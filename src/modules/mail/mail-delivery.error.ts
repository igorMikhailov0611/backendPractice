/**
 * The SMTP server did not accept the message. The registration flow maps it to
 * 503 `service_unavailable` (mentor's doc §1.4) and keeps the pending user + challenge.
 *
 * The original error is kept as `cause` for debugging, but the message is generic on purpose:
 * SMTP errors can contain server names and recipient addresses.
 */
export class MailDeliveryError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('Email could not be sent', options);
    this.name = 'MailDeliveryError';
  }
}
