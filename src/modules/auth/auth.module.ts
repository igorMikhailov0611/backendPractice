import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { MailModule } from '@/modules/mail/mail.module';
import { UsersModule } from '@/modules/users/users.module';

import { AuthController } from './auth.controller';
import { ChallengeSecrets } from './challenge-secrets.service';
import { RegistrationChallenge } from './entities/registration-challenge.entity';
import { PasswordHasher } from './password-hasher.service';
import { RegistrationService } from './registration.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([RegistrationChallenge]),
    UsersModule,
    MailModule,
  ],
  controllers: [AuthController],
  providers: [PasswordHasher, ChallengeSecrets, RegistrationService],
})
export class AuthModule {}
