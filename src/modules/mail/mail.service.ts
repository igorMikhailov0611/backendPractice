import { Inject, Injectable, Logger } from '@nestjs/common';

import { ConfigService } from '@/core/config/config.service';

import { MailDeliveryError } from './mail-delivery.error';
import { MAIL_TRANSPORT, type MailTransport } from './mail-transport.provider';

/** Confirmation secrets expire 10 minutes after sending (mentor's doc, `registration_challenges.expires_at`). */
const TTL_MINUTES = 10;

interface Mail {
  to: string;
  subject: string;
  text: string;
}

/**
 * Sends the registration emails. The code / token appears ONLY in the email body:
 * never in logs, errors or API responses (mentor's doc §1.5).
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
    private readonly config: ConfigService,
  ) {}

  sendRegistrationOtp(to: string, code: string): Promise<void> {
    return this.send({
      to,
      subject: 'Your confirmation code',
      text: [
        `Your confirmation code: ${code}`,
        '',
        `It expires in ${TTL_MINUTES} minutes.`,
        'If you did not register, ignore this email.',
      ].join('\n'),
    });
  }

  /**
   * The token goes in the URL fragment (#), which browsers never send to any server and never put in
   * the Referer header. A page reads it and POSTs it to /auth/register/confirm, so merely opening the
   * link (or a mail scanner prefetching it) changes nothing.
   */
  sendRegistrationMagicLink(to: string, token: string): Promise<void> {
    const link = `${this.config.get('FRONTEND_BASE_URL')}/register/confirm#token=${token}`;

    return this.send({
      to,
      subject: 'Confirm your email',
      text: [
        'Open this link to confirm your email:',
        link,
        '',
        `It expires in ${TTL_MINUTES} minutes and works once.`,
        'If you did not register, ignore this email.',
      ].join('\n'),
    });
  }

  private async send(mail: Mail): Promise<void> {
    try {
      await this.transport.sendMail({
        from: this.config.get('SMTP_FROM'),
        ...mail,
      });
    } catch (error) {
      // Only the error type: no recipient, no body (it contains the secret).
      this.logger.warn(
        `SMTP rejected a message: ${(error as Error)?.name ?? 'unknown error'}`,
      );
      throw new MailDeliveryError({ cause: error });
    }
  }
}
