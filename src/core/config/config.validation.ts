import Joi from 'joi';

import { Config } from './config.types';

/**
 * Spec §1 "Cryptographic Keys": secrets must be >= `min` bytes (256 bits for 32),
 * otherwise bootstrap halts. Used as `Joi.string().custom(minBytes(32))`.
 *
 * Joi custom validator contract: return `value` when it is valid, or return
 * `helpers.message({ custom: '...' })` to fail with a readable message.
 */
export const minBytes =
  (min: number): Joi.CustomValidator<string> =>
  (value, helpers) => {
    const byteLength = Buffer.byteLength(value, 'utf8');
    if (byteLength < min) {
      return helpers.message({
        custom: `must be at least ${min} bytes (got ${byteLength})`,
      });
    }
    return value;
  };

/**
 * `TRUSTED_ORIGINS` → list of origins. Shared by the validator and `main.ts` (CORS),
 * so both always read the value the same way.
 */
export const parseTrustedOrigins = (raw: string | undefined): string[] =>
  (raw ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

/**
 * Every entry must be an exact http(s) origin: scheme + host (+ port), no path, no trailing
 * slash, no wildcard. The browser sends `Origin` in exactly this form, and CORS/CSRF compare
 * strings exactly, so `https://app.test/` would never match anything.
 */
const exactOrigins: Joi.CustomValidator<string> = (value, helpers) => {
  for (const origin of parseTrustedOrigins(value)) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      return helpers.message({ custom: `"${origin}" is not a valid origin` });
    }
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.origin !== origin
    ) {
      return helpers.message({
        custom: `"${origin}" must be an exact origin like https://app.example.com`,
      });
    }
  }
  return value;
};

/** Crypto keys that must all hold different values (mentor 1.1: "общий ключ … запрещён"). */
export const DISTINCT_SECRET_KEYS = [
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'LOGIN_CHALLENGE_HMAC_KEY',
  'AUDIT_EMAIL_HMAC_KEY',
] as const satisfies readonly (keyof Config)[];

/**
 * Object-level rule: runs after every single key has passed its own checks, and sees the
 * whole config at once. Per-key rules can't do this, because each one sees only its own value.
 *
 * Contract: return `value` if all DISTINCT_SECRET_KEYS differ, otherwise
 * `helpers.message({ custom: '...' })` naming the clashing keys, never their values.
 */
export const distinctSecrets: Joi.CustomValidator<Config> = (
  value,
  helpers,
) => {
  const seen = new Map<string, string>();
  for (const key of DISTINCT_SECRET_KEYS) {
    if (seen.has(value[key])) {
      return helpers.message({
        custom: `${key} must differ from ${seen.get(value[key])}`,
      });
    }
    seen.set(value[key], key);
  }

  return value;
};

export const configValidationSchema = Joi.object<Config>({
  PORT: Joi.number().port().required(),
  // 'test': Jest always sets NODE_ENV=test, and real env vars win over .env.
  NODE_ENV: Joi.string().valid('development', 'production', 'test').required(),

  /**
   * Cookie secret
   */
  COOKIE_SECRET: Joi.string().required(),

  /**
   * Health check options
   */
  HEALTH_CHECK_ENABLED: Joi.boolean().optional().default(false),

  /**
   * Throttler options
   */
  THROTTLE_GLOBAL_TTL: Joi.number().optional().default(10000),
  THROTTLE_GLOBAL_LIMIT: Joi.number().optional().default(10),

  /**
   * PostgreSQL database options
   */
  POSTGRES_HOST: Joi.string().hostname().required(),
  POSTGRES_PORT: Joi.number().port().required(),
  POSTGRES_USER: Joi.string().required(),
  POSTGRES_PASSWORD: Joi.string().required(),
  POSTGRES_DB: Joi.string().required(),
  POSTGRES_SYNCHRONIZE: Joi.boolean().optional().default(false),
  POSTGRES_LOGGING: Joi.boolean().optional().default(false),
  POSTGRES_MIGRATIONS_RUN: Joi.boolean().optional().default(false),

  /**
   * API docs at /docs. Off unless asked for: a public map of every endpoint helps attackers more than users.
   */
  API_DOCS_ENABLED: Joi.boolean().optional().default(false),

  /**
   * Registration (spec §2 "Registration Flow")
   */
  REGISTRATION_EMAIL_CONFIRMATION_ENABLED: Joi.boolean()
    .optional()
    .default(false),
  REGISTRATION_CONFIRMATION_METHOD: Joi.string()
    .valid('otp', 'magic_link')
    .optional()
    .default('otp'),
  REGISTRATION_RATE_LIMIT: Joi.number().integer().min(1).optional().default(10),

  /**
   * HMAC key for OTP / magic-link secrets
   */
  LOGIN_CHALLENGE_HMAC_KEY: Joi.string().required().custom(minBytes(32)),

  /**
   * Authentication. No defaults for keys, issuer or audience: a missing value must stop the
   * boot, never be replaced by a test value or a key generated at startup (mentor 1.1).
   */
  JWT_ACCESS_SECRET: Joi.string().required().custom(minBytes(32)),
  JWT_REFRESH_SECRET: Joi.string().required().custom(minBytes(32)),
  AUDIT_EMAIL_HMAC_KEY: Joi.string().required().custom(minBytes(32)),
  JWT_ISSUER: Joi.string().required(),
  JWT_AUDIENCE: Joi.string().required(),
  LOGIN_EMAIL_CONFIRMATION_ENABLED: Joi.boolean().optional().default(false),
  LOGIN_EMAIL_CONFIRMATION_METHOD: Joi.string()
    .valid('otp', 'magic_link')
    .optional()
    .default('otp'),
  TRUSTED_ORIGINS: Joi.string()
    .allow('')
    .optional()
    .default('')
    .custom(exactOrigins),
  AUTH_COOKIE_CROSS_SITE: Joi.boolean().optional().default(false),
  AUTH_RATE_LIMIT: Joi.number().integer().min(1).optional().default(30),

  /**
   * Outgoing mail (SMTP). User and password are optional (Mailpit needs none),
   * but must be given together — see `.and()` below.
   */
  SMTP_HOST: Joi.string().hostname().required(),
  SMTP_PORT: Joi.number().port().required(),
  SMTP_USER: Joi.string().optional(),
  SMTP_PASS: Joi.string().optional(),
  SMTP_FROM: Joi.string().required(),

  /**
   * Frontend origin used to build links in emails
   */
  FRONTEND_BASE_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .required(),
})
  .and('SMTP_USER', 'SMTP_PASS')
  .custom(distinctSecrets);
