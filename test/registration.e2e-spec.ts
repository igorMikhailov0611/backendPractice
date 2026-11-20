import { randomUUID } from 'node:crypto';

import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTransport, SendMailOptions } from 'nodemailer';
import { DataSource } from 'typeorm';

import {
  MAIL_TRANSPORT,
  MailTransport,
} from '@/modules/mail/mail-transport.provider';

import { createE2eApp, overrideConfig, resetDatabase } from './e2e/app';
import {
  countEmailsTo,
  latestEmailTo,
  otpFrom,
  tokenFrom,
} from './e2e/mailpit';

/**
 * Registration flows end to end (plan step 12): real Fastify app, real Postgres (`*_test`), real SMTP
 * to Mailpit. Codes and tokens are read from the delivered emails, never from the API.
 */
describe('Registration (e2e)', () => {
  let app: NestFastifyApplication;
  let db: DataSource;

  beforeAll(async () => {
    app = await createE2eApp();
    db = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => resetDatabase(app));
  afterEach(() => jest.restoreAllMocks());

  /** Unique per test: Mailpit keeps old messages, so a fresh address means "only this test's emails". */
  const newEmail = (tag: string) => `${tag}-${randomUUID()}@example.com`;
  const PASSWORD = 'correct horse 42';

  const register = (email: string, password = PASSWORD) =>
    app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password },
    });
  const confirm = (payload: object) =>
    app.inject({ method: 'POST', url: '/auth/register/confirm', payload });
  const resend = (email: string) =>
    app.inject({
      method: 'POST',
      url: '/auth/register/resend',
      payload: { email },
    });

  // Jest's asymmetric matchers are typed `any`; give them the type of the field they stand for.
  const anyString = expect.any(String) as string;
  const anyDate = expect.any(Date) as Date;

  /** A 6-digit code that is guaranteed to be wrong. */
  const wrongCodeFor = (code: string) =>
    code === '000000' ? '111111' : '000000';

  const rowFor = async (email: string) => {
    const rows: {
      status: string;
      password_hash: string;
      attempts: number | null;
      last_sent_at: Date | null;
      consumed_at: Date | null;
    }[] = await db.query(
      `SELECT u.status, u.password_hash, c.attempts, c.last_sent_at, c.consumed_at
         FROM users u LEFT JOIN registration_challenges c ON c.user_id = u.id
        WHERE u.email = $1`,
      [email],
    );
    return rows[0];
  };

  describe('confirmation OFF', () => {
    beforeEach(() =>
      overrideConfig(app, { REGISTRATION_EMAIL_CONFIRMATION_ENABLED: 'false' }),
    );

    it('201 with an active user and an Argon2id hash; the same email again → 409', async () => {
      const email = newEmail('off');

      const created = await register(email);
      expect(created.statusCode).toBe(201);
      expect(created.json()).toEqual({
        id: anyString,
        email,
        status: 'active',
      });
      expect((await rowFor(email)).password_hash).toMatch(/^\$argon2id\$/);
      expect(await countEmailsTo(email)).toBe(0);

      // Normalization: same address with spaces and capitals is the same user.
      const again = await register(`  ${email.toUpperCase()} `);
      expect(again.statusCode).toBe(409);
      expect(again.json()).toMatchObject({ code: 'conflict' });
    });

    it('400 bad_request for an invalid body, unknown fields included', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email: 'not-an-email', password: 'short', role: 'admin' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ code: 'bad_request' });
    });
  });

  describe('confirmation ON, OTP', () => {
    beforeEach(() =>
      overrideConfig(app, {
        REGISTRATION_EMAIL_CONFIRMATION_ENABLED: 'true',
        REGISTRATION_CONFIRMATION_METHOD: 'otp',
      }),
    );

    it('202 without the code; wrong ×4, then the emailed code → 200 and the user is active', async () => {
      const email = newEmail('otp');

      const res = await register(email);
      expect(res.statusCode).toBe(202);
      const body = res.json<{ attemptId: string }>();
      expect(body).toEqual({
        confirmationRequired: true,
        method: 'otp',
        attemptId: anyString,
        expiresInSeconds: 600,
        resendAfterSeconds: 60,
      });

      const code = otpFrom(await latestEmailTo(email));
      expect(res.body).not.toContain(code);
      expect((await rowFor(email)).status).toBe('pending');

      for (let i = 0; i < 4; i++) {
        const wrong = await confirm({
          attemptId: body.attemptId,
          code: wrongCodeFor(code),
        });
        expect(wrong.statusCode).toBe(400);
      }

      const ok = await confirm({ attemptId: body.attemptId, code });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toEqual({
        id: anyString,
        email,
        status: 'active',
      });
      expect(await rowFor(email)).toMatchObject({
        status: 'active',
        attempts: 4,
        consumed_at: anyDate,
      });
    });

    it('exhaustion: 5 wrong → 400 each; the 6th, even with the right code → 429', async () => {
      const email = newEmail('exhaust');
      const { attemptId } = (await register(email)).json<{
        attemptId: string;
      }>();
      const code = otpFrom(await latestEmailTo(email));

      for (let i = 0; i < 5; i++) {
        const wrong = await confirm({ attemptId, code: wrongCodeFor(code) });
        expect(wrong.statusCode).toBe(400);
      }

      const sixth = await confirm({ attemptId, code });
      expect(sixth.statusCode).toBe(429);
      expect(sixth.json()).toMatchObject({ code: 'rate_limit_exceeded' });
      expect(await rowFor(email)).toMatchObject({
        status: 'pending',
        attempts: 5,
      });
    });

    it("a pending email can't be registered again → 409", async () => {
      const email = newEmail('pending');
      expect((await register(email)).statusCode).toBe(202);

      const again = await register(email, 'another password 7');
      expect(again.statusCode).toBe(409);
    });

    it('resend: the old code stops working, the new one confirms', async () => {
      const email = newEmail('resend');
      const { attemptId } = (await register(email)).json<{
        attemptId: string;
      }>();
      const oldCode = otpFrom(await latestEmailTo(email));

      // 1. Move the first email 61 s into the past, so resend isn't blocked by the 60 s cooldown.
      await db.query(
        "UPDATE registration_challenges SET last_sent_at = now() - interval '61 seconds'",
      );

      // 2. Resend: 202, and the SAME attempt (the row is updated in place, not replaced).
      const resent = await resend(email);
      expect(resent.statusCode).toBe(202);
      expect(resent.json()).toMatchObject({ attemptId });

      // 3. The new code from the SECOND email (`2` = wait until two emails have arrived).
      const newCode = otpFrom(await latestEmailTo(email, 2));

      // 4. The old code no longer works, the new one does.
      expect((await confirm({ attemptId, code: oldCode })).statusCode).toBe(
        400,
      );
      expect((await confirm({ attemptId, code: newCode })).statusCode).toBe(
        200,
      );
    });

    it('SMTP down → 503 with the rows kept; once mail is back, resend → 202 and the new code works', async () => {
      const email = newEmail('smtp-down');

      // A real SMTP connection to a closed port: the same ECONNREFUSED a dead mail server gives.
      const transport = app.get<MailTransport>(MAIL_TRANSPORT);
      const deadSmtp = createTransport({ host: '127.0.0.1', port: 1 });
      const smtpDown = jest
        .spyOn(transport, 'sendMail')
        .mockImplementation(((mail: SendMailOptions) =>
          deadSmtp.sendMail(mail)) as never);

      const failed = await register(email);
      expect(failed.statusCode).toBe(503);
      expect(failed.json()).toMatchObject({ code: 'service_unavailable' });
      // Mentor's doc §1.4: "Запись pending и попытка при этом сохранены."
      expect(await rowFor(email)).toMatchObject({
        status: 'pending',
        last_sent_at: null,
      });

      smtpDown.mockRestore(); // Mailpit is "back"

      // No 60 s cooldown: nothing was delivered.
      const resent = await resend(email);
      expect(resent.statusCode).toBe(202);
      const { attemptId } = resent.json<{ attemptId: string }>();

      const code = otpFrom(await latestEmailTo(email));
      expect((await confirm({ attemptId, code })).statusCode).toBe(200);
    });
  });

  describe('confirmation ON, magic link', () => {
    beforeEach(() =>
      overrideConfig(app, {
        REGISTRATION_EMAIL_CONFIRMATION_ENABLED: 'true',
        REGISTRATION_CONFIRMATION_METHOD: 'magic_link',
      }),
    );

    it('POST the token from the link → 200; the same token again → 400', async () => {
      const email = newEmail('link');

      const res = await register(email);
      expect(res.statusCode).toBe(202);
      expect(res.json()).toMatchObject({ method: 'magic_link' });

      const token = tokenFrom(await latestEmailTo(email));
      expect(res.body).not.toContain(token);

      const ok = await confirm({ token });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toMatchObject({ email, status: 'active' });

      const reused = await confirm({ token });
      expect(reused.statusCode).toBe(400);
    });
  });
});
