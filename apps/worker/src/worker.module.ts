import { type DynamicModule, Module } from '@nestjs/common';
import { QueueWorkerService } from './queue-worker.service.js';
import { WORKER_CONFIG, type WorkerConfig } from './worker-config.js';

@Module({})
export class WorkerModule {
  static register(config: WorkerConfig): DynamicModule {
    return {
      module: WorkerModule,
      providers: [{ provide: WORKER_CONFIG, useValue: config }, QueueWorkerService],
    };
  }
}
