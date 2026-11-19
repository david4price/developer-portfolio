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

/** A GitOps revision deployed this recently sends a burst along the delivery path. */
export const RECENT_RELEASE_MS = 15 * 60_000;

export type MapPower =
  | { readonly on: true; readonly snapshot: InfrastructureSnapshot }
  | { readonly on: false; readonly reason: OffReason };

/** Why the map is powered down. */
export type OffReason = 'connecting' | 'disabled' | 'unavailable' | 'stale';

/** What the powered-down map and the text view say for each reason. */
export const OFF_REASONS: Readonly<
  Record<OffReason, { readonly title: string; readonly map: string; readonly text: string }>
> = {
  connecting: {
    title: 'Connecting',
    map: 'Reading the cluster…',
    text: 'connecting to the cluster…',
  },
  disabled: {
    title: 'Unavailable',
    map: 'Live view not enabled here',
    text: 'the live view is not enabled on this deployment.',
  },
  unavailable: {
    title: 'Unavailable',
    map: 'Grid offline: status not loaded',
    text: 'the cluster status could not be loaded.',
  },
  stale: {
    title: 'Unavailable',
    map: 'Grid offline: status too old to trust',
    text: 'the last snapshot is too old to trust.',
  },
};

/**
 * Whether the map can show the snapshot at all; it never shows "healthy" without fresh data.
 * Staleness is judged on the visitor's clock alone where it can be: the snapshot goes stale once
 * it was received too long ago (refreshes stopped). It is also stale if it was already old when it
 * arrived (the server kept serving an old snapshot), which compares the server's timestamp with
 * the receipt time and so only errs when the visitor's clock runs well ahead of the server's.
 */
export function mapPower(
  snapshot: InfrastructureSnapshot | null,
  now: number,
  receivedAt: number = now,
): MapPower {
  if (snapshot === null) return { on: false, reason: 'unavailable' };
  const generatedAt = Date.parse(snapshot.generatedAt);
  if (
    !Number.isFinite(generatedAt) ||
    now - receivedAt > STALE_AFTER_MS ||
    receivedAt - generatedAt > STALE_AFTER_MS
  ) {
    return { on: false, reason: 'stale' };
  }
  return { on: true, snapshot };
}

export interface MapNode {
  readonly id: InfrastructureComponentId;
  readonly label: string;
  readonly detail: string;
}

/** The deployment's components, in drawing order. Where they sit depends on the layout. */
export const MAP_NODES: readonly MapNode[] = [
  { id: 'web', label: 'Website', detail: 'Cloudflare Pages' },
  { id: 'tunnel', label: 'Tunnel', detail: 'Cloudflare' },
  { id: 'api', label: 'API', detail: 'NestJS' },
  { id: 'worker', label: 'Worker', detail: 'BullMQ' },
  { id: 'ai', label: 'AI model', detail: 'Home server GPU' },
  { id: 'postgres', label: 'PostgreSQL', detail: 'Database' },
  { id: 'redis', label: 'Redis', detail: 'Sessions and queues' },
  { id: 'argocd', label: 'Argo CD', detail: 'GitOps' },
];

/** The delivery path's stages before Argo CD, in order; they have no health of their own. */
export const DELIVERY_STAGES = [
  { id: 'actions', label: 'GitHub Actions' },
  { id: 'ghcr', label: 'Container registry' },
  { id: 'pin', label: 'images.yaml pin' },
] as const;

export type DeliveryStageId = (typeof DELIVERY_STAGES)[number]['id'];

/** Everything drawn as a building: components and delivery stages. */
export type PieceId = InfrastructureComponentId | DeliveryStageId;

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** The runtime wires; every layout must route each of them. */
export type ConduitKey =
  | 'web-tunnel'
  | 'tunnel-api'
  | 'api-ai'
  | 'api-postgres'
  | 'api-redis'
  | 'worker-redis'
  | 'worker-postgres';

export interface RuntimeConduit {
  readonly key: ConduitKey;
  readonly from: InfrastructureComponentId;
  readonly to: InfrastructureComponentId;
}

