# Registration Feature — Implementation Plan

## Context

First feature of the project: user registration with optional email confirmation (OTP or magic link).
The original draft of this document was written for no particular stack and departed from
[technical_specification.md](technical_specification.md) (the source of truth) in several places.
This plan fixes those departures, ties the work to this NestJS + Fastify + TypeORM codebase, and splits it into small,
reviewable steps. Each step ends with a manual verification.

**Spec sections implemented:** §2 "Registration Flow", §2 "Email Challenge Protocols", §2 "Challenge Tables & `consumed_reason` Enum",
§4 "Safe Profile Contract", plus the cross-cutting rules in §1: the error code table, "DTO Whitelisting" and "Error Masking & Anti-Enumeration".

> §2: "`password`: Length 8 ≤ length ≤ 128 … at least one letter and one digit." "Argon2id (recommended default)."
> "Disabled (`false`): Atomically creates the user record with `status = "active"` … Returns `201 Created` with the Safe Profile DTO."
> "Enabled (`true`): … `status = "pending"` … Returns `202 Accepted` with `{confirmationRequired, method, attemptId, expiresInSeconds, resendAfterSeconds}`."
> "OTP: 6-digit … 10-minute TTL. Maximum 5 submission attempts (the 5th attempt can be valid) … HMAC-SHA256(code, LOGIN_CHALLENGE_HMAC_KEY)."
> "Magic Link: 32-byte … base64url … Sent to the user as `attemptId.secret` … strictly handled via `POST /auth/register/confirm`."
> "Resend: at most 1 request every 60 seconds per attempt. Revokes previous secret (`consumed_reason = "replaced"`), resets attempt counter, fresh 10-minute TTL."

## Corrections to the draft

| Draft | Spec / decision |
|---|---|
| Stack options, `DATABASE_URL` | Fixed stack. Existing `POSTGRES_*` config |
| `REQUIRE_EMAIL_CONFIRMATION`, `APP_SECRET_HMAC` | `REGISTRATION_EMAIL_CONFIRMATION_ENABLED`, `LOGIN_CHALLENGE_HMAC_KEY` (Joi: ≥ 32 bytes, otherwise the app refuses to boot) |
| `status`: pending/active | Postgres enum with 5 values: `pending, active, blocked, deleting, deleted`. Also `display_name` and `photo_key` columns so `SafeProfileDto` can be built |
| No `consumed_reason` | `consumed_reason` enum: `confirmed, replaced, attempts_exhausted, user_inactive` |
| Resend updates the challenge in place | Resend **creates a new row** and marks the old one `replaced`. Response returns the new `attemptId` |
| Magic link looked up by `secret_hash` index | Token is `attemptId.secret`: look up by PK, then compare HMACs with `timingSafeEqual` |
| 201 returns `{id,email,status}` | 201 / 200 return the 7-field `SafeProfileDto` |
| 409 on existing email | **Enumeration-safe** (decided, details below). 409 only when confirmation is OFF |
| Keep pending user on SMTP failure | **Roll back** (decided). Send inside the transaction, 503 `service_unavailable` on failure |
| Resend body `{email}`, 400 if no user | Body `{attemptId}`: per-attempt cooldown, no enumeration |
| bcrypt 72-byte cap | Argon2id, so the 128-char cap from the spec is enough |
| Assign `user` role | **Deferred** (decided). The spec §3 bootstrap gives the role to role-less active users later |
| Audit-log interceptor that filters bodies | Overkill. Write `Logger` event lines with ids only and never log request bodies |
| Not covered | Concurrency: unique-violation race (Postgres `23505` error) and parallel OTP guesses (row lock) |

## Decided behaviour (enumeration-safe registration)

`POST /auth/register` with confirmation **ON**:
- **New email:** in a transaction, create a `pending` user and a challenge, send the email. Return 202.
- **Existing `pending` email:** if the latest challenge is less than 60 s old, return 202 with the same attemptId and send nothing (prevents email bombing).
  Otherwise update `password_hash` (latest registration wins), mark the old challenge `replaced`, create a new one, send. Return 202.
  This also rescues users who lost the first email.
- **Existing `active`/other email:** still run argon2 hashing (keeps response time the same), send nothing, return 202 with a random **decoy** `attemptId`.
- Every branch returns the same response shape, and the work done is similar enough that timing stays close.

