import { Provider } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';

import { ConfigService } from '@/core/config/config.service';

/** DI token for the SMTP transport, so tests can provide a fake one instead. */
export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

export type MailTransport = Pick<Transporter, 'sendMail'>;

export const mailTransportProvider: Provider = {
  provide: MAIL_TRANSPORT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): MailTransport => {
    const port = Number(config.get('SMTP_PORT'));
    const user = config.get('SMTP_USER');
    const pass = config.get('SMTP_PASS');

    return createTransport({
      host: config.get('SMTP_HOST'),
      port,
      // 465 = TLS from the first byte. Other ports (587, Mailpit's 1025) upgrade with STARTTLS if offered.
      secure: port === 465,
      // Mailpit needs no login. Joi guarantees user and pass are either both set or both missing.
      auth: user ? { user, pass } : undefined,
      // Fail fast: the register request waits for the email, and the default timeouts are minutes.
      connectionTimeout: 5_000,
      greetingTimeout: 5_000,
      socketTimeout: 10_000,
    });
  },
};