/** Runtime connections; pulses travel from `from` to `to`. */
export const RUNTIME_CONDUITS: readonly RuntimeConduit[] = [
  { key: 'web-tunnel', from: 'web', to: 'tunnel' },
  { key: 'tunnel-api', from: 'tunnel', to: 'api' },
  { key: 'api-ai', from: 'api', to: 'ai' },
  { key: 'api-postgres', from: 'api', to: 'postgres' },
  { key: 'api-redis', from: 'api', to: 'redis' },
  { key: 'worker-redis', from: 'worker', to: 'redis' },
  { key: 'worker-postgres', from: 'worker', to: 'postgres' },
];

/**
 * Where everything sits in one arrangement of the map. Each runtime wire has its own route, so no
 * two wires share a stretch (each shows its own health and sparks); crossings are fine.
 */
export interface MapLayout {
  readonly name: 'wide' | 'narrow';
  readonly width: number;
  readonly height: number;
  /** Labels are drawn this much larger, so they stay readable when a tall layout is scaled down. */
  readonly textScale: number;
  readonly pieces: Readonly<Record<PieceId, Point>>;
  /** The cluster's flux capacitor, and the hub where its runtime arm reaches API and worker. */
  readonly core: Point;
  readonly hub: Point;
  /** The capacitor's arms: build (from the container registry) and deploy (from Argo CD). */
  readonly buildArm: readonly Point[];
  readonly deployArm: readonly Point[];
  /**
   * Routes for runtime wires that bend, from the `from` building to the `to` building. A wire
   * without one runs straight between the two buildings, so it follows them when they move.
   */
  readonly routes: Readonly<Partial<Record<ConduitKey, readonly Point[]>>>;
  readonly titleBlock: Point;
  readonly offline: { readonly x: number; readonly y: number; readonly width: number };
}

/** Every wire a layout draws, by role; the map draws these and the tests check these. */
export interface LayoutWires {
  /** The delivery path, stage to stage: actions → registry → pin → Argo CD. */
  readonly delivery: readonly (readonly Point[])[];
  readonly buildArm: readonly Point[];
  readonly deployArm: readonly Point[];
  readonly coreHub: readonly Point[];
  readonly hubApi: readonly Point[];
  readonly hubWorker: readonly Point[];
  readonly runtime: Readonly<Record<ConduitKey, readonly Point[]>>;
}

export function layoutWires(layout: MapLayout): LayoutWires {
  const { pieces, core, hub } = layout;
  const chain = [...DELIVERY_STAGES.map(({ id }) => pieces[id]), pieces.argocd];
  const runtime = {} as Record<ConduitKey, readonly Point[]>;
  for (const { key, from, to } of RUNTIME_CONDUITS) {
    runtime[key] = layout.routes[key] ?? [pieces[from], pieces[to]];
  }
  return {
    delivery: chain.slice(1).map((point, index) => [chain[index] ?? point, point]),
    buildArm: layout.buildArm,
    deployArm: layout.deployArm,
    coreHub: [core, hub],
    hubApi: [hub, pieces.api],
    hubWorker: [hub, pieces.worker],
    runtime,
  };
}

/** Landscape: delivery across the top, the capacitor in the middle, runtime below. */
export const WIDE_LAYOUT: MapLayout = {
  name: 'wide',
  width: 920,
  height: 710,
  textScale: 1,
  pieces: {
    actions: { x: 130, y: 100 },
    ghcr: { x: 350, y: 100 },
    pin: { x: 570, y: 100 },
    argocd: { x: 790, y: 100 },
    web: { x: 130, y: 250 },
    tunnel: { x: 130, y: 400 },
    api: { x: 350, y: 400 },
    worker: { x: 790, y: 400 },
    ai: { x: 350, y: 590 },
    postgres: { x: 570, y: 590 },
    redis: { x: 790, y: 590 },
  },
  core: { x: 570, y: 260 },
  hub: { x: 570, y: 400 },
  buildArm: [
    { x: 350, y: 100 },
    { x: 570, y: 260 },
  ],
  deployArm: [
    { x: 790, y: 100 },
    { x: 570, y: 260 },
  ],
  routes: {
    'api-postgres': [
      { x: 375, y: 400 },
      { x: 375, y: 512 },
      { x: 545, y: 512 },
      { x: 545, y: 590 },
    ],
    'api-redis': [
      { x: 395, y: 400 },
      { x: 395, y: 527 },
      { x: 812, y: 527 },
      { x: 812, y: 590 },
    ],
    'worker-postgres': [
      { x: 760, y: 400 },
      { x: 760, y: 542 },
      { x: 595, y: 542 },
      { x: 595, y: 590 },
    ],
  },
  titleBlock: { x: 24, y: 572 },
  offline: { x: 205, y: 200, width: 315 },
};

