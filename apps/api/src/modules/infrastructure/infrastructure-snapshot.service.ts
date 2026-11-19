import { Logger } from '@nestjs/common';
import type { InfrastructureComponent, InfrastructureSnapshot } from '@portfolio/shared-types';
import { type AiStatus, AiUnavailableError } from '../ai/ai-provider.js';
import { type ClusterReader, ClusterReadError } from './cluster-reader.js';
import { serializeSnapshot } from './snapshot-serializer.js';
import type { TrafficLevels } from './traffic.js';
import {
  DeploymentReadError,
  type DeploymentReader,
  type DeploymentStatus,
} from './deployment-reader.js';

export const INFRASTRUCTURE_SNAPSHOTS = Symbol('INFRASTRUCTURE_SNAPSHOTS');

/** Port for the controller: where the public snapshot comes from. */
export interface SnapshotSource {
  snapshot(): Promise<InfrastructureSnapshot>;
}

/** The view is off on this deployment. Maps to `infrastructure_disabled`. */
export class InfrastructureDisabledError extends Error {
  constructor() {
    super('The infrastructure view is not enabled');
    this.name = 'InfrastructureDisabledError';
  }
}

/** The source when `INFRASTRUCTURE_SOURCE=disabled`: nothing reads the cluster. */
export class DisabledSnapshotSource implements SnapshotSource {
  snapshot(): Promise<InfrastructureSnapshot> {
    return Promise.reject(new InfrastructureDisabledError());
  }
}

/** How long a snapshot is served before the cluster is read again (the design's 10–15 s). */
export const SNAPSHOT_TTL_MS = 12_000;
/** Longest a cluster read may take before it counts as failed. */
export const CLUSTER_READ_TIMEOUT_MS = 5_000;

/** No snapshot could be built, and there is none to fall back to. Maps to `infrastructure_unavailable`. */
export class InfrastructureUnavailableError extends Error {
  constructor() {
    super('The infrastructure status is unavailable');
    this.name = 'InfrastructureUnavailableError';
  }
}

export interface SnapshotServiceOptions {
  readonly namespace: string;
  readonly ttlMs?: number;
  readonly timeoutMs?: number;
  readonly now?: () => number;
  readonly deploymentReader?: DeploymentReader;
  /** Asks the model runtime, outside the cluster; without it the AI building stays unknown. */
  readonly aiStatus?: (signal: AbortSignal) => Promise<AiStatus>;
  /** The AI check's own deadline; `AI_STATUS_TIMEOUT_MS` by default. */
  readonly aiTimeoutMs?: number;
  /** Bucketed request rates; without them (or with `null`) no line carries sparks. */
  readonly traffic?: (signal: AbortSignal) => Promise<TrafficLevels | null>;
}

/**
 * The AI probe's own deadline, well inside the cluster read's: a runtime that doesn't answer
 * (host asleep, packets dropped) must not hold every refresh for the full 5 s.
 */
export const AI_STATUS_TIMEOUT_MS = 1_500;

/** The AI building's state from the runtime's answer, or from not getting one. */
const AI_STATE: Readonly<
  Record<AiStatus | 'unreachable', Pick<InfrastructureComponent, 'health' | 'failure'>>
> = {
  ready: { health: 'healthy', failure: null },
  busy: { health: 'degraded', failure: null },
  missing: { health: 'down', failure: 'not-ready' },
  unreachable: { health: 'down', failure: 'unreachable' },
};

/**
 * Where each level shows: the API's requests on the API and on the tunnel every one of them
 * crosses (when the tunnel runs in the cluster), chat replies on a probed AI model. Nothing else
 * is measured, so it stays without traffic.
 */
const trafficFor =
  (levels: TrafficLevels) =>
  (component: InfrastructureComponent): InfrastructureComponent => {
    if (component.id === 'api') return { ...component, traffic: levels.api };
    if (component.id === 'tunnel' && component.replicas !== null) {
      return { ...component, traffic: levels.api };
    }
    if (component.id === 'ai' && component.health !== 'unknown') {
      return { ...component, traffic: levels.ai };
    }
    return component;
  };

/**
 * Serves the Infrastructure Explorer's snapshot. Visitors never reach the cluster directly: a
 * snapshot is reused for `ttlMs`, concurrent requests share one read, and a failed read is not
 * retried before `ttlMs` has passed. After a failure the last good snapshot is served as it was;
 * the endpoint adds its age on this server's clock (`ageSeconds`), and the page powers the map
 * down once that passes a minute.
 */
export class InfrastructureSnapshotService implements SnapshotSource {
  private readonly logger = new Logger('InfrastructureSnapshotService');
  private cached: { readonly snapshot: InfrastructureSnapshot; readonly at: number } | null = null;
  private failedAt: number | null = null;
  private inflight: Promise<InfrastructureSnapshot> | null = null;
  /** The last AI probe failure (reason and status), so an outage logs when it changes only. */
  private aiFailure: string | null = null;
  /** Whether the last traffic read failed, so a Redis outage logs once each way. */
  private trafficFailing = false;
  private readonly ttlMs: number;
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(
    private readonly reader: ClusterReader,
    private readonly options: SnapshotServiceOptions,
  ) {
    this.ttlMs = options.ttlMs ?? SNAPSHOT_TTL_MS;
    this.timeoutMs = options.timeoutMs ?? CLUSTER_READ_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
  }

