import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { configureApp, createFastifyAdapter } from './app.setup.js';
import { createJsonLogger } from './common/logger.js';
import { loadApiConfig } from './config/api-config.js';

async function bootstrap(): Promise<void> {
  const config = loadApiConfig();
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(config),
    createFastifyAdapter(),
    { logger: createJsonLogger('api', config.logLevel) },
  );

  configureApp(app, config);
  app.enableShutdownHooks();

  await app.listen(config.port, config.host);
}

bootstrap().catch((error: unknown) => {
  process.stderr.write(
    `Unable to start api: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
