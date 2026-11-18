import type {
  InfrastructureComponent,
  InfrastructureComponentId,
  InfrastructureHealth,
  InfrastructureSnapshot,
  TrafficLevel,
} from '@portfolio/shared-types';
import {
  CLUSTER_HUB,
  componentById,
  componentHealthText,
  conduitTraffic,
  CORE,
  DELIVERY_STAGES,
  FAILURE_LABELS,
  MAP_NODES,
  type MapPower,
  recentRelease,
  rolloutInProgress,
  RUNTIME_CONDUITS,
  WINDOW_COLUMNS,
  WINDOW_ROWS,
  type WindowState,
  windowStates,
  worseHealth,
} from './map-model.ts';

const VIEW_WIDTH = 920;
const VIEW_HEIGHT = 710;
const BUILDING_WIDTH = 132;
const BUILDING_HEIGHT = 70;

interface Point {
  readonly x: number;
  readonly y: number;
}

type Tone = InfrastructureHealth | 'delivery' | 'off';

/**
 * A wire's route: straight when aligned, otherwise down, across, and down, with its bends. The
 * across part runs just above the lower building, clear of the labels under the upper one.
 */
function route(from: Point, to: Point): { path: string; bends: Point[] } {
  if (from.x === to.x || from.y === to.y) {
    return { path: `M ${from.x} ${from.y} L ${to.x} ${to.y}`, bends: [] };
  }
  const middle = to.y - BUILDING_HEIGHT / 2 - 28;
  return {
    path: `M ${from.x} ${from.y} V ${middle} H ${to.x} V ${to.y}`,
    bends: [
      { x: from.x, y: middle },
      { x: to.x, y: middle },
    ],
  };
}

interface WireProps {
  readonly from: Point;
  readonly to: Point;
  readonly tone: Tone;
  /** Spark speed; `null` draws the wire without current. */
  readonly traffic: TrafficLevel | null;
  readonly burst?: boolean;
  readonly straight?: boolean;
}

/** A power line: the wire, junction dots at its bends, and sparks travelling along it. */
function Wire({ from, to, tone, traffic, burst = false, straight = false }: WireProps) {
  const { path, bends } = straight
    ? { path: `M ${from.x} ${from.y} L ${to.x} ${to.y}`, bends: [] }
    : route(from, to);
  return (
    <g className={`explorer-conduit explorer-conduit--${tone}`}>
      <path className="explorer-conduit__tube" d={path} />
      {bends.map(({ x, y }) => (
        <circle key={`${x}-${y}`} className="explorer-conduit__joint" cx={x} cy={y} r={3.5} />
      ))}
      {traffic !== null && (
        <>
          <path
            className={`explorer-conduit__pulse explorer-conduit__pulse--${traffic}`}
            d={path}
          />
          <path
            className={`explorer-conduit__spark explorer-conduit__pulse--${traffic}`}
            d={path}
          />
        </>
      )}
      {burst && <path className="explorer-conduit__burst" d={path} />}
    </g>
  );
}

interface BuildingProps {
  readonly x: number;
  readonly y: number;
  readonly label: string;
  /** What the building is, under its name; omitted for the delivery stages. */
  readonly detail?: string;
  readonly status: string;
  /** A second status line, such as a failure reason. */
  readonly note?: string;
  readonly tone: Tone;
  readonly windows: readonly WindowState[];
  /** A red beacon on the roof: the component is down. */
  readonly beacon?: boolean;
}

/** Approximate widths of one monospace character at the label sizes, letter spacing included. */
const CHAR_WIDTH = { label: 7.8, detail: 6.4, status: 7.1, note: 6.4 } as const;

