import type {
  InfrastructureComponentId,
  InfrastructureHealth,
  InfrastructureSnapshot,
  TrafficLevel,
} from '@portfolio/shared-types';
import {
  CLUSTER_HUB,
  componentById,
  componentHealthText,
  FAILURE_LABELS,
  conduitTraffic,
  CORE,
  DELIVERY_STAGES,
  MAP_NODES,
  type MapPower,
  recentRelease,
  rolloutInProgress,
  RUNTIME_CONDUITS,
  worseHealth,
} from './map-model.ts';

const NODE_WIDTH = 168;
const NODE_HEIGHT = 84;

interface Point {
  readonly x: number;
  readonly y: number;
}

/** Straight when aligned, otherwise down, across, and down again, like a conduit on a board. */
function conduitPath(from: Point, to: Point): string {
  if (from.x === to.x || from.y === to.y) return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
  const middle = (from.y + to.y) / 2;
  return `M ${from.x} ${from.y} V ${middle} H ${to.x} V ${to.y}`;
}

type ConduitTone = InfrastructureHealth | 'delivery' | 'off';

interface ConduitProps {
  readonly path: string;
  readonly tone: ConduitTone;
  /** Pulse speed; `null` draws the conduit without pulses. */
  readonly traffic: TrafficLevel | null;
  readonly burst?: boolean;
}

function Conduit({ path, tone, traffic, burst = false }: ConduitProps) {
  return (
    <g className={`explorer-conduit explorer-conduit--${tone}`}>
      <path className="explorer-conduit__tube" d={path} />
      {traffic !== null && (
        <path className={`explorer-conduit__pulse explorer-conduit__pulse--${traffic}`} d={path} />
      )}
      {burst && <path className="explorer-conduit__burst" d={path} />}
    </g>
  );
}

interface NodeProps {
  readonly x: number;
  readonly y: number;
  readonly label: string;
  readonly detail: string;
  readonly status: string;
  /** A second status line, such as a failure reason. */
  readonly note?: string;
  readonly tone: ConduitTone;
}

function Node({ x, y, label, detail, status, note, tone }: NodeProps) {
  return (
    <g className={`explorer-node explorer-node--${tone}`}>
      <rect
        x={x - NODE_WIDTH / 2}
        y={y - NODE_HEIGHT / 2}
        width={NODE_WIDTH}
        height={NODE_HEIGHT}
        rx={12}
      />
      <text x={x} y={y - 18} className="explorer-node__label">
        {label}
      </text>
      <text x={x} y={y} className="explorer-node__detail">
        {detail}
      </text>
      <text x={x} y={y + 17} className="explorer-node__status">
        {status}
      </text>
      {note !== undefined && (
        <text x={x} y={y + 33} className="explorer-node__note">
          {note}
        </text>
      )}
    </g>
  );
}

