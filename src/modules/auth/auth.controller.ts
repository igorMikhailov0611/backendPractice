import { Body, Controller, HttpStatus, Post, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { RegistrationThrottle } from '@/core/throttler/throttler.decorators';

import { Public } from './decorators/public.decorator';
import { RegisterDto } from './dto/register.dto';
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
}
