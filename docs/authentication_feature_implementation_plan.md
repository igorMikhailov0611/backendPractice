# Authentication Feature — Implementation Plan

## Context

Second feature of the project: login by email + password, an optional email step (OTP or magic link), stateless
JWT access/refresh in HttpOnly cookies, refresh, logout, and the global access check every protected route goes through.

**Source of truth for authentication:** the mentor's [authentication_requirements.md](authentication_requirements.md)
("1.1.1 Аутентификация"). Where it disagrees with [technical_specification.md](technical_specification.md), the
mentor's doc wins. The spec still applies to everything the mentor's doc doesn't cover (error `code` values and shape
from §1, the 5-stage pipeline order, default-deny). A generic NestJS/Express plan derived from the mentor's doc was
used as a guide only. Section A lists what changed compared to it.

**Sections implemented:** mentor's doc §1.1–1.6 and the "Модель" / "Понятия" theory sections; spec §1 "Unified
Security Chain" stages 1–3, error table, "Default-Deny"; spec §2 "Direct Login & Step-Up", "Token Lifecycle".

> 1.3.1: "Для отсутствующего пользователя, неверного пароля и любого статуса кроме `active` вернуть одну нейтральную ошибку **401**."
> "Если SMTP не принял письмо после фиксации, попытка сохраняется, а **503** содержит `confirmationRequired`, `method`, `attemptId` и `retryAfterSeconds`, но не секрет."
> 1.3.2: "заблокировать пользователя и строку попытки именно в этом порядке … Истёкший TTL запрещает подтверждение, но не resend … `attempts_exhausted` — **429**."
> 1.3.3: "Все POST-запросы из другого origin проверяют точный `Origin` и заголовок `X-CSRF-Protection: 1` … Если origin находится на другом site, обе auth-cookie дополнительно получают `SameSite=None; Secure`."
> 1.3.6: "Недоступность базы даёт **503**."
> 1.5: "Для неизвестного email используется необратимый служебный идентификатор с отдельным ключом."
> 1.6: "не более 30 запросов с IP за минуту и не более 5 неуспешных проверок на пару email и IP за 15 минут."

## Where login differs from registration (both follow their mentor docs)

| Topic | Registration | Login |
|---|---|---|
| Magic-link token | 32 bytes, no id, lookup by `HMAC(token)` | `attemptId.secret`, lookup by id, then compare `HMAC(secret)` |
| `consumed_reason` | Not used | Required: `confirmed`, `replaced`, `attempts_exhausted`, `user_inactive` |
| New attempt | Resend updates the one row | New login marks the old row `replaced` and inserts a new one. Resend updates in place |
| Resend after 5 wrong codes | Revives the challenge | **429**. Exhaustion is final: new tries require the password again |
| Resend body | `{ email }` | `{ attemptId }` |
| SMTP failure | `last_sent_at = NULL`, generic 503, retry at once | Attempt kept, `last_sent_at` kept, 503 **with** `attemptId` + `retryAfterSeconds` |
| Unknown email | 409 is fine (explicit) | Same 401 as wrong password, plus a dummy hash check |

## A. Changes to the generic plan (adapting it to this codebase)

### A1. Fastify, not Express

- No `cookie-parser`. `@fastify/cookie` is already registered in `src/main.ts`. Use `request.cookies` and
  `reply.setCookie(...)` / `reply.clearCookie(...)` on `FastifyReply`.
- `request.user`: add it through Fastify declaration merging
  (`declare module 'fastify' { interface FastifyRequest { user?: { userId: string } } }`) and read it with a
  `@CurrentUser()` param decorator.
