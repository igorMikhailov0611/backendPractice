import { HttpStatus, Injectable, Logger } from '@nestjs/common';

import { ConfigService } from '@/core/config/config.service';
import { isUniqueViolation } from '@/core/database/postgres-errors';
import { ApiException } from '@/core/http/api-exception';
import { UserStatus } from '@/modules/users/entities/user.entity';
import { UsersService } from '@/modules/users/users.service';

import { RegisterDto } from './dto/register.dto';
import { RegisteredUserDto, toRegisteredUser } from './dto/registered-user.dto';
import { PasswordHasher } from './password-hasher.service';

/** 409 for a taken email (mentor's doc §1.4: explicit 409 is the default). */
const emailTaken = () =>
  new ApiException(
    HttpStatus.CONFLICT,
    'conflict',
    'Email is already registered',
  );

/** Registration flow (mentor's registration_requirements.md §1.3). */
@Injectable()
export class RegistrationService {
  private readonly logger = new Logger(RegistrationService.name);

  constructor(
    private readonly users: UsersService,
    private readonly hasher: PasswordHasher,
    private readonly config: ConfigService,
  ) {}

  /**
   * Confirmation OFF: create an `active` user right away and return `{ id, email, status }` (201).
   * No session is created: logging in is a separate step (mentor's doc §1.2).
   */
  async register(dto: RegisterDto): Promise<RegisteredUserDto> {
    if (this.confirmationEnabled()) {
      // Temporary: the pending-user + email flow arrives in plan step 7.
      throw new Error('Registration with email confirmation is not built yet');
    }

    // Fast path for the common case. Not enough on its own: see the catch below.
    if (await this.users.findByEmail(dto.email)) {
      this.logger.log('registration.failed reason=email_taken');
      throw emailTaken();
    }

    const passwordHash = await this.hasher.hash(dto.password);

    try {
      const user = await this.users.create({
        email: dto.email,
        passwordHash,
        status: UserStatus.Active,
      });
      this.logger.log(`registration.created userId=${user.id} status=active`);

      return toRegisteredUser(user);
    } catch (error) {
      // A parallel request inserted the same email between our check and our insert.
      if (isUniqueViolation(error)) {
        this.logger.log('registration.failed reason=email_taken_race');
        throw emailTaken();
      }
      throw error;
    }
  }

  private confirmationEnabled(): boolean {
    // ConfigService.get() is typed as string; Joi has already turned "true"/"false" into a boolean.
    return (
      String(this.config.get('REGISTRATION_EMAIL_CONFIRMATION_ENABLED')) ===
      'true'
    );
  }
}
