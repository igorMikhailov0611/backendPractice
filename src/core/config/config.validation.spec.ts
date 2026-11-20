import Joi from 'joi';

import { Config } from './config.types';
import {
  configValidationSchema,
  parseTrustedOrigins,
} from './config.validation';

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
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'r'.repeat(32),
  AUDIT_EMAIL_HMAC_KEY: 'e'.repeat(32),
  JWT_ISSUER: 'backend-practice-api',
  JWT_AUDIENCE: 'backend-practice-web',
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

  describe('authentication keys (mentor 1.1)', () => {
    it('applies auth defaults', () => {
      expect(validate().value as Config).toMatchObject({
        LOGIN_EMAIL_CONFIRMATION_ENABLED: false,
        LOGIN_EMAIL_CONFIRMATION_METHOD: 'otp',
        TRUSTED_ORIGINS: '',
        AUTH_COOKIE_CROSS_SITE: false,
        AUTH_RATE_LIMIT: 30,
      });
    });

    it.each([
      'JWT_ACCESS_SECRET',
      'JWT_REFRESH_SECRET',
      'AUDIT_EMAIL_HMAC_KEY',
      'JWT_ISSUER',
      'JWT_AUDIENCE',
    ])('rejects a missing %s (no default value)', (key) => {
      expect(errorPaths({ [key]: undefined })).toEqual([key]);
    });

    it.each([
      'JWT_ACCESS_SECRET',
      'JWT_REFRESH_SECRET',
      'AUDIT_EMAIL_HMAC_KEY',
    ])('rejects a 31-byte %s', (key) => {
      expect(errorPaths({ [key]: 'x'.repeat(31) })).toEqual([key]);
    });

    it('rejects an unknown login confirmation method', () => {
      expect(errorPaths({ LOGIN_EMAIL_CONFIRMATION_METHOD: 'sms' })).toEqual([
        'LOGIN_EMAIL_CONFIRMATION_METHOD',
      ]);
    });
  });

  describe('distinct crypto keys (mentor 1.1: a shared key is forbidden)', () => {
    it('accepts four different keys', () => {
      expect(validate().error).toBeUndefined();
    });

    it.each([
      ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'],
      ['JWT_ACCESS_SECRET', 'LOGIN_CHALLENGE_HMAC_KEY'],
      ['JWT_REFRESH_SECRET', 'AUDIT_EMAIL_HMAC_KEY'],
      ['LOGIN_CHALLENGE_HMAC_KEY', 'AUDIT_EMAIL_HMAC_KEY'],
    ])('rejects %s equal to %s, naming both keys', (first, second) => {
      const shared = 's'.repeat(40);
      const message = validate({ [first]: shared, [second]: shared }).error
        ?.message;

      expect(message).toContain(first);
      expect(message).toContain(second);
    });

    it('never echoes the shared value', () => {
      const shared = 's'.repeat(40);
      const message = validate({
        JWT_ACCESS_SECRET: shared,
        JWT_REFRESH_SECRET: shared,
      }).error?.message;

      expect(message).toBeDefined();
      expect(message).not.toContain(shared);
    });
  });

  describe('TRUSTED_ORIGINS', () => {
    it('accepts a comma-separated list of exact origins', () => {
      expect(
        validate({
          TRUSTED_ORIGINS: 'http://localhost:4200, https://app.example.com',
        }).error,
      ).toBeUndefined();
    });

    it.each([
      '*',
      'https://app.example.com/',
      'https://app.example.com/login',
      'ftp://app.example.com',
      'app.example.com',
    ])('rejects "%s"', (origin) => {
      expect(errorPaths({ TRUSTED_ORIGINS: origin })).toEqual([
        'TRUSTED_ORIGINS',
      ]);
    });

    it('parses the list the same way main.ts reads it', () => {
      expect(parseTrustedOrigins(' http://a.test ,, https://b.test ')).toEqual([
        'http://a.test',
        'https://b.test',
      ]);
      expect(parseTrustedOrigins('')).toEqual([]);
    });
  });

  it('rejects a FRONTEND_BASE_URL that is not http(s)', () => {
    expect(errorPaths({ FRONTEND_BASE_URL: 'javascript:alert(1)' })).toEqual([
      'FRONTEND_BASE_URL',
    ]);
  });
});
