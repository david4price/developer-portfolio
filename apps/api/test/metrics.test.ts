import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, describe, it } from 'node:test';
import { Global, Module } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ApiMetrics } from '../src/metrics/api-metrics.js';
import { closeMetricsServer, startMetricsServer } from '../src/metrics/metrics-server.js';
import {
  type AiCompletion,
  AiOverloadedError,
  type AiProvider,
  AiUnavailableError,
} from '../src/modules/ai/ai-provider.js';
import { MeteredAiProvider } from '../src/modules/ai/metered-ai.provider.js';
import { AiCapacityError, type AiConcurrencyLimiter } from '../src/modules/chat/limits.js';
import { MeteredAiConcurrencyLimiter } from '../src/modules/chat/metered-ai-concurrency.js';
import { HealthModule } from '../src/modules/health/health.module.js';
import type { ReadinessCheck } from '../src/modules/health/readiness.js';
import { createTestApp } from './support/test-app.js';

/** The value of one sample line (`name{labels} value`) in the exposition, or undefined. */
async function sample(metrics: ApiMetrics, series: string): Promise<number | undefined> {
  const line = (await metrics.render()).split('\n').find((entry) => entry.startsWith(`${series} `));
  return line === undefined ? undefined : Number(line.slice(series.length + 1));
}

const POSTGRES_CHECK = Symbol('POSTGRES_CHECK');
const REDIS_CHECK = Symbol('REDIS_CHECK');

function checksModule(postgres: ReadinessCheck, redis: ReadinessCheck) {
  @Global()
  @Module({
    providers: [
      { provide: POSTGRES_CHECK, useValue: postgres },
      { provide: REDIS_CHECK, useValue: redis },
    ],
    exports: [POSTGRES_CHECK, REDIS_CHECK],
  })
  class ChecksModule {}
  return ChecksModule;
}

describe('HTTP metrics', () => {
  let app: NestFastifyApplication;
  after(async () => {
    await app?.close();
  });

  it('counts requests by route pattern and status class, and errors by code', async () => {
    app = await createTestApp({
      imports: [
        checksModule(
          { name: 'postgres', check: () => Promise.resolve() },
          { name: 'redis', check: () => Promise.reject(new Error('down')) },
        ),
        HealthModule.forChecks([POSTGRES_CHECK, REDIS_CHECK]),
      ],
    });
    const metrics = app.get(ApiMetrics);

    await app.inject({ method: 'GET', url: '/api/v1/health?token=visitor-secret' });
    await app.inject({ method: 'GET', url: '/api/v1/health/ready' });
    await app.inject({ method: 'GET', url: '/api/v1/no-such-page-visitor-slug' });

    const live =
      'http_request_duration_seconds_count{method="GET",route="/api/v1/health",status_class="2xx"}';
    assert.equal(await sample(metrics, live), 1);
    const ready =
      'http_request_duration_seconds_count{method="GET",route="/api/v1/health/ready",status_class="5xx"}';
    assert.equal(await sample(metrics, ready), 1);
    const unmatched =
      'http_request_duration_seconds_count{method="GET",route="unmatched",status_class="4xx"}';
    assert.equal(await sample(metrics, unmatched), 1);
    assert.equal(await sample(metrics, 'api_errors_total{code="not_found"}'), 1);

    // Nothing a visitor sent (query strings, unknown paths) becomes a label.
    const exposition = await metrics.render();
    assert.doesNotMatch(exposition, /visitor-secret|visitor-slug/);
  });

  it('records the state of each readiness dependency', async () => {
    const metrics = app.get(ApiMetrics);
    assert.equal(await sample(metrics, 'readiness_dependency_up{dependency="postgres"}'), 1);
    assert.equal(await sample(metrics, 'readiness_dependency_up{dependency="redis"}'), 0);
  });
});

describe('metrics server', () => {
  it('serves only GET /metrics, in the Prometheus text format', async () => {
    const metrics = new ApiMetrics();
    metrics.countError('rate_limited');
    const server = await startMetricsServer(metrics, { host: '127.0.0.1', port: 0 });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const response = await fetch(`${base}/metrics`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type') ?? '', /^text\/plain; version=0\.0\.4/);
      assert.match(await response.text(), /^api_errors_total\{code="rate_limited"\} 1$/m);

      assert.equal((await fetch(`${base}/metrics?debug=1`)).status, 200);
      for (const [path, method] of [
        ['/', 'GET'],
        ['/api/v1/health', 'GET'],
        ['/metrics', 'POST'],
      ] as const) {
        const other = await fetch(`${base}${path}`, { method });
        assert.equal(other.status, 404, `${method} ${path}`);
        await other.body?.cancel();
      }
    } finally {
      await closeMetricsServer(server);
    }
  });

  it('survives a server error after startup and closes idempotently', async () => {
    const server = await startMetricsServer(new ApiMetrics(), { host: '127.0.0.1', port: 0 });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    // With no listener, Node would throw this as an uncaught exception and stop the API.
    server.emit('error', Object.assign(new Error('accept EMFILE'), { code: 'EMFILE' }));
    assert.equal((await fetch(`${base}/metrics`)).status, 200);

    await closeMetricsServer(server);
    await closeMetricsServer(server);
    assert.equal(server.listening, false);
  });

  it('fails to start, rather than hang, when its port is taken', async () => {
    const first = await startMetricsServer(new ApiMetrics(), { host: '127.0.0.1', port: 0 });
    const port = (first.address() as AddressInfo).port;
    try {
      await assert.rejects(
        startMetricsServer(new ApiMetrics(), { host: '127.0.0.1', port }),
        /EADDRINUSE/,
      );
    } finally {
      await closeMetricsServer(first);
    }
  });
});

