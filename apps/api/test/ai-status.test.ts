import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it, type TestContext } from 'node:test';
import {
  AiOverloadedError,
  type AiProvider,
  type AiStatus,
  AiUnavailableError,
} from '../src/modules/ai/ai-provider.js';
import { DisabledAiProvider } from '../src/modules/ai/disabled-ai.provider.js';
import { OpenAiCompatibleProvider } from '../src/modules/ai/openai-compatible.provider.js';
import { InfrastructureController } from '../src/modules/infrastructure/infrastructure.controller.js';
import { createSnapshotSource } from '../src/modules/infrastructure/infrastructure.module.js';
import {
  AI_STATUS_TIMEOUT_MS,
  INFRASTRUCTURE_SNAPSHOTS,
  InfrastructureSnapshotService,
} from '../src/modules/infrastructure/infrastructure-snapshot.service.js';
import { createTestApp } from './support/test-app.js';

const MODEL = 'example.org/private-org/private-model:Q4';

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

/** A fake runtime on a random port; returns its `/v1` base URL and the requests it saw. */
async function runtime(t: TestContext, handler: Handler) {
  const paths: string[] = [];
  const server = createServer((request, response) => {
    paths.push(`${request.method} ${request.url}`);
    handler(request, response);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}/engines/v1`, paths };
}

const json =
  (status: number, body: unknown): Handler =>
  (_request, response) =>
    response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));

const listing = (...ids: string[]) => ({
  object: 'list',
  data: ids.map((id) => ({ id, object: 'model', owned_by: 'private-owner', created: 1 })),
});

const provider = (baseUrl: string, model = MODEL) =>
  new OpenAiCompatibleProvider({ baseUrl, model });
const signal = () => AbortSignal.timeout(2_000);

describe('OpenAiCompatibleProvider.status', () => {
  it('asks only GET /models and reports ready when the configured model is listed', async (t) => {
    const { baseUrl, paths } = await runtime(t, json(200, listing('other', MODEL)));
    assert.equal(await provider(`${baseUrl}/`).status(signal()), 'ready');
    assert.deepEqual(paths, ['GET /engines/v1/models']);
  });

  it('matches only the exact name chat sends: no case folding, implied tags, or lone models', async (t) => {
    const { baseUrl } = await runtime(t, json(200, listing('AI/SmolLM2:latest')));
    assert.equal(await provider(baseUrl, 'ai/smollm2').status(signal()), 'missing');
    assert.equal(await provider(baseUrl, 'AI/SmolLM2').status(signal()), 'missing');
    assert.equal(await provider(baseUrl, 'AI/SmolLM2:latest').status(signal()), 'ready');
  });

  it('reports missing when several models are listed without it, and busy on 429/503', async (t) => {
    const missing = await runtime(t, json(200, listing('one', 'two')));
    assert.equal(await provider(missing.baseUrl).status(signal()), 'missing');
    const empty = await runtime(t, json(200, listing()));
    assert.equal(await provider(empty.baseUrl).status(signal()), 'missing');
    for (const status of [429, 503]) {
      const busy = await runtime(t, json(status, { error: 'loading' }));
      assert.equal(await provider(busy.baseUrl).status(signal()), 'busy');
    }
  });

  it('throws typed errors for statuses, redirects, bad bodies, and unreachable runtimes', async (t) => {
    const cases: Array<[Handler, AiUnavailableError['reason']]> = [
      [json(500, { error: 'private detail' }), 'upstream_status'],
      // A proxy's page in front of a runtime that's gone: not the runtime being busy.
      [
        (_request, response) =>
          response.writeHead(503, { 'content-type': 'text/html' }).end('<h1>no upstream</h1>'),
        'upstream_status',
      ],
      [json(200, { models: [] }), 'invalid_response'],
      [(_request, response) => response.writeHead(200).end('not json'), 'invalid_response'],
      [
        json(200, { data: Array.from({ length: 10_000 }, (_, i) => ({ id: `m${i}` })) }),
        'invalid_response',
      ],
      [
        (_request, response) =>
          response.writeHead(302, { location: 'http://203.0.113.9/models' }).end(),
        'network',
      ],
    ];
    for (const [handler, reason] of cases) {
      const { baseUrl } = await runtime(t, handler);
      await assert.rejects(
        provider(baseUrl).status(signal()),
        (error: unknown) => error instanceof AiUnavailableError && error.reason === reason,
      );
    }
    // Port 1: nothing listens there, so the connection is refused.
    await assert.rejects(
      provider('http://127.0.0.1:1/engines/v1').status(signal()),
      (error: unknown) => error instanceof AiUnavailableError && error.reason === 'network',
    );
  });

  it('reports a stalled runtime as a timeout, by the caller or its own deadline', async (t) => {
    const { baseUrl } = await runtime(t, () => undefined);
    const timedOut = (error: unknown) =>
      error instanceof AiUnavailableError && error.reason === 'timeout';
    await assert.rejects(provider(baseUrl).status(AbortSignal.timeout(100)), timedOut);
    const bounded = new OpenAiCompatibleProvider({ baseUrl, model: MODEL, timeoutMs: 100 });
    await assert.rejects(bounded.status(new AbortController().signal), timedOut);
  });

  it('counts a llama.cpp server as ready whatever name it lists, but not other single models or several', async (t) => {
    const llama = await runtime(
      t,
      json(200, {
        object: 'list',
        data: [{ id: '/models/loaded-file.gguf', object: 'model', owned_by: 'llamacpp' }],
      }),
    );
    assert.equal(await provider(llama.baseUrl).status(signal()), 'ready');
    const other = await runtime(t, json(200, listing('ai/other-model')));
    assert.equal(await provider(other.baseUrl).status(signal()), 'missing');
    // Several llama.cpp models (router mode) are routed by name, so the name must match.
    const router = await runtime(
      t,
      json(200, {
        data: [
          { id: 'model-a', owned_by: 'llamacpp' },
          { id: 'model-b', owned_by: 'llamacpp' },
        ],
      }),
    );
    assert.equal(await provider(router.baseUrl).status(signal()), 'missing');
  });

  it('uses one overload rule for chat and the check: a proxy 503 is not the runtime busy', async (t) => {
    const ask = { messages: [{ role: 'user', content: 'hi' }], maxOutputTokens: 5 } as const;
    const ownBusy = await runtime(t, json(503, { error: { message: 'Loading model' } }));
    await assert.rejects(provider(ownBusy.baseUrl).complete(ask, signal()), AiOverloadedError);
    const proxy = await runtime(t, (_request, response) =>
      response.writeHead(503, { 'content-type': 'text/html' }).end('<h1>no upstream</h1>'),
    );
    await assert.rejects(
      provider(proxy.baseUrl).complete(ask, signal()),
      (error: unknown) =>
        error instanceof AiUnavailableError &&
        error.reason === 'upstream_status' &&
        error.upstreamStatus === 503,
    );
  });

  it('has no status check when AI is off', () => {
    const disabled: AiProvider = new DisabledAiProvider();
    assert.equal(disabled.status, undefined);
  });
});

describe('AI building in the snapshot', () => {
  const workloads = { read: async () => ({ deployments: [], statefulSets: [], pods: [] }) };
  const service = (aiStatus?: (signal: AbortSignal) => Promise<AiStatus>) =>
    new InfrastructureSnapshotService(workloads, {
      namespace: 'portfolio',
      ttlMs: 0,
      aiTimeoutMs: 50,
      ...(aiStatus === undefined ? {} : { aiStatus }),
    });
  const aiOf = async (source: InfrastructureSnapshotService) =>
    (await source.snapshot()).components.find(({ id }) => id === 'ai');

  it('maps the runtime answer to health and failure, never a version or replica count', async () => {
    const expected = {
      ready: { health: 'healthy', failure: null },
      busy: { health: 'degraded', failure: null },
      missing: { health: 'down', failure: 'not-ready' },
    } as const;
    for (const [status, state] of Object.entries(expected)) {
      const ai = await aiOf(service(async () => status as AiStatus));
      assert.deepEqual(ai, { id: 'ai', ...state, version: null, replicas: null, traffic: null });
    }
  });

  it('draws an unreachable runtime as down without failing the snapshot', async () => {
    const ai = await aiOf(
      service(async () => {
        throw new AiUnavailableError('network');
      }),
    );
    assert.equal(ai?.health, 'down');
    assert.equal(ai?.failure, 'unreachable');
  });

  it('gives a stalled probe its own short deadline, not the cluster read’s', async () => {
    let probeSignal: AbortSignal | undefined;
    const started = Date.now();
    const ai = await aiOf(
      service(
        (signal) =>
          new Promise((_resolve, reject) => {
            probeSignal = signal;
            signal.addEventListener('abort', () => reject(new AiUnavailableError('timeout')));
          }),
      ),
    );
    assert.equal(ai?.failure, 'unreachable');
    assert.ok(probeSignal?.aborted);
    assert.ok(Date.now() - started < 1_000);
    assert.ok(AI_STATUS_TIMEOUT_MS < 5_000);
  });

  it('logs an outage once, with the stack for an unexpected error, and its recovery', async (t) => {
    const warned: unknown[] = [];
    const logged: unknown[] = [];
    let fail: Error | null = new Error('bug in the probe');
    const source = service(async () => {
      if (fail !== null) throw fail;
      return 'ready';
    });
    const logger = (source as unknown as { logger: { warn: unknown; log: unknown } }).logger;
    t.mock.method(logger as { warn: (entry: unknown) => void }, 'warn', (entry: unknown) =>
      warned.push(entry),
    );
    t.mock.method(logger as { log: (entry: unknown) => void }, 'log', (entry: unknown) =>
      logged.push(entry),
    );
    // A bug logs every time, with its stack.
    for (let i = 0; i < 2; i++) await source.snapshot();
    assert.equal(warned.length, 2);
    assert.match(JSON.stringify(warned[0]), /"reason":"unexpected".*bug in the probe/);
    // An outage logs once while its reason stays the same, and again when the reason changes.
    fail = new AiUnavailableError('network');
    for (let i = 0; i < 3; i++) await source.snapshot();
    assert.equal(warned.length, 3);
    assert.doesNotMatch(JSON.stringify(warned[2]), /stack|error"/);
    fail = new AiUnavailableError('upstream_status', 500);
    await source.snapshot();
    assert.equal(warned.length, 4);
    // Recovery logs once.
    fail = null;
    await source.snapshot();
    await source.snapshot();
    assert.equal(logged.length, 1);
  });

  it('leaves the AI building unknown without a probe', async () => {
    assert.equal((await aiOf(service()))?.health, 'unknown');
  });

  it('keeps the model name out of the HTTP response and probes once per cache window', async (t) => {
    const { baseUrl, paths } = await runtime(t, json(200, listing('other', MODEL)));
    const ai = provider(baseUrl);
    const cached = new InfrastructureSnapshotService(workloads, {
      namespace: 'portfolio',
      aiStatus: (signal) => ai.status(signal),
    });
    const app = await createTestApp({
      controllers: [InfrastructureController],
      providers: [{ provide: INFRASTRUCTURE_SNAPSHOTS, useValue: cached }],
    });
    t.after(() => app.close());
    for (let i = 0; i < 3; i++) {
      const response = await app.inject({ method: 'GET', url: '/api/v1/infrastructure' });
      assert.equal(response.statusCode, 200);
      assert.equal(
        response.json().components.find(({ id }: { id: string }) => id === 'ai').health,
        'healthy',
      );
      assert.doesNotMatch(response.body, /private|127\.0\.0\.1|engines|Q4|other/);
    }
    assert.equal(paths.length, 1);
  });
});

describe('AI status wiring', () => {
  const kubernetes = {
    enabled: true,
    source: 'kubernetes',
    namespace: 'portfolio',
    apiServerUrl: 'https://192.0.2.1:443',
  } as const;
  const aiStatusOf = (ai: AiProvider) => {
    const source = createSnapshotSource(kubernetes, ai);
    assert.ok(source instanceof InfrastructureSnapshotService);
    return (source as unknown as { options: { aiStatus?: (s: AbortSignal) => Promise<AiStatus> } })
      .options.aiStatus;
  };

  it('asks the chat adapter, bound to it, only when AI is enabled and it has a check', async () => {
    class Checked {
      enabled = true;
      private readonly answer: AiStatus = 'ready';
      complete(): Promise<never> {
        return Promise.reject(new Error('unused'));
      }
      status(): Promise<AiStatus> {
        return Promise.resolve(this.answer);
      }
    }
    const status = aiStatusOf(new Checked());
    assert.equal(await status?.(signal()), 'ready');
    const off = new Checked();
    off.enabled = false;
    assert.equal(aiStatusOf(off), undefined);
    assert.equal(aiStatusOf(new DisabledAiProvider()), undefined);
  });
});
