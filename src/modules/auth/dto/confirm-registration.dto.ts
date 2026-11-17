import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsUUID, Matches, ValidateIf } from 'class-validator';

import { NotTogetherWith } from '@/core/http/not-together-with.decorator';

/**
 * Body of `POST /auth/register/confirm`: exactly one of
 * - `{ attemptId, code }`: OTP. The challenge is found by id, then the code is compared.
 * - `{ token }`: magic link. The challenge is found by HMAC(token); no id is needed.
 *
 * How "exactly one" works: the OTP fields are required unless a token is sent, and a token
 * may not come with OTP fields. An empty body fails on attemptId/code.
 */
export class ConfirmRegistrationDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'OTP only: the `attemptId` from the 202 response. Send together with `code`.',
  })
  @ValidateIf((o: ConfirmRegistrationDto) => o.token === undefined)
  @IsUUID()
  attemptId?: string;

  @ApiPropertyOptional({
    pattern: '^\\d{6}$',
    example: '123456',
    description: 'OTP only: the 6-digit code from the email.',
  })
  @ValidateIf((o: ConfirmRegistrationDto) => o.token === undefined)
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code?: string;

  /** 32 random bytes as base64url = 43 chars. Rejecting other shapes early saves an HMAC + DB query. */
  @ApiPropertyOptional({
    pattern: '^[A-Za-z0-9_-]{43}$',
    description:
      'Magic link only: the `token` from the link fragment (`#token=…`). Not together with attemptId/code.',
  })
  @ValidateIf((o: ConfirmRegistrationDto) => o.token !== undefined)
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/, { message: 'token has an invalid format' })
  @NotTogetherWith(['attemptId', 'code'])
  token?: string;
}
