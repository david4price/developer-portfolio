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
  read(): Promise<TrafficLevels>;
}

/** Minutes summed for a level, the current one included. */
export const TRAFFIC_WINDOW_MINUTES = 5;
/** Events in the window from which a source counts as busy (about 12 a minute). */
export const BUSY_EVENTS = 60;

/** No events in the window is idle; up to `BUSY_EVENTS` is low; more is busy. */
export function trafficLevel(events: number): TrafficLevel {
  if (events <= 0) return 'idle';
  return events < BUSY_EVENTS ? 'low' : 'busy';
}

/** The subset of an ioredis client the counter uses. */
export interface TrafficStore {
  pipeline(): {
    incr(key: string): unknown;
    expire(key: string, seconds: number): unknown;
    exec(): Promise<unknown>;
  };
  mget(...keys: string[]): Promise<readonly (string | null)[]>;
}

const SOURCES: readonly TrafficSource[] = ['api', 'ai'];
const keyFor = (source: TrafficSource, minute: number) =>
  `portfolio:infrastructure:traffic:${source}:${minute}`;

export class RedisTrafficCounter implements TrafficCounter {
  private readonly logger = new Logger('TrafficCounter');
  /** Whether the last write failed, so a Redis outage logs once, not per request. */
  private failing = false;

  constructor(
    private readonly store: TrafficStore,
    private readonly now: () => number = Date.now,
  ) {}

  record(source: TrafficSource): void {
    const key = keyFor(source, Math.floor(this.now() / 60_000));
    const pipeline = this.store.pipeline();
    pipeline.incr(key);
    // Kept a minute past the window, then gone: nothing accumulates.
    pipeline.expire(key, (TRAFFIC_WINDOW_MINUTES + 1) * 60);
    pipeline.exec().then(
      () => {
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

  async read(): Promise<TrafficLevels> {
    const minute = Math.floor(this.now() / 60_000);
    const minutes = Array.from({ length: TRAFFIC_WINDOW_MINUTES }, (_, i) => minute - i);
    const keys = SOURCES.flatMap((source) => minutes.map((m) => keyFor(source, m)));
    const values = await this.store.mget(...keys);
    const total = (index: number) =>
      values.slice(index * minutes.length, (index + 1) * minutes.length).reduce((sum, value) => {
        const count = Number(value ?? 0);
        return sum + (Number.isSafeInteger(count) && count > 0 ? count : 0);
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
