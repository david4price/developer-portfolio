import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Redis } from 'ioredis';
import { DependencyUnavailableError } from '../../common/dependency-unavailable.error.js';
import {
  AiCapacityError,
  type AiConcurrencyLimiter,
  type RateLimiter,
  type RateLimitResult,
} from './limits.js';

const RATE_PREFIX = 'portfolio:chat:rate:';
const HOLDERS_KEY = 'portfolio:chat:ai:holders';
const WAITERS_KEY = 'portfolio:chat:ai:waiters';

async function withRedis<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw new DependencyUnavailableError('redis', { cause: error });
  }
}

/** INCR, start the window on the first hit, and report the count and remaining TTL atomically. */
const HIT = `local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
return {count, ttl}`;

/** DECR keeps the window's TTL; a missing (expired) or empty window is left alone. */
const REFUND = `local count = tonumber(redis.call('GET', KEYS[1]))
if count and count > 0 then return redis.call('DECR', KEYS[1]) end
return 0`;

export class RedisRateLimiter implements RateLimiter {
  constructor(private readonly redis: Redis) {}

  async hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const [count, ttl] = (await withRedis(() =>
      this.redis.eval(HIT, 1, RATE_PREFIX + key, windowSeconds),
    )) as [number, number];
    return { allowed: count <= limit, retryAfterSeconds: Math.max(1, ttl) };
  }

  async refund(key: string): Promise<void> {
    await withRedis(() => this.redis.eval(REFUND, 1, RATE_PREFIX + key));
  }
}

/*
 * Holders: sorted set of tokens scored by lease expiry (ms). Waiters: sorted set of tokens scored
 * by enqueue time (ms), which gives FIFO order. Both scripts use Redis's clock, so replicas with
 * skewed clocks agree, and both clear dead entries first, so a crashed replica can't keep a slot
 * or a queue place.
 */

/**
 * ARGV: limit, token, leaseMs, waiterStaleMs. Grants a slot if one is free and the caller is
 * entitled to it: queued callers by queue position, newcomers only once every waiter is served.
 */
const ACQUIRE = `local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now - tonumber(ARGV[4]))
local free = tonumber(ARGV[1]) - redis.call('ZCARD', KEYS[1])
if free <= 0 then return 0 end
local rank = redis.call('ZRANK', KEYS[2], ARGV[2])
if rank then
  if rank >= free then return 0 end
elseif redis.call('ZCARD', KEYS[2]) >= free then
  return 0
end
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[3]), ARGV[2])
redis.call('ZREM', KEYS[2], ARGV[2])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[3]))
return 1`;

/** ARGV: queueMax, token, waiterStaleMs. Joins the queue unless it is full. */
const ENQUEUE = `local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - tonumber(ARGV[3]))
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[1]) then return 0 end
redis.call('ZADD', KEYS[1], now, ARGV[2])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[3]))
return 1`;

export interface RedisAiConcurrencyOptions {
  readonly limit: number;
  readonly queueMax: number;
  readonly queueWaitMs: number;
  /** Lease lifetime: longer than one AI call, so a live holder never loses its slot. */
  readonly leaseMs: number;
  readonly pollMs?: number;
}

export class RedisAiConcurrencyLimiter implements AiConcurrencyLimiter {
  private readonly pollMs: number;
  /** A waiter that stopped polling this long ago is presumed dead. */
  private readonly waiterStaleMs: number;

  constructor(
    private readonly redis: Redis,
    private readonly options: RedisAiConcurrencyOptions,
  ) {
    this.pollMs = options.pollMs ?? 150;
    this.waiterStaleMs = options.queueWaitMs + 5_000;
  }

  async run<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T> {
    const token = randomUUID();
    await this.acquire(token, signal);
    try {
      return await task();
    } finally {
      // Best effort: the lease expires on its own, so a Redis error here must not replace the
      // task's result (or its real error).
      await this.redis.zrem(HOLDERS_KEY, token).catch(() => undefined);
    }
  }

  private tryAcquire(token: string): Promise<boolean> {
    return withRedis(async () => {
      const granted = await this.redis.eval(
        ACQUIRE,
        2,
        HOLDERS_KEY,
        WAITERS_KEY,
        this.options.limit,
        token,
        this.options.leaseMs,
        this.waiterStaleMs,
      );
      return granted === 1;
    });
  }

  private async acquire(token: string, signal: AbortSignal): Promise<void> {
    if (await this.tryAcquire(token)) return;

    const retryAfterSeconds = Math.ceil(this.options.queueWaitMs / 1_000) || 1;
    const queued = await withRedis(
      async () =>
        (await this.redis.eval(
          ENQUEUE,
          1,
          WAITERS_KEY,
          this.options.queueMax,
          token,
          this.waiterStaleMs,
        )) === 1,
    );
    if (!queued) throw new AiCapacityError(retryAfterSeconds);

    const deadline = Date.now() + this.options.queueWaitMs;
    try {
      while (Date.now() < deadline) {
        signal.throwIfAborted();
        await sleep(Math.min(this.pollMs, Math.max(0, deadline - Date.now())));
        if (await this.tryAcquire(token)) return;
      }
      throw new AiCapacityError(retryAfterSeconds, true);
    } catch (error) {
      // Leave the queue on timeout, abort, or Redis failure so the place isn't held.
      await this.redis.zrem(WAITERS_KEY, token).catch(() => undefined);
      throw error;
    }
  }
}
