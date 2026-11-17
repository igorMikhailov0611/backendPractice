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
  const users = {
    findByEmail: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    activate: jest.fn(),
  };
  const challenges = {
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    findOne: jest.fn(),
  };
  const hasher = { hash: jest.fn() };
  const secrets = {
    generateOtp: jest.fn(),
    generateMagicToken: jest.fn(),
    hmac: jest.fn(),
    matches: jest.fn(),
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

  describe('confirm', () => {
    const attemptId = '3f2b8c1e-9d4a-4c6b-8e7f-1a2b3c4d5e6f';
    const RIGHT_CODE = '123456';
    const TOKEN = 'T'.repeat(43);
    const otp = (code: string) => ({ attemptId, code });

    /** A fake DB row: the service mutates it and saves it, so state carries over between calls. */
    let row: RegistrationChallenge;
    let account: User;

    /** 200 on success, otherwise the error status. */
    const confirmStatus = (body: object) =>
      service.confirm(body).then(
        () => 200,
        (e: ApiException) => e.getStatus(),
      );
    const confirmError = (body: object) =>
      service.confirm(body).then(
        () => {
          throw new Error('expected confirm() to throw');
        },
        (e: ApiException) => e,
      );

    beforeEach(() => {
      account = user(UserStatus.Pending);
      row = {
        id: attemptId,
        userId: 'u1',
        method: ChallengeMethod.Otp,
        secretHash: 'stored-hash',
        attempts: 0,
        consumedAt: null,
        lastSentAt: new Date(Date.now() - 60_000),
        createdAt: new Date(),
      };

      challenges.findOne.mockImplementation(
        ({ where }: { where: Record<string, unknown> }) =>
          Promise.resolve(
            Object.entries(where).every(
              ([k, v]) => row[k as keyof RegistrationChallenge] === v,
            )
              ? row
              : null,
          ),
      );
      challenges.save.mockImplementation((c: RegistrationChallenge) =>
        Promise.resolve(c),
      );
      users.findById.mockImplementation(() => Promise.resolve(account));
      users.activate.mockImplementation(() => {
        account.status = UserStatus.Active;
        return Promise.resolve();
      });
      secrets.hmac.mockImplementation((s: string) => `hmac(${s})`);
      secrets.matches.mockImplementation(
        (s: string) =>
          s === (row.method === ChallengeMethod.Otp ? RIGHT_CODE : TOKEN),
      );
    });

    it('right code → 200 with the active user, challenge consumed', async () => {
      await expect(service.confirm(otp(RIGHT_CODE))).resolves.toEqual({
        id: 'u1',
        email: 'a@example.com',
        status: 'active',
      });
      expect(users.activate).toHaveBeenCalledWith('u1');
      expect(row.consumedAt).toBeInstanceOf(Date);
    });

    it('loads the challenge with a row lock', async () => {
      await service.confirm(otp(RIGHT_CODE));

      expect(challenges.findOne).toHaveBeenCalledWith({
        where: { id: attemptId, method: ChallengeMethod.Otp },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('wrong ×4, then right → 400 ×4, then 200', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++)
        statuses.push(await confirmStatus(otp('000000')));
      statuses.push(await confirmStatus(otp(RIGHT_CODE)));

      expect(statuses).toEqual([400, 400, 400, 400, 200]);
      expect(row.attempts).toBe(4);
    });

    it('wrong ×5 → the 5th is 400 and consumes; the 6th, even right, is 429', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 5; i++)
        statuses.push(await confirmStatus(otp('000000')));

      expect(statuses).toEqual([400, 400, 400, 400, 400]);
      expect(row.attempts).toBe(5);
      expect(row.consumedAt).toBeInstanceOf(Date);

      const sixth = await confirmError(otp(RIGHT_CODE));
      expect(sixth.getStatus()).toBe(429);
      expect(sixth.code).toBe('rate_limit_exceeded');
      expect(users.activate).not.toHaveBeenCalled();
    });

    it('expired → 400, attempts unchanged', async () => {
      row.lastSentAt = new Date(Date.now() - 11 * 60_000);

      expect(await confirmStatus(otp('000000'))).toBe(400);
      expect(row.attempts).toBe(0);
      expect(challenges.save).not.toHaveBeenCalled();
    });

    it('never delivered (last_sent_at NULL, SMTP failed) → 400', async () => {
      row.lastSentAt = null;

      expect(await confirmStatus(otp(RIGHT_CODE))).toBe(400);
      expect(users.activate).not.toHaveBeenCalled();
    });

    it('already confirmed → 400 on the second try', async () => {
      expect(await confirmStatus(otp(RIGHT_CODE))).toBe(200);
      expect(await confirmStatus(otp(RIGHT_CODE))).toBe(400);
    });

    it('unknown attemptId gets the same 400 body as a wrong code', async () => {
      const wrong = await confirmError(otp('000000'));
      challenges.findOne.mockResolvedValue(null);
      const unknown = await confirmError(otp(RIGHT_CODE));

      expect(unknown.getStatus()).toBe(400);
      expect(unknown.getResponse()).toEqual(wrong.getResponse());
    });

    describe('magic link', () => {
      beforeEach(() => {
        row.method = ChallengeMethod.MagicLink;
        row.secretHash = `hmac(${TOKEN})`;
      });

      it('finds the challenge by HMAC(token)', async () => {
        await service.confirm({ token: TOKEN });

        expect(challenges.findOne).toHaveBeenCalledWith({
          where: {
            secretHash: `hmac(${TOKEN})`,
            method: ChallengeMethod.MagicLink,
          },
          lock: { mode: 'pessimistic_write' },
        });
      });

      it('right token → 200, reused → 400', async () => {
        expect(await confirmStatus({ token: TOKEN })).toBe(200);
        expect(await confirmStatus({ token: TOKEN })).toBe(400);
      });

      it('unknown token → 400', async () => {
        expect(await confirmStatus({ token: 'X'.repeat(43) })).toBe(400);
      });

      it('a magic-link challenge cannot be confirmed with attemptId + code', async () => {
        expect(await confirmStatus(otp(RIGHT_CODE))).toBe(400);
      });
    });
    /**
     * Resend shares the confirm fixtures (the same fake row), so "resend, then confirm" runs end to end
     * against one piece of state. The secret fakes become realistic here: a new code gets a new hash.
     */
    describe('resend', () => {
      const resend = () => service.resend({ email: 'a@example.com' });
      const resendError = () =>
        resend().then(
          () => {
            throw new Error('expected resend() to throw');
          },
          (e: ApiException) => e,
        );

      beforeEach(() => {
        row.secretHash = `hmac(${RIGHT_CODE})`;
        row.lastSentAt = new Date(Date.now() - 2 * 60_000); // outside the cooldown
        users.findByEmail.mockImplementation(() => Promise.resolve(account));
        secrets.matches.mockImplementation(
          (raw: string, stored: string) => `hmac(${raw})` === stored,
        );
        secrets.generateOtp.mockReturnValue('654321');
        challenges.update.mockImplementation(
          (_id: string, patch: Partial<RegistrationChallenge>) => {
            Object.assign(row, patch);
            return Promise.resolve({ affected: 1 });
          },
        );
      });

      it("202 body: same attemptId, the challenge's method, no secret", async () => {
        const body = await resend();

        expect(body).toEqual({
          confirmationRequired: true,
          method: ChallengeMethod.Otp,
          attemptId,
          expiresInSeconds: 600,
          resendAfterSeconds: 60,
        });
        expect(JSON.stringify(body)).not.toContain('654321');
        expect(mail.sendRegistrationOtp).toHaveBeenCalledWith(
          'a@example.com',
          '654321',
        );
      });

      it("locks the user's challenge row", async () => {
        await resend();

        expect(challenges.findOne).toHaveBeenCalledWith({
          where: { userId: 'u1' },
          lock: { mode: 'pessimistic_write' },
        });
      });

      it('updates the same row: new hash, attempts 0, not consumed, TTL restarted', async () => {
        row.attempts = 3;
        const before = Date.now();

        await resend();

        expect(row.secretHash).toBe('hmac(654321)');
        expect(row.attempts).toBe(0);
        expect(row.consumedAt).toBeNull();
        expect(row.lastSentAt!.getTime()).toBeGreaterThanOrEqual(before);
        expect(challenges.create).not.toHaveBeenCalled();
      });

      it('cooldown: a second resend right away → 429, no email, row unchanged', async () => {
        await resend();
        mail.sendRegistrationOtp.mockClear();
        const hashAfterFirst = row.secretHash;

        const error = await resendError();

        expect(error.getStatus()).toBe(429);
        expect(error.code).toBe('rate_limit_exceeded');
        expect(mail.sendRegistrationOtp).not.toHaveBeenCalled();
        expect(row.secretHash).toBe(hashAfterFirst);
      });

      it('old code fails after resend, the new one works', async () => {
        await resend();

        expect(await confirmStatus(otp(RIGHT_CODE))).toBe(400);
        expect(await confirmStatus(otp('654321'))).toBe(200);
      });

      it('an exhausted challenge works again after resend', async () => {
        for (let i = 0; i < 5; i++) await confirmStatus(otp('000000'));
        expect(await confirmStatus(otp(RIGHT_CODE))).toBe(429);

        await resend();

        expect(await confirmStatus(otp('654321'))).toBe(200);
      });

      it('SMTP failure → 503 and last_sent_at NULL; a retry right away is allowed → 202', async () => {
        mail.sendRegistrationOtp.mockRejectedValueOnce(new MailDeliveryError());

        const error = await resendError();
        expect(error.getStatus()).toBe(503);
        expect(error.code).toBe('service_unavailable');
        expect(row.lastSentAt).toBeNull();

        await expect(resend()).resolves.toMatchObject({ attemptId });
      });

      it("keeps the challenge's method even if the config now says otherwise", async () => {
        row.method = ChallengeMethod.MagicLink;
        config.REGISTRATION_CONFIRMATION_METHOD = ChallengeMethod.Otp;

        const body = await resend();

        expect(body.method).toBe(ChallengeMethod.MagicLink);
        expect(mail.sendRegistrationMagicLink).toHaveBeenCalledWith(
          'a@example.com',
          'magic-token',
        );
        expect(mail.sendRegistrationOtp).not.toHaveBeenCalled();
      });

      it('unknown email → 400 bad_request, nothing sent', async () => {
        users.findByEmail.mockResolvedValue(null);

        const error = await resendError();

        expect(error.getStatus()).toBe(400);
        expect(error.code).toBe('bad_request');
        expect(mail.sendRegistrationOtp).not.toHaveBeenCalled();
      });

      it('active user → the same 400 as an unknown email', async () => {
        const unknownBody = await (async () => {
          users.findByEmail.mockResolvedValueOnce(null);
          return (await resendError()).getResponse();
        })();
        account.status = UserStatus.Active;

        const error = await resendError();

        expect(error.getStatus()).toBe(400);
        expect(error.getResponse()).toEqual(unknownBody);
      });
    });
  });
});
