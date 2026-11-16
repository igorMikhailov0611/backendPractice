import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import {
  ThrottlerGuard,
  ThrottlerModule as NestThrottlerModule,
} from '@nestjs/throttler';

import { ConfigModule } from '@/core/config/config.module';
import { ConfigService } from '@/core/config/config.service';

@Module({
  imports: [
    NestThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const ttl = Number(config.get('THROTTLE_GLOBAL_TTL'));
        const limit = Number(config.get('THROTTLE_GLOBAL_LIMIT'));

        return [
          {
            ttl,
            limit,
          },
        ];
      },
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
  exports: [NestThrottlerModule],
})
export class ThrottlerModule {}
