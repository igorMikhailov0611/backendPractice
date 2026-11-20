import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import {
  initializeTransactionalContext,
  StorageDriver,
} from 'typeorm-transactional';

import { AppModule } from '@/core/app/app.module';
import { ConfigService } from '@/core/config/config.service';
import { Config } from '@/core/config/config.types';

/** The real AppModule on Fastify, like main.ts. HTTP calls go through `app.inject()` (no open port). */
export async function createE2eApp(): Promise<NestFastifyApplication> {
  // DatabaseModule registers its DataSource with typeorm-transactional, which needs the context first.
  initializeTransactionalContext({ storageDriver: StorageDriver.AUTO });

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
  );
  await app.init();
  // Fastify loads plugins asynchronously; wait until it is ready to serve.
  await app.getHttpAdapter().getInstance().ready();

  return app;
}

/** Empties the registration tables. Refuses to run on anything but a `*_test` database. */
export async function resetDatabase(
  app: NestFastifyApplication,
): Promise<void> {
  const dataSource = app.get(DataSource);
  const database = String(dataSource.options.database);

  if (!database.endsWith('_test')) {
    throw new Error(`Refusing to TRUNCATE "${database}": not a test database`);
  }

  await dataSource.query(
    'TRUNCATE registration_challenges, users RESTART IDENTITY CASCADE',
  );
}

/**
 * Overrides config keys for the current test. Works because RegistrationService reads
 * the flag and the method on every call, not once at startup. Undone by `jest.restoreAllMocks()`.
 */
export function overrideConfig(
  app: NestFastifyApplication,
  values: Partial<Record<keyof Config, string>>,
): void {
  const config = app.get(ConfigService);
  const original = config.get.bind(config) as (key: keyof Config) => string;

  jest
    .spyOn(config, 'get')
    .mockImplementation((key: keyof Config) => values[key] ?? original(key));
}
