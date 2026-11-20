import { Test, TestingModule } from '@nestjs/testing';

import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { ConfigService } from '@/core/config/config.service';

describe('HealthController', () => {
  let controller: HealthController;
  const healthService = {
    getEmptyResponse: jest.fn(),
    checkHealth: jest.fn(),
  };
  const configService = { get: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthService, useValue: healthService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    controller = module.get(HealthController);
  });

  it('runs real checks when HEALTH_CHECK_ENABLED is "true"', async () => {
    configService.get.mockReturnValue('true');
    healthService.checkHealth.mockResolvedValue('checked');

    await expect(controller.check()).resolves.toBe('checked');
    expect(healthService.getEmptyResponse).not.toHaveBeenCalled();
  });

  it('returns the empty response when HEALTH_CHECK_ENABLED is not "true"', async () => {
    configService.get.mockReturnValue('false');
    healthService.getEmptyResponse.mockReturnValue('empty');

    await expect(controller.check()).resolves.toBe('empty');
    expect(healthService.checkHealth).not.toHaveBeenCalled();
  });
});
