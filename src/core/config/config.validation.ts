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

export const configValidationSchema = Joi.object<Config>({
  PORT: Joi.number().port().required(),
  NODE_ENV: Joi.string().valid('development', 'production').required(),

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
}).and('SMTP_USER', 'SMTP_PASS');
