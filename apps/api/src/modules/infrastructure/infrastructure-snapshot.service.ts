import { Logger } from '@nestjs/common';
import type { InfrastructureComponent, InfrastructureSnapshot } from '@portfolio/shared-types';
import { type AiStatus, AiStatusError, type AiStatusReader } from './ai-status.reader.js';
import { type ClusterReader, ClusterReadError } from './cluster-reader.js';
import { serializeSnapshot } from './snapshot-serializer.js';
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
  /** The model runtime, outside the cluster; without one the AI building stays unknown. */
  readonly aiStatusReader?: AiStatusReader;
}

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
      const [objects, deployment, ai] = await Promise.all([
        this.reader.read(signal),
        this.readDeployment(signal),
        this.readAi(signal),
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
      const snapshot: InfrastructureSnapshot = {
        ...workloads,
        ...(deployment ?? {}),
        components,
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

  /** Never fails the snapshot: an unreachable runtime is drawn as down, not hidden. */
  private async readAi(signal: AbortSignal): Promise<AiStatus | 'unreachable' | null> {
    if (this.options.aiStatusReader === undefined) return null;
    try {
      return await this.options.aiStatusReader.read(signal);
    } catch (error) {
      const failure = error instanceof AiStatusError ? error : null;
      this.logger.warn({
        message: 'AI runtime status refresh failed',
        reason: failure?.reason ?? 'unexpected',
        status: failure?.status ?? null,
      });
      return 'unreachable';
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
