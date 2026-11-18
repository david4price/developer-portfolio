import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { loadApiConfig } from '../src/config/api-config.js';
import {
  ArgoCdApplicationReader,
  serializeDeploymentStatus,
} from '../src/modules/infrastructure/argocd-application.reader.js';
import { DeploymentReadError } from '../src/modules/infrastructure/deployment-reader.js';
import { InfrastructureController } from '../src/modules/infrastructure/infrastructure.controller.js';
import {
  INFRASTRUCTURE_SNAPSHOTS,
  InfrastructureSnapshotService,
} from '../src/modules/infrastructure/infrastructure-snapshot.service.js';
import { createTestApp } from './support/test-app.js';

const NOW = '2026-11-18T12:00:00.000Z';
const application = () => ({
  metadata: { name: 'portfolio', annotations: { internal: '192.0.2.17' } },
  spec: {
    project: 'portfolio',
    source: { repoURL: 'https://private.example.com/repo', helm: { values: 'secret-password' } },
  },
  status: {
    sync: { status: 'Synced', revisions: ['f'.repeat(40)] },
    history: [
      {
        id: 4,
        revisions: ['b'.repeat(40), 'b'.repeat(40)],
        deployedAt: NOW,
        source: { token: 'private-token' },
      },
      { id: 2, revision: 'a'.repeat(40), deployedAt: '2026-11-17T12:00:00Z' },
    ],
    resources: [{ name: 'private-pod', namespace: 'argocd', node: 'private-node' }],
  },
});
const serialize = (value: unknown) => serializeDeploymentStatus(value, 'portfolio', 'portfolio');

describe('Argo CD allowlist', () => {
  it('emits only sync, a short deployed revision, and its time, never the comparison target or raw fields', () => {
    assert.deepEqual(serialize(application()), {
      sync: 'synced',
      release: { commit: 'bbbbbbb', pinnedAt: NOW },
    });
  });

  it('keeps the last deployed release while out of sync, and treats unfamiliar status as unknown', () => {
    const value = application();
    value.status.sync.status = 'OutOfSync';
    assert.equal(serialize(value).sync, 'out-of-sync');
    assert.equal(serialize(value).release?.commit, 'bbbbbbb');
    value.status.sync.status = 'new-upstream-status';
    assert.equal(serialize(value).sync, 'unknown');
  });

  it('supports single-source history, and omits missing or malformed revisions and dates', () => {
    for (const history of [
      undefined,
      [],
      [{ id: 1, revision: 'not-a-commit', deployedAt: NOW }],
      [{ id: 1, revision: 'a'.repeat(40), deployedAt: 'private-details' }],
    ] as const) {
      assert.equal(
        serialize({ ...application(), status: { sync: { status: 'Synced' }, history } }).release,
        null,
      );
    }
    assert.deepEqual(
      serialize({
        ...application(),
        status: { history: [{ id: 1, revision: 'a'.repeat(40), deployedAt: NOW }] },
      }),
      {
        sync: 'unknown',
        release: { commit: 'aaaaaaa', pinnedAt: NOW },
      },
    );
  });

  it('rejects another application, project, and malformed replies', () => {
    for (const value of [
      null,
      {},
      { ...application(), metadata: { name: 'other' } },
      { ...application(), spec: { project: 'other' } },
    ]) {
      assert.throws(() => serialize(value), { reason: 'invalid_response' });
    }
  });
});

