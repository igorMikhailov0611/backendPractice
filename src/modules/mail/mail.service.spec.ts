import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { ConfigService } from '@/core/config/config.service';

import { MailDeliveryError } from './mail-delivery.error';
import { MAIL_TRANSPORT } from './mail-transport.provider';
import { MailService } from './mail.service';

interface SentMail {
  from: string;
  to: string;
  subject: string;
  text: string;
}

describe('MailService', () => {
  let service: MailService;
  const transport = { sendMail: jest.fn<Promise<unknown>, [SentMail]>() };
  const config: Record<string, string> = {
    SMTP_FROM: 'Backend Practice <no-reply@localhost>',
    FRONTEND_BASE_URL: 'http://localhost:4200',
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        MailService,
        { provide: MAIL_TRANSPORT, useValue: transport },
        { provide: ConfigService, useValue: { get: (k: string) => config[k] } },
      ],
    }).compile();

    service = moduleRef.get(MailService);
  });

  const sent = () => transport.sendMail.mock.calls[0][0];

  describe('sendRegistrationOtp', () => {
    it('sends the code to the recipient from SMTP_FROM', async () => {
      await service.sendRegistrationOtp('a@example.com', '042137');

      expect(sent()).toMatchObject({
        from: 'Backend Practice <no-reply@localhost>',
        to: 'a@example.com',
      });
      expect(sent().text).toContain('042137');
      expect(sent().text).toContain('10 minutes');
    });
  });

  describe('sendRegistrationMagicLink', () => {
    it('puts the token in the URL fragment of a FRONTEND_BASE_URL link', async () => {
      await service.sendRegistrationMagicLink('a@example.com', 'tok_EN-123');

      expect(sent().text).toContain(
        'http://localhost:4200/register/confirm#token=tok_EN-123',
      );
    });
  });

  describe('when SMTP fails', () => {
    const smtpError = Object.assign(
      new Error('550 mailbox a@example.com rejected, code 042137'),
      { name: 'SmtpError' },
    );

    beforeEach(() => transport.sendMail.mockRejectedValue(smtpError));

    it('throws MailDeliveryError with a generic message and the original as cause', async () => {
      const error: unknown = await service
        .sendRegistrationOtp('a@example.com', '042137')
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(MailDeliveryError);
      expect((error as Error).message).toBe('Email could not be sent');
      expect((error as Error).cause).toBe(smtpError);
    });

    it('logs neither the recipient nor the secret', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      await service
        .sendRegistrationOtp('a@example.com', '042137')
        .catch(() => undefined);

      const logged = JSON.stringify(warn.mock.calls);
      expect(logged).not.toContain('a@example.com');
      expect(logged).not.toContain('042137');
      warn.mockRestore();
    });
  });
});
