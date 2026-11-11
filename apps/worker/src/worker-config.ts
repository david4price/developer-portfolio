import { connectionUrl, type LogLevel, logLevel, parseEnvironment } from '@portfolio/config';
import { z } from 'zod';

export const WORKER_CONFIG = Symbol('WORKER_CONFIG');

export interface WorkerConfig {
  readonly logLevel: LogLevel;
  readonly redisUrl: string;
  readonly concurrency: number;
}

const workerEnvironmentSchema = z.object({
  LOG_LEVEL: logLevel.default('log'),
  REDIS_URL: connectionUrl('redis:', 'rediss:'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(1),
});

export function loadWorkerConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): WorkerConfig {
  const parsed = parseEnvironment(workerEnvironmentSchema, environment);
  return {
    logLevel: parsed.LOG_LEVEL,
    redisUrl: parsed.REDIS_URL,
    concurrency: parsed.WORKER_CONCURRENCY,
  };
}
