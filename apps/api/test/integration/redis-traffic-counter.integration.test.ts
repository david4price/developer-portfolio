import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Redis } from 'ioredis';
import {
  BUSY_EVENTS,
  RedisTrafficCounter,
  TRAFFIC_WINDOW_MINUTES,
} from '../../src/modules/infrastructure/traffic.js';

/** Exercises the traffic counter against a real server. Skipped when REDIS_URL is unset. */
const redisUrl = process.env.REDIS_URL;

describe('RedisTrafficCounter', { skip: !redisUrl && 'REDIS_URL is not set' }, () => {
  let redis: Redis;
  // A minute far from now, so the test's keys never meet a running stack's.
  const minute = 1_000_000_000 + Math.floor(Math.random() * 1_000_000);
  const key = (source: string, m: number) => `portfolio:infrastructure:traffic:${source}:${m}`;

  before(() => {
    redis = new Redis(redisUrl ?? '', { maxRetriesPerRequest: 1 });
  });

  after(async () => {
    const keys = ['api', 'ai'].flatMap((source) =>
      Array.from({ length: TRAFFIC_WINDOW_MINUTES }, (_, i) => key(source, minute - i)),
    );
    await redis.del(...keys);
    redis.disconnect();
  });

  it('counts with expiring per-minute keys and reads the window back as levels', async () => {
    const counter = new RedisTrafficCounter(redis, () => minute * 60_000);
    for (let i = 0; i < BUSY_EVENTS; i++) counter.record('api');
    counter.record('ai');
    // Writes are fire-and-forget; wait until the last one has landed.
    for (let tries = 0; tries < 50; tries++) {
      if (Number(await redis.get(key('api', minute))) === BUSY_EVENTS) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(await redis.get(key('api', minute)), String(BUSY_EVENTS));
    const ttl = await redis.ttl(key('api', minute));
    assert.ok(ttl > 0 && ttl <= (TRAFFIC_WINDOW_MINUTES + 1) * 60, `unexpected TTL ${ttl}`);
    assert.deepEqual(await counter.read(), { api: 'busy', ai: 'low' });
  });
});
