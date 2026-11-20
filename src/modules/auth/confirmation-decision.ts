import { UserStatus } from '@/modules/users/entities/user.entity';

import {
  ChallengeMethod,
  RegistrationChallenge,
} from './entities/registration-challenge.entity';
import {
  CHALLENGE_TTL_SECONDS,
  MAX_OTP_ATTEMPTS,
} from './registration.constants';

/**
 * What a confirm request should do. Only `match` succeeds.
 * - `exhausted` → 429, every other failure → the same generic 400.
 * - `mismatch` is the only outcome that changes the counter (attempts++).
 */
export type ConfirmationOutcome =
  | 'not_found'
  | 'exhausted'
  | 'consumed'
  | 'expired'
  | 'not_pending'
  | 'mismatch'
  | 'match';

/** Everything the decision needs, already loaded. No DB access, no clock: easy to test. */
export interface ConfirmationFacts {
  challenge: Pick<
    RegistrationChallenge,
    'method' | 'attempts' | 'consumedAt' | 'lastSentAt'
  > | null;
  userStatus: UserStatus | null;
  /** HMAC of the submitted secret equals the stored hash (constant-time compare). */
  secretMatches: boolean;
  now: Date;
}

/**
 * The confirm decision sequence (plan "Decided behaviour" → Confirm, mentor's doc §1.3 "Логика/шаги").
 * The ORDER is the security property: the first check that applies wins.
 */
export function decideConfirmation(
  facts: ConfirmationFacts,
): ConfirmationOutcome {
  const { challenge, userStatus, secretMatches, now } = facts;

  if (!challenge) return 'not_found';
  if (challenge.method === ChallengeMethod.Otp && challenge.attempts >= MAX_OTP_ATTEMPTS) return 'exhausted';
  if (challenge.consumedAt) return 'consumed';
  if (!challenge.lastSentAt || now.getTime() > challenge.lastSentAt.getTime() + CHALLENGE_TTL_SECONDS * 1000) return 'expired';
  if (userStatus !== UserStatus.Pending) return 'not_pending';
  if (!secretMatches) return 'mismatch';
  return 'match';
}
