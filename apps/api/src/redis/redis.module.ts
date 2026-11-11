import { type EventEmitter, once } from 'node:events';
import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import { API_CONFIG, type ApiConfig } from '../config/api-config.js';
import type { ReadinessCheck } from '../modules/health/readiness.js';

export const REDIS = Symbol('REDIS');
export const REDIS_READINESS = Symbol('REDIS_READINESS');

/** The parts of an ioredis client the readiness check needs. */
export type RedisReadinessClient = EventEmitter & {
  readonly status: string;
  ping(): Promise<unknown>;
};

const CONNECT_WAIT_MS = 1_000;

/**
 * Commands fail fast while disconnected (no offline queue), so a probe that arrives while the
 * client is still connecting would report a false outage. Wait briefly for `ready` first; the
 * abort signal removes the listener if Redis never comes up, so repeated probes don't leak.
 */
export function redisReadinessCheck(
  client: RedisReadinessClient,
  connectWaitMs = CONNECT_WAIT_MS,
): ReadinessCheck {
  return {
    name: 'redis',
    check: async () => {
      if (client.status !== 'ready') {
        await once(client, 'ready', { signal: AbortSignal.timeout(connectWaitMs) });
      }
      await client.ping();
    },
  };
}

export function createRedis(redisUrl: string): Redis {
  const client = new Redis(redisUrl, {
    // Fail commands immediately while disconnected instead of queueing them, so readiness and
    // request paths report an outage rather than hanging. Reconnection continues in the background.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 2_000,
  });

  const logger = new Logger('Redis');
  let connected = false;
  client.on('ready', () => {
    connected = true;
    logger.log('connected');
  });
  client.on('error', (error: Error) => {
    if (connected) logger.warn({ message: 'connection lost', error: error.message });
    connected = false;
  });

  return client;
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [API_CONFIG],
      useFactory: (config: ApiConfig) => createRedis(config.redisUrl),
    },
    {
      provide: REDIS_READINESS,
      inject: [REDIS],
      useFactory: (redis: Redis): ReadinessCheck => redisReadinessCheck(redis),
    },
  ],
  exports: [REDIS, REDIS_READINESS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  onApplicationShutdown(): void {
    this.redis.disconnect();
  }
}
