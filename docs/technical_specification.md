# Technical Specification: Auth, User Management & File Transformation Backend Service

## 1. General System & Architectural Requirements

The service is designed as an isolated monolithic HTTP REST API application built on **NestJS (Node.js / TypeScript)** and deployed as an independent, stateless process. Consolidating authentication, access control (RBAC), user profile management, and file processing into a single monolithic boundary ensures atomic transactional integrity, sub-millisecond inter-module latency, and zero distributed state complexities.

- **Source of Truth**: PostgreSQL is the single transactional source of truth. External in-memory caches without built-in version control are strictly prohibited.
- **Scalability**: Zero in-memory session state (stateless architecture driven by cryptographic JWTs) and dual-adapter file storage abstraction allow horizontal scaling behind an L7 load balancer.
- **Security Posture**: A unified security pipeline enforces a **default-deny** policy, mitigates Cross-Site Request Forgery (CSRF), prevents unauthorized access to PII, and protects against CPU/memory exhaustion attacks.

### Technology Stack & Constraints

- **Framework**: Monolithic HTTP REST API via NestJS / TypeScript.
- **Database**: PostgreSQL (relational store for system entities, users, RBAC roles/permissions, challenge logs, and operation history).
- **File Storage Layer (`StorageAdapter`)**:
  - `local-storage`: Used exclusively in local development and test environments.
  - `s3-storage`: Used in production environments (S3-compatible object storage).
- **Cryptographic Keys**: Secrets (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `LOGIN_CHALLENGE_HMAC_KEY`) must each be $\ge 32$ bytes (256 bits). If any secret is missing or below the threshold, application bootstrap halts, setting health check `readiness = false` and triggering process termination.

### Unified Security Chain (5-Stage Request Pipeline)

Every protected inbound HTTP request must sequentially pass through the following 5-stage pipeline before execution reaches the controller or business handler:

1. **JWT Extraction & Cryptographic Validation**:
   - Token is extracted exclusively from the HttpOnly `access_token` cookie.
   - Verifies HS256 signature using `JWT_ACCESS_SECRET`.
   - Validates timestamps (`iat`, `exp`), issuer (`iss = JWT_ISSUER`), audience (`aud = JWT_AUDIENCE`), and token type claim (`token_use = "access"`).
2. **Subject Existence & Status Verification**:
   - Extracts `sub` claim (`userId`) and queries PostgreSQL.
   - Verifies the user exists and holds `status = "active"`. Any other status (`pending`, `blocked`, `deleting`, `deleted`) terminates the request immediately.
3. **CSRF Mitigation**:
   - All state-mutating requests (`POST`, `PUT`, `PATCH`, `DELETE`) originating from cross-origin contexts must match the `Origin` header against an explicit domain allowlist and supply the custom header `X-CSRF-Protection: 1`.
4. **RBAC Permission Check**:
   - Controller-demanded `permission@action` pair is evaluated against the in-memory policy snapshot.
5. **Ownership Check**:
   - For operations targeting personal resources, `actorUserId` is compared to resource `ownerId`.
   - On mismatch, access is granted only if the caller holds an administrative permission with the `*_any` suffix (e.g., `users@read_any`).

### Standardized HTTP Status & Error Codes

