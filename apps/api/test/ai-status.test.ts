import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it, type TestContext } from 'node:test';
import { type AiProvider, type AiStatus, AiStatusError } from '../src/modules/ai/ai-provider.js';
import { DisabledAiProvider } from '../src/modules/ai/disabled-ai.provider.js';
import { OpenAiCompatibleProvider } from '../src/modules/ai/openai-compatible.provider.js';
import { InfrastructureController } from '../src/modules/infrastructure/infrastructure.controller.js';
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

  it('matches ids regardless of case and an implied :latest tag', async (t) => {
    const { baseUrl } = await runtime(t, json(200, listing('other', 'AI/SmolLM2:latest')));
    assert.equal(await provider(baseUrl, 'ai/smollm2').status(signal()), 'ready');
  });

  it('counts a runtime with one listed model as ready, whatever its id (llama.cpp)', async (t) => {
    const { baseUrl } = await runtime(t, json(200, listing('/models/loaded-file.gguf')));
    assert.equal(await provider(baseUrl).status(signal()), 'ready');
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
    const cases: Array<[Handler, AiStatusError['reason']]> = [
      [json(500, { error: 'private detail' }), 'upstream_status'],
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
        (error: unknown) => error instanceof AiStatusError && error.reason === reason,
      );
    }
    // Port 1: nothing listens there, so the connection is refused.
    await assert.rejects(
      provider('http://127.0.0.1:1/engines/v1').status(signal()),
      (error: unknown) => error instanceof AiStatusError && error.reason === 'network',
    );
  });

  it('reports a stalled runtime as a timeout', async (t) => {
    const { baseUrl } = await runtime(t, () => undefined);
    await assert.rejects(
      provider(baseUrl).status(AbortSignal.timeout(100)),
      (error: unknown) => error instanceof AiStatusError && error.reason === 'timeout',
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
        throw new AiStatusError('network');
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
            signal.addEventListener('abort', () => reject(new AiStatusError('timeout')));
          }),
      ),
    );
    assert.equal(ai?.failure, 'unreachable');
    assert.ok(probeSignal?.aborted);
    assert.ok(Date.now() - started < AI_STATUS_TIMEOUT_MS + 1_000);
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
    for (let i = 0; i < 3; i++) await source.snapshot();
    assert.equal(warned.length, 1);
    assert.match(JSON.stringify(warned[0]), /"reason":"unexpected".*bug in the probe/);
    fail = null;
    await source.snapshot();
    await source.snapshot();
    assert.equal(logged.length, 1);
    fail = new AiStatusError('upstream_status', 500);
    await source.snapshot();
    assert.equal(warned.length, 2);
    assert.doesNotMatch(JSON.stringify(warned[1]), /stack|error"/);
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
