import type {
  InfrastructureComponent,
  InfrastructureComponentId,
  InfrastructureHealth,
  InfrastructureSnapshot,
  TrafficLevel,
} from '@portfolio/shared-types';

/**
 * A snapshot older than this powers the map down: the server refreshes every 10–15 s, so missing
 * a few refreshes means the data can no longer be trusted.
 */
export const STALE_AFTER_MS = 60_000;

/** A release pinned this recently sends a burst along the delivery path. */
export const RECENT_RELEASE_MS = 15 * 60_000;

export type MapPower =
  | { readonly on: true; readonly snapshot: InfrastructureSnapshot }
  | { readonly on: false; readonly reason: 'unavailable' | 'stale' };

/** Whether the map can show the snapshot at all. Never shows "healthy" without fresh data. */
export function mapPower(snapshot: InfrastructureSnapshot | null, now: number): MapPower {
  if (snapshot === null) return { on: false, reason: 'unavailable' };
  const generatedAt = Date.parse(snapshot.generatedAt);
  if (!Number.isFinite(generatedAt) || now - generatedAt > STALE_AFTER_MS) {
    return { on: false, reason: 'stale' };
  }
  return { on: true, snapshot };
}

export interface MapNode {
  readonly id: InfrastructureComponentId;
  readonly label: string;
  readonly detail: string;
  readonly x: number;
  readonly y: number;
}

/** Fixed layout: the deployment's shape is known; only health and traffic come from data. */
export const MAP_NODES: readonly MapNode[] = [
  { id: 'web', label: 'Website', detail: 'Cloudflare Pages', x: 130, y: 250 },
  { id: 'tunnel', label: 'Tunnel', detail: 'Cloudflare', x: 130, y: 400 },
  { id: 'api', label: 'API', detail: 'NestJS', x: 350, y: 400 },
  { id: 'worker', label: 'Worker', detail: 'BullMQ', x: 790, y: 400 },
  { id: 'ai', label: 'AI model', detail: 'Home server GPU', x: 350, y: 590 },
  { id: 'postgres', label: 'PostgreSQL', detail: 'Database', x: 570, y: 590 },
  { id: 'redis', label: 'Redis', detail: 'Sessions and queues', x: 790, y: 590 },
  { id: 'argocd', label: 'Argo CD', detail: 'GitOps', x: 790, y: 100 },
];

/** The delivery path's stages before Argo CD; they have no health of their own. */
export const DELIVERY_STAGES = [
  { id: 'actions', label: 'GitHub Actions', x: 130, y: 100 },
  { id: 'ghcr', label: 'Container registry', x: 350, y: 100 },
  { id: 'pin', label: 'images.yaml pin', x: 570, y: 100 },
] as const;

/** The cluster's flux capacitor, where the build, deploy, and runtime lines meet. */
export const CORE = { x: 570, y: 260 } as const;
/** Where the core's runtime arm reaches the cluster workloads. */
export const CLUSTER_HUB = { x: 570, y: 400 } as const;

export interface RuntimeConduit {
  readonly from: InfrastructureComponentId;
  readonly to: InfrastructureComponentId;
}

/** Runtime connections; pulses travel from `from` to `to`. */
export const RUNTIME_CONDUITS: readonly RuntimeConduit[] = [
  { from: 'web', to: 'tunnel' },
  { from: 'tunnel', to: 'api' },
  { from: 'api', to: 'ai' },
  { from: 'api', to: 'postgres' },
  { from: 'api', to: 'redis' },
  { from: 'worker', to: 'redis' },
  { from: 'worker', to: 'postgres' },
];

const SEVERITY: Readonly<Record<InfrastructureHealth, number>> = {
  healthy: 0,
  progressing: 1,
  unknown: 2,
  degraded: 3,
  down: 4,
};

/** A conduit is only as healthy as the worse of its two ends. */
export function worseHealth(
  a: InfrastructureHealth,
  b: InfrastructureHealth,
): InfrastructureHealth {
  return SEVERITY[a] >= SEVERITY[b] ? a : b;
}

/** A component the snapshot doesn't mention is unknown, never assumed healthy. */
export function componentById(
  snapshot: InfrastructureSnapshot,
  id: InfrastructureComponentId,
): InfrastructureComponent {
  return (
    snapshot.components.find((component) => component.id === id) ?? {
      id,
      health: 'unknown',
      version: null,
      replicas: null,
      traffic: null,
      failure: null,
    }
  );
}

/**
 * A rollout is in progress while any component is progressing (the server reports that while
 * desired and ready replicas differ during an update). Too few ready replicas on a failing
 * component is a failure, shown by its health, not a rollout.
 */
export function rolloutInProgress(snapshot: InfrastructureSnapshot): boolean {
  return snapshot.components.some(({ health }) => health === 'progressing');
}

