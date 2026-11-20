export interface Config {
  PORT: number;
  NODE_ENV: 'development' | 'production' | 'test';

  /**
   * Cookie secret
   */
  COOKIE_SECRET: string;

  /**
   * Health check options
   */
  HEALTH_CHECK_ENABLED?: boolean;

  /**
   * Throttler options
   */
  THROTTLE_GLOBAL_TTL?: number;
  THROTTLE_GLOBAL_LIMIT?: number;

  /**
   * PostgreSQL database options
   */
  POSTGRES_HOST: string;
  POSTGRES_PORT: number;
  POSTGRES_USER: string;
  POSTGRES_PASSWORD: string;
  POSTGRES_DB: string;
  POSTGRES_SYNCHRONIZE?: boolean;
  POSTGRES_LOGGING?: boolean;
  POSTGRES_MIGRATIONS_RUN?: boolean;

  /** Serve the OpenAPI description + Swagger UI at /docs (mentor's doc §1.6). Off by default. */
  API_DOCS_ENABLED?: boolean;

  /**
   * Registration (spec §2 "Registration Flow")
   */
  REGISTRATION_EMAIL_CONFIRMATION_ENABLED?: boolean;
  REGISTRATION_CONFIRMATION_METHOD?: 'otp' | 'magic_link';
  /** Max POST /auth/register requests per minute per IP (mentor's doc §1.6) */
  REGISTRATION_RATE_LIMIT?: number;

  /**
   * HMAC key for OTP / magic-link secrets (spec §1 "Cryptographic Keys": >= 32 bytes)
   */
  LOGIN_CHALLENGE_HMAC_KEY: string;

  /**
   * Authentication (mentor's authentication_requirements.md §1.1, §1.3.3)
   */
  /** HS256 key for access JWTs (>= 32 bytes, differs from every other crypto key) */
  JWT_ACCESS_SECRET: string;
  /** HS256 key for refresh JWTs (>= 32 bytes, differs from every other crypto key) */
  JWT_REFRESH_SECRET: string;
  /** HMAC key for the irreversible email identifier in logs and login_failures (mentor 1.5) */
  AUDIT_EMAIL_HMAC_KEY: string;
  JWT_ISSUER: string;
  JWT_AUDIENCE: string;
  LOGIN_EMAIL_CONFIRMATION_ENABLED?: boolean;
  LOGIN_EMAIL_CONFIRMATION_METHOD?: 'otp' | 'magic_link';
  /** Comma-separated exact origins allowed by CORS and the CSRF check. Empty = same-origin only */
  TRUSTED_ORIGINS?: string;
  /** true → both auth cookies get SameSite=None; Secure (frontend on another site) */
  AUTH_COOKIE_CROSS_SITE?: boolean;
  /** Max login / refresh requests per minute per IP (mentor 1.6) */
  AUTH_RATE_LIMIT?: number;

  /**
   * Outgoing mail (SMTP)
   */
  SMTP_HOST: string;
  SMTP_PORT: number;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  SMTP_FROM: string;

  /**
   * Frontend origin used to build links in emails (magic link)
   */
  FRONTEND_BASE_URL: string;
}
