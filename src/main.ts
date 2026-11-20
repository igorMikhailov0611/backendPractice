import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import compression from '@fastify/compress';
import fastifyCookie from '@fastify/cookie';
import {
  initializeTransactionalContext,
  StorageDriver,
} from 'typeorm-transactional';

import { AppModule } from './core/app/app.module';
import { ConfigService } from '@/core/config/config.service';
import { parseTrustedOrigins } from '@/core/config/config.validation';
import { setupApiDocs } from '@/core/docs/api-docs';

async function bootstrap() {
  initializeTransactionalContext({ storageDriver: StorageDriver.AUTO });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  await app.register(compression);

  const configService = app.get(ConfigService);

  // Exact origins only: `*` is not allowed together with credentials (mentor 1.3.3).
  // X-CSRF-Protection must be allowed, or the preflight blocks every cross-origin POST.
  app.enableCors({
    origin: parseTrustedOrigins(configService.get('TRUSTED_ORIGINS')),
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    allowedHeaders: ['Content-Type', 'X-CSRF-Protection'],
    credentials: true,
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });

  await app.register(fastifyCookie, {
    secret: configService.get('COOKIE_SECRET'),
  });

  setupApiDocs(app, configService);

  const port = configService.get('PORT');

  await app.listen(port);
}

bootstrap();
