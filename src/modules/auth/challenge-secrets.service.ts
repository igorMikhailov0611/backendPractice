import {
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { ConfigService } from '@/core/config/config.service';

/**
 * Secrets sent by email for registration confirmation (mentor's registration_requirements.md):
 * - OTP: 6 digits, found by attempt id, then compared.
 * - Magic-link token: 32 random bytes, found by its HMAC (no id inside).
 * Only HMAC-SHA256(secret, LOGIN_CHALLENGE_HMAC_KEY) is ever stored.
 */
@Injectable()
export class ChallengeSecrets {
  private readonly key: string;

  constructor(config: ConfigService) {
    // Validated as >= 32 bytes at startup (minBytes in config.validation.ts).
    this.key = config.get('LOGIN_CHALLENGE_HMAC_KEY');
  }

  /** "000000".."999999", uniformly distributed, from the OS secure random source. */
  generateOtp(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  /** 32 random bytes as base64url: 43 URL-safe characters, no padding. */
  generateMagicToken(): string {
    return randomBytes(32).toString('base64url');
  }

  /** HMAC-SHA256 as lowercase hex: 64 chars, matches CHK_registration_challenges_secret_hash. */
  hmac(secret: string): string {
    return createHmac('sha256', this.key).update(secret).digest('hex');
  }

  /** Constant-time check that `secret` hashes to `storedHash`. */
  matches(secret: string, storedHash: string): boolean {
    const actual = Buffer.from(this.hmac(secret), 'hex');
    const expected = Buffer.from(storedHash, 'hex');

    // timingSafeEqual throws on different lengths. Only a corrupt row could differ (always 32 bytes),
    // and the length itself is not secret, so returning early here leaks nothing.
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  }
}
