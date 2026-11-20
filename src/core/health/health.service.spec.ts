import { Test, TestingModule } from '@nestjs/testing';
import { HealthCheckService } from '@nestjs/terminus';

import { HealthService } from './health.service';

describe('HealthService', () => {
  let service: HealthService;
  const healthCheckService = { check: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: HealthCheckService, useValue: healthCheckService },
      ],
    }).compile();

    service = module.get(HealthService);
  });

  it('returns an "ok" response with no details when checks are skipped', () => {
    expect(service.getEmptyResponse()).toEqual({ status: 'ok', details: {} });
  });

  it('delegates to terminus HealthCheckService', async () => {
    const result = { status: 'ok', details: {} };
    healthCheckService.check.mockResolvedValue(result);

    await expect(service.checkHealth()).resolves.toBe(result);
    expect(healthCheckService.check).toHaveBeenCalledWith([]);
  });
});
