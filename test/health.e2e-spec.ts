import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import {
  initializeTransactionalContext,
  StorageDriver,
} from 'typeorm-transactional';

import { AppModule } from '@/core/app/app.module';

describe('Health (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    // Same as main.ts: DatabaseModule registers its DataSource with
    // typeorm-transactional, which requires the context to exist first.
    initializeTransactionalContext({ storageDriver: StorageDriver.AUTO });

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await app.init();
    // Fastify loads plugins asynchronously; wait until it is ready to serve.
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns 200 with status "ok" (public route)', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
  });
});