/**
 * The cluster core's state: `rollout` while a component is progressing (pulses run into the
 * junction), `deployed` when Argo CD reports the cluster synced (the tubes glow), `waiting` when it
 * is out of sync or unknown without a rollout (dim), and `off` without data.
 */
export type CoreState = 'off' | 'rollout' | 'deployed' | 'waiting';

export function coreState(snapshot: InfrastructureSnapshot | null): CoreState {
  if (snapshot === null) return 'off';
  if (rolloutInProgress(snapshot)) return 'rollout';
  return snapshot.sync === 'synced' ? 'deployed' : 'waiting';
}

export const CORE_STATE_LABELS: Readonly<Record<CoreState, string>> = {
  off: 'Offline',
  rollout: 'Rolling out',
  deployed: 'Deployed',
  waiting: 'Waiting to sync',
};

/** A release pinned recently enough to animate the delivery path. */
export function recentRelease(snapshot: InfrastructureSnapshot, now: number): boolean {
  if (snapshot.release === null) return false;
  const pinnedAt = Date.parse(snapshot.release.pinnedAt);
  return Number.isFinite(pinnedAt) && now - pinnedAt >= 0 && now - pinnedAt <= RECENT_RELEASE_MS;
}

/**
 * Pulse speed for a conduit: the busier end sets it. No traffic data means no pulse, because
 * nothing animates without a data source; a conduit to a down component carries none either.
 */
export function conduitTraffic(
  from: InfrastructureComponent,
  to: InfrastructureComponent,
): TrafficLevel | null {
  if (from.health === 'down' || to.health === 'down') return null;
  const levels: readonly TrafficLevel[] = ['idle', 'low', 'busy'];
  const known = [from.traffic, to.traffic].filter((level) => level !== null);
  if (known.length === 0) return null;
  return known.reduce((busiest, level) =>
    levels.indexOf(level) > levels.indexOf(busiest) ? level : busiest,
  );
}

export const HEALTH_LABELS: Readonly<Record<InfrastructureHealth, string>> = {
  healthy: 'Healthy',
  progressing: 'Rolling out',
  degraded: 'Degraded',
  down: 'Down',
  unknown: 'Unknown',
};

export const FAILURE_LABELS: Readonly<
  Record<NonNullable<InfrastructureComponent['failure']>, string>
> = {
  'crash-loop': 'restarting repeatedly',
  'image-pull': 'image not pulled',
  unschedulable: 'cannot be scheduled',
  'not-ready': 'not ready',
  unreachable: 'unreachable',
};

/** Health and ready replicas, as short text for a map node. */
export function componentHealthText(component: InfrastructureComponent): string {
  const health = HEALTH_LABELS[component.health];
  return component.replicas === null
    ? health
    : `${health}, ${component.replicas.ready}/${component.replicas.desired} ready`;
}

/** One line of plain text per component, so status never depends on colour alone. */
export function componentStatus(component: InfrastructureComponent): string {
  const health = componentHealthText(component);
  return component.failure === null ? health : `${health}, ${FAILURE_LABELS[component.failure]}`;
}

/** Each building, seen from above, has this many windows (columns × rows). */
export const WINDOW_COLUMNS = 8;
export const WINDOW_ROWS = 3;

/**
 * `lit`: running. `flicker`: lit but unsteady (degraded). `waking`: about to light while a rollout
 * brings replicas up. `dark`: nothing running there, or no data.
 */
export type WindowState = 'lit' | 'flicker' | 'waking' | 'dark';

/**
 * Which windows are lit, from the component's health and ready replicas: all of them when every
 * replica is ready, a share of them when only some are, a dimmer and flickering share when
 * degraded, none when down, unknown, or without data. Windows light in a fixed scattered order,
 * so the same data always draws the same building.
 */
export function windowStates(component: InfrastructureComponent | null): readonly WindowState[] {
  const total = WINDOW_COLUMNS * WINDOW_ROWS;
  const share =
    component === null || component.replicas === null
      ? 1
      : component.replicas.desired > 0
        ? component.replicas.ready / component.replicas.desired
        : 0;
  const health = component?.health ?? 'unknown';
  const litCount =
    health === 'healthy' || health === 'progressing'
      ? Math.round(total * share)
      : health === 'degraded'
        ? Math.round(total * share * 0.6)
        : 0;
  return Array.from({ length: total }, (_, index): WindowState => {
    // 11 and 24 share no factor, so this visits every window once, in a scattered order.
    const rank = (index * 11) % total;
    if (rank < litCount) return health === 'degraded' && rank % 3 === 0 ? 'flicker' : 'lit';
    return health === 'progressing' ? 'waking' : 'dark';
  });
}
