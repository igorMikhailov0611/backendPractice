import { ApiProperty } from '@nestjs/swagger';

import { ChallengeMethod } from '../entities/registration-challenge.entity';

/**
 * 202 body of `POST /auth/register` (confirmation ON) and of `POST /auth/register/resend`.
 * Spec §2 / mentor's doc §1.3: the code or token itself is never part of the response, only the email.
 */
export class ConfirmationRequiredDto {
  @ApiProperty({ enum: [true], example: true })
  confirmationRequired: true;
  @ApiProperty({
    enum: ChallengeMethod,
    description:
      'Chosen by the server. `otp`: a code in the email; `magic_link`: a link.',
  })
  method: ChallengeMethod;
  /** The challenge id. The client sends it back together with the OTP code. */
  @ApiProperty({ format: 'uuid' })
  attemptId: string;
  @ApiProperty({
    example: 600,
    description: 'The code/link stops working after this.',
  })
  expiresInSeconds: number;
  @ApiProperty({
    example: 60,
    description: 'Earliest moment POST /auth/register/resend is accepted.',
  })
  resendAfterSeconds: number;
}