| HTTP Status | Error Code (`code`) | Trigger Condition & Semantics |
| :--- | :--- | :--- |
| `400 Bad Request` | `bad_request` | DTO validation failure, malformed payload, password policy violation, image resolution exceeding $4096 \times 4096\text{ px}$, or invalid/expired OTP/Magic Link token. |
| `401 Unauthorized` | `invalid_session` / `invalid_credentials` | Missing or expired access token, inactive user status (`pending`, `blocked`, `deleting`, `deleted`), or invalid login credentials. |
| `403 Forbidden` | `permission_denied` / `ownership_denied` / `csrf_rejected` | Insufficient RBAC privileges, resource ownership mismatch lacking `*_any` permission, or failed/missing CSRF validation headers. |
| `404 Not Found` | `not_found` | Target resource, user, or file does not exist (returned only after passing RBAC checks). |
| `409 Conflict` | `conflict` | Unique constraint violation (email, role name, grant duplicates), active account deletion job, or attempting to reduce `rbac@manage` administrator count to zero. |
| `413 Payload Too Large` | `payload_too_large` | Request body or file upload exceeds configured maximum byte thresholds. |
| `415 Unsupported Media Type` | `unsupported_media_type` | File upload MIME type or extension is not present in the explicit allowlist. |
| `429 Too Many Requests` | `rate_limit_exceeded` | Rate limit exceeded, resend cooldown (60 seconds) active, or OTP input attempts exhausted. |
| `503 Service Unavailable` | `authorization_unavailable` / `service_unavailable` | PostgreSQL, S3, or SMTP unreachable; failure loading/updating the in-memory RBAC snapshot. |
| `504 Gateway Timeout` | `gateway_timeout` | File transformation execution exceeds the hard 30-second time limit. |

### Threat Mitigation Guidelines

- **Default-Deny**: All API endpoints are private by default. Access is exposed only when decorated with explicit `@Public()`. Endpoints missing an access decorator or declared `permission@action` pair trigger a bootstrap failure or return `503 Service Unavailable`.
- **Error Masking & Anti-Enumeration**: Authentication and infrastructure failures must return generic error messages. Disclosing whether an email exists during registration or login is strictly forbidden.
- **DTO Whitelisting**: Strict validation pipe with `whitelist: true` and `forbidNonWhitelisted: true`. Unknown fields are stripped or rejected before reaching the business layer.
- **Payload Attack Defenses**:
  - **XXE (XML External Entity)**: External entity and DTD resolution must be explicitly disabled in XML parsers.
  - **Decompression Bombs**: Archive decompression and image rasterization must enforce strict stream memory buffers and compression ratio limits.
  - **SVG Script Execution**: SVG rasterization runs in an isolated context after aggressively stripping `<script>` tags, inline event attributes (e.g., `onload=`), and external URIs.

---

## 2. Authentication & Identity Module

### Registration Flow (`POST /auth/register`)

1. **Input Normalization & Validation**:
   - `email`: Mandatory whitespace trimming and lowercase transformation.
   - `password`: Length $8 \le \text{length} \le 128$ characters, requiring at least one letter and one digit. The 128-character upper bound mitigates CPU denial-of-service and prevents bcrypt truncation at byte 72.
2. **Password Hashing**:
   - Argon2id (recommended default) or bcrypt with $\text{cost} \ge 12$. A unique salt is generated per password.
3. **Confirmation Modes (`REGISTRATION_EMAIL_CONFIRMATION_ENABLED`)**:
   - **Disabled (`false`)**: Atomically creates the user record with `status = "active"` and assigns the default `user` role within a single transaction. Returns `201 Created` with the Safe Profile DTO.
   - **Enabled (`true`)**: Creates the user record with `status = "pending"` and creates an entry in `registration_challenges`. Returns `202 Accepted` with:
     ```json
     {
       "confirmationRequired": true,
       "method": "otp", // or "magic_link"
       "attemptId": "<uuid>",
       "expiresInSeconds": 600,
       "resendAfterSeconds": 60
     }
     ```
     *Secret tokens or plain codes must never be included in the response body.*

### Email Challenge Protocols

- **OTP (One-Time Password)**:
  - 6-digit numeric code with a 10-minute TTL.
  - Maximum 5 submission attempts (the 5th attempt can be valid).
  - Stored in the database exclusively as `HMAC-SHA256(code, LOGIN_CHALLENGE_HMAC_KEY)`.
  - The 5th failed attempt invalidates the challenge with `consumed_reason = "attempts_exhausted"`.