- The global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`) already exists in
  `src/core/http/validation.pipe.ts`. Nothing to add.

### A2. Reuse what registration already built

- `ChallengeSecrets` (`generateOtp`, `generateMagicToken`, `hmac`, `matches`). No new `ChallengeService`.
- `PasswordHasher.verify` for login. The **dummy hash** is computed once in `onModuleInit` with
  `PasswordHasher.hash(randomBytes(32))`, so its Argon2 parameters always match real hashes. A hard-coded constant
  could drift from them and make "unknown email" measurably faster.
- `registration.constants.ts` (600 s TTL, 60 s cooldown, 5 attempts). Renaming it to `challenge.constants.ts` is
  optional.
- `ChallengeMethod` (own DB enum name `login_challenge_method`), `ConfirmationRequiredDto` (202 body),
  `NormalizedEmail`, `NotTogetherWith`, `ErrorResponseDto`, `isUniqueViolation`.
- `MailService` gets `sendLoginOtp(to, code)` and `sendLoginMagicLink(to, token)`. The link is
  `${FRONTEND_BASE_URL}/login/confirm#token=<attemptId>.<secret>`.
- The structure of `RegistrationService`:
  - a pure `decide…()` function: no DB, no clock, unit-tested;
  - a `@Transactional()` private method that locks rows and returns an *outcome*;
  - a public method that throws **after commit**, so `attempts++`, `user_inactive` and `replaced` are not rolled
    back by a 4xx.

  One deliberate exception: a JWT signing failure on confirm must roll back (mentor 1.3.2), so it throws inside the
  transaction.
- `users` already has `UNIQUE(email)` + `CHK_users_email_normalized`. No new email index is needed.

### A3. Config: project conventions

No `registerAs('auth')`. Keys go into `src/core/config/config.types.ts`, `config.validation.ts` and `.env.example`.

| Key | Rule |
|---|---|
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `AUDIT_EMAIL_HMAC_KEY` | `required().custom(minBytes(32))` (`minBytes` already exists) |
| All four crypto keys incl. `LOGIN_CHALLENGE_HMAC_KEY` | Object-level Joi `.custom()`: they must all differ |
| `JWT_ISSUER`, `JWT_AUDIENCE` | Required strings, no defaults |
| `LOGIN_EMAIL_CONFIRMATION_ENABLED` | Boolean, default `false` |
| `LOGIN_EMAIL_CONFIRMATION_METHOD` | `otp` \| `magic_link`, default `otp`. Read per request, so a change affects only new logins |
| `TRUSTED_ORIGINS` | Comma-separated exact origins. Replaces the hard-coded CORS list in `main.ts` |
| `AUTH_COOKIE_CROSS_SITE` | Boolean, default `false`. `true` → both cookies `SameSite=None; Secure` |
| `AUTH_RATE_LIMIT` | Requests/min/IP for login and refresh, default 30 (configurable so e2e can raise it) |

CORS in `main.ts`: `origin` = `TRUSTED_ORIGINS`, `credentials: true`,
`allowedHeaders: ['Content-Type', 'X-CSRF-Protection']`.

There is deliberately no "insecure cookies" switch, because the mentor allows no exception to HTTPS. Browsers accept
`Secure` cookies from `http://localhost`. With curl, pass cookies explicitly (`--cookie "access_token=…"`).

### A4. Errors fit the existing `ApiException` + `HttpExceptionFilter`

- Throw `new ApiException(status, code, message)`. A plain 401 already maps to `invalid_session`;
  `invalid_credentials` needs `ApiException`.
- **Core change 1:** `ApiException` gets two optional fields:
  - `extra`: a typed object merged into the response body;
  - `retryAfterSeconds`: also sent as a `Retry-After` header.

  Used for the 429 cooldown and the login SMTP 503 (`{ confirmationRequired, method, attemptId, retryAfterSeconds }`).
  The filter already passes `ApiException` bodies through on 5xx.
- **Core change 2 (developer confirms):** the filter maps TypeORM/pg *connection* errors (not constraint violations)
  to **503** `service_unavailable` instead of 500. This affects the whole app.

### A5. Database

