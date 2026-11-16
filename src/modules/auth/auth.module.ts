import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UsersModule } from '@/modules/users/users.module';

import { RegistrationChallenge } from './entities/registration-challenge.entity';

@Module({
  imports: [TypeOrmModule.forFeature([RegistrationChallenge]), UsersModule],
})
export class AuthModule {}
