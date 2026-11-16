import { Module } from '@nestjs/common';

import { ConfigModule } from '@/core/config/config.module';
import { DatabaseModule } from '@/core/database/database.module';
import { HealthModule } from '@/core/health/health.module';
import { HttpModule } from '@/core/http/http.module';
import { ThrottlerModule } from '@/core/throttler/throttler.module';

/**
 *
 * Application modules
 *
 */
import { AuthModule } from '@/modules/auth/auth.module';
import { UsersModule } from '@/modules/users/users.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    HealthModule,
    HttpModule,
    ThrottlerModule,
    /**
     *
     * Application modules
     *
     */
    AuthModule,
    UsersModule,
  ],
})
export class AppModule {}
