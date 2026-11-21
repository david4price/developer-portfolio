import type { ApiMetrics } from '../../metrics/api-metrics.js';
import { AiCapacityError, type AiConcurrencyLimiter } from './limits.js';

/**
 * Measures the wrapped limiter from this pod's side: how many requests wait for a slot, how long
 * the granted ones waited, and how many were turned away. Results and errors pass through.
 */
export class MeteredAiConcurrencyLimiter implements AiConcurrencyLimiter {
  constructor(
    private readonly inner: AiConcurrencyLimiter,
    private readonly metrics: ApiMetrics,
  ) {}

  async hasCapacity(): Promise<boolean> {
    const available = await this.inner.hasCapacity();
    if (!available) this.metrics.countCapacityRejection('precheck');
    return available;
  }

  async run<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T> {
    const endWait = this.metrics.startAiWait();
    try {
      return await this.inner.run(() => {
        endWait(true);
        return task();
      }, signal);
    } catch (error) {
      if (error instanceof AiCapacityError) {
        this.metrics.countCapacityRejection(error.waited ? 'waited' : 'immediate');
      }
      throw error;
    } finally {
      // Abort, Redis failure, or rejection: the wait ended without a slot.
      endWait(false);
    }
  }
}
