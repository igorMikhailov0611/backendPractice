import { User, UserStatus } from '@/modules/users/entities/user.entity';

import { toRegisteredUser } from './registered-user.dto';

describe('toRegisteredUser', () => {
  const user: User = {
    id: '35524561-6c51-4c99-88c7-708177b8e677',
    email: 'a@example.com',
    passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA',
    status: UserStatus.Active,
    createdAt: new Date('2026-11-16T10:00:00Z'),
    updatedAt: new Date('2026-11-16T10:00:00Z'),
  };

  it('returns id, email and status', () => {
    expect(toRegisteredUser(user)).toEqual({
      id: user.id,
      email: 'a@example.com',
      status: 'active',
    });
  });

  it('returns exactly those three fields and nothing else', () => {
    expect(Object.keys(toRegisteredUser(user)).sort()).toEqual([
      'email',
      'id',
      'status',
    ]);
  });

  it('never contains the password hash, even when serialized', () => {
    expect(JSON.stringify(toRegisteredUser(user))).not.toContain('argon2');
  });

  it('keeps the pending status as is', () => {
    expect(
      toRegisteredUser({ ...user, status: UserStatus.Pending }).status,
    ).toBe('pending');
  });
});
