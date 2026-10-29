---
paths:
  - "src/modules/auth/**"
  - "src/modules/rbac/**"
  - "src/modules/users/**"
  - "src/**/guards/**"
  - "src/**/*.guard.ts"
  - "src/main.ts"
---

# Security rules (spec §1–§4)

- **Default-deny:** every route requires auth unless decorated with `@Public()`. Protected routes must declare a
  `permission@action` requirement; missing metadata must fail closed, never open.
- **Request pipeline order** for protected routes: JWT (cookie `access_token`, HS256, check `iss`/`aud`/`exp`/`token_use`)
  → user exists and `status = 'active'` → CSRF (Origin allowlist + `X-CSRF-Protection: 1` on mutating methods)
  → RBAC permission → ownership (`*_any` permission to bypass).
- Tokens are read **only** from HttpOnly cookies, never from the `Authorization` header or the body. Cookie
  attributes must match the spec table (refresh cookie `Path=/auth/refresh`).
- **Anti-enumeration:** login/registration responses must not reveal whether an email exists. On unknown email,
  still run a dummy hash verification to equalise timing.
- Compare secrets/HMACs with `crypto.timingSafeEqual`, never `===`.
- Generate tokens/codes with `crypto.randomBytes` / `crypto.randomInt`, never `Math.random`.
- Never put secrets, OTP codes, magic-link tokens, password hashes or JWTs in responses (except cookies) or logs.
- Secrets (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `LOGIN_CHALLENGE_HMAC_KEY`) must be validated as ≥ 32 bytes
  in the Joi config schema so the app refuses to boot otherwise.
- Return errors with the spec's `code` values (`invalid_credentials`, `invalid_session`, `permission_denied`,
  `ownership_denied`, `csrf_rejected`, …) and generic messages.
- Return 404 for missing resources **only after** RBAC checks pass, so unauthorised callers can't probe for IDs.
