import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type { ApiErrorResponse, InfrastructureSnapshot } from '@portfolio/shared-types';
import { loadApiConfig } from '../src/config/api-config.js';
import {
  type ClusterObjects,
  type ClusterReader,
  ClusterReadError,
} from '../src/modules/infrastructure/cluster-reader.js';
import { InfrastructureController } from '../src/modules/infrastructure/infrastructure.controller.js';
import {
  DisabledSnapshotSource,
  INFRASTRUCTURE_SNAPSHOTS,
  InfrastructureSnapshotService,
  type SnapshotSource,
} from '../src/modules/infrastructure/infrastructure-snapshot.service.js';
import { KubernetesClusterReader } from '../src/modules/infrastructure/kubernetes-cluster.reader.js';
import {
  imageVersion,
  serializeSnapshot,
} from '../src/modules/infrastructure/snapshot-serializer.js';
import { createTestApp } from './support/test-app.js';

const NAMESPACE = 'portfolio';
const NOW = new Date('2026-11-18T12:00:00.000Z');

/** Values that must never leave the API, planted all over the raw objects below. */
const SECRETS = {
  podIp: '192.0.2.17',
  hostIp: '198.51.100.20',
  nodeName: 'homelab-node-1',
  envValue: 'postgres://portfolio:super-secret-password@postgres:5432/portfolio',
  secretName: 'portfolio-api-env',
  registryPath: 'ghcr.io/example-owner/portfolio-api',
  otherNamespace: 'kube-system',
  annotation: 'kubectl.kubernetes.io/last-applied-configuration',
  serviceAccount: 'portfolio-api-reader',
  podName: 'portfolio-api-6d9f7b8c5d-x2k4q',
  uid: '0f3c9a52-7d1e-4b8a-9c3f-2e6d1a7b8c9d',
  eventMessage: 'Back-off restarting failed container api in pod',
};

const labels = (component: string) => ({
  'app.kubernetes.io/component': component,
  'app.kubernetes.io/instance': 'portfolio',
  'pod-template-hash': '6d9f7b8c5d',
});

function deployment(
  component: string,
  overrides: { replicas?: number; status?: object; image?: string; namespace?: string } = {},
) {
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: {
      name: `portfolio-${component}`,
      namespace: overrides.namespace ?? NAMESPACE,
      uid: SECRETS.uid,
      generation: 3,
      labels: labels(component),
      annotations: { [SECRETS.annotation]: JSON.stringify({ env: SECRETS.envValue }) },
    },
    spec: {
      replicas: overrides.replicas ?? 1,
      template: {
        metadata: { labels: labels(component) },
        spec: {
          serviceAccountName: SECRETS.serviceAccount,
          nodeName: SECRETS.nodeName,
          containers: [
            {
              name: component,
              image:
                overrides.image ?? `${SECRETS.registryPath}@sha256:${'ab12cd3'.padEnd(64, 'e')}`,
              env: [{ name: 'DATABASE_URL', value: SECRETS.envValue }],
              envFrom: [{ secretRef: { name: SECRETS.secretName } }],
            },
          ],
        },
      },
    },
    status: overrides.status ?? {
      observedGeneration: 3,
      replicas: 1,
      readyReplicas: 1,
      availableReplicas: 1,
      updatedReplicas: 1,
      conditions: [{ type: 'Available', status: 'True', message: SECRETS.eventMessage }],
    },
  };
}

function pod(component: string, status: object) {
  return {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name: SECRETS.podName,
      namespace: NAMESPACE,
      uid: SECRETS.uid,
      labels: labels(component),
    },
    spec: { nodeName: SECRETS.nodeName, serviceAccountName: SECRETS.serviceAccount },
    status: {
      podIP: SECRETS.podIp,
      hostIP: SECRETS.hostIp,
      podIPs: [{ ip: SECRETS.podIp }],
      ...status,
    },
  };
}

