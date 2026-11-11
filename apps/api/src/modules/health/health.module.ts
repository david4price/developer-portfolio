import { type DynamicModule, Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { READINESS_CHECKS, type ReadinessCheck } from './readiness.js';

@Module({})
export class HealthModule {
  /** Collects the readiness checks exported under `tokens` by infrastructure modules. */
  static forChecks(tokens: readonly symbol[]): DynamicModule {
    return {
      module: HealthModule,
      controllers: [HealthController],
      providers: [
        {
          provide: READINESS_CHECKS,
          inject: [...tokens],
          useFactory: (...checks: ReadinessCheck[]) => checks,
        },
      ],
    };
  }
}
