import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UsersModule } from '@/modules/users/users.module';

import { ChallengeSecrets } from './challenge-secrets.service';
import { RegistrationChallenge } from './entities/registration-challenge.entity';
import { PasswordHasher } from './password-hasher.service';

@Module({
  imports: [TypeOrmModule.forFeature([RegistrationChallenge]), UsersModule],
  providers: [PasswordHasher, ChallengeSecrets],
})
export class AuthModule {}