const steadyCluster = (): ClusterObjects => ({
  deployments: [
    deployment('api'),
    deployment('worker'),
    deployment('redis', { image: 'docker.io/library/redis:7-alpine' }),
    deployment('cloudflared', { image: 'docker.io/cloudflare/cloudflared:2026.11.0' }),
    // Another namespace's workload with a known label must be ignored.
    deployment('api', { namespace: SECRETS.otherNamespace }),
    // Unlabelled or unknown components are ignored too.
    { ...deployment('metrics-server'), metadata: { namespace: NAMESPACE, labels: {} } },
  ],
  statefulSets: [
    {
      ...deployment('postgres', { image: 'docker.io/library/postgres:17-alpine' }),
      kind: 'StatefulSet',
    },
  ],
  pods: [
    pod('api', {
      phase: 'Running',
      containerStatuses: [{ name: 'api', ready: true, state: { running: {} } }],
    }),
  ],
});

describe('snapshot serializer (allowlist)', () => {
  it('emits exactly the allowlisted fields for the namespace', () => {
    const snapshot = serializeSnapshot(steadyCluster(), { namespace: NAMESPACE, now: NOW });
    const workload = (version: string | null) => ({
      health: 'healthy',
      version,
      replicas: { desired: 1, available: 1, ready: 1 },
      traffic: null,
      failure: null,
    });
    const unknown = {
      health: 'unknown',
      version: null,
      replicas: null,
      traffic: null,
      failure: null,
    };
    assert.deepEqual(snapshot, {
      generatedAt: NOW.toISOString(),
      sync: 'unknown',
      release: null,
      components: [
        { id: 'web', ...unknown },
        { id: 'tunnel', ...workload('2026.11.0') },
        { id: 'api', ...workload('sha256:ab12cd3') },
        { id: 'worker', ...workload('sha256:ab12cd3') },
        { id: 'ai', ...unknown },
        { id: 'postgres', ...workload('17-alpine') },
        { id: 'redis', ...workload('7-alpine') },
        { id: 'argocd', ...unknown },
      ],
    });
  });

  it('leaks no IPs, node names, env values, secrets, registry paths, names, or other namespaces', () => {
    const failing: ClusterObjects = {
      ...steadyCluster(),
      deployments: [
        deployment('api', {
          status: { observedGeneration: 3, replicas: 1, readyReplicas: 0, updatedReplicas: 1 },
        }),
      ],
      pods: [
        pod('api', {
          conditions: [{ type: 'PodScheduled', status: 'True', message: SECRETS.eventMessage }],
          containerStatuses: [
            {
              name: 'api',
              ready: false,
              state: { waiting: { reason: 'CrashLoopBackOff', message: SECRETS.eventMessage } },
            },
          ],
        }),
      ],
    };
    for (const objects of [steadyCluster(), failing]) {
      const json = JSON.stringify(serializeSnapshot(objects, { namespace: NAMESPACE, now: NOW }));
      for (const [name, value] of Object.entries(SECRETS)) {
        assert.ok(!json.includes(value), `${name} leaked`);
      }
      for (const word of [
        'ghcr.io',
        'docker.io',
        'super-secret',
        'portfolio-api',
        '192.0.2.',
        'homelab',
      ]) {
        assert.ok(!json.includes(word), `${word} leaked`);
      }
    }
  });

  it('skips malformed objects instead of failing the whole snapshot', () => {
    const snapshot = serializeSnapshot(
      {
        deployments: [null, 'text', { metadata: {} }, deployment('api')],
        statefulSets: [],
        pods: [42],
      },
      { namespace: NAMESPACE, now: NOW },
    );
    assert.equal(snapshot.components.find(({ id }) => id === 'api')?.health, 'healthy');
  });
});

