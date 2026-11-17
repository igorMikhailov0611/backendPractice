import { ChallengeMethod } from '../entities/registration-challenge.entity';

/**
 * 202 body of `POST /auth/register` (confirmation ON) and of `POST /auth/register/resend`.
 * Spec §2 / mentor's doc §1.3: the code or token itself is never part of the response, only the email.
 */
export class ConfirmationRequiredDto {
  confirmationRequired: true;
  method: ChallengeMethod;
  /** The challenge id. The client sends it back together with the OTP code. */
  attemptId: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
}
