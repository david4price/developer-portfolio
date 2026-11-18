import type {
  InfrastructureComponent,
  InfrastructureComponentId,
  InfrastructureHealth,
  InfrastructureSnapshot,
  TrafficLevel,
} from '@portfolio/shared-types';
import type { ReactNode } from 'react';
import type { CardId } from './card-content.ts';
import {
  componentById,
  componentHealthText,
  conduitTraffic,
  CORE_STATE_LABELS,
  type CoreState,
  coreState,
  DELIVERY_STAGES,
  FAILURE_LABELS,
  formatAge,
  layoutWires,
  MAP_NODES,
  type MapLayout,
  type MapPower,
  type PieceId,
  type Point,
  recentRelease,
  RUNTIME_CONDUITS,
  SYNC_LABELS,
  WIDE_LAYOUT,
  WINDOW_COLUMNS,
  WINDOW_ROWS,
  type WindowState,
  windowStates,
  worseHealth,
} from './map-model.ts';

const BUILDING_WIDTH = 132;
const BUILDING_HEIGHT = 70;

type Tone = InfrastructureHealth | 'delivery' | 'off';

interface WireProps {
  /** The route, from the source to the destination; sparks travel this way. */
  readonly points: readonly Point[];
  readonly tone: Tone;
  /** Spark speed; `null` draws the wire without current. */
  readonly traffic: TrafficLevel | null;
  readonly burst?: boolean;
}

/** A power line: the wire, junction dots at its bends, and sparks travelling along it. */
function Wire({ points, tone, traffic, burst = false }: WireProps) {
  const path = points.map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ');
  const bends = points.slice(1, -1);
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
  readonly at: Point;
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
  /** The layout's text scale: label lines and their plate grow with it. */
  readonly scale?: number;
}

/** Approximate widths of one monospace character at the label sizes, letter spacing included. */
const CHAR_WIDTH = { label: 7.8, detail: 6.4, status: 7.1, note: 6.4 } as const;

/** A building seen from above: roof, parapet, and windows lit by what runs inside. */
function Building({
  at: { x, y },
  label,
  detail,
  status,
  note,
  tone,
  windows,
  beacon,
  scale = 1,
}: BuildingProps) {
  const left = x - BUILDING_WIDTH / 2;
  const top = y - BUILDING_HEIGHT / 2;
  const below = top + BUILDING_HEIGHT;
  const pitchX = (BUILDING_WIDTH - 24) / WINDOW_COLUMNS;
  const pitchY = (BUILDING_HEIGHT - 22) / WINDOW_ROWS;
  // A plate in the paper's colour behind the label, so wires pass under it as on a schematic.
  const plateWidth =
    Math.max(
      label.length * CHAR_WIDTH.label,
      (detail ?? '').length * CHAR_WIDTH.detail,
      status.length * CHAR_WIDTH.status,
      (note ?? '').length * CHAR_WIDTH.note,
    ) *
      scale +
    14;
  const plateBottom = (note !== undefined ? 61 : detail !== undefined ? 48 : 35) * scale;
  const line = (offset: number) => below + offset * scale;
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
        y={below + 4}
        width={plateWidth}
        height={plateBottom - 4}
      />
      <text x={x} y={line(16)} className="explorer-node__label">
        {label}
      </text>
      {detail !== undefined && (
        <text x={x} y={line(29)} className="explorer-node__detail">
          {detail}
        </text>
      )}
      <text x={x} y={line(detail === undefined ? 30 : 43)} className="explorer-node__status">
        {status}
      </text>
      {note !== undefined && (
        <text x={x} y={line(56)} className="explorer-node__note">
          {note}
        </text>
      )}
    </g>
  );
}

/**
 * The cluster as a flux capacitor in its box: three glass tubes in a Y, each from a gold electrode
 * to the junction, behind a gasketed window. Its look comes from `coreState`: tubes glow when the
 * cluster is deployed, pulses run into the junction during a rollout, dim when waiting to sync,
 * dark without data. The label tape names the cluster and its state.
 */