describe('health and failure rules', () => {
  const health = (status: object, replicas = 2, pods: unknown[] = []) => {
    const snapshot = serializeSnapshot(
      { deployments: [deployment('api', { replicas, status })], statefulSets: [], pods },
      { namespace: NAMESPACE, now: NOW },
    );
    const api = snapshot.components.find(({ id }) => id === 'api');
    assert.ok(api);
    return api;
  };
  const counts = { observedGeneration: 3, replicas: 2, updatedReplicas: 2 };

  it('reads healthy, degraded, down, and progressing from replica counts', () => {
    assert.equal(health({ ...counts, readyReplicas: 2, availableReplicas: 2 }).health, 'healthy');
    assert.equal(health({ ...counts, readyReplicas: 1, availableReplicas: 1 }).health, 'degraded');
    assert.equal(health({ ...counts, readyReplicas: 0 }).health, 'down');
    assert.equal(health({ ...counts, readyReplicas: 2 }, 0).health, 'down', 'scaled to zero');
    assert.equal(
      health({ ...counts, updatedReplicas: 1, readyReplicas: 2 }).health,
      'progressing',
      'not every replica updated yet',
    );
    assert.equal(
      health({ ...counts, observedGeneration: 2, readyReplicas: 2 }).health,
      'progressing',
      'the controller has not seen the new spec',
    );
    assert.equal(
      health({ ...counts, replicas: 3, readyReplicas: 2 }).health,
      'progressing',
      'old replicas still running',
    );
  });

  it('reports the most telling coarse failure from the pods, and none when healthy', () => {
    const waiting = (reason: string) =>
      pod('api', { containerStatuses: [{ ready: false, state: { waiting: { reason } } }] });
    const down = { ...counts, readyReplicas: 0 };
    assert.equal(health(down, 2, [waiting('CrashLoopBackOff')]).failure, 'crash-loop');
    assert.equal(health(down, 2, [waiting('ImagePullBackOff')]).failure, 'image-pull');
    assert.equal(
      health(down, 2, [pod('api', { conditions: [{ type: 'PodScheduled', status: 'False' }] })])
        .failure,
      'unschedulable',
    );
    assert.equal(health(down, 2, [waiting('ContainerCreating')]).failure, 'not-ready');
    assert.equal(
      health(down, 2, [waiting('ContainerCreating'), waiting('CrashLoopBackOff')]).failure,
      'crash-loop',
    );
    assert.equal(
      health({ ...counts, readyReplicas: 2 }, 2, [waiting('CrashLoopBackOff')]).failure,
      null,
    );
  });

  it('ignores finished pods, reads init containers, and reports no failure when scaled to zero', () => {
    const down = { ...counts, readyReplicas: 0 };
    const evicted = pod('api', {
      phase: 'Failed',
      containerStatuses: [{ ready: false, state: { waiting: { reason: 'CrashLoopBackOff' } } }],
    });
    const initCrash = pod('api', {
      phase: 'Pending',
      initContainerStatuses: [{ ready: false, state: { waiting: { reason: 'CrashLoopBackOff' } } }],
      containerStatuses: [{ ready: false, state: { waiting: { reason: 'PodInitializing' } } }],
    });
    assert.equal(health(down, 2, [evicted]).failure, null, 'an evicted pod is history');
    const running = pod('api', {
      phase: 'Running',
      containerStatuses: [{ ready: false, state: {} }],
    });
    const terminating = {
      ...running,
      metadata: { ...running.metadata, deletionTimestamp: NOW.toISOString() },
    };
    assert.equal(health(down, 2, [terminating]).failure, null, 'a terminating pod is going away');
    assert.equal(health(down, 2, [initCrash]).failure, 'crash-loop');
    const off = health({ ...counts, readyReplicas: 0 }, 0, [initCrash]);
    assert.deepEqual([off.health, off.failure], ['down', null], 'scaled to zero on purpose');
  });

  it('keeps only the tag, or a short digest, of an image', () => {
    assert.equal(imageVersion('docker.io/library/postgres:17-alpine'), '17-alpine');
    assert.equal(
      imageVersion(`ghcr.io/a/b@sha256:${'0123456789abcdef'.repeat(4)}`),
      'sha256:0123456',
    );
    assert.equal(imageVersion('registry.local:5000/team/app:v1.2.3'), 'v1.2.3');
    assert.equal(imageVersion('registry.local:5000/team/app'), null, 'a port is not a tag');
    assert.equal(imageVersion('postgres'), null);
    assert.equal(imageVersion('app@md5:abc'), null);
  });
});

class FakeReader implements ClusterReader {
  calls = 0;
  failing = false;
  private release: (() => void) | null = null;
  gate: Promise<void> | null = null;

  hold(): void {
    this.gate = new Promise((resolve) => {
      this.release = resolve;
    });
  }

  open(): void {
    this.release?.();
    this.gate = null;
  }

  async read(): Promise<ClusterObjects> {
    this.calls += 1;
    if (this.gate !== null) await this.gate;
    if (this.failing) throw new ClusterReadError('network');
    return steadyCluster();
  }
}