- **Magic Link**:
  - 32-byte cryptographically secure random token (base64url-encoded), 10-minute TTL.
  - Sent to the user as `attemptId.secret`. Stored in DB as `HMAC-SHA256(secret, LOGIN_CHALLENGE_HMAC_KEY)`.
  - Confirmation is strictly handled via `POST /auth/register/confirm`. State-mutating `GET` requests are prohibited to avoid link-prefetch consumption by email security crawlers.
- **Resend Flow (`POST /auth/register/resend`)**:
  - Rate-limited to at most 1 request every 60 seconds per attempt.
  - Revokes previous secret (`consumed_reason = "replaced"`), resets attempt counter, and starts a fresh 10-minute TTL.

### Direct Login (`POST /auth/login`) & Step-Up

1. **Rate Limiting**:
   - Maximum 30 requests/minute per IP.
   - Maximum 5 failed login attempts per `(email + IP)` pair within a 15-minute sliding window.
2. **Credential Validation & Constant-Time Protection**:
   - Normalize email, verify password hash.
   - If the user does not exist, credentials fail, or the user is inactive (`pending`, `blocked`, `deleting`, `deleted`), return `401 Unauthorized` with `code: "invalid_credentials"`.
   - On non-existent user lookups, execute a dummy password hash verification using a pre-calculated mock hash to equalize response times against timing attacks.
3. **Two-Step Login (`LOGIN_EMAIL_CONFIRMATION_ENABLED = true`)**:
   - Creates a challenge in `login_challenges` (`otp` or `magic_link`), dispatches notification email, and returns `202 Accepted`.
   - `POST /auth/login/confirm` validates the challenge, updates its status, checks user status, and sets auth cookies.

### Challenge Tables & `consumed_reason` Enum

`registration_challenges` and `login_challenges` must track status using the `consumed_reason` enum:
- `confirmed`: Verification completed successfully.
- `replaced`: Invalidated by a subsequent resend operation.
- `attempts_exhausted`: Expired due to 5 incorrect OTP inputs.
- `user_inactive`: User was transitioned to an inactive state prior to challenge completion.

### Token Lifecycle & Cookie Management

| Parameter | Access Token (`access_token`) | Refresh Token (`refresh_token`) |
| :--- | :--- | :--- |
| **TTL** | 15 minutes | 30 days |
| **Payload Claims** | `sub`, `iss`, `aud`, `iat`, `exp`, `token_use: "access"` | `sub`, `iss`, `aud`, `iat`, `exp`, `token_use: "refresh"` |
| **Signing Algorithm / Secret** | HS256 / `JWT_ACCESS_SECRET` ($\ge 32\text{ bytes}$) | HS256 / `JWT_REFRESH_SECRET` ($\ge 32\text{ bytes}$) |
| **Transport** | HttpOnly Cookie | HttpOnly Cookie |
| **Cookie Attributes** | `HttpOnly; Secure; SameSite=Strict; Path=/` | `HttpOnly; Secure; SameSite=Strict; Path=/auth/refresh` |

- **Token Refresh (`POST /auth/refresh`)**: Rate-limited to 30 requests/minute per IP. Executes stateless token rotation. Validates refresh token signature, expiration, and ensures user holds `status = "active"` in PostgreSQL. Returns `204 No Content` with new set of auth cookies.
- **Logout (`POST /auth/logout`)**: Idempotently clears both cookies by setting expired dates matching the original `Path` and `SameSite` configurations. Always returns `204 No Content`.

---

## 3. Role-Based Access Control (RBAC) Module

The RBAC module enforces the principle of least privilege with zero-downtime hot policy reloading.

### Relational Schema (7 Core Tables)

1. `roles`:
   - `id` (UUID, PK)
   - `name` (text, Unique, normalized lowercase)
   - `description` (text, max 500 chars, nullable)
   - `created_at`, `updated_at` (timestamptz)