describe('client disconnects', () => {
  it('are counted apart from errors', async () => {
    const metrics = new ApiMetrics();
    metrics.countClientDisconnect();
    assert.equal(await sample(metrics, 'http_client_disconnects_total'), 1);
    assert.doesNotMatch(await metrics.render(), /^api_errors_total\{/m);
  });
});

const completion: AiCompletion = { content: 'Woof.', outputTokens: 2 };
const request = { messages: [], maxOutputTokens: 10 };

describe('MeteredAiProvider', () => {
  it('times completions by outcome and passes results and errors through', async () => {
    const metrics = new ApiMetrics();
    const failures: unknown[] = [new AiUnavailableError('timeout'), new AiOverloadedError(429)];
    const inner: AiProvider = {
      enabled: true,
      complete: () => {
        const failure = failures.shift();
        return failure === undefined ? Promise.resolve(completion) : Promise.reject(failure);
      },
    };
    const provider = new MeteredAiProvider(inner, metrics);
    const signal = new AbortController().signal;

    await assert.rejects(provider.complete(request, signal), AiUnavailableError);
    await assert.rejects(provider.complete(request, signal), AiOverloadedError);
    assert.deepEqual(await provider.complete(request, signal), completion);

    for (const outcome of ['timeout', 'overloaded', 'success']) {
      assert.equal(
        await sample(metrics, `ai_inference_duration_seconds_count{outcome="${outcome}"}`),
        1,
        outcome,
      );
    }
  });

  it('labels a call the visitor abandoned as aborted', async () => {
    const metrics = new ApiMetrics();
    const controller = new AbortController();
    const provider = new MeteredAiProvider(
      {
        enabled: true,
        complete: () => {
          controller.abort();
          return Promise.reject(new Error('aborted'));
        },
      },
      metrics,
    );
    await assert.rejects(provider.complete(request, controller.signal));
    assert.equal(
      await sample(metrics, 'ai_inference_duration_seconds_count{outcome="aborted"}'),
      1,
    );
  });

  it('keeps the runtime check only when the provider has one', async () => {
    const metrics = new ApiMetrics();
    const without = new MeteredAiProvider(
      { enabled: false, complete: () => Promise.reject() },
      metrics,
    );
    assert.equal(without.status, undefined);
    assert.equal(without.enabled, false);

    const withStatus = new MeteredAiProvider(
      {
        enabled: true,
        complete: () => Promise.reject(),
        status: () => Promise.resolve('ready'),
      },
      metrics,
    );
    assert.equal(await withStatus.status?.(new AbortController().signal), 'ready');
  });
});

describe('MeteredAiConcurrencyLimiter', () => {
  const signal = new AbortController().signal;

  it('counts waiters while they wait and times the wait once a slot is granted', async () => {
    const metrics = new ApiMetrics();
    let grant: () => void = () => undefined;
    const slot = new Promise<void>((resolve) => {
      grant = resolve;
    });
    const inner: AiConcurrencyLimiter = {
      hasCapacity: async () => true,
      run: async (task) => {
        await slot;
        return task();
      },
    };
    const limiter = new MeteredAiConcurrencyLimiter(inner, metrics);

    const result = limiter.run(async () => {
      assert.equal(await sample(metrics, 'ai_queue_waiting'), 0, 'not waiting once granted');
      return 'reply';
    }, signal);
    assert.equal(await sample(metrics, 'ai_queue_waiting'), 1);
    grant();
    assert.equal(await result, 'reply');

    assert.equal(await sample(metrics, 'ai_queue_waiting'), 0);
    assert.equal(await sample(metrics, 'ai_queue_wait_seconds_count'), 1);
  });

  it('counts a full queue found by the precheck, and passes the answer through', async () => {
    const metrics = new ApiMetrics();
    let open = false;
    const limiter = new MeteredAiConcurrencyLimiter(
      { hasCapacity: async () => open, run: (task) => task() },
      metrics,
    );
    assert.equal(await limiter.hasCapacity(), false);
    open = true;
    assert.equal(await limiter.hasCapacity(), true);
    assert.equal(await sample(metrics, 'ai_capacity_rejections_total{reason="precheck"}'), 1);
  });

  it('counts rejections by whether the request waited, without timing them as waits', async () => {
    const metrics = new ApiMetrics();
    const rejections = [new AiCapacityError(10), new AiCapacityError(10, true)];
    const limiter = new MeteredAiConcurrencyLimiter(
      {
        hasCapacity: async () => true,
        run: () => Promise.reject(rejections.shift() ?? new Error('Redis down')),
      },
      metrics,
    );
    const task = () => Promise.resolve('unused');

    await assert.rejects(limiter.run(task, signal), AiCapacityError);
    await assert.rejects(limiter.run(task, signal), AiCapacityError);
    await assert.rejects(limiter.run(task, signal), /Redis down/);

    assert.equal(await sample(metrics, 'ai_capacity_rejections_total{reason="immediate"}'), 1);
    assert.equal(await sample(metrics, 'ai_capacity_rejections_total{reason="waited"}'), 1);
    assert.equal(await sample(metrics, 'ai_queue_waiting'), 0);
    assert.equal(await sample(metrics, 'ai_queue_wait_seconds_count'), 0);
  });
});
