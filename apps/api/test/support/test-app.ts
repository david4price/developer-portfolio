import 'reflect-metadata';
import type { ModuleMetadata } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { configureApp, createFastifyAdapter } from '../../src/app.setup.js';
import { MetricsModule } from '../../src/metrics/metrics.module.js';

/**
 * Boots a Fastify-backed Nest application exactly as `main.ts` configures HTTP, minus listening.
 * `MetricsModule` is always included, as in `AppModule`; read it with `app.get(ApiMetrics)`.
 */
export async function createTestApp(
  metadata: ModuleMetadata,
  corsOrigins: readonly string[] = [],
): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({
    ...metadata,
    imports: [MetricsModule, ...(metadata.imports ?? [])],
  }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter(), {
    logger: false,
  });
  configureApp(app, { corsOrigins });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