2. `permissions`:
   - `id` (UUID, PK)
   - `name` (text, Unique, e.g., `users`, `transformations`, `rbac`)
   - `description` (text, max 500 chars, nullable)
   - `created_at`, `updated_at` (timestamptz)
3. `permission_actions`:
   - `id` (UUID, PK)
   - `permission_id` (UUID, FK $\to$ `permissions.id` ON DELETE CASCADE)
   - `name` (text, e.g., `read`, `update`)
   - *Unique constraint*: `(permission_id, name)`
4. `grants`:
   - `id` (UUID, PK)
   - `role_id` (UUID, FK $\to$ `roles.id` ON DELETE CASCADE)
   - `permission_id` (UUID, FK $\to$ `permissions.id` ON DELETE CASCADE)
   - `all_actions` (boolean, default false)
   - `created_at`, `updated_at` (timestamptz)
   - *Unique constraint*: `(role_id, permission_id)`
5. `grant_actions`:
   - `grant_id` (UUID, FK $\to$ `grants.id` ON DELETE CASCADE)
   - `permission_action_id` (UUID, FK $\to$ `permission_actions.id` ON DELETE RESTRICT)
   - *Primary Key*: `(grant_id, permission_action_id)`
6. `user_roles`:
   - `user_id` (UUID, FK $\to$ `users.id` ON DELETE CASCADE)
   - `role_id` (UUID, FK $\to$ `roles.id` ON DELETE RESTRICT)
   - *Primary Key*: `(user_id, role_id)`
7. `rbac_policy_state`:
   - `id` (integer, PK, single row `id = 1`)
   - `version` (bigint, monotonically increasing revision counter)
   - `updated_at` (timestamptz)

### In-Memory Policy Snapshot & Dynamic Reloading

1. The service maintains a full RBAC policy graph in process memory.
2. During request authorization, the service compares its local snapshot version with `rbac_policy_state.version` in PostgreSQL.
3. If the database version is higher, the process temporarily pauses authorization, pulls a fresh policy snapshot, validates graph integrity, and atomically swaps the local snapshot pointer.
4. If loading fails or the policy is malformed, protected endpoints fail closed with `503 Service Unavailable` (`code: "authorization_unavailable"`).

### Complete Catalog of Permissions and Actions

- **`users`**: `read`, `read_any`, `update`, `update_any`, `delete`, `delete_any`, `list`
- **`transformations`**: `convert`, `history`, `history_any`, `download`, `download_any`
- **`rbac`**: `manage`

### Bootstrap & Administrator Invariant

- **Bootstrap**: On application startup against empty RBAC tables:
  - Seeds permissions (`rbac`, `users`, `transformations`) and actions.
  - Creates default roles: `user` and `admin`.
  - Assigns `users@read`, `users@update`, `users@delete` to `user`.
  - Assigns `rbac@manage` and all actions across `users` and `transformations` to `admin`.
  - Grants `admin` role to user identified by `RBAC_BOOTSTRAP_ADMIN_USER_ID`. All remaining active users without roles receive the `user` role.
- **Admin Invariant**: Any administrative operation that would result in $0$ active users holding `rbac@manage` must be rejected within the database transaction, returning `409 Conflict`.

### RBAC Management Endpoints (`/admin/rbac/*`)

