import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';

import { ConfigService } from '@/core/config/config.service';
import { ApiException } from '@/core/http/api-exception';
import { MailDeliveryError } from '@/modules/mail/mail-delivery.error';
import { MailService } from '@/modules/mail/mail.service';
import { User, UserStatus } from '@/modules/users/entities/user.entity';
import { UsersService } from '@/modules/users/users.service';

import { ChallengeSecrets } from './challenge-secrets.service';
import {
  ChallengeMethod,
  RegistrationChallenge,
} from './entities/registration-challenge.entity';
import { PasswordHasher } from './password-hasher.service';
import { RegistrationService } from './registration.service';

// @Transactional() needs a real DataSource. In unit tests it becomes a no-op decorator:
// atomicity is the database's job and is covered by e2e tests, not by mocks.
jest.mock('typeorm-transactional', () => ({
  Transactional: () => () => undefined,
}));

describe('RegistrationService', () => {
  let service: RegistrationService;
  const users = { findByEmail: jest.fn(), create: jest.fn() };
  const challenges = { create: jest.fn(), save: jest.fn(), update: jest.fn() };
  const hasher = { hash: jest.fn() };
  const secrets = {
    generateOtp: jest.fn(),
    generateMagicToken: jest.fn(),
    hmac: jest.fn(),
  };
  const mail = {
    sendRegistrationOtp: jest.fn(),
    sendRegistrationMagicLink: jest.fn(),
  };
  let config: Record<string, unknown>;

  const dto = { email: 'a@example.com', password: 'secret12' };
  const user = (status: UserStatus): User => ({
    id: 'u1',
    email: 'a@example.com',
    passwordHash: '$argon2id$hash',
    status,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const uniqueViolation = () =>
    new QueryFailedError(
      'INSERT',
      [],
      Object.assign(new Error('dup'), { code: '23505' }),
    );

  beforeEach(async () => {
    jest.resetAllMocks();
    config = { REGISTRATION_EMAIL_CONFIRMATION_ENABLED: false };
    users.findByEmail.mockResolvedValue(null);
    users.create.mockImplementation((data: Pick<User, 'status'>) =>
      Promise.resolve(user(data.status)),
    );
    challenges.create.mockImplementation((data: object) => data);
    challenges.save.mockImplementation((data: object) =>
      Promise.resolve({ ...data, id: 'c1' }),
    );
    challenges.update.mockResolvedValue({ affected: 1 });
    hasher.hash.mockResolvedValue('$argon2id$hash');
    secrets.generateOtp.mockReturnValue('123456');
    secrets.generateMagicToken.mockReturnValue('magic-token');
    secrets.hmac.mockReturnValue('a'.repeat(64));

    const moduleRef = await Test.createTestingModule({
      providers: [
        RegistrationService,
        { provide: UsersService, useValue: users },
        {
          provide: getRepositoryToken(RegistrationChallenge),
          useValue: challenges,
        },
        { provide: PasswordHasher, useValue: hasher },
        { provide: ChallengeSecrets, useValue: secrets },
        { provide: MailService, useValue: mail },
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

  describe('confirmation OFF', () => {
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

    it('creates no challenge and sends no email', async () => {
      await service.register(dto);

      expect(challenges.save).not.toHaveBeenCalled();
      expect(mail.sendRegistrationOtp).not.toHaveBeenCalled();
      expect(mail.sendRegistrationMagicLink).not.toHaveBeenCalled();
    });

    it('never passes the raw password to the database', async () => {
      await service.register(dto);

      expect(JSON.stringify(users.create.mock.calls)).not.toContain('secret12');
    });

    it('returns 409 conflict for a taken email, without hashing or inserting', async () => {
      users.findByEmail.mockResolvedValue(user(UserStatus.Active));

      const error = await registerError();

      expect(error.getStatus()).toBe(409);
      expect(error.code).toBe('conflict');
      expect(hasher.hash).not.toHaveBeenCalled();
      expect(users.create).not.toHaveBeenCalled();
    });

    it('returns 409 when a parallel request wins the race (unique violation 23505)', async () => {
      users.create.mockRejectedValue(uniqueViolation());

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

  describe('confirmation ON', () => {
    beforeEach(() => {
      config.REGISTRATION_EMAIL_CONFIRMATION_ENABLED = true;
      config.REGISTRATION_CONFIRMATION_METHOD = 'otp';
    });

    it('returns the 202 body with the challenge id, without the code', async () => {
      const result = await service.register(dto);

      expect(result).toEqual({
        confirmationRequired: true,
        method: 'otp',
        attemptId: 'c1',
        expiresInSeconds: 600,
        resendAfterSeconds: 60,
      });
      expect(JSON.stringify(result)).not.toContain('123456');
    });

    it('creates a pending user and a challenge that stores only the HMAC of the code', async () => {
      await service.register(dto);

      expect(users.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: UserStatus.Pending }),
      );
      expect(secrets.hmac).toHaveBeenCalledWith('123456');
      expect(challenges.save).toHaveBeenCalledWith({
        userId: 'u1',
        method: ChallengeMethod.Otp,
        secretHash: 'a'.repeat(64),
        lastSentAt: expect.any(Date) as Date,
      });
    });

    it('emails the OTP code to the normalized address', async () => {
      await service.register(dto);

      expect(mail.sendRegistrationOtp).toHaveBeenCalledWith(
        'a@example.com',
        '123456',
      );
      expect(mail.sendRegistrationMagicLink).not.toHaveBeenCalled();
    });

    it('emails a magic link when REGISTRATION_CONFIRMATION_METHOD=magic_link', async () => {
      config.REGISTRATION_CONFIRMATION_METHOD = 'magic_link';

      const result = await service.register(dto);

      expect(result).toMatchObject({ method: 'magic_link' });
      expect(secrets.hmac).toHaveBeenCalledWith('magic-token');
      expect(mail.sendRegistrationMagicLink).toHaveBeenCalledWith(
        'a@example.com',
        'magic-token',
      );
      expect(JSON.stringify(result)).not.toContain('magic-token');
    });

    it('sends the email only after both rows are saved', async () => {
      await service.register(dto);

      const saved = challenges.save.mock.invocationCallOrder[0];
      const sent = mail.sendRegistrationOtp.mock.invocationCallOrder[0];
      expect(saved).toBeLessThan(sent);
    });

    it('returns 409 for an email that belongs to a pending user', async () => {
      users.findByEmail.mockResolvedValue(user(UserStatus.Pending));

      const error = await registerError();

      expect(error.getStatus()).toBe(409);
      expect(error.code).toBe('conflict');
      expect(challenges.save).not.toHaveBeenCalled();
      expect(mail.sendRegistrationOtp).not.toHaveBeenCalled();
    });

    it('returns 409 on a race (23505) and sends no email', async () => {
      users.create.mockRejectedValue(uniqueViolation());

      const error = await registerError();

      expect(error.getStatus()).toBe(409);
      expect(mail.sendRegistrationOtp).not.toHaveBeenCalled();
    });

    describe('SMTP failure', () => {
      beforeEach(() => {
        mail.sendRegistrationOtp.mockRejectedValue(new MailDeliveryError());
      });

      it('returns 503 service_unavailable', async () => {
        const error = await registerError();

        expect(error).toBeInstanceOf(ApiException);
        expect(error.getStatus()).toBe(503);
        expect(error.code).toBe('service_unavailable');
      });

      it('keeps the rows but marks the challenge as never delivered (last_sent_at = NULL)', async () => {
        await registerError();

        expect(challenges.update).toHaveBeenCalledWith('c1', {
          lastSentAt: null,
        });
      });

      it('still returns 503 when resetting last_sent_at fails too', async () => {
        challenges.update.mockRejectedValue(new Error('connection terminated'));

        const error = await registerError();

        expect(error).toBeInstanceOf(ApiException);
        expect(error.getStatus()).toBe(503);
      });
    });

    it('rethrows a non-mail error from sending unchanged', async () => {
      const bug = new TypeError('unexpected');
      mail.sendRegistrationOtp.mockRejectedValue(bug);

      await expect(service.register(dto)).rejects.toBe(bug);
    });
  });
});
