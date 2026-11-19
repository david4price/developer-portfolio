import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Controller, Get, HttpException, Post } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import {
  InfrastructureSnapshotService,
  type SnapshotServiceOptions,
} from '../src/modules/infrastructure/infrastructure-snapshot.service.js';
import {
  BUSY_EVENTS,
  NoopTrafficCounter,
  RedisTrafficCounter,
  TRAFFIC_WINDOW_MINUTES,
  type TrafficCounter,
  TrafficInterceptor,
  type TrafficLevels,
  type TrafficSource,
  type TrafficStore,
  trafficLevel,
} from '../src/modules/infrastructure/traffic.js';
import { createTestApp } from './support/test-app.js';

const MINUTE = 60_000;

/** An in-memory stand-in for the two Redis calls the counter makes. */
class FakeStore implements TrafficStore {
  readonly values = new Map<string, string>();
  readonly expiries = new Map<string, number>();
  failWrites = false;
  stallReads = false;

  pipeline() {
    const ops: Array<() => void> = [];
    const pipeline = {
      incr: (key: string) => {
        ops.push(() => this.values.set(key, String(Number(this.values.get(key) ?? 0) + 1)));
        return pipeline;
      },
      expire: (key: string, seconds: number, mode: 'NX') => {
        assert.equal(mode, 'NX');
        ops.push(() => {
          if (!this.expiries.has(key)) this.expiries.set(key, seconds);
        });
        return pipeline;
      },
      exec: async () => {
        if (this.failWrites) throw new Error('connection lost');
        for (const op of ops) op();
        return [];
      },
    };
    return pipeline;
  }

