import { z } from 'zod';

export const NOOP_QUEUE = 'noop';

export const noopPayloadSchema = z.object({
  requestedAt: z.iso.datetime(),
});

export interface NoopResult {
  readonly requestedAt: string;
  readonly processedAt: string;
}

/**
 * Smoke-test job proving the queue round trip. Payloads are validated because queue contents are
 * an input boundary like any HTTP request.
 */
export function processNoop(payload: unknown, now: () => Date = () => new Date()): NoopResult {
  const { requestedAt } = noopPayloadSchema.parse(payload);
  return { requestedAt, processedAt: now().toISOString() };
}