describe('InfrastructureSnapshotService', () => {
  const setup = () => {
    const clock = { now: NOW.getTime() };
    const reader = new FakeReader();
    const service = new InfrastructureSnapshotService(reader, {
      namespace: NAMESPACE,
      ttlMs: 12_000,
      now: () => clock.now,
    });
    return { clock, reader, service };
  };

  it('serves one read for 12 s, then reads again', async () => {
    const { clock, reader, service } = setup();
    const first = await service.snapshot();
    clock.now += 11_000;
    assert.equal(await service.snapshot(), first);
    assert.equal(reader.calls, 1);
    clock.now += 2_000;
    const second = await service.snapshot();
    assert.equal(reader.calls, 2);
    assert.equal(second.generatedAt, new Date(clock.now).toISOString());
  });

  it('shares one read between concurrent requests', async () => {
    const { reader, service } = setup();
    reader.hold();
    const requests = [service.snapshot(), service.snapshot(), service.snapshot()];
    reader.open();
    const snapshots = await Promise.all(requests);
    assert.equal(reader.calls, 1);
    assert.ok(snapshots.every((snapshot) => snapshot === snapshots[0]));
  });

  it('falls back to the last snapshot on failure, and waits before retrying', async () => {
    const { clock, reader, service } = setup();
    const good = await service.snapshot();
    reader.failing = true;
    clock.now += 13_000;
    assert.equal(await service.snapshot(), good, 'the old snapshot, with its old generatedAt');
    clock.now += 5_000;
    assert.equal(await service.snapshot(), good);
    assert.equal(reader.calls, 2, 'no retry before the TTL has passed');
  });

  it('is unavailable when the first read fails', async () => {
    const { reader, service } = setup();
    reader.failing = true;
    await assert.rejects(service.snapshot(), { name: 'InfrastructureUnavailableError' });
  });
});

describe('GET /api/v1/infrastructure', () => {
  const start = (snapshots: SnapshotSource) =>
    createTestApp({
      controllers: [InfrastructureController],
      providers: [{ provide: INFRASTRUCTURE_SNAPSHOTS, useValue: snapshots }],
    });

  it('says the view is not enabled by default', async () => {
    const app = await start(new DisabledSnapshotSource());
    const response = await app.inject({ method: 'GET', url: '/api/v1/infrastructure' });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json<ApiErrorResponse>().error.code, 'infrastructure_disabled');
    await app.close();
  });

  it('returns the snapshot, never cached by intermediaries', async () => {
    const service = new InfrastructureSnapshotService(new FakeReader(), { namespace: NAMESPACE });
    const app = await start(service);
    const response = await app.inject({ method: 'GET', url: '/api/v1/infrastructure' });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['cache-control'], 'no-store');
    const body = response.json<InfrastructureSnapshot>();
    assert.equal(body.components.length, 8);
    assert.ok(!response.body.includes(SECRETS.nodeName));
    await app.close();
  });

  it('says the status is unavailable when the cluster cannot be read', async () => {
    const reader = new FakeReader();
    reader.failing = true;
    const app = await start(new InfrastructureSnapshotService(reader, { namespace: NAMESPACE }));
    const response = await app.inject({ method: 'GET', url: '/api/v1/infrastructure' });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json<ApiErrorResponse>().error.code, 'infrastructure_unavailable');
    await app.close();
  });
});

