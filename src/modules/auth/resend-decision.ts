import { UserStatus } from '@/modules/users/entities/user.entity';

import { RegistrationChallenge } from './entities/registration-challenge.entity';
import { RESEND_COOLDOWN_SECONDS } from './registration.constants';

/**
 * What a resend request should do. Only `send` issues a new secret.
 * - `cooldown` → 429 rate_limit_exceeded, every other refusal → the same generic 400.
 */
export type ResendOutcome = 'not_found' | 'not_pending' | 'cooldown' | 'send';

/** Everything the decision needs, already loaded. No DB access, no clock: easy to test. */
export interface ResendFacts {
  /** null = no user with this email. */
  userStatus: UserStatus | null;
  /** null = the user has no challenge (e.g. registered while confirmation was OFF). */
  challenge: Pick<RegistrationChallenge, 'lastSentAt'> | null;
  now: Date;
}

/**
 * The resend decision sequence (plan "Decided behaviour" → Resend, mentor's doc §1.3.2 / §1.4).
 * `consumedAt` and `attempts` are deliberately NOT inputs: resend revives an exhausted challenge.
 */
export function decideResend(facts: ResendFacts): ResendOutcome {
  const { userStatus, challenge, now } = facts;

  if (!userStatus) return 'not_found';
  if (userStatus !== UserStatus.Pending) return 'not_pending';
  if (!challenge) return 'not_found';
  const lastSentAt = challenge.lastSentAt;
  if (
    lastSentAt &&
    now.getTime() - lastSentAt.getTime() < RESEND_COOLDOWN_SECONDS * 1000
  ) {
    return 'cooldown';
  }

  return 'send';
}
