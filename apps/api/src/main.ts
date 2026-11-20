import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { configureApp, createFastifyAdapter } from './app.setup.js';
import { createJsonLogger } from './common/logger.js';
import { loadApiConfig } from './config/api-config.js';
import { ApiMetrics } from './metrics/api-metrics.js';
import { startMetricsServer } from './metrics/metrics-server.js';

async function bootstrap(): Promise<void> {
  const config = loadApiConfig();
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(config),
    createFastifyAdapter(),
    { logger: createJsonLogger('api', config.logLevel) },
  );

  configureApp(app, config);
  app.enableShutdownHooks();

  try {
    const metrics = app.get(ApiMetrics);
    metrics.collectProcessMetrics();
    const metricsServer = await startMetricsServer(metrics, config.metrics);
    // Closing the app (shutdown, or a failed start below) closes the metrics port too.
    app
      .getHttpAdapter()
      .getInstance()
      .addHook('onClose', async () => {
        metricsServer.closeAllConnections();
        await new Promise<void>((resolve) => metricsServer.close(() => resolve()));
      });

    await app.listen(config.port, config.host);
  } catch (error) {
    // Release Redis, PostgreSQL, and any open port, so the process can exit with the error.
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