| Endpoint | Method | Body / Params | Validation & Rules |
| :--- | :--- | :--- | :--- |
| `/admin/rbac/roles` | `GET` | — | Returns array of all roles. |
| `/admin/rbac/roles` | `POST` | `name: string`, `description?: string` | `name` length 1–64 (`^[a-z][a-z0-9._-]{0,63}$`). `description` $\le 500$ chars (empty string parsed to `null`). |
| `/admin/rbac/roles/{roleId}` | `PUT` | `name: string`, `description?: string` | Full replacement. Same validation as POST. |
| `/admin/rbac/roles/{roleId}` | `DELETE` | — | Returns `409 Conflict` if assigned to users or referenced by grants. |
| `/admin/rbac/permissions` | `GET` | — | Lists all permissions with nested action objects. |
| `/admin/rbac/permissions` | `POST` | `name: string`, `description?: string`, `actions: string[]` | `actions` must contain 1–64 unique strings. |
| `/admin/rbac/permissions/{id}` | `PUT` | `name: string`, `description?: string`, `actions: string[]` | Updating permission. Removing an action bound to `grant_actions` returns `409 Conflict` unless the referencing grant has `all_actions = true`. |
| `/admin/rbac/permissions/{id}` | `DELETE` | — | Returns `409 Conflict` if referenced by existing grants. |
| `/admin/rbac/grants` | `GET` | — | Lists all role-permission grants. |
| `/admin/rbac/grants` | `POST` | `roleId: UUID`, `permissionId: UUID`, `actions?: string[]` | Empty or omitted `actions` sets `all_actions = true`. |
| `/admin/rbac/grants/{id}` | `PUT` | `roleId: UUID`, `permissionId: UUID`, `actions?: string[]` | Replaces assigned actions for the grant. |
| `/admin/rbac/grants/{id}` | `DELETE` | — | Deletes grant mapping. |
| `/admin/rbac/users/{id}/roles` | `GET` | — | Returns array of assigned role IDs. |
| `/admin/rbac/users/{id}/roles` | `PUT` | `roleIds: UUID[]` | Replaces assigned roles. Empty array unassigns all roles. Validates `rbac@manage` invariant. |

---

## 4. User & Profile Management Module

### Safe Profile Contract

All public user projections must serialize into a strict 7-field DTO:

```typescript
interface SafeProfileDto {
  id: string; // UUID
  email: string; // Normalized
  displayName: string | null;
  photoUrl: string | null; // API endpoint URL (/users/{userId}/photo), never direct S3 key
  status: 'pending' | 'active' | 'blocked' | 'deleting' | 'deleted';
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}
```

*Never expose password hashes, challenge secrets, internal storage keys (`photo_key`), audit revisions, or JWT payloads.*

### Profile & Avatar Operations

- `GET /users/{userId}`: Requires `users@read`. Target mismatch requires `users@read_any`. Returns Safe Profile DTO.
- `PATCH /users/{userId}`: Requires `users@update` (`users@update_any` for other users). Updates `displayName`. Email changes trigger a re-confirmation challenge flow without invalidating current session.
- `PUT /users/{userId}/photo` & `DELETE /users/{userId}/photo`:
  - **Upload Pipeline**: Validate image MIME type, strip EXIF metadata, resize/crop to a maximum of $1024 \times 1024\text{ px}$, and convert to WebP.
  - **Storage Cleanup**: Old avatars are deleted asynchronously. Obsolete file keys are appended to `storage_cleanup_jobs` table for out-of-band deletion by a background worker.
- `GET /users/{userId}/photo`: Streams binary image data with `Content-Type: image/webp`.

### Two-Phase Asynchronous Account Deletion (`DELETE /users/{userId}`)

To prevent HTTP gateway timeouts and maintain strict idempotency, account deletion follows an asynchronous job pattern:

1. **Ingestion Phase**:
   - Caller issues `DELETE /users/{userId}` with an optional `Idempotency-Key` header (16 random bytes represented as 32 hex chars).
   - Validates `users@delete` (or `users@delete_any`).
   - Transactionally updates user `status = "deleting"` and inserts a record into the deletion tasks table with `jobId = Idempotency-Key` (generated if missing).
   - Returns `202 Accepted` immediately:
     ```json
     {
       "jobId": "a1b2c3d4e5f6...",
       "status": "deleting"
     }
     ```