/** A building seen from above: roof, parapet, and windows lit by what runs inside. */
function Building({ x, y, label, detail, status, note, tone, windows, beacon }: BuildingProps) {
  const left = x - BUILDING_WIDTH / 2;
  const top = y - BUILDING_HEIGHT / 2;
  const pitchX = (BUILDING_WIDTH - 24) / WINDOW_COLUMNS;
  const pitchY = (BUILDING_HEIGHT - 22) / WINDOW_ROWS;
  // A plate in the paper's colour behind the label, so wires pass under it as on a schematic.
  const plateWidth =
    Math.max(
      label.length * CHAR_WIDTH.label,
      (detail ?? '').length * CHAR_WIDTH.detail,
      status.length * CHAR_WIDTH.status,
      (note ?? '').length * CHAR_WIDTH.note,
    ) + 14;
  const plateBottom = note !== undefined ? 61 : detail !== undefined ? 48 : 35;
  return (
    <g className={`explorer-node explorer-node--${tone}`}>
      <rect
        className="explorer-node__footprint"
        x={left}
        y={top}
        width={BUILDING_WIDTH}
        height={BUILDING_HEIGHT}
      />
      <rect
        className="explorer-node__roof"
        x={left + 5}
        y={top + 5}
        width={BUILDING_WIDTH - 10}
        height={BUILDING_HEIGHT - 10}
      />
      {windows.map((state, index) => {
        const column = index % WINDOW_COLUMNS;
        const row = Math.floor(index / WINDOW_COLUMNS);
        return (
          <rect
            key={index}
            className={`explorer-window explorer-window--${state}`}
            x={left + 12 + column * pitchX + 2}
            y={top + 11 + row * pitchY + 2}
            width={pitchX - 4}
            height={pitchY - 5}
          />
        );
      })}
      {beacon === true && (
        <circle
          className="explorer-node__beacon"
          cx={left + BUILDING_WIDTH - 9}
          cy={top + 9}
          r={4}
        />
      )}
      <rect
        className="explorer-node__plate"
        x={x - plateWidth / 2}
        y={top + BUILDING_HEIGHT + 4}
        width={plateWidth}
        height={plateBottom - 4}
      />
      <text x={x} y={top + BUILDING_HEIGHT + 16} className="explorer-node__label">
        {label}
      </text>
      {detail !== undefined && (
        <text x={x} y={top + BUILDING_HEIGHT + 29} className="explorer-node__detail">
          {detail}
        </text>
      )}
      <text
        x={x}
        y={top + BUILDING_HEIGHT + (detail === undefined ? 30 : 43)}
        className="explorer-node__status"
      >
        {status}
      </text>
      {note !== undefined && (
        <text x={x} y={top + BUILDING_HEIGHT + 56} className="explorer-node__note">
          {note}
        </text>
      )}
    </g>
  );
}

/** The substation where build, deploy, and runtime meet: a transformer that hums in a rollout. */
function Core({ state }: { readonly state: 'off' | 'steady' | 'rollout' }) {
  return (
    <g className={`explorer-core explorer-core--${state}`}>
      <rect
        className="explorer-core__yard"
        x={CORE.x - 46}
        y={CORE.y - 36}
        width={92}
        height={72}
      />
      <circle cx={CORE.x - 11} cy={CORE.y} r={20} className="explorer-core__ring" />
      <circle cx={CORE.x + 11} cy={CORE.y} r={20} className="explorer-core__ring" />
      <text x={CORE.x} y={CORE.y + 52} className="explorer-core__label">
        Substation
      </text>
    </g>
  );
}

interface TitleBlockProps {
  readonly snapshot: InfrastructureSnapshot | null;
  readonly now: number;
}

/** The drawing's title block: the release is its revision, the snapshot time its date. */
function TitleBlock({ snapshot, now }: TitleBlockProps) {
  const x = 24;
  const y = 572;
  const width = 196;
  const age =
    snapshot === null
      ? '—'
      : `${Math.max(0, Math.round((now - Date.parse(snapshot.generatedAt)) / 1_000))} s ago`;
  const rows: readonly [string, string][] = [
    ['Drawing', 'Portfolio grid'],
    ['Revision', snapshot?.release?.commit ?? '—'],
    ['GitOps', snapshot === null ? '—' : snapshot.sync],
    ['Updated', age],
  ];
  return (
    <g className="explorer-title">
      <rect x={x} y={y} width={width} height={rows.length * 24 + 8} />
      {rows.map(([name, value], index) => (
        <g key={name}>
          {index > 0 && (
            <line x1={x} x2={x + width} y1={y + 4 + index * 24} y2={y + 4 + index * 24} />
          )}
          <text x={x + 10} y={y + 21 + index * 24} className="explorer-title__name">
            {name}
          </text>
          <text x={x + 80} y={y + 21 + index * 24} className="explorer-title__value">
            {value}
          </text>
        </g>
      ))}
    </g>
  );
}

function summary(snapshot: InfrastructureSnapshot): string {
  const healthy = MAP_NODES.filter(
    ({ id }) => componentById(snapshot, id).health === 'healthy',
  ).length;
  return `Deployment map: ${healthy} of ${MAP_NODES.length} components healthy. Details follow in the table.`;
}

export interface ExplorerMapProps {
  readonly power: MapPower;
  readonly now: number;
}

/**
 * The deployment as a schematic of a power grid. Every light, colour, and spark comes from the
 * snapshot; without fresh data the grid powers down and says "unavailable" instead of showing the
 * last known state.
 */
