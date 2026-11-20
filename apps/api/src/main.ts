import 'reflect-metadata';
import type { Server } from 'node:http';
import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { configureApp, createFastifyAdapter } from './app.setup.js';
import { createJsonLogger } from './common/logger.js';
import { loadApiConfig } from './config/api-config.js';
import { ApiMetrics } from './metrics/api-metrics.js';
import { closeMetricsServer, startMetricsServer } from './metrics/metrics-server.js';

async function bootstrap(): Promise<void> {
  const config = loadApiConfig();
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(config),
    createFastifyAdapter(),
    { logger: createJsonLogger('api', config.logLevel) },
  );

  configureApp(app, config);
  app.enableShutdownHooks();

  let metricsServer: Server | undefined;
  try {
    const metrics = app.get(ApiMetrics);
    metrics.collectProcessMetrics();
    const started = await startMetricsServer(metrics, config.metrics);
    metricsServer = started;
    // A normal shutdown closes the metrics port with the app.
    app
      .getHttpAdapter()
      .getInstance()
      .addHook('onClose', () => closeMetricsServer(started));

    await app.listen(config.port, config.host);
  } catch (error) {
    // Release every open port, Redis, and PostgreSQL, so the process can exit with the error.
    // The metrics port is closed directly too, in case closing the app fails first.
    if (metricsServer !== undefined) await closeMetricsServer(metricsServer);
    await app.close().catch(() => undefined);
    throw error;
  }
}

bootstrap().catch((error: unknown) => {
  process.stderr.write(
    `Unable to start api: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