2. **Background Execution Phase (`deletion-worker`)**:
   - The worker polls for tasks in `deleting` state and executes the erasers sequentially:
     - **Avatar Eraser**: Calls `StorageAdapter.delete()` to wipe avatar file from S3/disk.
     - **Personal Data Eraser**: Anonymizes user record in `users`: sets `email = "deleted.<32_hex_random>@example.invalid"` and `displayName = null`.
     - **Data Purge Eraser**: Deletes all active records in `registration_challenges`, `login_challenges`, and session caches.
3. **Finalization Phase**:
   - Updates user record status to `deleted`.
   - Repeated calls to `DELETE /users/{userId}` with the same or new idempotency keys do not create new tasks; they return the existing `jobId` and current status.

### Admin User Listing (`GET /admin/users`)

- **Keyset Pagination**: Cursor-based pagination using the composite tuple `(created_at, id)`.
- **Tamper-Proof Cursor**: The opaque cursor string returned to clients must be HMAC-signed to prevent parameter tampering.
- **Drift Protection (`snapshotAt`)**: Accepts or defaults to a `snapshotAt` timestamp, preventing page drift caused by newly registered users during pagination iterations.
- **Filter Allowlist**: `status`, `created_after`, `created_before`, and substring `search` (matching against `email` and `displayName`).

---

## 5. File Transformation & Storage Module

### Converter Core Engine Constraints

- **Streaming Architecture**: All file parsing, processing, and output streaming must run through Node.js pipeline streams without loading full payloads into process heap memory.
- **Execution Timeout**: Hard processing timeout of 30 seconds. On exceedance, stream is killed and responds with `504 Gateway Timeout`.
- **Payload Limits**: Files exceeding max allowed upload size are aborted immediately with `413 Payload Too Large`.

### Structured Text Conversion (`POST /api/convert`)

- **Permission Required**: `transformations@convert`.
- **Supported 12 Transformation Paths**:
  - `CSV -> JSON`, `CSV -> XML`, `CSV -> YAML`
  - `JSON -> CSV`, `JSON -> XML`, `JSON -> YAML`
  - `XML -> CSV`, `XML -> JSON`, `XML -> YAML`
  - `YAML -> CSV`, `YAML -> JSON`, `YAML -> XML`
- **Security Parsers**:
  - **YAML**: Safe parsing mode only; constructor instantiation of arbitrary classes/functions is disabled.
  - **XML**: External entities (XXE) and external DTD parsing explicitly disabled.

### Image Conversion Engine (`POST /api/images/convert`)

- **Permission Required**: `transformations@convert`.
- **Supported Formats**: `PNG`, `JPEG`, `SVG` (rasterization input only; SVG is never generated as output).
- **Dimension Ceiling**: Input and output images bounded by a maximum resolution of $4096 \times 4096\text{ px}$. Exceeding this returns `400 Bad Request`.
- **Decompression Bomb Protection**: Memory allocation limits enforced during image decoding.
- **Sanitization & Post-Processing**: Strip EXIF tags, support JPEG quality parameters, and flatten alpha channels onto an opaque white background when converting from transparent formats (e.g., `PNG -> JPEG`).

### Transformation History & Storage Retention

- **Format Registry**: `GET /api/convert/formats` and `GET /api/images/convert/formats` expose the supported conversion matrix.
- **History (`GET /api/transformations/history`)**: Requires `transformations@history` (or `transformations@history_any`). Keyset pagination over `(created_at, id)` with HMAC cursor signing and `snapshotAt`.
- **Persistent Retention (`save=true`)**: If `save=true` is set during transformation, the converted artifact is asynchronously persisted to object storage via `StorageAdapter` under a cryptographically random key.
- **Secure Download (`GET /api/transformations/history/{itemId}/download`)**: Requires `transformations@download` (`transformations@download_any`). Streams binary payload with corresponding `Content-Type` and `Content-Disposition`.
- **Retention Worker (`retention-worker`)**: Scheduled out-of-band job running every 24 hours. Prunes saved transformation artifacts older than 90 days from storage and marks history entries as expired.