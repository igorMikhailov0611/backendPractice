# Registration Feature — Implementation Plan

## Context

First feature of the project: user registration with optional email confirmation (OTP or magic link).

**Source of truth for registration:** the mentor's [registration_requirements.md](registration_requirements.md)
("1.0 Регистрация"). Where it disagrees with [technical_specification.md](technical_specification.md), the mentor's doc
wins. The spec still applies to everything the mentor's doc doesn't cover (error `code` values and shape from §1, DTO
whitelisting, config key validation).

**Sections implemented:** mentor's doc §1.1–1.6 (contract, errors, audit, non-functional requirements) and the
"Модель" / "Понятия" theory sections; spec §1 error table and "DTO Whitelisting".

> 1.3.1: "**Подтверждение выключено:** 201 Created, `id`, нормализованный `email`, `status: active`."
> "**Подтверждение включено:** 202 Accepted, `confirmationRequired: true`, `method`, `attemptId`, `expiresInSeconds: 600`, `resendAfterSeconds: 60`."
> 1.3.2: "Пятая попытка ещё может быть успешной. Пятый неверный ввод — это неверный код, и попытка после него погашена.
> Следующий запрос, даже с верным кодом, отклоняется как исчерпанный лимит."
> "Ссылка: 32 случайных байта. Попытка находится по HMAC токена, идентификатор в него не входит."
> `POST /auth/register/resend` — `email`: "Не чаще 1 раза в 60 секунд … заново запускает TTL и обнуляет счётчик попыток."
> 1.4: "**409** — email уже зарегистрирован … **503** — письмо не отправлено. Запись `pending` и попытка при этом сохранены."

## Where we depart from the spec (mentor's doc wins)