interface CoreProps {
  readonly state: CoreState;
  readonly at: Point;
  /** Unique per drawing: the map's capacitor and a card's close-up each get their own filter. */
  readonly glowId: string;
}

function Core({ state, at: { x, y }, glowId }: CoreProps) {
  const junction = { x, y: y + 2 };
  const glow = `url(#${glowId})`;
  const lit = state === 'deployed' || state === 'rollout';
  const electrodes = [
    { x: x - 34, y: y - 28 },
    { x: x + 34, y: y - 28 },
    { x, y: y + 44 },
  ] as const;
  return (
    <g className={`explorer-core explorer-core--${state}`}>
      {/* The glow's region hugs the capacitor: blurring more of the drawing every frame is wasted
          work. It is in user space because a vertical tube's box has no width to size it by. */}
      <filter
        id={glowId}
        filterUnits="userSpaceOnUse"
        x={x - 80}
        y={y - 90}
        width={160}
        height={180}
      >
        <feGaussianBlur stdDeviation="4" result="wide" />
        <feGaussianBlur in="SourceGraphic" stdDeviation="1.5" result="near" />
        <feMerge>
          <feMergeNode in="wide" />
          <feMergeNode in="wide" />
          <feMergeNode in="near" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <rect className="explorer-core__box" x={x - 70} y={y - 78} width={140} height={156} rx={8} />
      <rect className="explorer-core__tape" x={x - 52} y={y - 70} width={104} height={14} />
      <text className="explorer-core__tape-text" x={x} y={y - 59.5}>
        K3s cluster
      </text>
      <rect
        className="explorer-core__window"
        x={x - 58}
        y={y - 50}
        width={116}
        height={116}
        rx={20}
      />
      {/* Yellow cables from the red caps on each electrode to the window's edge. */}
      <path
        className="explorer-core__cable"
        d={`M ${x - 42} ${y - 34} C ${x - 58} ${y - 28}, ${x - 54} ${y - 10}, ${x - 50} ${y + 2}`}
      />
      <path
        className="explorer-core__cable"
        d={`M ${x + 42} ${y - 34} C ${x + 58} ${y - 28}, ${x + 54} ${y - 10}, ${x + 50} ${y + 2}`}
      />
      <path
        className="explorer-core__cable"
        d={`M ${x + 9} ${y + 52} C ${x + 26} ${y + 54}, ${x + 36} ${y + 50}, ${x + 38} ${y + 40}`}
      />
      {electrodes.map((electrode) => (
        <g key={`${electrode.x}-${electrode.y}`}>
          <path
            className="explorer-core__tube"
            d={`M ${electrode.x} ${electrode.y} L ${junction.x} ${junction.y}`}
          />
          <path
            className="explorer-core__light"
            d={`M ${electrode.x} ${electrode.y} L ${junction.x} ${junction.y}`}
            filter={state === 'deployed' ? glow : undefined}
          />
          {state === 'rollout' && (
            <path
              className="explorer-core__pulse"
              d={`M ${electrode.x} ${electrode.y} L ${junction.x} ${junction.y}`}
              filter={glow}
            />
          )}
          <circle className="explorer-core__electrode" cx={electrode.x} cy={electrode.y} r={8} />
        </g>
      ))}
      <circle className="explorer-core__cap" cx={x - 42} cy={y - 34} r={4.5} />
      <circle className="explorer-core__cap" cx={x + 42} cy={y - 34} r={4.5} />
      <circle className="explorer-core__cap" cx={x + 9} cy={y + 52} r={4.5} />
      <circle
        className="explorer-core__junction"
        cx={junction.x}
        cy={junction.y}
        r={4}
        filter={lit ? glow : undefined}
      />
      <rect className="explorer-core__tape" x={x - 44} y={y + 66} width={88} height={11} />
      <text className="explorer-core__tape-text explorer-core__tape-text--small" x={x} y={y + 74.5}>
        {CORE_STATE_LABELS[state]}
      </text>
    </g>
  );
}

interface TitleBlockProps {
  readonly snapshot: InfrastructureSnapshot | null;
  readonly now: number;
  readonly at: Point;
}

