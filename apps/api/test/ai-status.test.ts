import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it, type TestContext } from 'node:test';
import {
  type AiStatusReader,
  AiStatusError,
  ModelListStatusReader,
} from '../src/modules/infrastructure/ai-status.reader.js';
import { InfrastructureController } from '../src/modules/infrastructure/infrastructure.controller.js';
import {
  createAiStatusReader,
  createSnapshotSource,
} from '../src/modules/infrastructure/infrastructure.module.js';
import {
  INFRASTRUCTURE_SNAPSHOTS,
  InfrastructureSnapshotService,
} from '../src/modules/infrastructure/infrastructure-snapshot.service.js';
import { createTestApp } from './support/test-app.js';

const MODEL = 'example.org/private-org/private-model:Q4';

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

/** A fake runtime on a random port; returns its `/v1` base URL and the paths it was asked for. */
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

const signal = () => AbortSignal.timeout(2_000);

describe('ModelListStatusReader', () => {
  it('asks only GET /models and reports ready when the configured model is listed', async (t) => {
    const { baseUrl, paths } = await runtime(t, json(200, listing('other', MODEL)));
    const reader = new ModelListStatusReader({ baseUrl: `${baseUrl}/`, model: MODEL });
    assert.equal(await reader.read(signal()), 'ready');
    assert.deepEqual(paths, ['GET /engines/v1/models']);
  });

  it('reports missing when the runtime answers without the model, and busy on 429/503', async (t) => {
    const missing = await runtime(t, json(200, listing('other')));
    assert.equal(
      await new ModelListStatusReader({ baseUrl: missing.baseUrl, model: MODEL }).read(signal()),
      'missing',
    );
    for (const status of [429, 503]) {
      const busy = await runtime(t, json(status, { error: 'loading' }));
      assert.equal(
        await new ModelListStatusReader({ baseUrl: busy.baseUrl, model: MODEL }).read(signal()),
        'busy',
      );
    }
  });

  it('throws typed errors for statuses, redirects, bad bodies, and unreachable runtimes', async (t) => {
    const cases: Array<[Handler, AiStatusError['reason']]> = [
      [json(500, { error: 'private detail' }), 'status'],
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
        new ModelListStatusReader({ baseUrl, model: MODEL }).read(signal()),
        (error: unknown) => error instanceof AiStatusError && error.reason === reason,
      );
    }
    // Port 1: nothing listens there, so the connection is refused.
    await assert.rejects(
      new ModelListStatusReader({ baseUrl: 'http://127.0.0.1:1/engines/v1', model: MODEL }).read(
        signal(),
      ),
      (error: unknown) => error instanceof AiStatusError && error.reason === 'network',
    );
  });

  it('reports a stalled runtime as a timeout', async (t) => {
    const { baseUrl } = await runtime(t, () => undefined);
    await assert.rejects(
      new ModelListStatusReader({ baseUrl, model: MODEL }).read(AbortSignal.timeout(100)),
      (error: unknown) => error instanceof AiStatusError && error.reason === 'timeout',
    );
  });

  it('refuses a non-http base URL', () => {
    assert.throws(() => new ModelListStatusReader({ baseUrl: 'file:///etc', model: MODEL }));
  });
});

describe('AI building in the snapshot', () => {
  const workloads = { read: async () => ({ deployments: [], statefulSets: [], pods: [] }) };
  const aiOf = async (aiStatusReader: AiStatusReader | undefined) => {
    const service = new InfrastructureSnapshotService(workloads, {
      namespace: 'portfolio',
      ...(aiStatusReader === undefined ? {} : { aiStatusReader }),
    });
    return (await service.snapshot()).components.find(({ id }) => id === 'ai');
  };

  it('maps the runtime answer to health and failure, never a version or replica count', async () => {
    const expected = {
      ready: { health: 'healthy', failure: null },
      busy: { health: 'degraded', failure: null },
      missing: { health: 'down', failure: 'not-ready' },
    } as const;
    for (const [status, state] of Object.entries(expected)) {
      const ai = await aiOf({ read: async () => status as keyof typeof expected });
      assert.deepEqual(ai, {
        id: 'ai',
        ...state,
        version: null,
        replicas: null,
        traffic: null,
      });
    }
  });

  it('draws an unreachable runtime as down without failing the snapshot', async () => {
    const ai = await aiOf({
      read: async () => {
        throw new AiStatusError('network');
      },
    });
    assert.equal(ai?.health, 'down');
    assert.equal(ai?.failure, 'unreachable');
    const unexpected = await aiOf({
      read: async () => {
        throw new Error('bug');
      },
    });
    assert.equal(unexpected?.failure, 'unreachable');
  });

  it('leaves the AI building unknown without a probe', async () => {
    assert.equal((await aiOf(undefined))?.health, 'unknown');
  });

  it('keeps the model name out of the HTTP response and probes once per cache window', async (t) => {
    const { baseUrl, paths } = await runtime(t, json(200, listing(MODEL)));
    const service = new InfrastructureSnapshotService(workloads, {
      namespace: 'portfolio',
      aiStatusReader: new ModelListStatusReader({ baseUrl, model: MODEL }),
    });
    const app = await createTestApp({
      controllers: [InfrastructureController],
      providers: [{ provide: INFRASTRUCTURE_SNAPSHOTS, useValue: service }],
    });
    t.after(() => app.close());
    for (let i = 0; i < 3; i++) {
      const response = await app.inject({ method: 'GET', url: '/api/v1/infrastructure' });
      assert.equal(response.statusCode, 200);
      assert.equal(
        response.json().components.find(({ id }: { id: string }) => id === 'ai').health,
        'healthy',
      );
      assert.doesNotMatch(response.body, /private|127\.0\.0\.1|engines|Q4/);
    }
    assert.equal(paths.length, 1);
  });
});

describe('AI probe wiring', () => {
  it('probes only an enabled openai-compatible runtime with a base URL', () => {
    assert.equal(createAiStatusReader({ enabled: false }), undefined);
    assert.equal(
      createAiStatusReader({
        enabled: true,
        provider: 'openai-compatible',
        model: MODEL,
        baseUrl: null,
      }),
      undefined,
    );
    assert.ok(
      createAiStatusReader({
        enabled: true,
        provider: 'openai-compatible',
        model: MODEL,
        baseUrl: 'http://192.0.2.5:12434/engines/v1',
      }) instanceof ModelListStatusReader,
    );
    // The disabled source never builds a probe.
    assert.ok(createSnapshotSource({ enabled: false }));
  });
});
