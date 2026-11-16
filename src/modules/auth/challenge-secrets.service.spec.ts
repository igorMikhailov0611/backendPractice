import { createHmac } from 'node:crypto';

import { ConfigService } from '@/core/config/config.service';

import { ChallengeSecrets } from './challenge-secrets.service';

describe('ChallengeSecrets', () => {
  const key = 'k'.repeat(32);
  const secrets = new ChallengeSecrets({
    get: () => key,
  } as unknown as ConfigService);

  describe('generateOtp', () => {
    it('always returns exactly 6 digits, including leading zeros', () => {
      for (let i = 0; i < 1000; i++) {
        expect(secrets.generateOtp()).toMatch(/^\d{6}$/);
      }
    });

    it('does not repeat the same code', () => {
      const codes = new Set(
        Array.from({ length: 50 }, () => secrets.generateOtp()),
      );

      expect(codes.size).toBeGreaterThan(45);
    });
  });

  describe('generateMagicToken', () => {
    it('is 32 bytes encoded as URL-safe base64 (43 chars)', () => {
      const token = secrets.generateMagicToken();

      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    });

    it('is unique each time', () => {
      expect(secrets.generateMagicToken()).not.toBe(
        secrets.generateMagicToken(),
      );
    });
  });

  describe('hmac', () => {
    it('is HMAC-SHA256 with the configured key, as 64 lowercase hex chars', () => {
      const expected = createHmac('sha256', key).update('123456').digest('hex');

      expect(secrets.hmac('123456')).toBe(expected);
      expect(secrets.hmac('123456')).toMatch(/^[0-9a-f]{64}$/);
    });

    it('is deterministic (same input, same hash), so it can be looked up', () => {
      expect(secrets.hmac('123456')).toBe(secrets.hmac('123456'));
    });

    it('depends on the key: another key gives another hash', () => {
      const other = new ChallengeSecrets({
        get: () => 'z'.repeat(32),
      } as unknown as ConfigService);

      expect(other.hmac('123456')).not.toBe(secrets.hmac('123456'));
    });
  });

  describe('matches', () => {
    const stored = secrets.hmac('123456');

    it('accepts the right secret', () => {
      expect(secrets.matches('123456', stored)).toBe(true);
    });

    it('rejects a wrong secret', () => {
      expect(secrets.matches('123457', stored)).toBe(false);
    });

    it('returns false (no throw) for a hash of the wrong length', () => {
      expect(secrets.matches('123456', 'abcd')).toBe(false);
    });
  });
});