/**
 * Portrait, for phones: two columns read top to bottom (delivery, the capacitor, then runtime),
 * with wires to the far buildings running down the outer margins and the middle gutter.
 */
export const NARROW_LAYOUT: MapLayout = {
  name: 'narrow',
  width: 450,
  height: 1250,
  textScale: 1.2,
  pieces: {
    actions: { x: 115, y: 80 },
    ghcr: { x: 325, y: 80 },
    pin: { x: 325, y: 235 },
    argocd: { x: 115, y: 235 },
    api: { x: 115, y: 590 },
    worker: { x: 325, y: 590 },
    tunnel: { x: 115, y: 770 },
    redis: { x: 325, y: 770 },
    web: { x: 115, y: 950 },
    postgres: { x: 325, y: 950 },
    ai: { x: 115, y: 1125 },
  },
  core: { x: 220, y: 420 },
  hub: { x: 220, y: 590 },
  // The build arm runs from the registry down the right margin, around the pin, into the box.
  buildArm: [
    { x: 325, y: 80 },
    { x: 420, y: 80 },
    { x: 420, y: 322 },
    { x: 270, y: 322 },
    { x: 220, y: 420 },
  ],
  deployArm: [
    { x: 115, y: 235 },
    { x: 220, y: 420 },
  ],
  routes: {
    'api-ai': [
      { x: 115, y: 590 },
      { x: 26, y: 590 },
      { x: 26, y: 1125 },
      { x: 115, y: 1125 },
    ],
    'api-postgres': [
      { x: 175, y: 590 },
      { x: 175, y: 705 },
      { x: 220, y: 705 },
      { x: 220, y: 950 },
      { x: 325, y: 950 },
    ],
    'api-redis': [
      { x: 150, y: 590 },
      { x: 150, y: 690 },
      { x: 290, y: 690 },
      { x: 290, y: 770 },
    ],
    // Down the right margin, midway between the buildings (edge at 391) and the frame (440).
    'worker-postgres': [
      { x: 325, y: 590 },
      { x: 416, y: 590 },
      { x: 416, y: 950 },
      { x: 325, y: 950 },
    ],
  },
  titleBlock: { x: 240, y: 1095 },
  offline: { x: 30, y: 505, width: 390 },
};

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

/** A GitOps revision deployed recently enough to animate the delivery path. */
export function recentRelease(snapshot: InfrastructureSnapshot, now: number): boolean {
  if (snapshot.release === null) return false;
  const pinnedAt = Date.parse(snapshot.release.pinnedAt);
  return Number.isFinite(pinnedAt) && now - pinnedAt >= 0 && now - pinnedAt <= RECENT_RELEASE_MS;
}

/**
 * Pulse speed for a conduit: what arrives at its far end (`to`) when that is measured, so the
 * line into the AI model runs at the chat's rate, not the whole API's; otherwise what leaves
 * its near end. No traffic data means no pulse, because nothing animates without a data
 * source; a conduit to a down component carries none either.
 */
export function conduitTraffic(
  from: InfrastructureComponent,
  to: InfrastructureComponent,
): TrafficLevel | null {
  if (from.health === 'down' || to.health === 'down') return null;
  return to.traffic ?? from.traffic;
}

export const SYNC_LABELS: Readonly<Record<InfrastructureSnapshot['sync'], string>> = {
  synced: 'Synced',
  'out-of-sync': 'Out of sync',
  unknown: 'Unknown',
};

/** How long ago `time` was, for every view: seconds, then minutes, then hours. */
export function formatAge(time: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(time)) / 1_000));
  if (!Number.isFinite(seconds)) return 'unknown';
  if (seconds < 120) return `${seconds} s ago`;
  const minutes = Math.round(seconds / 60);
  return minutes < 120 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`;
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
