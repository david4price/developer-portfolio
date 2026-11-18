import type {
  InfrastructureComponent,
  InfrastructureComponentId,
  InfrastructureFailure,
  InfrastructureHealth,
  InfrastructureSnapshot,
  ReplicaCounts,
} from '@portfolio/shared-types';
import { z } from 'zod';
import type { ClusterObjects } from './cluster-reader.js';

/**
 * The allowlist serializer (P6-02). Raw cluster objects are parsed with schemas that name only
 * the fields the snapshot needs; zod drops every other key, so IP addresses, node names,
 * environment variables, annotations, and anything added later never reach the response. Objects
 * from other namespaces, or without a known component label, are ignored.
 */

const COMPONENT_LABEL = 'app.kubernetes.io/component';

/** Chart component labels → map components. The chart calls the tunnel `cloudflared`. */
const COMPONENTS: Readonly<Record<string, InfrastructureComponentId>> = {
  api: 'api',
  worker: 'worker',
  postgres: 'postgres',
  redis: 'redis',
  cloudflared: 'tunnel',
};

/** Every component in the snapshot, in a fixed order; those not in the cluster stay unknown. */
const ALL_COMPONENTS: readonly InfrastructureComponentId[] = [
  'web',
  'tunnel',
  'api',
  'worker',
  'ai',
  'postgres',
  'redis',
  'argocd',
];

const count = z.number().int().nonnegative();

const metadataSchema = z.object({
  namespace: z.string(),
  generation: count.optional(),
  labels: z.record(z.string(), z.string()).optional(),
});

const workloadSchema = z.object({
  metadata: metadataSchema,
  spec: z.object({
    replicas: count.optional(),
    template: z.object({
      spec: z.object({ containers: z.array(z.object({ image: z.string() })).min(1) }),
    }),
  }),
  status: z
    .object({
      observedGeneration: count.optional(),
      replicas: count.optional(),
      readyReplicas: count.optional(),
      availableReplicas: count.optional(),
      updatedReplicas: count.optional(),
    })
    .optional(),
});

const containerStatusSchema = z.object({
  ready: z.boolean().optional(),
  state: z.object({ waiting: z.object({ reason: z.string().optional() }).optional() }).optional(),
});

const podSchema = z.object({
  metadata: metadataSchema,
  status: z
    .object({
      phase: z.string().optional(),
      conditions: z.array(z.object({ type: z.string(), status: z.string() })).optional(),
      initContainerStatuses: z.array(containerStatusSchema).optional(),
      containerStatuses: z.array(containerStatusSchema).optional(),
    })
    .optional(),
});

type Workload = z.infer<typeof workloadSchema>;
type Pod = z.infer<typeof podSchema>;

