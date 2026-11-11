import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { type Job, Worker } from 'bullmq';
import { NOOP_QUEUE, processNoop } from './jobs/noop.job.js';
import { WORKER_CONFIG, type WorkerConfig } from './worker-config.js';

@Injectable()
export class QueueWorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('QueueWorker');
  private closeWorker: (() => Promise<void>) | undefined;

  constructor(@Inject(WORKER_CONFIG) private readonly config: WorkerConfig) {}

  onApplicationBootstrap(): void {
    const worker = new Worker(NOOP_QUEUE, async (job: Job) => processNoop(job.data), {
      connection: { url: this.config.redisUrl, maxRetriesPerRequest: null },
      concurrency: this.config.concurrency,
    });
    this.closeWorker = () => worker.close();

    worker.on('completed', (job) =>
      this.logger.log({ message: 'job completed', queue: NOOP_QUEUE, jobId: job.id }),
    );
    worker.on('failed', (job, error) =>
      this.logger.warn({
        message: 'job failed',
        queue: NOOP_QUEUE,
        jobId: job?.id,
        attempt: job?.attemptsMade,
        error: error.message,
      }),
    );
    worker.on('error', (error) =>
      this.logger.error({ message: 'worker error', error: error.message }),
    );
  }

  /** Lets the active job finish, then disconnects. */
  async onApplicationShutdown(): Promise<void> {
    await this.closeWorker?.();
  }
}