describe('ArgoCdApplicationReader', () => {
  it('makes only the scoped GET and rereads the token on refresh', async (t) => {
    const requests: { path: string | undefined; token: string | undefined }[] = [];
    const server = createServer((request, response) => {
      requests.push({ path: request.url, token: request.headers.authorization });
      response.end(JSON.stringify(application()));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => server.close());
    const serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const settings = {
      serverUrl,
      application: 'portfolio',
      project: 'portfolio',
      tokenFile: '/token',
      caFile: '/ca',
    };
    assert.throws(() => new ArgoCdApplicationReader(settings), /HTTPS/);
    let token = 'first-token';
    const reader = new ArgoCdApplicationReader({
      ...settings,
      allowInsecureHttpForTests: true,
      readFile: async () => token,
    });
    await reader.read(AbortSignal.timeout(1_000));
    token = 'second-token';
    await reader.read(AbortSignal.timeout(1_000));
    assert.deepEqual(requests, [
      { path: '/api/v1/applications/portfolio?project=portfolio', token: 'Bearer first-token' },
      { path: '/api/v1/applications/portfolio?project=portfolio', token: 'Bearer second-token' },
    ]);
  });

  it('refuses credentials in URLs, paths, queries, and fragments', () => {
    for (const serverUrl of [
      'https://user:password@example.com',
      'https://example.com/path',
      'https://example.com/?token=secret',
      'https://example.com/#fragment',
    ]) {
      assert.throws(
        () =>
          new ArgoCdApplicationReader({
            serverUrl,
            application: 'portfolio',
            project: 'portfolio',
            tokenFile: '/token',
            caFile: '/ca',
          }),
        /HTTPS/,
      );
    }
  });

  it('rejects statuses and redirects without following them or exposing their bodies', async (t) => {
    let calls = 0;
    let status = 403;
    const server = createServer((_request, response) => {
      calls++;
      response.writeHead(status, { location: '/redirect-target' });
      response.end('private-upstream-error');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => server.close());
    const reader = new ArgoCdApplicationReader({
      serverUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      application: 'portfolio',
      project: 'portfolio',
      tokenFile: '/token',
      caFile: '/ca',
      readFile: async () => 'token',
      allowInsecureHttpForTests: true,
    });
    for (const code of [401, 403, 302, 500]) {
      status = code;
      await assert.rejects(reader.read(AbortSignal.timeout(1_000)), (error: unknown) => {
        assert.ok(error instanceof DeploymentReadError);
        assert.equal(error.status, code);
        assert.doesNotMatch(error.message, /private-upstream/);
        return true;
      });
    }
    assert.equal(calls, 4);
  });

  it('bounds response size, validates JSON, and handles timeouts including a stalled body', async (t) => {
    let mode = 'large';
    const server = createServer((_request, response) => {
      if (mode === 'timeout') {
        response.writeHead(200);
        response.write('{');
        return;
      }
      response.end(mode === 'large' ? 'x'.repeat(2000) : 'not json');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => {
      server.closeAllConnections();
      server.close();
    });
    const reader = new ArgoCdApplicationReader({
      serverUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      application: 'portfolio',
      project: 'portfolio',
      tokenFile: '/token',
      caFile: '/ca',
      readFile: async () => 'token',
      allowInsecureHttpForTests: true,
      maxResponseBytes: 1000,
    });
    await assert.rejects(reader.read(AbortSignal.timeout(1_000)), { reason: 'invalid_response' });
    mode = 'malformed';
    await assert.rejects(reader.read(AbortSignal.timeout(1_000)), { reason: 'invalid_response' });
    mode = 'timeout';
    await assert.rejects(reader.read(AbortSignal.timeout(30)), { reason: 'timeout' });
  });

  it('verifies its mounted CA without weakening global TLS, and handles missing credentials', async (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'argocd-reader-tls-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '1',
        '-subj',
        '/CN=127.0.0.1',
        '-addext',
        'subjectAltName=IP:127.0.0.1',
        '-keyout',
        join(directory, 'key'),
        '-out',
        join(directory, 'cert'),
      ],
      { stdio: 'ignore' },
    );
    const cert = readFileSync(join(directory, 'cert'), 'utf8');
    const server = createHttpsServer(
      { key: readFileSync(join(directory, 'key')), cert },
      (_request, response) => response.end(JSON.stringify(application())),
    );
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => {
      server.closeAllConnections();
      server.close();
    });
    const settings = {
      serverUrl: `https://127.0.0.1:${(server.address() as AddressInfo).port}`,
      application: 'portfolio',
      project: 'portfolio',
      tokenFile: '/token',
      caFile: '/ca',
    };
    const reader = new ArgoCdApplicationReader({
      ...settings,
      readFile: async (path) => (path === '/ca' ? cert : 'token'),
    });
    assert.equal((await reader.read(AbortSignal.timeout(1_000))).sync, 'synced');
    await assert.rejects(fetch(settings.serverUrl), 'global TLS must not trust the custom CA');
    const invalid = new ArgoCdApplicationReader({
      ...settings,
      readFile: async (path) => (path === '/ca' ? '' : 'token'),
    });
    await assert.rejects(invalid.read(AbortSignal.timeout(1_000)), { reason: 'network' });
    const missing = new ArgoCdApplicationReader({
      ...settings,
      readFile: () => Promise.reject(new Error('private path')),
    });
    await assert.rejects(missing.read(AbortSignal.timeout(1_000)), { reason: 'credentials' });
  });
});

