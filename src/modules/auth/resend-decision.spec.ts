import { UserStatus } from '@/modules/users/entities/user.entity';

import { decideResend, ResendFacts } from './resend-decision';

const now = new Date('2026-01-01T12:00:00Z');
const secondsAgo = (s: number) => new Date(now.getTime() - s * 1000);

/** A pending user whose email went out 2 minutes ago: resend is allowed. Override one fact per test. */
const facts = (overrides: Partial<ResendFacts> = {}): ResendFacts => ({
  userStatus: UserStatus.Pending,
  challenge: { lastSentAt: secondsAgo(120) },
  now,
  ...overrides,
});

describe('decideResend', () => {
  it('send: pending user, last email older than 60 s', () => {
    expect(decideResend(facts())).toBe('send');
  });

  it('not_found: no user with this email', () => {
    expect(decideResend(facts({ userStatus: null, challenge: null }))).toBe(
      'not_found',
    );
  });

  it('not_found: user exists but has no challenge', () => {
    expect(decideResend(facts({ challenge: null }))).toBe('not_found');
  });

  it('not_pending: user is already active', () => {
    expect(decideResend(facts({ userStatus: UserStatus.Active }))).toBe(
      'not_pending',
    );
  });

  it('cooldown: last email 30 s ago', () => {
    expect(
      decideResend(facts({ challenge: { lastSentAt: secondsAgo(30) } })),
    ).toBe('cooldown');
  });

  it('cooldown: last email 59.999 s ago', () => {
    const lastSentAt = new Date(now.getTime() - 59_999);
    expect(decideResend(facts({ challenge: { lastSentAt } }))).toBe('cooldown');
  });

  it('send: exactly 60 s after the last email ("не чаще 1 раза в 60 секунд")', () => {
    expect(
      decideResend(facts({ challenge: { lastSentAt: secondsAgo(60) } })),
    ).toBe('send');
  });

  it('send: never delivered (SMTP failed, last_sent_at NULL) → no cooldown, retry right away', () => {
    expect(decideResend(facts({ challenge: { lastSentAt: null } }))).toBe(
      'send',
    );
  });

  describe('order', () => {
    it('an active user inside the cooldown window gets not_pending, not cooldown', () => {
      expect(
        decideResend(
          facts({
            userStatus: UserStatus.Active,
            challenge: { lastSentAt: secondsAgo(5) },
          }),
        ),
      ).toBe('not_pending');
    });
  });
});