  snapshot(): Promise<InfrastructureSnapshot> {
    const now = this.now();
    if (this.cached !== null && now - this.cached.at < this.ttlMs) {
      return Promise.resolve(this.cached.snapshot);
    }
    if (this.failedAt !== null && now - this.failedAt < this.ttlMs) return this.fallback();
    this.inflight ??= this.refresh().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async refresh(): Promise<InfrastructureSnapshot> {
    try {
      const signal = AbortSignal.timeout(this.timeoutMs);
      const [objects, deployment, ai, traffic] = await Promise.all([
        this.reader.read(signal),
        this.readDeployment(signal),
        this.readAi(signal),
        this.readTraffic(signal),
      ]);
      const workloads = serializeSnapshot(objects, {
        namespace: this.options.namespace,
        now: new Date(this.now()),
      });
      const components = workloads.components.map((component) => {
        if (component.id === 'argocd' && deployment !== null) {
          return { ...component, health: 'healthy' as const };
        }
        if (component.id === 'ai' && ai !== null) return { ...component, ...AI_STATE[ai] };
        return component;
      });
      const withTraffic = traffic === null ? components : components.map(trafficFor(traffic));
      const snapshot: InfrastructureSnapshot = {
        ...workloads,
        ...(deployment ?? {}),
        components: withTraffic,
      };
      this.cached = { snapshot, at: this.now() };
      this.failedAt = null;
      return snapshot;
    } catch (error) {
      this.failedAt = this.now();
      // Only the typed reason and status: never a response body or anything from the cluster.
      // An unexpected error is a bug here (the reader only throws ClusterReadError): its stack
      // goes in the same structured line, as the exception filter logs it.
      const read = error instanceof ClusterReadError ? error : null;
      this.logger.warn({
        message: 'Infrastructure snapshot refresh failed',
        reason: read?.reason ?? 'unexpected',
        status: read?.status ?? null,
        servingPrevious: this.cached !== null,
        ...(read === null && { error: error instanceof Error ? error.stack : 'non-error thrown' }),
      });
      return this.fallback();
    }
  }

  private fallback(): Promise<InfrastructureSnapshot> {
    return this.cached === null
      ? Promise.reject(new InfrastructureUnavailableError())
      : Promise.resolve(this.cached.snapshot);
  }

  /**
   * Never fails the snapshot: an unreachable runtime is drawn as down, not hidden. A failure is
   * logged when it starts or changes (always, with the stack, if it's a bug here), and the
   * recovery when it ends.
   */
  private async readAi(signal: AbortSignal): Promise<AiStatus | 'unreachable' | null> {
    if (this.options.aiStatus === undefined) return null;
    const deadline = this.options.aiTimeoutMs ?? AI_STATUS_TIMEOUT_MS;
    try {
      const status = await this.options.aiStatus(
        AbortSignal.any([signal, AbortSignal.timeout(deadline)]),
      );
      if (this.aiFailure !== null) this.logger.log({ message: 'AI runtime status readable again' });
      this.aiFailure = null;
      return status;
    } catch (error) {
      const failure = error instanceof AiUnavailableError ? error : null;
      const key = failure === null ? null : `${failure.reason}:${failure.upstreamStatus}`;
      if (key === null || key !== this.aiFailure) {
        this.logger.warn({
          message: 'AI runtime status refresh failed',
          reason: failure?.reason ?? 'unexpected',
          status: failure?.upstreamStatus ?? null,
          ...(failure === null && {
            error: error instanceof Error ? error.stack : 'non-error thrown',
          }),
        });
      }
      this.aiFailure = key ?? 'unexpected';
      return 'unreachable';
    }
  }

  /**
   * Never fails the snapshot: without levels the lines simply carry no sparks. A failure logs
   * when it starts and when it ends.
   */
  private async readTraffic(signal: AbortSignal): Promise<TrafficLevels | null> {
    if (this.options.traffic === undefined) return null;
    try {
      const levels = await this.options.traffic(signal);
      if (this.trafficFailing) this.logger.log({ message: 'Traffic levels readable again' });
      this.trafficFailing = false;
      return levels;
    } catch (error) {
      if (!this.trafficFailing) {
        this.logger.warn({
          message: 'Traffic levels refresh failed',
          error: error instanceof Error ? error.message : 'non-error thrown',
        });
      }
      this.trafficFailing = true;
      return null;
    }
  }

  private async readDeployment(signal: AbortSignal): Promise<DeploymentStatus | null> {
    if (this.options.deploymentReader === undefined) return null;
    try {
      return await this.options.deploymentReader.read(signal);
    } catch (error) {
      const failure = error instanceof DeploymentReadError ? error : null;
      this.logger.warn({
        message: 'Deployment status refresh failed',
        reason: failure?.reason ?? 'unexpected',
        status: failure?.status ?? null,
      });
      return null;
    }
  }
}
