---
paths:
  - "src/**/*.spec.ts"
  - "test/**"
---

# Testing rules

- Unit tests live next to the file under test as `<name>.spec.ts`; e2e tests live in `test/` as `*.e2e-spec.ts`.
- Unit tests: build the module with `Test.createTestingModule`, mock repositories via
  `{ provide: getRepositoryToken(Entity), useValue: mockRepo }` and mock `ConfigService` values.
- Cover the failure paths the spec cares about, not just the happy path: wrong status codes and `code` values,
  inactive user statuses, expired/exhausted challenges, permission vs `*_any` ownership cases.
- e2e tests must use the Fastify adapter (`new FastifyAdapter()` + `app.getHttpAdapter().getInstance().ready()`)
  to match production, and a real Postgres database rather than mocks.
- Never weaken an assertion just to make a failing test pass — find out why it fails.
