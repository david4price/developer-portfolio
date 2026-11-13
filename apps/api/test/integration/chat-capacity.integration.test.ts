import 'reflect-metadata';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ApiErrorResponse } from '@portfolio/shared-types';
import { Redis } from 'ioredis';
import { API_CONFIG, type ApiConfig, type ChatConfig } from '../../src/config/api-config.js';
import {
  AI_PROVIDER,
  type AiCompletion,
  type AiProvider,
} from '../../src/modules/ai/ai-provider.js';
import { CHAT_SESSION_STORE } from '../../src/modules/chat/chat-session.store.js';
import { ChatController } from '../../src/modules/chat/chat.controller.js';
import { ChatService } from '../../src/modules/chat/chat.service.js';
import { AI_CONCURRENCY, AiCapacityError, RATE_LIMITER } from '../../src/modules/chat/limits.js';
import { RedisChatSessionStore } from '../../src/modules/chat/redis-chat-session.store.js';
import {
  RedisAiConcurrencyLimiter,
  RedisRateLimiter,
} from '../../src/modules/chat/redis-limits.js';
import { createTestApp } from '../support/test-app.js';

/** Capacity controls against a real Redis. Skipped when REDIS_URL is unset. */
const redisUrl = process.env.REDIS_URL;

/**
 * Only the limiter keys: test files run in parallel against one Redis, and the session-store
 * tests own `portfolio:chat:session:*` and `portfolio:chat:lock:*`.
 */
async function clearChatKeys(redis: Redis): Promise<void> {
  const keys = [
    ...(await redis.keys('portfolio:chat:ai:*')),
    ...(await redis.keys('portfolio:chat:rate:*')),
  ];
  if (keys.length > 0) await redis.del(...keys);
}

