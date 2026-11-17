import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Res,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply } from 'fastify';

import { ErrorResponseDto } from '@/core/http/error-response.dto';
import { RegistrationThrottle } from '@/core/throttler/throttler.decorators';

import { Public } from './decorators/public.decorator';
import { ConfirmRegistrationDto } from './dto/confirm-registration.dto';
import { RegisterDto } from './dto/register.dto';
import { ConfirmationRequiredDto } from './dto/confirmation-required.dto';
import { RegisteredUserDto } from './dto/registered-user.dto';
import { ResendRegistrationDto } from './dto/resend-registration.dto';
import {
  RegistrationResult,
  RegistrationService,
} from './registration.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly registration: RegistrationService) {}

  /**
   * Guest-only operation, so @Public(). The body is validated and normalized by the global
   * ValidationPipe before this method runs; a bad body never reaches the service (400 bad_request).
   * Rate limit: REGISTRATION_RATE_LIMIT per minute per IP (mentor's doc §1.6) → 429 rate_limit_exceeded.
   *
   * Status depends on the outcome, so it can't be a static @HttpCode():
   * 201 Created (user is active) or 202 Accepted (user is pending, an email is on its way).
   * `passthrough: true` lets us set the status while Nest still serializes the return value.
   */
  @ApiOperation({
    summary: 'Register with email + password',
    description:
      'No session is created. Whether an email confirmation is required is a server setting ' +
      '(REGISTRATION_EMAIL_CONFIRMATION_ENABLED), so a client must handle both 201 and 202.',
  })
  @ApiCreatedResponse({
    type: RegisteredUserDto,
    description: 'Confirmation OFF: the user is active.',
  })
  @ApiAcceptedResponse({
    type: ConfirmationRequiredDto,
    description:
      'Confirmation ON: the user is pending, a code or link was emailed. The secret is never in the response.',
  })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Invalid email, password policy failed, or unknown fields.',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'Email already registered (active or pending).',
  })
  @ApiTooManyRequestsResponse({
    type: ErrorResponseDto,
    description:
      'More than REGISTRATION_RATE_LIMIT requests per minute from this IP.',
  })
  @ApiServiceUnavailableResponse({
    type: ErrorResponseDto,
    description:
      'Email not sent. The pending user and the attempt are kept: use resend.',
  })
  @Public()
  @RegistrationThrottle()
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<RegistrationResult> {
    const result = await this.registration.register(dto);

    if ('confirmationRequired' in result) {
      reply.status(HttpStatus.ACCEPTED);
    }
    return result;
  }

  /**
   * Body: `{ attemptId, code }` (OTP) or `{ token }` (magic link). The link in the email opens a page,
   * and that page POSTs the token: a GET must never change state, or mail scanners that prefetch
   * links would confirm accounts (spec §2 "Magic Link").
   * 200 `{ id, email, status: "active" }`, 400 for any invalid/expired/used secret, 429 when exhausted.
   */
  @ApiOperation({
    summary: 'Confirm a pending registration',
    description:
      'Send exactly one of `{ attemptId, code }` (OTP) or `{ token }` (magic link).',
  })
  @ApiBody({
    type: ConfirmRegistrationDto,
    examples: {
      otp: {
        summary: 'OTP code',
        value: {
          attemptId: '3f2b8c1e-9d4a-4c6b-8e7f-1a2b3c4d5e6f',
          code: '123456',
        },
      },
      magicLink: {
        summary: 'Magic-link token',
        value: { token: 'q3Jd0Yb8kC1xZr7mW2nE5tLp9sVa4uHf6gKi0oNyR8c' },
      },
    },
  })
  @ApiOkResponse({
    type: RegisteredUserDto,
    description: 'The user is now active.',
  })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'Wrong, expired, already used or unknown code/token. One generic answer for all of them.',
  })
  @ApiTooManyRequestsResponse({
    type: ErrorResponseDto,
    description:
      '5 wrong codes: even the right code is refused now. Request a new one via resend.',
  })
  @Public()
  @Post('register/confirm')
  @HttpCode(HttpStatus.OK)
  confirm(@Body() dto: ConfirmRegistrationDto): Promise<RegisteredUserDto> {
    return this.registration.confirm(dto);
  }

  /**
   * Body: `{ email }`. Replaces the code/link of a pending user's challenge and emails it again.
   * 202 (same body as register, same attemptId), 400 for an unknown / non-pending email,
   * 429 within 60 s of the last email, 503 if SMTP fails (rows kept, retry allowed right away).
   *
   * Two limits: the 60 s cooldown is per EMAIL (protects one inbox), this @Throttle is per IP
   * (one client can't cycle through many emails). A fixed number, so a static decorator is fine here.
   * It overrides the `default` throttler for this route only → 429 rate_limit_exceeded.
   */
  @ApiOperation({
    summary: 'Resend the confirmation email',
    description:
      'Replaces the previous code/link (it stops working), restarts the 10-minute TTL and resets the attempt counter.',
  })
  @ApiAcceptedResponse({
    type: ConfirmationRequiredDto,
    description: 'A new email is on its way. Same attemptId as before.',
  })
  @ApiTooManyRequestsResponse({
    type: ErrorResponseDto,
    description:
      'Too soon. Either an email was already sent to this address less than 60 s ago ' +
      '(wait for `resendAfterSeconds` from the previous response), or this IP sent more than ' +
      '10 resend requests in the last minute (wait for the `Retry-After` header).',
  })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'Nothing to resend: the email is invalid, unknown, or already confirmed. ' +
      'One generic answer for all of them. Show the user a neutral message or send them to login.',
  })
  @ApiServiceUnavailableResponse({
    type: ErrorResponseDto,
    description:
      'Email not sent. The attempt is kept and no cooldown applies, so the client may retry right away.',
  })
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('register/resend')
  @HttpCode(HttpStatus.ACCEPTED)
  resend(@Body() dto: ResendRegistrationDto): Promise<ConfirmationRequiredDto> {
    return this.registration.resend(dto);
  }
}
