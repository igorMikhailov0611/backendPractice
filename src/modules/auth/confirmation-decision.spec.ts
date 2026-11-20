import { UserStatus } from '@/modules/users/entities/user.entity';

import { ConfirmationFacts, decideConfirmation } from './confirmation-decision';
import { ChallengeMethod } from './entities/registration-challenge.entity';

const now = new Date('2026-01-01T12:00:00Z');
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

/** A live, untouched OTP challenge for a pending user, with the right code. Override one fact per test. */
const facts = (
  overrides: Partial<ConfirmationFacts> & {
    challenge?: Partial<NonNullable<ConfirmationFacts['challenge']>> | null;
  } = {},
): ConfirmationFacts => {
  const { challenge, ...rest } = overrides;
  return {
    userStatus: UserStatus.Pending,
    secretMatches: true,
    now,
    ...rest,
    challenge:
      challenge === null
        ? null
        : {
            method: ChallengeMethod.Otp,
            attempts: 0,
            consumedAt: null,
            lastSentAt: minutesAgo(1),
            ...challenge,
          },
  };
};

describe('decideConfirmation', () => {
  describe('each rule on its own', () => {
    it('match: live challenge, pending user, right secret', () => {
      expect(decideConfirmation(facts())).toBe('match');
    });

    it('not_found: no challenge', () => {
      expect(decideConfirmation(facts({ challenge: null }))).toBe('not_found');
    });

    it('exhausted: OTP with 5 wrong inputs', () => {
      expect(decideConfirmation(facts({ challenge: { attempts: 5 } }))).toBe(
        'exhausted',
      );
    });

    it('consumed: already used', () => {
      expect(
        decideConfirmation(facts({ challenge: { consumedAt: minutesAgo(1) } })),
      ).toBe('consumed');
    });

    it('expired: never delivered (last_sent_at NULL)', () => {
      expect(
        decideConfirmation(facts({ challenge: { lastSentAt: null } })),
      ).toBe('expired');
    });

    it('expired: sent more than 10 minutes ago', () => {
      expect(
        decideConfirmation(
          facts({ challenge: { lastSentAt: minutesAgo(11) } }),
        ),
      ).toBe('expired');
    });

    it('not_pending: user is already active', () => {
      expect(decideConfirmation(facts({ userStatus: UserStatus.Active }))).toBe(
        'not_pending',
      );
    });

    it('not_pending: user row is gone', () => {
      expect(decideConfirmation(facts({ userStatus: null }))).toBe(
        'not_pending',
      );
    });

    it('mismatch: wrong secret', () => {
      expect(decideConfirmation(facts({ secretMatches: false }))).toBe(
        'mismatch',
      );
    });
  });

  describe('boundaries', () => {
    it('the 5th input can still succeed (attempts = 4)', () => {
      expect(decideConfirmation(facts({ challenge: { attempts: 4 } }))).toBe(
        'match',
      );
    });

    it('exactly 10 minutes after sending is still valid', () => {
      expect(
        decideConfirmation(
          facts({ challenge: { lastSentAt: minutesAgo(10) } }),
        ),
      ).toBe('match');
    });

    it('the attempt limit does not apply to magic links', () => {
      expect(
        decideConfirmation(
          facts({
            challenge: { method: ChallengeMethod.MagicLink, attempts: 5 },
          }),
        ),
      ).toBe('match');
    });
  });

  describe('order: the first applicable rule wins', () => {
    it('exhausted beats a right code (no 6th guess)', () => {
      expect(
        decideConfirmation(
          facts({ challenge: { attempts: 5, consumedAt: minutesAgo(1) } }),
        ),
      ).toBe('exhausted');
    });

    it('exhausted beats expired', () => {
      expect(
        decideConfirmation(
          facts({ challenge: { attempts: 5, lastSentAt: minutesAgo(30) } }),
        ),
      ).toBe('exhausted');
    });

    it('consumed beats expired and mismatch', () => {
      expect(
        decideConfirmation(
          facts({
            secretMatches: false,
            challenge: {
              consumedAt: minutesAgo(1),
              lastSentAt: minutesAgo(30),
            },
          }),
        ),
      ).toBe('consumed');
    });

    it('expired beats mismatch (a wrong code on an expired challenge does not count)', () => {
      expect(
        decideConfirmation(
          facts({
            secretMatches: false,
            challenge: { lastSentAt: minutesAgo(11) },
          }),
        ),
      ).toBe('expired');
    });

    it('not_pending beats mismatch', () => {
      expect(
        decideConfirmation(
          facts({ secretMatches: false, userStatus: UserStatus.Active }),
        ),
      ).toBe('not_pending');
    });
  });
});
