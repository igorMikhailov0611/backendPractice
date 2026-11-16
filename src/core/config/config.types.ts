export interface Config {
  PORT: number;
  NODE_ENV: 'development' | 'production';

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
