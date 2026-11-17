import { Body, Controller, Post } from '@nestjs/common';

import { RegistrationThrottle } from '@/core/throttler/throttler.decorators';

import { Public } from './decorators/public.decorator';
import { RegisterDto } from './dto/register.dto';
import { RegisteredUserDto } from './dto/registered-user.dto';
import { RegistrationService } from './registration.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly registration: RegistrationService) {}

  /**
   * Guest-only operation, so @Public(). The body is validated and normalized by the global
   * ValidationPipe before this method runs; a bad body never reaches the service (400 bad_request).
   * POST answers 201 Created by default in Nest.
   * Rate limit: REGISTRATION_RATE_LIMIT per minute per IP (mentor's doc §1.6) → 429 rate_limit_exceeded.
   */
  @Public()
  @RegistrationThrottle()
  @Post('register')
  register(@Body() dto: RegisterDto): Promise<RegisteredUserDto> {
    return this.registration.register(dto);
  }
}
