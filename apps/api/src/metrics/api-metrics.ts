import type { ApiErrorCode, DependencyState } from '@portfolio/shared-types';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from '@prometheus-io/client';

/** How one AI completion ended, as a metric label. */
export type AiInferenceOutcome =
  | 'success'
  | 'timeout'
  | 'network'
  | 'upstream_status'
  | 'invalid_response'
  | 'overloaded'
  | 'disabled'
  | 'aborted'
  | 'error';

/** Why a chat request got no AI slot: at once (queue full) or after waiting its turn. */
export type AiCapacityRejection = 'immediate' | 'waited';

/** Request durations run from a few milliseconds to a chat reply (AI wait plus generation). */
const HTTP_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60];
const AI_BUCKETS = [0.25, 0.5, 1, 2.5, 5, 10, 15, 20, 30, 45, 60];
const QUEUE_WAIT_BUCKETS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30];

/**
 * The API's Prometheus metrics, in a registry of its own (each instance starts empty, so tests
 * don't share state). Labels are low-cardinality by construction: matched route patterns, status
 * classes, error codes, and fixed outcome names, never ids, slugs, or anything a visitor typed.
 * Each pod counts only its own traffic; a scraper adds pods up.
 */
export class ApiMetrics {
  private readonly registry = new Registry();

  private readonly httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration by method, matched route, and status class.',
    labelNames: ['method', 'route', 'status_class'] as const,
    buckets: HTTP_BUCKETS,
    registers: [this.registry],
  });

  private readonly errors = new Counter({
    name: 'api_errors_total',
    help: 'Error responses by API error code.',
    labelNames: ['code'] as const,
    registers: [this.registry],
  });

  private readonly disconnects = new Counter({
    name: 'http_client_disconnects_total',
    help: 'Requests the visitor abandoned before the answer (not errors; no response was sent).',
    registers: [this.registry],
  });

  private readonly readiness = new Gauge({
    name: 'readiness_dependency_up',
    help: '1 when the dependency passed its last readiness check, 0 when it failed.',
    labelNames: ['dependency'] as const,
    registers: [this.registry],
  });

  private readonly aiDuration = new Histogram({
    name: 'ai_inference_duration_seconds',
    help: 'AI completion duration (excluding the wait for a slot) by outcome.',
    labelNames: ['outcome'] as const,
    buckets: AI_BUCKETS,
    registers: [this.registry],
  });

  private readonly aiWaiting = new Gauge({
    name: 'ai_queue_waiting',
    help: 'Chat requests in this pod acquiring an AI slot (asking for one, or queued for one).',
    registers: [this.registry],
  });

  private readonly aiQueueWait = new Histogram({
    name: 'ai_queue_wait_seconds',
    help: 'Time from asking for an AI slot to getting it; near zero when a slot was free.',
    buckets: QUEUE_WAIT_BUCKETS,
    registers: [this.registry],
  });

  private readonly aiRejections = new Counter({
    name: 'ai_capacity_rejections_total',
    help: 'Chat requests turned away for lack of AI capacity: immediately, or after waiting.',
    labelNames: ['reason'] as const,
    registers: [this.registry],
  });

  /** Adds process and Node.js runtime metrics (CPU, memory, event loop, GC). Call once. */
  collectProcessMetrics(): void {
    collectDefaultMetrics({ register: this.registry });
  }

  observeRequest(method: string, route: string, status: number, durationSeconds: number): void {
    this.httpDuration.observe(
      { method, route, status_class: `${Math.floor(status / 100)}xx` },
      durationSeconds,
    );
  }

  countError(code: ApiErrorCode): void {
    this.errors.inc({ code });
  }

  countClientDisconnect(): void {
    this.disconnects.inc();
  }

  setReadiness(checks: Readonly<Record<string, DependencyState>>): void {
    for (const [dependency, state] of Object.entries(checks)) {
      this.readiness.set({ dependency }, state === 'up' ? 1 : 0);
    }
  }

  observeInference(outcome: AiInferenceOutcome, durationSeconds: number): void {
    this.aiDuration.observe({ outcome }, durationSeconds);
  }

  /** Marks a request as waiting for an AI slot; the returned function ends the wait. */
  startAiWait(): (granted: boolean) => void {
    this.aiWaiting.inc();
    const stopTimer = this.aiQueueWait.startTimer();
    let ended = false;
    return (granted) => {
      if (ended) return;
      ended = true;
      this.aiWaiting.dec();
      if (granted) stopTimer();
    };
  }

  countCapacityRejection(reason: AiCapacityRejection): void {
    this.aiRejections.inc({ reason });
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  /** The Prometheus text exposition of every metric. */
  render(): Promise<string> {
    return this.registry.metrics();
  }
}
