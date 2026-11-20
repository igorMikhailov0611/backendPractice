import Joi from 'joi';

import { Config } from './config.types';
import { configValidationSchema } from './config.validation';

/** Minimal env that satisfies every required key. */
const validEnv = {
  PORT: '3000',
  NODE_ENV: 'development',
  COOKIE_SECRET: 'cookie-secret',
  POSTGRES_HOST: 'localhost',
  POSTGRES_PORT: '5432',
  POSTGRES_USER: 'postgres',
  POSTGRES_PASSWORD: 'postgres',
  POSTGRES_DB: 'backend_practice',
  LOGIN_CHALLENGE_HMAC_KEY: 'k'.repeat(32),
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
  SMTP_FROM: 'Backend Practice <no-reply@localhost>',
  FRONTEND_BASE_URL: 'http://localhost:4200',
};

const validate = (
  overrides: Record<string, unknown> = {},
): Joi.ValidationResult<Config> =>
  configValidationSchema.validate({ ...validEnv, ...overrides });

const errorPaths = (overrides: Record<string, unknown>) =>
  validate(overrides).error?.details.map((d) => d.path.join('.'));

describe('configValidationSchema', () => {
  it('accepts a minimal valid env and applies registration defaults', () => {
    const result = validate();

    expect(result.error).toBeUndefined();
    expect(result.value as Config).toMatchObject({
      REGISTRATION_EMAIL_CONFIRMATION_ENABLED: false,
      REGISTRATION_CONFIRMATION_METHOD: 'otp',
      REGISTRATION_RATE_LIMIT: 10,
    });
  });

  describe('LOGIN_CHALLENGE_HMAC_KEY (spec §1: >= 32 bytes or boot halts)', () => {
    it('rejects a missing key', () => {
      expect(errorPaths({ LOGIN_CHALLENGE_HMAC_KEY: undefined })).toEqual([
        'LOGIN_CHALLENGE_HMAC_KEY',
      ]);
    });

    it('rejects a 31-byte key', () => {
      expect(errorPaths({ LOGIN_CHALLENGE_HMAC_KEY: 'k'.repeat(31) })).toEqual([
        'LOGIN_CHALLENGE_HMAC_KEY',
      ]);
    });

    it('counts UTF-8 bytes, not characters', () => {
      // 'й' is 2 bytes in UTF-8: 16 chars = 32 bytes (ok), 15 chars = 30 bytes (too short)
      expect(
        validate({ LOGIN_CHALLENGE_HMAC_KEY: 'й'.repeat(16) }).error,
      ).toBeUndefined();
      expect(errorPaths({ LOGIN_CHALLENGE_HMAC_KEY: 'й'.repeat(15) })).toEqual([
        'LOGIN_CHALLENGE_HMAC_KEY',
      ]);
    });

    it('explains the failure without echoing the secret', () => {
      const message = validate({ LOGIN_CHALLENGE_HMAC_KEY: 'k'.repeat(31) })
        .error?.message;

      expect(message).toContain('must be at least 32 bytes (got 31)');
      expect(message).not.toContain('k'.repeat(31));
    });

    it('accepts a 32-byte key and keeps it unchanged', () => {
      const key = 'k'.repeat(32);
      const result = validate({ LOGIN_CHALLENGE_HMAC_KEY: key });

      expect(result.error).toBeUndefined();
      expect((result.value as Config).LOGIN_CHALLENGE_HMAC_KEY).toBe(key);
    });
  });

  it('rejects an unknown confirmation method', () => {
    expect(errorPaths({ REGISTRATION_CONFIRMATION_METHOD: 'sms' })).toEqual([
      'REGISTRATION_CONFIRMATION_METHOD',
    ]);
  });

  it('rejects a non-positive REGISTRATION_RATE_LIMIT', () => {
    expect(errorPaths({ REGISTRATION_RATE_LIMIT: '0' })).toEqual([
      'REGISTRATION_RATE_LIMIT',
    ]);
  });

  it('requires SMTP_USER and SMTP_PASS together', () => {
    expect(validate({ SMTP_USER: 'user' }).error).toBeDefined();
    expect(
      validate({ SMTP_USER: 'user', SMTP_PASS: 'pass' }).error,
    ).toBeUndefined();
  });

  it('rejects a FRONTEND_BASE_URL that is not http(s)', () => {
    expect(errorPaths({ FRONTEND_BASE_URL: 'javascript:alert(1)' })).toEqual([
      'FRONTEND_BASE_URL',
    ]);
  });
});