Confirmation **OFF**: there is nothing to hide behind (an account either gets created or it doesn't), so an existing email returns 409 `conflict`.
Concurrent inserts are caught through the unique-constraint error `23505` and mapped to 409 (or to the pending branch).

`POST /auth/register/resend` with an unknown attemptId returns a decoy 202, so a resend can't be used to tell decoys from real ids.

## Steps

### Step 0 — Fix boilerplate gaps that block this feature (known gaps from CLAUDE.md)
- Migration naming: change the `migration:generate`/`create` scripts in `package.json` to emit `<ts>-<Name>.migration.ts`, or change the glob in
  [database.module.ts](../src/core/database/database.module.ts) and [data-source.ts](../src/database/data-source.ts). Both must stay in sync.
- Add `moduleNameMapper: { "^@/(.*)$": "<rootDir>/$1" }` to the jest config in `package.json` (and to `test/jest-e2e.json`, mapping to `<rootDir>/../src/$1`).
- [main.ts](../src/main.ts): add `ValidationPipe({ whitelist, forbidNonWhitelisted: true, transform: true, exceptionFactory → bad_request })`.
- Add a global exception filter `src/core/http/http-exception.filter.ts` that writes the spec error shape `{ statusCode, code, message }` through `FastifyReply`.
  Add small helpers or exception classes for each `code` (`bad_request`, `conflict`, `rate_limit_exceeded`, `service_unavailable`).
- Import `AuthModule` in [app.module.ts](../src/core/app/app.module.ts). Register `ThrottlerGuard` as `APP_GUARD`.
- Add a `@Public()` decorator in `src/modules/auth/decorators/public.decorator.ts`. It only marks routes for now; the JWT guard that reads it comes with login.
- Verify: `npm run build`, `npm test`, and `POST` an unknown field to any route → 400 `bad_request`.

### Step 1 — Config + Mailpit
- Config keys, added to [config.types.ts](../src/core/config/config.types.ts), [config.validation.ts](../src/core/config/config.validation.ts) and `.env.example`:
  `REGISTRATION_EMAIL_CONFIRMATION_ENABLED` (bool, default false), `REGISTRATION_CONFIRMATION_METHOD` (`otp|magic_link`),
  `LOGIN_CHALLENGE_HMAC_KEY` (required, min 32 bytes), `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER?`, `SMTP_PASS?`, `SMTP_FROM`,
  `FRONTEND_BASE_URL` (used to build the magic-link URL).
- Add a `mailpit` service to `docker-compose.yml` (SMTP on 1025, UI on 8025).
- Verify: the app refuses to boot when the HMAC key is short. Mailpit UI opens at http://localhost:8025.

### Step 2 — `users` table (UsersModule)
- `src/modules/users/entities/user.entity.ts`: `id` uuid, `email` varchar(255) unique, `password_hash`, `display_name` null,
  `photo_key` null, `status` enum (5 values, default `pending`), `created_at` / `updated_at` timestamptz.
  The email is already normalized by the DTO, so a plain unique index is enough. Add `CHECK (email = lower(btrim(email)))` as a safety net in the database.
- `src/modules/users/dto/safe-profile.dto.ts` + a `toSafeProfile(user)` mapper (`photoUrl` = `/users/{id}/photo` or null). Unit test.
- Add a `UsersService` with `findByEmail` and `create`, exported from `UsersModule`.
- Generate the migration, review the SQL, check that `down()` really undoes `up()`, then run it.
- Verify: run `\d users` in psql and `npm run migration:show`.

### Step 3 — `registration_challenges` table (AuthModule)
- `src/modules/auth/entities/registration-challenge.entity.ts`: `id` uuid, `user_id` FK→users ON DELETE CASCADE, `method` enum,
  `secret_hash` char(64), `attempts` int default 0, `created_at` (used as "sent at" for the cooldown), `expires_at`, `consumed_at` null,
  `consumed_reason` enum null. Add `CHECK ((consumed_at IS NULL) = (consumed_reason IS NULL))` and an index on `user_id`.
- Migration, verified the same way as step 2.

### Step 4 — Security primitives (pure, unit-tested)
- New dependency: `argon2`, for Argon2id as the spec recommends.
- `src/modules/auth/password-hasher.service.ts`: `hash` and `verify` (argon2id).
- `src/modules/auth/challenge-secret.service.ts`: `generateOtp()` (`crypto.randomInt(0, 1e6)`, zero-padded),
  `generateMagicSecret()` (`randomBytes(32).toString('base64url')`), `hmac(secret)` (HMAC-SHA256 with `LOGIN_CHALLENGE_HMAC_KEY`, hex),
  `matches(raw, storedHash)` (length check + `timingSafeEqual`).
- `src/modules/auth/dto/register.dto.ts`: `@Transform` trim + lowercase, `@IsEmail`, `@MaxLength(255)`. Password: 8–128 chars,
  `\p{L}` (a letter in any script) and `\d`. **(Learn by Doing: password policy validation.)**
- Unit tests: normalization edge cases, password policy matrix, OTP format, HMAC matches/mismatches.

### Step 5 — Mail
- New dependency: `nodemailer` (+ `@types/nodemailer`), the standard SMTP client.
- `src/modules/mail/mail.service.ts` (`MailModule`): `sendRegistrationOtp(email, code)` and `sendRegistrationMagicLink(email, token)`.
  Link format: `${FRONTEND_BASE_URL}/register/confirm#token=<attemptId.secret>`. The URL fragment never reaches servers or `Referer` headers.
  The frontend page POSTs the token, so opening the link does nothing on the server.
- SMTP errors become 503 `service_unavailable`. The service sits behind a class token, so tests can mock it or make it throw.
- Verify: a small manual call sends a message that shows up in Mailpit.

### Step 6 — `POST /auth/register`, confirmation OFF
- `auth.controller.ts` (`@Public()`, `@Throttle`), `registration.service.ts`.
- New email: hash, insert an `active` user, return 201 + SafeProfile. Existing email or `23505`: 409 `conflict`.
- Unit tests with a mocked repository. Verify: run curl twice → 201, then 409. `SELECT` shows `status=active` and an argon2 hash.

### Step 7 — `POST /auth/register`, confirmation ON
- `@Transactional()` flow covering the three branches in "Decided behaviour". The email is sent last, inside the transaction, so a failure rolls everything back and returns 503.
- Use `@HttpCode` / `reply.status` to switch between 201 and 202 depending on config.
- Unit tests for each branch and for the SMTP failure rollback. Verify: curl → 202, the code appears in Mailpit, the response contains no secret.

### Step 8 — `POST /auth/register/confirm`
- Body is either `{ attemptId, code }` (OTP) or `{ token: "attemptId.secret" }` (magic link). A DTO checks that exactly one form is used.
- In a transaction, `SELECT … FOR UPDATE` the challenge (TypeORM `lock: { mode: 'pessimistic_write' }`). This makes parallel guesses wait, so none of them can skip the attempt counter.
- Order of checks **(Learn by Doing: this decision sequence)**:
  not found / consumed / expired → 400 `bad_request` (attempts stay unchanged) → user no longer `pending` → consume with `user_inactive`, 400
  → secret mismatch → `attempts++`. If this is the 5th failure, consume with `attempts_exhausted` and return 429 `rate_limit_exceeded`, otherwise 400
  → match → consume with `confirmed`, set the user `active`, return 200 + SafeProfile.
- All 400s carry the same generic message.
- Unit tests: wrong code ×4 then right code on the 5th → 200. Wrong ×5 → 429, then 400. Expired, replaced and inactive cases.

### Step 9 — `POST /auth/register/resend`
- Body `{ attemptId }`. Unknown id → decoy 202. Consumed or expired-and-confirmed → 400. Less than 60 s since the challenge's `created_at` → 429 `rate_limit_exceeded`.
- Otherwise, in a transaction: mark the old challenge `replaced`, create a new one (same method, attempts 0, fresh TTL), send the email, return 202 with the new attemptId.
- Unit tests for the cooldown, replacement, and showing the old code no longer works.

### Step 10 — Rate limits + logging
- `@Throttle` per route. The spec gives no numbers for registration, so we pick them, close to the login figure: register 10/min/IP, confirm 30/min, resend 10/min.
  Note: the throttler keeps its counters in each process's memory, so the limits are per instance. Fine for now.
- `Logger` event lines (`registration.created`, `registration.challenge_sent`, `registration.confirmed`, `registration.confirm_failed{reason}`)
  with user and challenge ids only. No emails in failure logs, and no bodies, codes, tokens or hashes ever.

### Step 11 — e2e
- Rewrite `test/app.e2e-spec.ts` to use `FastifyAdapter` + `.ready()`, a real Postgres test database, and Mailpit's API (`GET /api/v1/messages`) to read codes.
- Flows: OFF → 201 / 409. ON + OTP → 202, wrong×4, right → 200, active in the database. Exhaustion → 429. Resend → old code 400, new code 200.
  Magic link → POST token → 200. Existing active email → 202 decoy and no mail sent. SMTP down → 503 with no rows left behind.

## Learn-by-Doing points (one at a time, as each step comes up)
1. Password policy validation in `register.dto.ts` (step 4).
2. The confirm decision sequence in `registration.service.ts` (step 8).

## Out of scope (mention, don't build)
`user` role assignment (RBAC), cleanup of stale pending users, auto-login cookies after confirm (needs JWT/login), CSRF guard,
outbox pattern for email.

## Verification (end-to-end)
`docker compose up -d` (Postgres + Mailpit) → `npm run migration:run` → `npm run build` → `npm test` → `npm run test:e2e`.
Manual check: register with each config combination using curl, read the code at http://localhost:8025, confirm, and run
`SELECT email,status FROM users; SELECT attempts,consumed_reason FROM registration_challenges;`

