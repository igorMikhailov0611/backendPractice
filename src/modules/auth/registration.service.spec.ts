import { Test } from '@nestjs/testing';
import { QueryFailedError } from 'typeorm';

import { ConfigService } from '@/core/config/config.service';
import { ApiException } from '@/core/http/api-exception';
import { User, UserStatus } from '@/modules/users/entities/user.entity';
import { UsersService } from '@/modules/users/users.service';

import { PasswordHasher } from './password-hasher.service';
import { RegistrationService } from './registration.service';

describe('RegistrationService (confirmation OFF)', () => {
  let service: RegistrationService;
  const users = { findByEmail: jest.fn(), create: jest.fn() };
  const hasher = { hash: jest.fn() };
  const config: Record<string, unknown> = {
    REGISTRATION_EMAIL_CONFIRMATION_ENABLED: false,
  };

  const dto = { email: 'a@example.com', password: 'secret12' };
  const created: User = {
    id: 'u1',
    email: 'a@example.com',
    passwordHash: '$argon2id$hash',
    status: UserStatus.Active,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    users.findByEmail.mockResolvedValue(null);
    users.create.mockResolvedValue(created);
    hasher.hash.mockResolvedValue('$argon2id$hash');

    const moduleRef = await Test.createTestingModule({
      providers: [
        RegistrationService,
        { provide: UsersService, useValue: users },
        { provide: PasswordHasher, useValue: hasher },
        { provide: ConfigService, useValue: { get: (k: string) => config[k] } },
      ],
    }).compile();

    service = moduleRef.get(RegistrationService);
  });

  /** Runs `register` and returns the thrown error (fails the test if nothing is thrown). */
  const registerError = async () => {
    const error: unknown = await service.register(dto).then(
      () => {
        throw new Error('expected register() to throw');
      },
      (e: unknown) => e,
    );
    return error as ApiException;
  };

  it('creates an active user with the hashed password and returns id, email, status', async () => {
    await expect(service.register(dto)).resolves.toEqual({
      id: 'u1',
      email: 'a@example.com',
      status: 'active',
    });
    expect(hasher.hash).toHaveBeenCalledWith('secret12');
    expect(users.create).toHaveBeenCalledWith({
      email: 'a@example.com',
      passwordHash: '$argon2id$hash',
      status: UserStatus.Active,
    });
  });

  it('never passes the raw password to the database', async () => {
    await service.register(dto);

    expect(JSON.stringify(users.create.mock.calls)).not.toContain('secret12');
  });

  it('returns 409 conflict for a taken email, without hashing or inserting', async () => {
    users.findByEmail.mockResolvedValue(created);

    const error = await registerError();

    expect(error.getStatus()).toBe(409);
    expect(error.code).toBe('conflict');
    expect(hasher.hash).not.toHaveBeenCalled();
    expect(users.create).not.toHaveBeenCalled();
  });

  it('returns 409 when a parallel request wins the race (unique violation 23505)', async () => {
    users.create.mockRejectedValue(
      new QueryFailedError(
        'INSERT',
        [],
        Object.assign(new Error('dup'), { code: '23505' }),
      ),
    );

    const error = await registerError();

    expect(error).toBeInstanceOf(ApiException);
    expect(error.getStatus()).toBe(409);
  });

  it('rethrows other database errors unchanged (they become a generic 500)', async () => {
    const dbDown = new Error('connection terminated');
    users.create.mockRejectedValue(dbDown);

    await expect(service.register(dto)).rejects.toBe(dbDown);
  });
});