describe('KubernetesClusterReader (contract, fake API server)', () => {
  let server: Server;
  let baseUrl: string;
  const requests: { url: string; authorization: string | undefined }[] = [];
  let respond: (request: IncomingMessage) => {
    status: number;
    body: string;
    location?: string;
  } = () => ({ status: 200, body: '{"items":[]}' });

  before(async () => {
    server = createServer((request, response) => {
      requests.push({ url: request.url ?? '', authorization: request.headers.authorization });
      const { status, body, location } = respond(request);
      response.writeHead(status, {
        'content-type': 'application/json',
        ...(location === undefined ? {} : { location }),
      });
      response.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const reader = (maxResponseBytes?: number) =>
    new KubernetesClusterReader({
      apiServerUrl: baseUrl,
      namespace: NAMESPACE,
      readToken: async () => 'service-account-token',
      allowInsecureHttpForTests: true,
      ...(maxResponseBytes === undefined ? {} : { maxResponseBytes }),
    });
  const read = (instance = reader()) => instance.read(AbortSignal.timeout(2_000));

  it('lists deployments, statefulsets, and pods in its namespace, with the token', async () => {
    requests.length = 0;
    respond = (request) => ({
      status: 200,
      body: JSON.stringify({
        items: [{ kind: request.url?.includes('/pods') ? 'Pod' : 'Workload' }],
      }),
    });
    const objects = await read();
    assert.deepEqual(requests.map(({ url }) => url.split('?')[0]).sort(), [
      '/api/v1/namespaces/portfolio/pods',
      '/apis/apps/v1/namespaces/portfolio/deployments',
      '/apis/apps/v1/namespaces/portfolio/statefulsets',
    ]);
    for (const { url } of requests) {
      const query = new URL(`http://x${url}`).searchParams;
      assert.equal(
        query.get('labelSelector'),
        'app.kubernetes.io/component in (api,worker,postgres,redis,cloudflared)',
        `${url}: only the shown components`,
      );
      assert.equal(
        query.get('fieldSelector'),
        url.includes('/pods') ? 'status.phase!=Failed,status.phase!=Succeeded' : null,
        `${url}: finished pods filtered on the server`,
      );
    }
    assert.ok(
      requests.every(({ authorization }) => authorization === 'Bearer service-account-token'),
    );
    assert.deepEqual(objects.pods, [{ kind: 'Pod' }]);
    assert.equal(objects.deployments.length, 1);
  });

  it('refuses plain http unless a test opts in, since it always sends the token', () => {
    assert.throws(
      () => new KubernetesClusterReader({ apiServerUrl: baseUrl, namespace: NAMESPACE }),
      /https/,
    );
  });

  it('turns error statuses, bad bodies, oversized bodies, and redirects into typed failures', async () => {
    const cases: [ReturnType<typeof respond>, string, number | undefined][] = [
      [{ status: 403, body: '{"message":"forbidden: secret detail"}' }, 'status', undefined],
      [{ status: 200, body: 'not json' }, 'invalid_response', undefined],
      [{ status: 200, body: '{"kind":"Status"}' }, 'invalid_response', undefined],
      [
        { status: 200, body: JSON.stringify({ items: ['x'.repeat(5_000)] }) },
        'invalid_response',
        1_000,
      ],
      [{ status: 302, body: '', location: 'http://example.invalid/' }, 'status', undefined],
    ];
    for (const [reply, reason, limit] of cases) {
      respond = () => reply;
      await assert.rejects(read(reader(limit)), (error: unknown) => {
        assert.ok(error instanceof ClusterReadError);
        assert.equal(error.reason, reason, JSON.stringify(reply).slice(0, 60));
        assert.ok(!error.message.includes('secret detail'));
        return true;
      });
    }
  });
});

describe('infrastructure configuration', () => {
  const required = {
    DATABASE_URL: 'postgres://portfolio:local-only@localhost:5432/portfolio',
    REDIS_URL: 'redis://localhost:6379',
  };

  it('is off by default', () => {
    assert.deepEqual(loadApiConfig(required).infrastructure, { enabled: false });
  });

  it('reads the in-cluster API server address for the kubernetes source', () => {
    const config = loadApiConfig({
      ...required,
      INFRASTRUCTURE_SOURCE: 'kubernetes',
      KUBERNETES_SERVICE_HOST: '192.0.2.1',
      KUBERNETES_SERVICE_PORT: '443',
    });
    assert.deepEqual(config.infrastructure, {
      enabled: true,
      source: 'kubernetes',
      namespace: 'portfolio',
      apiServerUrl: 'https://192.0.2.1:443',
    });
    const ipv6 = loadApiConfig({
      ...required,
      INFRASTRUCTURE_SOURCE: 'kubernetes',
      KUBERNETES_SERVICE_HOST: '2001:db8::1',
      KUBERNETES_SERVICE_PORT: '443',
    });
    assert.equal(
      ipv6.infrastructure.enabled && ipv6.infrastructure.apiServerUrl,
      'https://[2001:db8::1]:443',
    );
  });

  it('rejects the kubernetes source outside a pod, and invalid namespaces', () => {
    assert.throws(
      () => loadApiConfig({ ...required, INFRASTRUCTURE_SOURCE: 'kubernetes' }),
      /KUBERNETES_SERVICE_HOST/,
    );
    assert.throws(
      () => loadApiConfig({ ...required, INFRASTRUCTURE_NAMESPACE: 'Not_A_Namespace' }),
      /INFRASTRUCTURE_NAMESPACE/,
    );
  });
});