**`login_challenges`** (mentor's table, BCNF, no `expires_at`), as an entity + `npm run migration:generate`:

| Column | Type / constraint |
|---|---|
| `id` | uuid PK (`attemptId`, first half of the magic-link token) |
| `user_id` | uuid FK → `users` `ON DELETE CASCADE` |
| `method` | enum `login_challenge_method` (`otp`, `magic_link`) |
| `secret_hash` | `char(64)`, CHECK `~ '^[0-9a-f]{64}$'` |
| `last_sent_at` | `timestamptz NOT NULL` |
| `attempts` | `int` default 0, CHECK `BETWEEN 0 AND 5` |
| `consumed_at` | `timestamptz NULL` |
| `consumed_reason` | enum `login_challenge_consumed_reason` NULL |
| `created_at` | `timestamptz` |

- Partial unique index `(user_id) WHERE consumed_at IS NULL`: at most one live attempt per user.
- CHECK `(consumed_at IS NULL) = (consumed_reason IS NULL)`: the two are always set together.
- No index on `secret_hash`: rows are always found by id.

**`login_failures`** (Postgres-backed limiter, a true 15-minute sliding window):

| Column | Type |
|---|---|
| `id` | uuid PK |
| `email_hash` | `char(64)`: `HMAC(AUDIT_EMAIL_HMAC_KEY, email)`, never the raw email |
| `ip` | `inet` |
| `created_at` | `timestamptz` |

- Index on `(email_hash, ip, created_at)`.
- Before Argon2: `COUNT(*) WHERE email_hash = $1 AND ip = $2 AND created_at > now() - interval '15 minutes'` ≥ 5 → 429.
- After a failed check (unknown email, wrong password or inactive user): insert a row and delete rows older than
  15 minutes.
- Rows are not reset on a successful login, which is the literal reading of "5 failed checks per 15 min".
- The same `AUDIT_EMAIL_HMAC_KEY` is the "irreversible identifier with a separate key" for logs (mentor 1.5).

**`users.status`:** add `blocked`, `deleting` and `deleted` to the `user_status` enum (`ALTER TYPE … ADD VALUE`), so
tests can cover all statuses the mentor lists. Code always checks `status !== UserStatus.Active`.

### A6. Guards and the request pipeline (spec §1 stages 1–3)

- **`AccessTokenGuard`**, a global `APP_GUARD` that skips `@Public()` routes:
  - reads the `access_token` cookie only and verifies it (`token_use = access`);
  - `SELECT id, status`, then `status !== active` → 401;
  - every failure gives the same 401 `invalid_session`. The category (`missing`, `malformed`, `signature`, `expired`,
    `claims`, `token_use`, `user_inactive`) goes to the log only;
  - DB error → 503.

  This makes default-deny real: `HealthController` needs `@Public()`. The registration routes already have it.
- **`CsrfGuard`**, global, for `POST`/`PUT`/`PATCH`/`DELETE`:
  - no `Origin` header → allow (not a browser cross-origin request);
  - `Origin` equals the request's own origin (`request.protocol://request.host`) → allow;
  - otherwise `Origin` must be in `TRUSTED_ORIGINS` **and** `X-CSRF-Protection` must be `1`. If not → 403
    `csrf_rejected`.

  Behind a TLS-terminating proxy, `trustProxy` must be on so `request.protocol` is correct (out of scope for now).
- **Order:** global guards run in registration order. ThrottlerGuard (ThrottlerModule) → AccessTokenGuard →
  CsrfGuard, the last two registered in this order in `AuthModule`. This matches the spec: JWT → status → CSRF.
- **Rate limits:** a named `auth` throttler (`AUTH_RATE_LIMIT` per 60 s per IP) with an `@AuthThrottle()` marker on
  login and refresh. This is the same pattern as `@RegistrationThrottle()`: decorator arguments can't read config,
  and a static 30 would break e2e because every request there comes from 127.0.0.1.
- **JWT:** `@nestjs/jwt` (a DI wrapper around the `jsonwebtoken` from the mentor's example). Every sign/verify call
  passes its own secret, `algorithms: ['HS256']`, `issuer`, `audience` and `clockTolerance: 30`. After `verify`,
  check `token_use` and that `sub` is a non-empty string. The payload is exactly `sub, iss, aud, iat, exp, token_use`.

### A7. Dependencies

- **Add:** `@nestjs/jwt`.
- **Not needed:** `cookie-parser`, `@types/cookie-parser` (Fastify cookie is in place), `testcontainers` (e2e already
  runs on a real `*_test` DB + Mailpit), `nestjs-pino` / `pino-http`. For "structured logs", Nest 11's
  `ConsoleLogger({ json: true })` is enough. Optional.

### A8. Audit (mentor 1.5)

- Nest `Logger`, one line per event, ids only:
  - `login.succeeded`, `login.failed reason=…`, `login.rate_limited`;
  - `login_challenge.created|resent|confirmed|mismatch|expired|exhausted|user_inactive`;
  - `refresh.succeeded`, `refresh.failed category=…`, `logout`, `access.rejected category=…`;
  - `csrf.rejected`, `smtp.failed`, `jwt.sign_failed`, `db.unavailable`.
- Every line carries `requestId` (Fastify `request.id`).
- Known user → `userId` (+ `attemptId`, `method`). Unknown email → `emailHash`.
- Never logged: raw email, password, password hash, OTP, token, HMAC, JWT, `Cookie` / `Set-Cookie`, keys, full URL,
  full body.

## B. Decided behaviour

### Login — `POST /auth/login` → 204 | 202 | 400 | 401 | 429 | 503

1. DTO: `email` via `@NormalizedEmail()`. `password`: `@IsString() @IsNotEmpty() @MaxLength(128)`, never trimmed.
   128 is the registration maximum, so a longer password can never match anyway, and the limit caps Argon2's work.
2. `@AuthThrottle()` (30/min/IP), then the `login_failures` window (≥ 5 → 429). Both run **before** Argon2.
3. Look up the user. If none, run the dummy hash check.
   - No user, wrong password, or `status !== active` → record a failure → **401** `invalid_credentials`. Same body
     for all of them.
4. **Confirmation OFF:** sign both JWTs (failure → 503, no `Set-Cookie`), set both cookies → **204**.
5. **Confirmation ON**, in one transaction:
   1. Lock `users` row `FOR UPDATE`, then the live challenge `FOR UPDATE`.
   2. Re-check `active` → if not, 401, no email.
   3. Live challenge sent < 60 s ago → **429** + `retryAfterSeconds`. No new attempt, no email.
   4. Mark it `consumed_at = now`, `consumed_reason = replaced`. Insert the new attempt (method from config).
   5. **Commit**, then send the email.
   - SMTP failure → **503** `{ confirmationRequired: true, method, attemptId, retryAfterSeconds }`. The attempt is
     kept. A retry goes through resend or login after 60 s.
   - Sent → **202** `{ confirmationRequired: true, method, attemptId, expiresInSeconds: 600, resendAfterSeconds: 60 }`.

   The `users` row lock is the mutex: on a first login there is no challenge row yet to lock, and two parallel logins
   must not both create one.

### Confirm — `POST /auth/login/confirm` → 204 | 400 | 401 | 429 | 503

Body: exactly one of `{ attemptId (uuid), code (6 digits) }` or `{ token: "<uuid>.<43 base64url chars>" }`.

1. Read `user_id` by `attemptId` (not found → 400). Then, in a transaction, lock `users` and then the challenge, and
   re-read both.
2. `attempts = 5` and `consumed_reason = attempts_exhausted` → **429**.
3. Any other `consumed_at` (`confirmed` / `replaced` / `user_inactive`) → 400.
4. `now > last_sent_at + 10 min` → 400, **attempts unchanged**.
5. User missing or not `active` → `consumed_reason = user_inactive`, commit → **401** `invalid_credentials`.
6. Constant-time HMAC compare.
   - OTP mismatch → `attempts++`. At 5 → `consumed_reason = attempts_exhausted`. Commit → 400.
   - Magic-link mismatch → 400, no counter.
7. Match → sign both JWTs (failure → throw inside the transaction → rollback → 503, the attempt can be retried) →
   `consumed_reason = confirmed` → commit → cookies → **204**.

### Resend — `POST /auth/login/resend` `{ attemptId }` → 202 | 400 | 429 | 503

1. Lock `users`, then the challenge.
   - Not found, or user not `active` → 400.
   - `attempts_exhausted` → **429**. Other consumed states → 400.
   - An expired TTL is **allowed**.
2. `last_sent_at` < 60 s ago → **429** + `retryAfterSeconds`.
3. New secret of the attempt's own method: update `secret_hash`, `last_sent_at = now` and `attempts = 0` in place.
   Commit.
4. Send.
   - SMTP failure → generic **503**. The new hash stays, and the next send is possible after 60 s.
   - Sent → **202** with the same body as login (`ConfirmationRequiredDto`; `confirmationRequired: true` is an extra
     harmless field).

### Refresh — `POST /auth/refresh` → 204 | 401 | 429 | 503

- `@Public()` (no access token needed) + `@AuthThrottle()`.
- Reads the `refresh_token` cookie only. Verify with `token_use = refresh` → read the user by `sub`.
- Not active / missing → **401** `invalid_session`. DB down → 503. Signing fails → 503, no `Set-Cookie`.
- Success → a new pair (new 30 days) → **204**. Nothing is stored. The old refresh token stays valid until its `exp`:
  a documented limitation of the stateless contract.

### Logout — `POST /auth/logout` → 204

`@Public()`. Always clears both cookies with the same `Path` / `Secure` / `SameSite` and no `Domain`. CSRF applies.

### Cookies

| Cookie | Attributes |
|---|---|
| `access_token` | `HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=900` |
| `refresh_token` | `HttpOnly; Secure; SameSite=Strict; Path=/auth/refresh; Max-Age=2592000` |

`SameSite=None` when `AUTH_COOKIE_CROSS_SITE=true`. Never a `Domain` attribute. One helper builds the options for both
`setCookie` and `clearCookie`, so the attributes can't drift apart. If they did, the browser would treat the clear as
a different cookie and keep the old one.

## C. Steps

Each step: explain the concept → code → `npm run build` + tests → manual check.

### Step 1 — Config + CORS

- New keys from A3, the distinct-keys validator **(Learn by Doing #1)**, `TRUSTED_ORIGINS` in `main.ts`.
- Verify: `npx jest src/core/config`. The app refuses to boot with a short key or with two equal keys.

### Step 2 — Core error extensions

- `ApiException.extra` + `retryAfterSeconds` → body + `Retry-After` header.
- DB connection error → 503 (after the developer confirms).
- Unit tests in `http-exception.filter.spec.ts`.

### Step 3 — More user statuses

- Migration adding `blocked`, `deleting`, `deleted` to `user_status`.
- Verify: `\dT+ user_status`, `npm run migration:show`.

### Step 4 — `TokenService` + cookie helpers

- `signPair(userId)`, `verify(token, 'access' | 'refresh')`, `setAuthCookies(reply, pair)`, `clearAuthCookies(reply)`.
- Unit tests: refresh token rejected as access, wrong `iss`/`aud`, the 30 s clock-skew boundary, a token with
  `alg: none` / HS512 rejected, empty `sub` rejected.

### Step 5 — `POST /auth/login`, confirmation OFF

- `login.service.ts`, `dto/login.dto.ts`, dummy hash, uniform 401, 204 + cookies, `@AuthThrottle()` (named `auth`
  throttler in `core/throttler`).
- Verify: `curl -i` → two `Set-Cookie` lines with the right attributes. An unknown email, a wrong password and a
  `pending` user all give the identical 401 body.

### Step 6 — `login_failures` + (email, IP) limiter

- Entity, migration, `LoginFailures` service: `isBlocked`, `record` **(Learn by Doing #2: the window query)**.
- Verify: the 6th wrong password within 15 min from one IP → 429. `SELECT * FROM login_failures` shows only hashes.

### Step 7 — Global `AccessTokenGuard`

- Guard, `@CurrentUser()`, Fastify type augmentation, `@Public()` on `HealthController`.
- Verify: unit tests for every rejection category; e2e with a test-only protected controller (no real protected
  endpoint exists yet).

### Step 8 — `POST /auth/refresh` + `POST /auth/logout`

- Verify: refresh with the cookie → new pair. Set the user to `blocked` in SQL → 401. Logout without cookies → 204
  with two clearing `Set-Cookie` lines.

### Step 9 — Global `CsrfGuard`

- The pure decision function **(Learn by Doing #3)** + the guard.
- Verify: `curl -X POST -H 'Origin: https://evil.test' …/auth/logout` → 403 `csrf_rejected`. Trusted origin without
  the header → 403. With `X-CSRF-Protection: 1` → 204.

### Step 10 — `login_challenges`

- Entity + migration from A5.
- Verify: `\d login_challenges`, the partial index is present.

### Step 11 — Login with confirmation ON

- Locks, `replaced`, commit before send, the SMTP 503 body, mail methods.
- Verify: 202, code in Mailpit (http://localhost:8025). Log in again within 60 s → 429. Stop Mailpit → 503 with
  `attemptId`.

### Step 12 — `POST /auth/login/confirm`

- `login-confirmation-decision.ts` **(Learn by Doing #4: the decision order)** + the service.
- Unit tests: wrong ×4 then right → 204. Wrong ×5 → 5th is 400, 6th (even correct) → 429. Expired → 400, attempts
  unchanged. Replaced attempt → 400. User blocked meanwhile → 401 + `user_inactive`. Magic link right / wrong.

### Step 13 — `POST /auth/login/resend`

- Unit tests: cooldown → 429. Old code fails after resend. Exhausted → 429. Expired but unconsumed → 202. SMTP failure
  → 503 and the old code still fails.

### Step 14 — Audit events, Swagger, optional JSON logger

- Log events from A8.
- `@ApiTags('auth')`, `@ApiCookieAuth()`, responses 202/204/400/401/403/429/503 on every new route.

### Step 15 — e2e + coverage

- `test/e2e/app.ts`: `resetDatabase` also truncates `login_challenges, login_failures`.
- `test/e2e/test-env.ts`: `AUTH_RATE_LIMIT=1000` (and JWT keys if `.env` lacks them).
- Flows: direct login; OTP happy path; exhaustion (400 then 429); magic link; resend; refresh; refresh token used as
  access → 401; blocked user → 401 on access and refresh; logout idempotent; CSRF 403; SMTP down → 503 with
  `attemptId`.
- `npm run test:cov` ≥ 80%.

## Learn-by-Doing points

1. The distinct-keys Joi validator (step 1).
2. The 15-minute sliding-window query for failed logins (step 6).
3. The CSRF decision function (step 9).
4. The login-confirmation decision order (step 12).

## Out of scope (mention, don't build)

Refresh-token reuse detection / denylist (excluded by the contract), RBAC and its permission metadata,
`GET /users/{id}` and `SafeProfileDto`, cleanup of stale `pending` users and old `login_challenges`, Fastify
`trustProxy` for production, a frontend page for `/login/confirm`.

## Verification (end-to-end)

`docker compose up -d` → `npm run migration:run` → `npm run build` → `npm test` → `npm run test:e2e` → `npm run test:cov`.

Manual:
1. Register + confirm a user.
2. `curl -i -X POST localhost:3000/auth/login -H 'Content-Type: application/json' -d '{"email":"…","password":"…"}'`
   → check the cookie attributes.
3. With `LOGIN_EMAIL_CONFIRMATION_ENABLED=true`: read the code in Mailpit, confirm, then
   `SELECT method, attempts, consumed_reason FROM login_challenges;`
