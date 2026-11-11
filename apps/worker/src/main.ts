import 'reflect-metadata';
import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { logLevelsUpTo } from '@portfolio/config';
import { loadWorkerConfig } from './worker-config.js';
import { WorkerModule } from './worker.module.js';

async function bootstrap(): Promise<void> {
  const config = loadWorkerConfig();
  const app = await NestFactory.createApplicationContext(WorkerModule.register(config), {
    logger: new ConsoleLogger('worker', { json: true, logLevels: logLevelsUpTo(config.logLevel) }),
  });

  app.enableShutdownHooks();
  await app.init();
}

bootstrap().catch((error: unknown) => {
  process.stderr.write(
    `Unable to start worker: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
