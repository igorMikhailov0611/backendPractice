import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/**
 * Argon2id parameters, stated explicitly instead of relying on library defaults.
 * 64 MiB memory, 3 passes, 4 lanes: above the OWASP minimum (19 MiB, t=2, p=1).
 * They are stored inside every hash string, so changing them later only affects new hashes;
 * old ones still verify with the parameters they were created with.
 */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 64 * 1024, // KiB
  timeCost: 3,
  parallelism: 4,
} as const;

/** Slow, salted, one-way password hashing (mentor's registration_requirements.md "Пароль"). */
@Injectable()
export class PasswordHasher {
  /** Returns `$argon2id$v=19$m=65536,t=3,p=4$<salt>$<hash>`. A fresh random salt every call. */
  hash(password: string): Promise<string> {
    return argon2.hash(password, ARGON2_OPTIONS);
  }

  /**
   * True only if `password` produces `hash`. A malformed hash string is treated as "no match"
   * instead of throwing, so a corrupted row can't turn a login attempt into a 500.
   */
  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }
}