export function ExplorerMap({ power, now }: ExplorerMapProps) {
  const snapshot = power.on ? power.snapshot : null;
  const component = (id: InfrastructureComponentId): InfrastructureComponent | null =>
    snapshot === null ? null : componentById(snapshot, id);
  const tone = (id: InfrastructureComponentId): Tone => component(id)?.health ?? 'off';
  const node = (id: InfrastructureComponentId) => {
    const found = MAP_NODES.find((candidate) => candidate.id === id);
    if (found === undefined) throw new Error(`no map node for ${id}`);
    return found;
  };
  const argocd = node('argocd');
  const ghcr = DELIVERY_STAGES[1];
  const burst = snapshot !== null && recentRelease(snapshot, now);
  const delivery: Tone = snapshot === null ? 'off' : 'delivery';
  const between = (a: InfrastructureComponentId, b: InfrastructureComponentId): Tone => {
    const first = component(a);
    const second = component(b);
    return first === null || second === null ? 'off' : worseHealth(first.health, second.health);
  };
  // Delivery stages have no health of their own: lit in a fixed pattern while there is data.
  const deliveryWindows: readonly WindowState[] = Array.from(
    { length: WINDOW_COLUMNS * WINDOW_ROWS },
    (_, index) => (snapshot !== null && index % 3 !== 1 ? 'lit' : 'dark'),
  );

  return (
    <svg
      className={`explorer-map${snapshot === null ? ' explorer-map--off' : ''}`}
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      role="img"
      aria-label={
        snapshot === null
          ? 'Deployment map, powered off: the cluster status is unavailable.'
          : summary(snapshot)
      }
    >
      <defs>
        <pattern id="explorer-grid-minor" width={20} height={20} patternUnits="userSpaceOnUse">
          <path className="explorer-map__grid-minor" d="M 20 0 L 0 0 0 20" />
        </pattern>
        <pattern id="explorer-grid-major" width={100} height={100} patternUnits="userSpaceOnUse">
          <rect width={100} height={100} fill="url(#explorer-grid-minor)" />
          <path className="explorer-map__grid-major" d="M 100 0 L 0 0 0 100" />
        </pattern>
        <filter id="explorer-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect className="explorer-map__panel" width={VIEW_WIDTH} height={VIEW_HEIGHT} rx={14} />
      <rect width={VIEW_WIDTH} height={VIEW_HEIGHT} rx={14} fill="url(#explorer-grid-major)" />
      <rect
        className="explorer-map__border"
        x={10}
        y={10}
        width={VIEW_WIDTH - 20}
        height={VIEW_HEIGHT - 20}
      />

      <g filter="url(#explorer-glow)">
        {DELIVERY_STAGES.map((stage, index) => (
          <Wire
            key={stage.id}
            from={stage}
            to={DELIVERY_STAGES[index + 1] ?? argocd}
            tone={delivery}
            traffic={null}
            burst={burst}
          />
        ))}
        <Wire from={ghcr} to={CORE} tone={delivery} traffic={null} burst={burst} straight />
        <Wire from={argocd} to={CORE} tone={tone('argocd')} traffic={null} burst={burst} straight />
        <Wire from={CORE} to={CLUSTER_HUB} tone={between('api', 'worker')} traffic={null} />
        <Wire from={CLUSTER_HUB} to={node('api')} tone={tone('api')} traffic={null} />
        <Wire from={CLUSTER_HUB} to={node('worker')} tone={tone('worker')} traffic={null} />
        {RUNTIME_CONDUITS.map(({ from, to }) => {
          const start = component(from);
          const end = component(to);
          return (
            <Wire
              key={`${from}-${to}`}
              from={node(from)}
              to={node(to)}
              tone={between(from, to)}
              traffic={start === null || end === null ? null : conduitTraffic(start, end)}
            />
          );
        })}
      </g>

      <Core
        state={snapshot === null ? 'off' : rolloutInProgress(snapshot) ? 'rollout' : 'steady'}
      />

      {DELIVERY_STAGES.map((stage) => (
        <Building
          key={stage.id}
          x={stage.x}
          y={stage.y}
          label={stage.label}
          status={
            snapshot === null
              ? 'No data'
              : stage.id === 'pin' && snapshot.release !== null
                ? `Release ${snapshot.release.commit}`
                : ''
          }
          tone={delivery}
          windows={deliveryWindows}
        />
      ))}
      {MAP_NODES.map(({ id, label, detail, x, y }) => {
        const current = component(id);
        return (
          <Building
            key={id}
            x={x}
            y={y}
            label={label}
            detail={detail}
            status={current === null ? 'No data' : componentHealthText(current)}
            note={current?.failure ? FAILURE_LABELS[current.failure] : undefined}
            tone={tone(id)}
            windows={windowStates(current)}
            beacon={current?.health === 'down'}
          />
        );
      })}

      <TitleBlock snapshot={snapshot} now={now} />

      {!power.on && (
        <g className="explorer-map__offline">
          <rect x={205} y={200} width={315} height={70} />
          <text x={362} y={230} className="explorer-map__offline-title">
            Unavailable
          </text>
          <text x={362} y={254} className="explorer-map__offline-reason">
            {power.reason === 'stale'
              ? 'Grid offline: status too old to trust'
              : 'Grid offline: status not loaded'}
          </text>
        </g>
      )}
    </svg>
  );
}
