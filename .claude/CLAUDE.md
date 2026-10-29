# Backend Practice — Auth, Users, RBAC & File Transformation Service

NestJS 11 + Fastify + TypeORM + PostgreSQL monolith. The full product requirements live in
[docs/technical_specification.md](../docs/technical_specification.md) — it is the source of truth for
behaviour, status codes, error codes, table schemas and limits. Read the relevant section before
implementing any feature, and quote the section you are implementing in your plan.

## Who you are working with

The developer is an experienced **frontend** developer learning backend to become fullstack. This is a
training project, so learning matters as much as working code:

- Before writing a non-trivial piece, briefly explain the backend concept behind it (e.g. what a guard,
  interceptor, transaction, migration or index is) — use frontend analogies where they genuinely fit
  (guard ≈ route guard, interceptor ≈ axios interceptor, DTO ≈ typed form schema, module ≈ feature folder with DI).
- Work in small, reviewable steps (one entity / one endpoint / one guard at a time), not whole modules in one go.
- After each step, say how to verify it manually (curl/HTTPie command, SQL query, or test to run).
- Point out *why* a security rule from the spec exists (timing attacks, enumeration, CSRF, XXE…), not just what it is.
- Don't silently "fix" things outside the task — mention them and let the developer decide.

## Commands

```bash
docker compose up -d          # local Postgres (reads .env)
npm run start:dev             # dev server with watch
npm run build                 # tsc via nest build — use as the type-check
npm run lint                  # eslint --fix
npm run format                # prettier
npm test                      # unit tests (*.spec.ts under src/)
npx jest path/to/file.spec.ts # single test file
npm run test:e2e              # e2e tests (test/*.e2e-spec.ts)
npm run migration:generate    # diff entities vs DB → new migration (DB must be running)
npm run migration:run | migration:revert | migration:show
```

After changing code, run `npm run build` and the relevant tests before calling the step done.

## Architecture

```
src/
├── main.ts                 # bootstrap: Fastify adapter, global ValidationPipe, CORS, cookies, compression
├── core/                   # infrastructure, not business logic
│   ├── app/app.module.ts   # root module — register new feature modules here
│   ├── config/             # typed env config (Joi validated at startup)
│   ├── database/           # TypeORM connection + typeorm-transactional
│   ├── health/             # GET /health (terminus)
│   └── throttler/          # @nestjs/throttler config
├── database/
│   ├── data-source.ts      # DataSource for the TypeORM CLI only
│   └── migrations/
└── modules/                # feature modules (auth, users, rbac, transformations, …)
```

Feature module layout (create files only as they are needed):

```
src/modules/<feature>/
├── <feature>.module.ts
├── <feature>.controller.ts
├── <feature>.service.ts
├── entities/<name>.entity.ts
├── dto/<action>-<name>.dto.ts
├── guards/ | decorators/ | adapters/   # when needed
└── *.spec.ts                           # next to the file under test
```

## Conventions

- **HTTP layer is Fastify, not Express.** Use `FastifyRequest` / `FastifyReply` from `fastify`, Fastify plugins
  via `app.register(...)`, and `reply.setCookie(...)` from `@fastify/cookie`. Never import types from `express`.
- **Imports:** use the `@/` alias for cross-folder imports (`@/core/config/config.service`); relative imports
  only within the same module folder.
- **Config:** never read `process.env` in app code. Add the key to `config.types.ts` + `config.validation.ts`
  (+ `.env.example`), then inject `ConfigService`. Note `ConfigService.get()` returns `string` — convert
  numbers/booleans explicitly (see `database.module.ts`).
- **Validation:** request bodies/params/queries are `class-validator` DTO classes. Joi is used only for env config.
- **Database:** entities are `*.entity.ts` (auto-loaded). Schema changes go through migrations — never
  `synchronize: true`. Use `@Transactional()` from `typeorm-transactional` for multi-write operations.
- **Errors:** responses must follow the spec's error shape with a machine-readable `code`
  (`bad_request`, `invalid_session`, `permission_denied`, `conflict`, …) — see the status table in spec §1.
- **Responses:** users are only ever returned as the 7-field `SafeProfileDto` (spec §4). Never return entities directly.
- **Security defaults from the spec:** endpoints are private by default (`@Public()` opt-out), auth comes from
  HttpOnly cookies only, never log secrets/passwords/tokens, auth failures return generic messages.
- Tests use Jest + `@nestjs/testing`. Unit test services with mocked repositories; e2e for HTTP flows.

## Known gaps in the boilerplate (fix when the related feature is touched)

- `.env.example` is the template for `.env`; copy it and fill in secrets before running.
- Migration glob in `database.module.ts` / `data-source.ts` is `*.migration{.ts,.js}`, but
  `npm run migration:generate` produces `<timestamp>-Migration.ts`, which does **not** match — migrations would
  be silently ignored. Align the file naming and the glob before the first migration.
- Jest config has no `moduleNameMapper` for `@/` → unit tests importing via `@/` will fail to resolve.
- Global `ValidationPipe` has `whitelist: true` but not `forbidNonWhitelisted: true` / `transform: true` required by spec §1.
- `test/app.e2e-spec.ts` is the stale Nest default (expects `GET /` → "Hello World!"), and e2e uses the Express
  adapter rather than Fastify.
- `ThrottlerModule` is configured but no `ThrottlerGuard` is registered, so rate limiting is not active yet.
- `AuthModule` exists but is not imported in `AppModule`.
