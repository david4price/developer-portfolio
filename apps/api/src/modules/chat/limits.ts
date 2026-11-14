export const RATE_LIMITER = Symbol('RATE_LIMITER');
export const AI_CONCURRENCY = Symbol('AI_CONCURRENCY');

export interface RateLimitResult {
  readonly allowed: boolean;
  /** Seconds until the current window resets (meaningful when `allowed` is false). */
  readonly retryAfterSeconds: number;
  /** Identifies the window this hit counted in, so a refund can't land in a later one. */
  readonly window: string;
}

/** Fixed-window counters. Keys are built by the caller from server-derived values only. */
export interface RateLimiter {
  /** Counts one hit against `key`; allowed while the window's count is at most `limit`. */
  hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult>;
  /**
   * Takes back one hit, but only from `window` (the one `hit` counted it in): once that window
   * has expired and a new one started, there is nothing to take back.
   */
  refund(key: string, window: string): Promise<void>;
}

/** No slot became free in time, or the wait queue was full. */
export class AiCapacityError extends Error {
  constructor(
    readonly retryAfterSeconds: number,
    /** True when the request held a queue place until the wait ran out (it used capacity). */
    readonly waited = false,
  ) {
    super('AI capacity exhausted');
    this.name = 'AiCapacityError';
  }
}

/**
 * Global limit on AI calls in flight (across replicas), with a bounded FIFO wait queue. `run`
 * either executes `task` while holding a slot or throws `AiCapacityError`; it never waits longer
 * than the configured queue wait.
 */
export interface AiConcurrencyLimiter {
  run<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T>;
}