/** The drawing's title block: the release is its revision, the snapshot time its date. */
function TitleBlock({ snapshot, now, at: { x, y } }: TitleBlockProps) {
  const width = 196;
  const rows: readonly [string, string][] = [
    ['Drawing', 'Portfolio grid'],
    ['Revision', snapshot?.release?.commit ?? '—'],
    ['GitOps', snapshot === null ? '—' : SYNC_LABELS[snapshot.sync]],
    ['Updated', snapshot === null ? '—' : formatAge(snapshot.generatedAt, now)],
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

interface SelectableProps {
  readonly label: string;
  readonly onSelect: (() => void) | undefined;
  readonly children: ReactNode;
}

/** Makes a piece of the map a button that opens its card, by click, Enter, or Space. */
function Selectable({ label, onSelect, children }: SelectableProps) {
  if (onSelect === undefined) return children;
  return (
    <g
      className="explorer-select"
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-haspopup="dialog"
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      {children}
    </g>
  );
}

/** Delivery stages have no health of their own: lit in a fixed pattern while there is data. */
function deliveryWindows(snapshot: InfrastructureSnapshot | null): readonly WindowState[] {
  return Array.from({ length: WINDOW_COLUMNS * WINDOW_ROWS }, (_, index) =>
    snapshot !== null && index % 3 !== 1 ? 'lit' : 'dark',
  );
}

/** How a component or delivery stage is drawn, from the snapshot (or `null` for no data). */
function buildingProps(
  id: PieceId,
  snapshot: InfrastructureSnapshot | null,
  layout: MapLayout,
): BuildingProps {
  const at = layout.pieces[id];
  const scale = layout.textScale;
  const stage = DELIVERY_STAGES.find((candidate) => candidate.id === id);
  if (stage !== undefined) {
    return {
      at,
      scale,
      label: stage.label,
      status:
        snapshot === null
          ? 'No data'
          : stage.id === 'pin' && snapshot.release !== null
            ? `Release ${snapshot.release.commit}`
            : '',
      tone: snapshot === null ? 'off' : 'delivery',
      windows: deliveryWindows(snapshot),
    };
  }
  const node = MAP_NODES.find((candidate) => candidate.id === id);
  if (node === undefined) throw new Error(`no map piece for ${id}`);
  const current = snapshot === null ? null : componentById(snapshot, node.id);
  return {
    at,
    scale,
    label: node.label,
    detail: node.detail,
    status: current === null ? 'No data' : componentHealthText(current),
    note: current?.failure ? FAILURE_LABELS[current.failure] : undefined,
    tone: current?.health ?? 'off',
    windows: windowStates(current),
    beacon: current?.health === 'down',
  };
}

const PIECE_IDS: readonly PieceId[] = [
  ...DELIVERY_STAGES.map(({ id }) => id),
  ...MAP_NODES.map(({ id }) => id),
];

/**
 * One piece of the map on its own, for the front of its card, drawn from the wide layout. It
 * reuses the map's filters, which stay in the page while a card is open.
 */
export function MapPiece({ id, power }: { readonly id: CardId; readonly power: MapPower }) {
  const snapshot = power.on ? power.snapshot : null;
  if (id === 'cluster') {
    const { core } = WIDE_LAYOUT;
    return (
      <svg
        className="explorer-map explorer-piece"
        viewBox={`${core.x - 80} ${core.y - 88} 160 176`}
        aria-hidden="true"
      >
        <Core state={coreState(snapshot)} at={core} glowId="explorer-piece-flux-glow" />
      </svg>
    );
  }
  const props = buildingProps(id, snapshot, WIDE_LAYOUT);
  return (
    <svg
      className="explorer-map explorer-piece"
      viewBox={`${props.at.x - 100} ${props.at.y - 50} 200 ${props.note === undefined ? 135 : 150}`}
      aria-hidden="true"
    >
      <Building {...props} />
    </svg>
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
  /** The arrangement: wide (landscape) by default, narrow (portrait) on phones. */
  readonly layout?: MapLayout;
  /** Opens a piece's card; without it, the map is a picture with no controls. */
  readonly onSelect?: (id: CardId) => void;
}

/**
 * The deployment as a schematic of a power grid. Every light, colour, and spark comes from the
 * snapshot; without fresh data the grid powers down and says "unavailable" instead of showing the
 * last known state.
 */
export function ExplorerMap({ power, now, layout = WIDE_LAYOUT, onSelect }: ExplorerMapProps) {
  const snapshot = power.on ? power.snapshot : null;
  const { core, width, height } = layout;
  const component = (id: InfrastructureComponentId): InfrastructureComponent | null =>
    snapshot === null ? null : componentById(snapshot, id);
  const tone = (id: InfrastructureComponentId): Tone => component(id)?.health ?? 'off';
  const between = (a: InfrastructureComponentId, b: InfrastructureComponentId): Tone => {
    const first = component(a);
    const second = component(b);
    return first === null || second === null ? 'off' : worseHealth(first.health, second.health);
  };
  const select = (id: CardId) => (onSelect === undefined ? undefined : () => onSelect(id));
  const burst = snapshot !== null && recentRelease(snapshot, now);
  const delivery: Tone = snapshot === null ? 'off' : 'delivery';
  const wires = layoutWires(layout);

  return (
    <svg
      className={`explorer-map explorer-map--${layout.name}${snapshot === null ? ' explorer-map--off' : ''}`}
      viewBox={`0 0 ${width} ${height}`}
      role="group"
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
      <rect className="explorer-map__panel" width={width} height={height} rx={14} />
      <rect width={width} height={height} rx={14} fill="url(#explorer-grid-major)" />
      <rect
        className="explorer-map__border"
        x={10}
        y={10}
        width={width - 20}
        height={height - 20}
      />

      <g filter="url(#explorer-glow)">
        {wires.delivery.map((points, index) => (
          <Wire key={index} points={points} tone={delivery} traffic={null} burst={burst} />
        ))}
        <Wire points={wires.buildArm} tone={delivery} traffic={null} burst={burst} />
        <Wire points={wires.deployArm} tone={tone('argocd')} traffic={null} burst={burst} />
        <Wire points={wires.coreHub} tone={between('api', 'worker')} traffic={null} />
        <Wire points={wires.hubApi} tone={tone('api')} traffic={null} />
        <Wire points={wires.hubWorker} tone={tone('worker')} traffic={null} />
        {RUNTIME_CONDUITS.map(({ key, from, to }) => {
          const start = component(from);
          const end = component(to);
          return (
            <Wire
              key={key}
              points={wires.runtime[key]}
              tone={between(from, to)}
              traffic={start === null || end === null ? null : conduitTraffic(start, end)}
            />
          );
        })}
      </g>

      <Selectable
        label={`K3s cluster: ${CORE_STATE_LABELS[coreState(snapshot)]}. Open details.`}
        onSelect={select('cluster')}
      >
        <Core state={coreState(snapshot)} at={core} glowId="explorer-map-flux-glow" />
      </Selectable>

      {PIECE_IDS.map((id) => {
        const props = buildingProps(id, snapshot, layout);
        const status = props.status === '' ? 'delivery stage' : props.status;
        return (
          <Selectable
            key={id}
            label={`${props.label}: ${status}. Open details.`}
            onSelect={select(id)}
          >
            <Building {...props} />
          </Selectable>
        );
      })}

      <TitleBlock snapshot={snapshot} now={now} at={layout.titleBlock} />

      {!power.on && (
        <g className="explorer-map__offline">
          <rect
            x={layout.offline.x}
            y={layout.offline.y}
            width={layout.offline.width}
            height={70}
          />
          <text
            x={layout.offline.x + layout.offline.width / 2}
            y={layout.offline.y + 30}
            className="explorer-map__offline-title"
          >
            Unavailable
          </text>
          <text
            x={layout.offline.x + layout.offline.width / 2}
            y={layout.offline.y + 54}
            className="explorer-map__offline-reason"
          >
            {power.reason === 'stale'
              ? 'Grid offline: status too old to trust'
              : 'Grid offline: status not loaded'}
          </text>
        </g>
      )}
    </svg>
  );
}