  async mget(...keys: string[]) {
    if (this.stallReads) return new Promise<never>(() => undefined);
    return keys.map((key) => this.values.get(key) ?? null);
  }
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('traffic levels', () => {
  it('buckets the window: none is idle, under the threshold low, from it busy', () => {
    assert.equal(trafficLevel(0), 'idle');
    assert.equal(trafficLevel(1), 'low');
    assert.equal(trafficLevel(BUSY_EVENTS - 1), 'low');
    assert.equal(trafficLevel(BUSY_EVENTS), 'busy');
  });
});

describe('RedisTrafficCounter', () => {
  it('counts per source per minute, with keys that expire soon after the window', async () => {
    const store = new FakeStore();
    let now = 100 * MINUTE + 5_000;
    const counter = new RedisTrafficCounter(store, () => now);
    counter.record('api');
    counter.record('api');
    counter.record('ai');
    now += MINUTE;
    counter.record('api');
    await settle();
    assert.deepEqual(Object.fromEntries(store.values), {
      'portfolio:infrastructure:traffic:api:100': '2',
      'portfolio:infrastructure:traffic:ai:100': '1',
      'portfolio:infrastructure:traffic:api:101': '1',
    });
    for (const seconds of store.expiries.values()) {
      assert.equal(seconds, (TRAFFIC_WINDOW_MINUTES + 2) * 60);
    }
  });

  it('reads a sliding window: the partial far minute counts for the share still inside', async () => {
    const store = new FakeStore();
    let now = 200 * MINUTE;
    const counter = new RedisTrafficCounter(store, () => now);
    const signal = () => AbortSignal.timeout(1_000);
    assert.deepEqual(await counter.read(signal()), { api: 'idle', ai: 'idle' });
    // A steady 12 a minute: 12 in each of the last six minutes, current one included.
    for (let m = 200 - TRAFFIC_WINDOW_MINUTES; m <= 200; m++) {
      store.values.set(`portfolio:infrastructure:traffic:api:${m}`, '12');
    }
    // At the start of minute 200 the far minute (195) still counts in full: 72 → busy.
    assert.equal((await counter.read(signal())).api, 'busy');
    // Most of the way through minute 200 the far minute has slid out; with the current
    // minute's 12 already in, the window holds just over 60: still busy, no flip.
    now = 200 * MINUTE + 50_000;
    assert.equal((await counter.read(signal())).api, 'busy');
    // Older minutes never count, and junk values count as nothing.
    store.values.set(
      `portfolio:infrastructure:traffic:ai:${200 - TRAFFIC_WINDOW_MINUTES - 1}`,
      '999',
    );
    store.values.set('portfolio:infrastructure:traffic:ai:199', '3');
    store.values.set('portfolio:infrastructure:traffic:ai:198', 'not a number');
    store.values.set('portfolio:infrastructure:traffic:ai:197', '-50');
    assert.equal((await counter.read(signal())).ai, 'low');
  });

  it('gives up a stalled read when the signal aborts, leaving nothing unhandled', async () => {
    const store = new FakeStore();
    store.stallReads = true;
    const counter = new RedisTrafficCounter(store);
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      await assert.rejects(counter.read(AbortSignal.timeout(50)));
      await assert.rejects(counter.read(AbortSignal.abort(new Error('already'))), /already/);
      store.stallReads = false;
      // A read that settles first: the deadline firing later rejects into nothing.
      await counter.read(AbortSignal.timeout(30));
      await new Promise((resolve) => setTimeout(resolve, 80));
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
    assert.deepEqual(unhandled, []);
  });

  it('counts nothing and reports no levels with the view off', async () => {
    const counter = new NoopTrafficCounter();
    counter.record();
    assert.equal(await counter.read(), null);
  });

  it('never throws from record, and logs a Redis outage once', async (t) => {
    const store = new FakeStore();
    store.failWrites = true;
    const counter = new RedisTrafficCounter(store);
    const warned: unknown[] = [];
    const logger = (counter as unknown as { logger: { warn: (entry: unknown) => void } }).logger;
    t.mock.method(logger, 'warn', (entry: unknown) => warned.push(entry));
    for (let i = 0; i < 3; i++) assert.doesNotThrow(() => counter.record('api'));
    await settle();
    assert.equal(warned.length, 1);
    store.failWrites = false;
    const logged: unknown[] = [];
    t.mock.method(
      (counter as unknown as { logger: { log: (entry: unknown) => void } }).logger,
      'log',
      (entry: unknown) => logged.push(entry),
    );
    counter.record('api');
    await settle();
    assert.equal(logged.length, 1);
    store.failWrites = true;
    counter.record('api');
    await settle();
    assert.equal(warned.length, 2);
  });
});

describe('TrafficInterceptor', () => {
  @Controller('health')
  class FakeHealth {
    @Get('ready')
    ready() {
      return { status: 'ready' };
    }
  }
  @Controller('infrastructure')
  class FakeInfrastructure {
    @Get()
    get() {
      return {};
    }
  }
  @Controller('projects')
  class FakeProjects {
    @Get()
    list() {
      return [];
    }
  }
  @Controller('chat')
  class FakeChat {
    static fail = false;
    @Post('messages')
    send() {
      if (FakeChat.fail) throw new HttpException({ error: { code: 'ai_overloaded' } }, 503);
      return { reply: 'hi', links: [] };
    }
    @Post('sessions')
    session() {
      return {};
    }
  }

  it('counts visitor requests and replied chat messages, never probes or the explorer', async (t) => {
    const recorded: TrafficSource[] = [];
    const counter: TrafficCounter = {
      record: (source) => recorded.push(source),
      read: async () => ({ api: 'idle', ai: 'idle' }),
    };
    const app = await createTestApp({
      controllers: [FakeHealth, FakeInfrastructure, FakeProjects, FakeChat],
      providers: [{ provide: APP_INTERCEPTOR, useValue: new TrafficInterceptor(counter) }],
    });
    t.after(() => app.close());
    const call = (method: 'GET' | 'POST', url: string) =>
      app.inject({ method, url, ...(method === 'POST' ? { payload: {} } : {}) });

    await call('GET', '/api/v1/health/ready');
    await call('GET', '/api/v1/infrastructure');
    assert.deepEqual(recorded, []);
    await call('GET', '/api/v1/projects');
    await call('POST', '/api/v1/chat/sessions');
    assert.deepEqual(recorded, ['api', 'api']);
    await call('POST', '/api/v1/chat/messages');
    assert.deepEqual(recorded.slice(2), ['api', 'ai']);
    FakeChat.fail = true;
    const failed = await call('POST', '/api/v1/chat/messages');
    assert.equal(failed.statusCode, 503);
    assert.deepEqual(recorded.slice(4), ['api']);
  });
});

describe('traffic in the snapshot', () => {
  const pod = (component: string) => ({
    metadata: {
      namespace: 'portfolio',
      labels: { 'app.kubernetes.io/component': component },
    },
    spec: {
      replicas: 1,
      template: { spec: { containers: [{ image: `example/${component}:1` }] } },
    },
    status: { replicas: 1, readyReplicas: 1, availableReplicas: 1, updatedReplicas: 1 },
  });
  const workloads = {
    read: async () => ({
      deployments: [pod('api'), pod('cloudflared')],
      statefulSets: [],
      pods: [],
    }),
  };
  const snapshotWith = async (options: Partial<SnapshotServiceOptions>) => {
    const service = new InfrastructureSnapshotService(workloads, {
      namespace: 'portfolio',
      ...options,
    });
    const snapshot = await service.snapshot();
    return Object.fromEntries(snapshot.components.map(({ id, traffic }) => [id, traffic]));
  };
  const levels: TrafficLevels = { api: 'busy', ai: 'low' };

  it('puts API traffic on the API and its tunnel, and chat on a probed model only', async () => {
    assert.deepEqual(
      await snapshotWith({ traffic: async () => levels, aiStatus: async () => 'ready' }),
      {
        web: null,
        tunnel: 'busy',
        api: 'busy',
        worker: null,
        ai: 'low',
        postgres: null,
        redis: null,
        argocd: null,
      },
    );
    const unprobed = await snapshotWith({ traffic: async () => levels });
    assert.equal(unprobed.ai, null);
  });

  it('leaves the tunnel without traffic when it is not in the cluster', async () => {
    const service = new InfrastructureSnapshotService(
      { read: async () => ({ deployments: [pod('api')], statefulSets: [], pods: [] }) },
      { namespace: 'portfolio', traffic: async () => levels },
    );
    const tunnel = (await service.snapshot()).components.find(({ id }) => id === 'tunnel');
    assert.equal(tunnel?.traffic, null);
  });

  it('carries no traffic when the levels fail, and still serves the snapshot', async () => {
    const failed = await snapshotWith({
      traffic: async () => {
        throw new Error('redis down');
      },
    });
    assert.equal(failed.api, null);
    // A stalled read gives up at the refresh's deadline, as the Redis counter does.
    const started = Date.now();
    const stalled = await snapshotWith({
      timeoutMs: 100,
      traffic: (signal) =>
        new Promise<TrafficLevels>((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason)),
        ),
    });
    assert.ok(Date.now() - started < 2_000);
    assert.equal(stalled.api, null);
    // With the view's counter off there are no levels either.
    const off = await snapshotWith({ traffic: async () => null });
    assert.equal(off.api, null);
  });

  it('returns only buckets: no counts reach the snapshot', async () => {
    const service = new InfrastructureSnapshotService(workloads, {
      namespace: 'portfolio',
      traffic: async () => levels,
    });
    const body = JSON.stringify(await service.snapshot());
    assert.doesNotMatch(body, /"traffic":\d|count|events/);
  });
});