/** Parses each item on its own: one malformed object is skipped, not the whole snapshot. */
function parseAll<T>(items: readonly unknown[], schema: z.ZodType<T>): T[] {
  return items.flatMap((item) => {
    const parsed = schema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

function componentOf(
  metadata: z.infer<typeof metadataSchema>,
  namespace: string,
): InfrastructureComponentId | undefined {
  if (metadata.namespace !== namespace) return undefined;
  const label = metadata.labels?.[COMPONENT_LABEL];
  return label === undefined ? undefined : COMPONENTS[label];
}

/**
 * The image's version without its registry path: the tag, or a short digest for images pinned by
 * digest (`sha256:` and 7 hex characters). Anything unexpected becomes `null`.
 */
export function imageVersion(image: string): string | null {
  const at = image.indexOf('@');
  if (at >= 0) {
    const digest = /^sha256:([a-f0-9]{7})[a-f0-9]*$/.exec(image.slice(at + 1));
    return digest === null ? null : `sha256:${digest[1]}`;
  }
  const name = image.slice(image.lastIndexOf('/') + 1);
  const colon = name.indexOf(':');
  if (colon < 0) return null;
  const tag = name.slice(colon + 1);
  return /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(tag) ? tag : null;
}

const FAILURE_ORDER: readonly InfrastructureFailure[] = [
  'crash-loop',
  'image-pull',
  'unschedulable',
  'not-ready',
];

/**
 * The most telling coarse failure among a component's live pods; never their messages or events.
 * Finished pods (evicted, completed) are left out, and init containers count: a pod stuck in
 * `Init:CrashLoopBackOff` is crash-looping, not merely not ready.
 */
function podFailure(pods: readonly Pod[]): InfrastructureFailure | null {
  const found = new Set<InfrastructureFailure>();
  for (const pod of pods) {
    const status = pod.status;
    if (status?.phase === 'Failed' || status?.phase === 'Succeeded') continue;
    if (
      status?.conditions?.some(
        ({ type, status: value }) => type === 'PodScheduled' && value === 'False',
      )
    ) {
      found.add('unschedulable');
    }
    for (const container of [
      ...(status?.initContainerStatuses ?? []),
      ...(status?.containerStatuses ?? []),
    ]) {
      const reason = container.state?.waiting?.reason;
      if (reason === 'CrashLoopBackOff') found.add('crash-loop');
      else if (
        reason === 'ImagePullBackOff' ||
        reason === 'ErrImagePull' ||
        reason === 'InvalidImageName'
      ) {
        found.add('image-pull');
      } else if (container.ready === false) found.add('not-ready');
    }
  }
  return FAILURE_ORDER.find((failure) => found.has(failure)) ?? null;
}

/**
 * Health from replica counts: down with no replica ready, progressing while a rollout is under
 * way (the controller hasn't seen the latest spec, replicas aren't all updated yet, or old ones
 * remain), degraded with fewer ready than desired, healthy otherwise.
 */
function workloadHealth(workload: Workload): {
  health: InfrastructureHealth;
  replicas: ReplicaCounts;
} {
  const status = workload.status ?? {};
  const desired = workload.spec.replicas ?? 1;
  const replicas: ReplicaCounts = {
    desired,
    available: status.availableReplicas ?? 0,
    ready: status.readyReplicas ?? 0,
  };
  const synced = (status.observedGeneration ?? 0) >= (workload.metadata.generation ?? 0);
  const rolling =
    !synced || (status.updatedReplicas ?? 0) < desired || (status.replicas ?? 0) > desired;
  const health: InfrastructureHealth =
    desired === 0 || replicas.ready === 0
      ? 'down'
      : rolling
        ? 'progressing'
        : replicas.ready < desired
          ? 'degraded'
          : 'healthy';
  return { health, replicas };
}

const unknown = (id: InfrastructureComponentId): InfrastructureComponent => ({
  id,
  health: 'unknown',
  version: null,
  replicas: null,
  traffic: null,
  failure: null,
});

export interface SerializeOptions {
  /** The only namespace whose objects are read; everything else is ignored. */
  readonly namespace: string;
  readonly now: Date;
}

/**
 * The public snapshot from raw cluster objects. The website, the AI runtime, and Argo CD aren't
 * workloads in the namespace, so they stay `unknown` here; Argo CD's sync status and the latest
 * release come with its read-only token (P6-03), and request rates with metrics (P7-01).
 */
export function serializeSnapshot(
  objects: ClusterObjects,
  { namespace, now }: SerializeOptions,
): InfrastructureSnapshot {
  const workloads = new Map<InfrastructureComponentId, Workload>();
  for (const workload of parseAll(
    [...objects.deployments, ...objects.statefulSets],
    workloadSchema,
  )) {
    const id = componentOf(workload.metadata, namespace);
    if (id !== undefined && !workloads.has(id)) workloads.set(id, workload);
  }
  const pods = new Map<InfrastructureComponentId, Pod[]>();
  for (const pod of parseAll(objects.pods, podSchema)) {
    const id = componentOf(pod.metadata, namespace);
    if (id !== undefined) pods.set(id, [...(pods.get(id) ?? []), pod]);
  }

  const components = ALL_COMPONENTS.map((id): InfrastructureComponent => {
    const workload = workloads.get(id);
    if (workload === undefined) return unknown(id);
    const { health, replicas } = workloadHealth(workload);
    const image = workload.spec.template.spec.containers[0]?.image ?? '';
    return {
      id,
      health,
      version: imageVersion(image),
      replicas,
      traffic: null,
      // Healthy, or scaled to zero on purpose: there is no failure to report.
      failure:
        health === 'healthy' || replicas.desired === 0 ? null : podFailure(pods.get(id) ?? []),
    };
  });

  return { generatedAt: now.toISOString(), sync: 'unknown', release: null, components };
}
