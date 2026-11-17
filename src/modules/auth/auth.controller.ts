import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { RegistrationThrottle } from '@/core/throttler/throttler.decorators';

import { Public } from './decorators/public.decorator';
import { ConfirmRegistrationDto } from './dto/confirm-registration.dto';
import { RegisterDto } from './dto/register.dto';
import { RegisteredUserDto } from './dto/registered-user.dto';
import {
  RegistrationResult,
  RegistrationService,
} from './registration.service';

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
  @Public()
  @Post('register/confirm')
  @HttpCode(HttpStatus.OK)
  confirm(@Body() dto: ConfirmRegistrationDto): Promise<RegisteredUserDto> {
    return this.registration.confirm(dto);
  }
}
