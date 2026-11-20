import { Module } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import {
  ThrottlerGuard,
  ThrottlerModule as NestThrottlerModule,
} from '@nestjs/throttler';

import { ConfigModule } from '@/core/config/config.module';
import { ConfigService } from '@/core/config/config.service';

import {
  REGISTRATION_THROTTLE_KEY,
  REGISTRATION_THROTTLER,
} from './throttler.decorators';

@Module({
  imports: [
    NestThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService, Reflector],
      useFactory: (config: ConfigService, reflector: Reflector) => {
        const ttl = Number(config.get('THROTTLE_GLOBAL_TTL'));
        const limit = Number(config.get('THROTTLE_GLOBAL_LIMIT'));

        return [
          // Applies to every route (unless @SkipThrottle).
          {
            name: 'default',
            ttl,
            limit,
          },
          // Applies only to routes marked with @RegistrationThrottle(); skipped everywhere else.
          {
            name: REGISTRATION_THROTTLER,
            ttl: 60_000,
            limit: Number(config.get('REGISTRATION_RATE_LIMIT')),
            skipIf: (context) =>
              !reflector.getAllAndOverride<boolean>(REGISTRATION_THROTTLE_KEY, [
                context.getHandler(),
                context.getClass(),
              ]),
          },
        ];
      },
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
  exports: [NestThrottlerModule],
})
export class ThrottlerModule {}