| Topic | technical_specification.md | This plan (mentor's doc) |
|---|---|---|
| Taken email | Anti-enumeration | Explicit **409** `conflict`, also for a `pending` email |
| Response body | 7-field `SafeProfileDto` | `{ id, email, status }` (201 register, 200 confirm) |
| Magic-link token | `attemptId.secret` | 32 random bytes, no id. Lookup by `HMAC(token)` |
| Resend | Per attempt, new secret marks old `replaced` | Body `{ email }`. Same challenge row is updated in place |
| `consumed_reason` enum | Required | Not used. `consumed_at` + `attempts` are enough |
| Users status | 5-value enum | `pending`, `active` (more values get added by a later migration) |

## Decided behaviour

**Register** (`POST /auth/register`):
- Validate → hash (Argon2id) → branch on `REGISTRATION_EMAIL_CONFIRMATION_ENABLED`.
- **OFF:** insert an `active` user → **201** `{ id, email, status: "active" }`.
- **ON:** in one transaction insert a `pending` user + a challenge (with `last_sent_at = now()`), **commit**, then send the email.
  - Sent → **202** `{ confirmationRequired, method, attemptId, expiresInSeconds: 600, resendAfterSeconds: 60 }`.
  - SMTP failed → set `last_sent_at = NULL` (nothing was delivered, so the secret is not valid and resend has no cooldown),
    keep the user + challenge, return **503** `service_unavailable`.
- Email already exists (any status), or Postgres unique violation `23505` from a parallel request → **409** `conflict`.

**Confirm** (`POST /auth/register/confirm`), body is exactly one of `{ attemptId, code }` or `{ token }`:
- Runs whether the flag is on or off (the flag only affects new registrations).
- In a transaction, load the challenge **with a row lock** (`SELECT … FOR UPDATE`) — by `id` for OTP, by `secret_hash = HMAC(token)` for a link.
- Order of checks:
  1. Not found → 400.
  2. OTP and `attempts >= 5` → **429** `rate_limit_exceeded` (exhausted — even with the right code).
  3. `consumed_at` set → 400.
  4. Never delivered (`last_sent_at IS NULL`) or expired (`now > last_sent_at + 10 min`) → 400, **attempts unchanged**.
  5. User is not `pending` → 400.
  6. Secret mismatch (`timingSafeEqual` on the HMACs) → `attempts++`; if it just reached 5, set `consumed_at`. Return 400.
  7. Match → user `active`, `consumed_at = now()` → **200** `{ id, email, status: "active" }`.
- Every 400 has the same generic message (`bad_request`).

**Resend** (`POST /auth/register/resend`, body `{ email }`):
- Unknown email, or user not `pending` → 400 generic.
- `last_sent_at` less than 60 s ago → **429**.
- Otherwise, in a transaction: new secret → `UPDATE` the same row: `secret_hash`, `attempts = 0`, `consumed_at = NULL`,
  `last_sent_at = now()`. Commit, send. This also revives an exhausted challenge (the mentor's doc: resend resets the counter).
  The old code/link stops working because its hash is gone.
- Sent → **202** (same body as register, same `attemptId`). SMTP failed → `last_sent_at = NULL`, **503**.

### `expires_at`: computed, not stored

The mentor's doc shows `expires_at` as a column and explains it is always `last_sent_at + 10 min` (a transitive
dependency, so the table is only in 2NF and an update can forget one of the two fields). We **compute** it instead:
`expires_at = last_sent_at + 600 s`. Resend then only touches `last_sent_at`, the update anomaly can't happen, and the
table is in BCNF. `last_sent_at IS NULL` doubles as "never delivered".

## Steps

### Step 0 — Boilerplate gaps ✅ (commit `4c170e4`)

### Step 1 — Config + Mailpit (in progress)
- Keys already added: `REGISTRATION_EMAIL_CONFIRMATION_ENABLED`, `REGISTRATION_CONFIRMATION_METHOD`,
  `LOGIN_CHALLENGE_HMAC_KEY` (≥ 32 bytes, `minBytes` — TODO(human)), `SMTP_*`, `FRONTEND_BASE_URL`.
- **Add:** `REGISTRATION_RATE_LIMIT` (requests per minute per IP, default 10). The mentor's doc §1.6 says the registration threshold is set in config.
- Mailpit service in `docker-compose.yml` (done).
- Verify: `npx jest src/core/config`, app refuses to boot with a short HMAC key, http://localhost:8025 opens.

### Step 2 — `users` table (UsersModule)
- `src/modules/users/entities/user.entity.ts`: `id` uuid, `email` varchar(255) unique, `password_hash` text,
  `status` enum `pending|active` (default `pending`), `created_at` / `updated_at` timestamptz.
- `CHECK (email = lower(btrim(email)))` as a database-side safety net for normalization.
- `UsersService` (`findByEmail`, `create`), exported from `UsersModule`.
- `src/modules/auth/dto/registered-user.dto.ts` + mapper `toRegisteredUser(user) → { id, email, status }`. Unit test.
- Generate the migration, read the SQL, check `down()`, run it. Verify: `\d users`, `npm run migration:show`.

### Step 3 — `registration_challenges` table (AuthModule)
- `id` uuid, `user_id` FK → users ON DELETE CASCADE, **unique** (one challenge per user — resend updates it),
  `method` enum `otp|magic_link`, `secret_hash` char(64) with a **partial** unique index `WHERE method = 'magic_link'`
  (magic-link lookup; OTP hashes repeat across users because there are only 10⁶ codes, so they must not be unique), `attempts` int default 0,
  `last_sent_at` timestamptz null, `consumed_at` timestamptz null, `created_at`.
- Migration, verified the same way as step 2.

### Step 4 — Security primitives (pure, unit-tested)
- Dependency: `argon2`.
- `password-hasher.service.ts`: `hash`, `verify` (Argon2id).
- `challenge-secret.service.ts`: `generateOtp()` (`crypto.randomInt(0, 1_000_000)`, zero-padded to 6),
  `generateMagicToken()` (`randomBytes(32).toString('base64url')`), `hmac(secret)` (HMAC-SHA256, hex),
  `matches(raw, storedHash)` (`timingSafeEqual`).
- `dto/register.dto.ts`: email `@Transform` trim + lowercase, `@IsEmail`, `@MaxLength(255)`. Password **not trimmed**,
  8–128 chars, at least one `\p{L}` and one `\d`. **(Learn by Doing: password policy.)**
- Unit tests: normalization, password matrix (incl. `секрет12` ✓, leading/trailing spaces kept), OTP format, HMAC match/mismatch.

### Step 5 — Mail
- Dependency: `nodemailer` (+ `@types/nodemailer`).
- `MailModule` / `MailService`: `sendRegistrationOtp(email, code)`, `sendRegistrationMagicLink(email, token)`.
  Link: `${FRONTEND_BASE_URL}/register/confirm#token=<token>` — opening it does nothing on the server; a page (or you, with curl) POSTs the token.
- Throws a typed `MailDeliveryError`; the caller turns it into 503. Mockable in tests.
- Verify: a manual send shows up in Mailpit.

### Step 6 — `POST /auth/register`, confirmation OFF
- `auth.controller.ts` (`@Public()`, `@Throttle` from `REGISTRATION_RATE_LIMIT`), `registration.service.ts`.
- 201 + `{ id, email, status }`. Existing email / `23505` → 409.
- Unit tests with a mocked repository. Verify: curl twice → 201 then 409; `User@Example.com ` → 409 too; `SELECT` shows an `$argon2id$` hash.

### Step 7 — `POST /auth/register`, confirmation ON
- `@Transactional()` insert of user + challenge, then send **after commit**. Failure → `last_sent_at = NULL`, 503.
- Status 201 vs 202 chosen at runtime (`reply.status(...)`).
- Unit tests: happy path, 409 for a `pending` email, SMTP failure keeps rows and returns 503.
- Verify: curl → 202, code visible in Mailpit, not in the response. Stop Mailpit → 503, `SELECT` shows the pending user.

### Step 8 — `POST /auth/register/confirm`
- DTO: exactly one of `{ attemptId (uuid), code (6 digits) }` or `{ token }`.
- Pessimistic row lock so parallel guesses can't skip the counter.
- Decision sequence from "Decided behaviour". **(Learn by Doing: the check order.)**
- Unit tests: wrong ×4 then right → 200. Wrong ×5 → the 5th is 400, the 6th (even correct) → 429. Expired → 400 with
  attempts unchanged. Already confirmed → 400. Magic link: right token → 200, reused → 400.

### Step 9 — `POST /auth/register/resend`
- Unknown / non-pending → 400. Cooldown → 429. Otherwise in-place update, send, 202 (or 503).
- Unit tests: cooldown, old code fails after resend, exhausted challenge works again after resend, retry right after a 503.

### Step 10 — Rate limits + logging
- ~~`@Throttle`: register from config~~ ✅ done in step 6: named `registration` throttler in
  `core/throttler/throttler.module.ts` (`REGISTRATION_RATE_LIMIT` per 60 s per IP), opted into with
  `@RegistrationThrottle()` (config can't be read inside `@Throttle(...)` arguments, since decorators run before DI).
- Resend: 10/min/IP on top of the 60 s per-email cooldown. A static `@Throttle({ default: { limit: 10, ttl: 60_000 } })` works here.
- `Logger` events with ids only: `registration.created`, `registration.failed{reason}`, `registration.email_sent`,
  `registration.email_failed`, `registration.confirmed`, `registration.confirm_failed{reason}`.
  Never passwords, hashes, codes, tokens or whole request bodies.

### Step 11 — API description (mentor's doc §1.6: "описание API")
- `@nestjs/swagger` with the Fastify adapter, decorators on the three endpoints and their DTOs, UI at `/docs`.

### Step 12 — e2e
- Fastify-based e2e app, a real Postgres test database, Mailpit API (`GET /api/v1/messages`) to read codes.
- Flows: OFF → 201 / 409. ON + OTP → 202, wrong ×4, right → 200. Exhaustion → 400 then 429. Resend → old code 400, new 200.
  Magic link → POST token → 200. Pending email → 409. SMTP down → 503, rows kept, resend after Mailpit is back → 202.

## Learn-by-Doing points
1. `minBytes` Joi validator (step 1, in progress).
2. Password policy in `register.dto.ts` (step 4).
3. Confirm decision sequence in `registration.service.ts` (step 8).

## Out of scope (mention, don't build)
`user` role assignment (comes with RBAC, in the same transaction that makes the user `active`), cleanup of stale
`pending` users, CORS origin allowlist (not needed while the client is an HTTP tool), login/JWT cookies, outbox pattern for email.

## Verification (end-to-end)
`docker compose up -d` → `npm run migration:run` → `npm run build` → `npm test` → `npm run test:e2e`.
Manual: register with each config combination, read the code at http://localhost:8025, confirm, then
`SELECT email, status FROM users; SELECT attempts, last_sent_at, consumed_at FROM registration_challenges;`