/** The Y-shaped core where build, deploy, and runtime meet; it flickers during a rollout. */
function Core({ state }: { readonly state: 'off' | 'steady' | 'rollout' }) {
  return (
    <g className={`explorer-core explorer-core--${state}`}>
      <circle cx={CORE.x} cy={CORE.y} r={34} className="explorer-core__ring" />
      <path
        className="explorer-core__y"
        d={`M ${CORE.x - 18} ${CORE.y - 16} L ${CORE.x} ${CORE.y} L ${CORE.x + 18} ${CORE.y - 16} M ${CORE.x} ${CORE.y} L ${CORE.x} ${CORE.y + 22}`}
      />
      <circle cx={CORE.x} cy={CORE.y} r={6} className="explorer-core__heart" />
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
 * The deployment map. Every colour and animation comes from the snapshot; without fresh data the
 * whole map powers down and says "unavailable" instead of showing the last known state.
 */
export function ExplorerMap({ power, now }: ExplorerMapProps) {
  const snapshot = power.on ? power.snapshot : null;
  const health = (id: InfrastructureComponentId): ConduitTone =>
    snapshot === null ? 'off' : componentById(snapshot, id).health;
  const node = (id: InfrastructureComponentId) => {
    const found = MAP_NODES.find((candidate) => candidate.id === id);
    if (found === undefined) throw new Error(`no map node for ${id}`);
    return found;
  };
  const argocd = node('argocd');
  const ghcr = DELIVERY_STAGES[1];
  const burst = snapshot !== null && recentRelease(snapshot, now);
  const runtimeArm: ConduitTone =
    snapshot === null
      ? 'off'
      : worseHealth(
          componentById(snapshot, 'api').health,
          componentById(snapshot, 'worker').health,
        );

  return (
    <svg
      className={`explorer-map${snapshot === null ? ' explorer-map--off' : ''}`}
      viewBox="0 0 880 600"
      role="img"
      aria-label={
        snapshot === null
          ? 'Deployment map, powered off: the cluster status is unavailable.'
          : summary(snapshot)
      }
    >
      <defs>
        <filter id="explorer-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect className="explorer-map__panel" x={0} y={0} width={880} height={600} rx={18} />

      <g filter="url(#explorer-glow)">
        {DELIVERY_STAGES.map((stage, index) => {
          const next = DELIVERY_STAGES[index + 1] ?? argocd;
          return (
            <Conduit
              key={stage.id}
              path={conduitPath(stage, next)}
              tone={snapshot === null ? 'off' : 'delivery'}
              traffic={null}
              burst={burst}
            />
          );
        })}
        <Conduit
          path={`M ${ghcr.x} ${ghcr.y} L ${CORE.x} ${CORE.y}`}
          tone={snapshot === null ? 'off' : 'delivery'}
          traffic={null}
          burst={burst}
        />
        <Conduit
          path={`M ${argocd.x} ${argocd.y} L ${CORE.x} ${CORE.y}`}
          tone={health('argocd')}
          traffic={null}
          burst={burst}
        />
        <Conduit path={conduitPath(CORE, CLUSTER_HUB)} tone={runtimeArm} traffic={null} />
        <Conduit path={conduitPath(CLUSTER_HUB, node('api'))} tone={health('api')} traffic={null} />
        <Conduit
          path={conduitPath(CLUSTER_HUB, node('worker'))}
          tone={health('worker')}
          traffic={null}
        />
        {RUNTIME_CONDUITS.map(({ from, to }) => {
          const tone =
            snapshot === null
              ? 'off'
              : worseHealth(
                  componentById(snapshot, from).health,
                  componentById(snapshot, to).health,
                );
          const traffic =
            snapshot === null
              ? null
              : conduitTraffic(componentById(snapshot, from), componentById(snapshot, to));
          return (
            <Conduit
              key={`${from}-${to}`}
              path={conduitPath(node(from), node(to))}
              tone={tone}
              traffic={traffic}
            />
          );
        })}
      </g>

      <Core
        state={snapshot === null ? 'off' : rolloutInProgress(snapshot) ? 'rollout' : 'steady'}
      />

      {DELIVERY_STAGES.map((stage) => (
        <Node
          key={stage.id}
          x={stage.x}
          y={stage.y}
          label={stage.label}
          detail="Delivery"
          status={
            snapshot === null
              ? 'No data'
              : stage.id === 'pin' && snapshot.release !== null
                ? `Release ${snapshot.release.commit}`
                : ''
          }
          tone={snapshot === null ? 'off' : 'delivery'}
        />
      ))}
      {MAP_NODES.map(({ id, label, detail, x, y }) => {
        const component = snapshot === null ? null : componentById(snapshot, id);
        return (
          <Node
            key={id}
            x={x}
            y={y}
            label={label}
            detail={detail}
            status={component === null ? 'No data' : componentHealthText(component)}
            note={component?.failure ? FAILURE_LABELS[component.failure] : undefined}
            tone={health(id)}
          />
        );
      })}

      {!power.on && (
        <g className="explorer-map__offline">
          <rect x={250} y={268} width={380} height={64} rx={12} />
          <text x={440} y={298} className="explorer-map__offline-title">
            Unavailable
          </text>
          <text x={440} y={320} className="explorer-map__offline-reason">
            {power.reason === 'stale'
              ? 'The last status is too old to trust.'
              : 'The cluster status could not be loaded.'}
          </text>
        </g>
      )}
    </svg>
  );
}
