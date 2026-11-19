import {
  type CallHandler,
  type ExecutionContext,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import { API_PREFIX, type TrafficLevel } from '@portfolio/shared-types';
import type { FastifyRequest } from 'fastify';
import { type Observable, tap } from 'rxjs';

/**
 * Coarse request rates for the Infrastructure Explorer's sparks (P6-04, ahead of P7-01's
 * metrics). Counters live in Redis, shared by every API replica, one key per source per minute;
 * only a bucket (`idle`, `low`, `busy`) ever leaves the API, never a count or anything per client.
 */

/** What is counted: public API requests, and chat replies the model produced. */
export type TrafficSource = 'api' | 'ai';
export type TrafficLevels = Readonly<Record<TrafficSource, TrafficLevel>>;

export const TRAFFIC_COUNTER = Symbol('TRAFFIC_COUNTER');

export interface TrafficCounter {
  /** Counts one event; never throws and never delays the request. */
  record(source: TrafficSource): void;
  /** The current levels, or `null` when nothing is counted here. Rejects on `signal`. */
  read(signal: AbortSignal): Promise<TrafficLevels | null>;
}

/** With the view off: nothing is written to Redis and the lines carry no sparks. */
export class NoopTrafficCounter implements TrafficCounter {
  record(): void {}

  read(): Promise<null> {
    return Promise.resolve(null);
  }
}

/** The window a level covers: a sliding 5 minutes. */
export const TRAFFIC_WINDOW_MINUTES = 5;
/** Events in the window from which a source counts as busy (12 a minute). */
export const BUSY_EVENTS = 60;

/** No events in the window is idle; fewer than `BUSY_EVENTS` is low; more is busy. */
export function trafficLevel(events: number): TrafficLevel {
  if (events <= 0) return 'idle';
  return events < BUSY_EVENTS ? 'low' : 'busy';
}

/** The subset of an ioredis client the counter uses. */
export interface TrafficStore {
  pipeline(): {
    incr(key: string): unknown;
    expire(key: string, seconds: number, mode: 'NX'): unknown;
    exec(): Promise<unknown>;
  };
  mget(...keys: string[]): Promise<readonly (string | null)[]>;
}

const SOURCES: readonly TrafficSource[] = ['api', 'ai'];
const keyFor = (source: TrafficSource, minute: number) =>
  `portfolio:infrastructure:traffic:${source}:${minute}`;
/** Long enough for the oldest minute a window reads, then gone: nothing accumulates. */
const KEY_TTL_SECONDS = (TRAFFIC_WINDOW_MINUTES + 2) * 60;

/** Settles with `promise`, or rejects when `signal` aborts first; leaves no listener behind. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/**
 * Per-minute counters in Redis. A level reads a sliding window: the current minute so far, the
 * four before it, and the part of the fifth one back the window still covers, so a steady rate
 * gives a steady level whatever the second.
 */
export class RedisTrafficCounter implements TrafficCounter {
  private readonly logger = new Logger('TrafficCounter');
  /** Whether the last write failed, so an outage logs when it starts and when it ends. */
  private failing = false;

  constructor(
    private readonly store: TrafficStore,
    private readonly now: () => number = Date.now,
  ) {}

  record(source: TrafficSource): void {
    const key = keyFor(source, Math.floor(this.now() / 60_000));
    const pipeline = this.store.pipeline();
    pipeline.incr(key);
    // Only the first increment of a minute sets the expiry.
    pipeline.expire(key, KEY_TTL_SECONDS, 'NX');
    pipeline.exec().then(
      () => {
        if (this.failing) this.logger.log({ message: 'Traffic counter writes resumed' });
        this.failing = false;
      },
      (error: unknown) => {
        if (!this.failing) {
          this.logger.warn({
            message: 'Traffic counter write failed',
            error: error instanceof Error ? error.message : 'non-error thrown',
          });
        }
        this.failing = true;
      },
    );
  }

  async read(signal: AbortSignal): Promise<TrafficLevels> {
    const now = this.now();
    const minute = Math.floor(now / 60_000);
    const elapsed = (now % 60_000) / 60_000;
    // Newest first: the current minute, then each full one back to the window's far edge.
    const minutes = Array.from({ length: TRAFFIC_WINDOW_MINUTES + 1 }, (_, i) => minute - i);
    const weights = minutes.map((_, i) => (i === TRAFFIC_WINDOW_MINUTES ? 1 - elapsed : 1));
    const keys = SOURCES.flatMap((source) => minutes.map((m) => keyFor(source, m)));
    const values = await untilAborted(this.store.mget(...keys), signal);
    const total = (index: number) =>
      minutes.reduce((sum, _, i) => {
        const count = Number(values[index * minutes.length + i] ?? 0);
        const valid = Number.isSafeInteger(count) && count > 0 ? count : 0;
        return sum + valid * (weights[i] ?? 0);
      }, 0);
    return { api: trafficLevel(total(0)), ai: trafficLevel(total(1)) };
  }
}

/** Routes that aren't visitor traffic: probes, and the explorer's own polling of itself. */
const UNCOUNTED = [`/${API_PREFIX}/health`, `/${API_PREFIX}/infrastructure`];
/** A chat message that got a reply went through the model. */
const AI_ROUTE = `/${API_PREFIX}/chat/messages`;

/**
 * Counts every handled API request (errors too) except probes and the explorer's polling, and a
 * chat message as AI traffic once it got a reply. Only the route is read, never the client.
 */
export class TrafficInterceptor implements NestInterceptor {
  constructor(private readonly counter: TrafficCounter) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const route = request.routeOptions.url ?? '';
    if (UNCOUNTED.some((prefix) => route === prefix || route.startsWith(`${prefix}/`))) {
      return next.handle();
    }
    this.counter.record('api');
    if (request.method !== 'POST' || route !== AI_ROUTE) return next.handle();
    return next.handle().pipe(tap(() => this.counter.record('ai')));
  }
}