describe('chat capacity (Redis)', { skip: !redisUrl && 'REDIS_URL is not set' }, () => {
  let redis: Redis;

  before(() => {
    redis = new Redis(redisUrl ?? '', { maxRetriesPerRequest: 1 });
  });
  beforeEach(() => clearChatKeys(redis));
  after(async () => {
    await clearChatKeys(redis);
    redis.disconnect();
  });

  const limiter = (options: Partial<ConstructorParameters<typeof RedisAiConcurrencyLimiter>[1]>) =>
    new RedisAiConcurrencyLimiter(redis, {
      limit: 1,
      queueMax: 2,
      queueWaitMs: 1_000,
      leaseMs: 5_000,
      pollMs: 20,
      ...options,
    });
  const never = new AbortController().signal;

  it('counts fixed windows and reports the time left', async () => {
    const rate = new RedisRateLimiter(redis);
    const results = [];
    for (let index = 0; index < 4; index += 1) results.push(await rate.hit('test:a', 3, 60));
    assert.deepEqual(
      results.map(({ allowed }) => allowed),
      [true, true, true, false],
    );
    assert.ok((results[3]?.retryAfterSeconds ?? 0) > 50);
    assert.equal((await rate.hit('test:b', 3, 60)).allowed, true, 'keys are independent');
  });

  it('never runs more tasks at once than the limit, serving waiters in FIFO order', async () => {
    const limit = limiter({ limit: 2, queueMax: 10, queueWaitMs: 5_000 });
    let running = 0;
    let peak = 0;
    const order: number[] = [];
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        (async () => {
          await sleep(index * 5); // deterministic arrival order
          await limit.run(async () => {
            running += 1;
            peak = Math.max(peak, running);
            order.push(index);
            await sleep(40);
            running -= 1;
          }, never);
        })(),
      ),
    );
    assert.equal(peak, 2);
    assert.deepEqual(order, [0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('rejects at once when the queue is full, and after the wait when no slot frees', async () => {
    const limit = limiter({ limit: 1, queueMax: 1, queueWaitMs: 300 });
    const hold = limit.run(() => sleep(1_000), never);
    await sleep(20);
    const queued = limit.run(async () => 'late', never);
    await sleep(20);

    const started = Date.now();
    await assert.rejects(
      limit.run(async () => 'x', never),
      AiCapacityError,
    );
    assert.ok(Date.now() - started < 200, 'a full queue rejects immediately');

    await assert.rejects(queued, AiCapacityError, 'the waiter gives up after queueWaitMs');
    assert.equal(await redis.zcard('portfolio:chat:ai:waiters'), 0, 'a timed-out waiter leaves');
    await hold;
  });

  it('frees the slot of a holder that died, once its lease expires', async () => {
    await redis.zadd('portfolio:chat:ai:holders', Date.now() + 200, 'crashed-replica');
    const limit = limiter({ limit: 1, queueMax: 1, queueWaitMs: 2_000, leaseMs: 5_000 });
    const started = Date.now();
    assert.equal(await limit.run(async () => 'ok', never), 'ok');
    assert.ok(Date.now() - started >= 150, 'it waited for the dead lease to expire');
  });

  it('does not let a newcomer jump ahead of a waiter', async () => {
    const limit = limiter({ limit: 1, queueMax: 5, queueWaitMs: 2_000 });
    const order: string[] = [];
    const first = limit.run(() => sleep(100).then(() => order.push('holder')), never);
    await sleep(10);
    const waiter = limit.run(async () => order.push('waiter'), never);
    await sleep(150); // the slot is free now, but the waiter hasn't polled yet
    const newcomer = limit.run(async () => order.push('newcomer'), never);
    await Promise.all([first, waiter, newcomer]);
    assert.deepEqual(order, ['holder', 'waiter', 'newcomer']);
  });

  describe('load: concurrent visitors through the HTTP API', () => {
    let app: NestFastifyApplication;
    const AI_MS = 250;
    const limits: ChatConfig = {
      maxConcurrency: 1,
      queueMax: 2,
      queueWaitMs: 1_000,
      sessionMessageLimit: 100,
      ipMessagesPerHour: 1_000,
      ipSessionsPerHour: 1_000,
      trustCfConnectingIp: false,
    };
    const slowAi: AiProvider = {
      enabled: true,
      async complete(): Promise<AiCompletion> {
        await sleep(AI_MS);
        return { content: 'ok', outputTokens: 1 };
      },
    };

    before(async () => {
      app = await createTestApp({
        controllers: [ChatController],
        providers: [
          ChatService,
          { provide: CHAT_SESSION_STORE, useValue: new RedisChatSessionStore(redis) },
          { provide: AI_PROVIDER, useValue: slowAi },
          { provide: RATE_LIMITER, useValue: new RedisRateLimiter(redis) },
          {
            provide: AI_CONCURRENCY,
            useValue: new RedisAiConcurrencyLimiter(redis, {
              limit: limits.maxConcurrency,
              queueMax: limits.queueMax,
              queueWaitMs: limits.queueWaitMs,
              leaseMs: 5_000,
              pollMs: 20,
            }),
          },
          { provide: API_CONFIG, useValue: { chat: limits } as unknown as ApiConfig },
        ],
      });
    });
    after(() => app?.close());

    it('serves capacity plus queue and answers everyone else 503 quickly, never hanging', async () => {
      const VISITORS = 12;
      const cookies = await Promise.all(
        Array.from({ length: VISITORS }, async () => {
          const response = await app.inject({ method: 'POST', url: '/api/v1/chat/sessions' });
          return String(response.headers['set-cookie']).split(';')[0] ?? '';
        }),
      );

      const results = await Promise.all(
        cookies.map(async (cookie) => {
          const started = Date.now();
          const response = await app.inject({
            method: 'POST',
            url: '/api/v1/chat/messages',
            headers: { cookie },
            payload: { message: 'hello' },
          });
          return { status: response.statusCode, ms: Date.now() - started, body: response.body };
        }),
      );

      const served = results.filter(({ status }) => status === 200);
      const overloaded = results.filter(({ status }) => status === 503);
      assert.equal(served.length, limits.maxConcurrency + limits.queueMax, JSON.stringify(results));
      assert.equal(overloaded.length, VISITORS - served.length);
      for (const { body } of overloaded) {
        assert.equal(
          JSON.parse(body).error.code,
          'ai_overloaded' satisfies ApiErrorResponse['error']['code'],
        );
      }
      // Rejections come at once (queue full); nothing waits past the queue wait plus served work.
      assert.ok(Math.max(...overloaded.map(({ ms }) => ms)) < 300, JSON.stringify(results));
      const bound = limits.queueWaitMs + AI_MS * served.length + 500;
      assert.ok(Math.max(...results.map(({ ms }) => ms)) < bound, JSON.stringify(results));
      assert.equal(await redis.zcard('portfolio:chat:ai:holders'), 0, 'every slot was released');
    });
  });
});
