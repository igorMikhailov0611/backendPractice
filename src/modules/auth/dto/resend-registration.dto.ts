import { NormalizedEmail } from '../decorators/normalized-email.decorator';

/**
 * Body of `POST /auth/register/resend` (mentor's doc §1.3.2). The client sends the email, not the
 * attemptId: a magic-link user never sees an attemptId, and this works for both methods.
 */
export class ResendRegistrationDto {
  @NormalizedEmail()
  email: string;
}