describe('optional deployment source', () => {
  it('adds only allowlisted facts to HTTP responses and shares the 12 s cache', async (t) => {
    let calls = 0;
    const service = new InfrastructureSnapshotService(
      { read: async () => ({ deployments: [], statefulSets: [], pods: [] }) },
      {
        namespace: 'portfolio',
        deploymentReader: {
          read: async () => {
            calls++;
            return serialize(application());
          },
        },
      },
    );
    const app = await createTestApp({
      controllers: [InfrastructureController],
      providers: [{ provide: INFRASTRUCTURE_SNAPSHOTS, useValue: service }],
    });
    t.after(() => app.close());
    for (let i = 0; i < 2; i++) {
      const response = await app.inject({ method: 'GET', url: '/api/v1/infrastructure' });
      assert.equal(response.statusCode, 200);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.equal(response.json().sync, 'synced');
      assert.equal(response.json().release.commit, 'bbbbbbb');
      assert.doesNotMatch(response.body, /192\.0\.2\.17|private|secret-password|repoURL/);
    }
    assert.equal(calls, 1);
  });

  it('refreshes workloads but clears old sync/release facts when Argo CD fails', async () => {
    let now = Date.parse(NOW);
    let fails = false;
    const service = new InfrastructureSnapshotService(
      { read: async () => ({ deployments: [], statefulSets: [], pods: [] }) },
      {
        namespace: 'portfolio',
        now: () => now,
        deploymentReader: {
          read: async () => {
            if (fails) throw new DeploymentReadError('status', 403);
            return serialize(application());
          },
        },
      },
    );
    assert.equal((await service.snapshot()).sync, 'synced');
    fails = true;
    now += 13_000;
    const snapshot = await service.snapshot();
    assert.equal(snapshot.generatedAt, new Date(now).toISOString());
    assert.equal(snapshot.sync, 'unknown');
    assert.equal(snapshot.release, null);
    assert.equal(snapshot.components.find(({ id }) => id === 'argocd')?.health, 'unknown');
  });
});

describe('Argo CD environment settings', () => {
  const required = {
    DATABASE_URL: 'postgres://portfolio:local-only@localhost:5432/portfolio',
    REDIS_URL: 'redis://localhost:6379',
    INFRASTRUCTURE_SOURCE: 'kubernetes',
    KUBERNETES_SERVICE_HOST: '192.0.2.1',
    KUBERNETES_SERVICE_PORT: '443',
  };
  const argocd = {
    ARGOCD_ENABLED: 'true',
    ARGOCD_SERVER_URL: 'https://argocd.example.com',
    ARGOCD_APPLICATION: 'portfolio',
    ARGOCD_PROJECT: 'portfolio',
    ARGOCD_TOKEN_FILE: '/run/secrets/token',
    ARGOCD_CA_FILE: '/run/secrets/ca.crt',
  };
  it('requires complete settings when enabled, with HTTPS and absolute credential paths', () => {
    assert.throws(
      () => loadApiConfig({ ...required, ARGOCD_ENABLED: 'true' }),
      /ARGOCD_SERVER_URL/,
    );
    assert.throws(
      () => loadApiConfig({ ...required, ...argocd, INFRASTRUCTURE_SOURCE: 'disabled' }),
      /ARGOCD_ENABLED/,
    );
    for (const [key, value] of [
      ['ARGOCD_SERVER_URL', 'http://example.com'],
      ['ARGOCD_SERVER_URL', 'https://example.com/private'],
      ['ARGOCD_TOKEN_FILE', 'relative'],
      ['ARGOCD_CA_FILE', 'relative'],
    ] as const) {
      assert.throws(() => loadApiConfig({ ...required, ...argocd, [key]: value }), new RegExp(key));
    }
    const config = loadApiConfig({ ...required, ...argocd }).infrastructure;
    assert.ok(config.enabled);
    assert.equal(config.argocd?.serverUrl, argocd.ARGOCD_SERVER_URL);
  });
});
