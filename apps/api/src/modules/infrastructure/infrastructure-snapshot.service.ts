import { Logger } from '@nestjs/common';
import type { InfrastructureSnapshot } from '@portfolio/shared-types';
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
}

/**
 * Serves the Infrastructure Explorer's snapshot. Visitors never reach the cluster directly: a
 * snapshot is reused for `ttlMs`, concurrent requests share one read, and a failed read is not
 * retried before `ttlMs` has passed. After a failure the last good snapshot is served as it was;
 * its `generatedAt` lets the page power the map down once it is too old.
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
      const [objects, deployment] = await Promise.all([
        this.reader.read(signal),
        this.readDeployment(signal),
      ]);
      const workloads = serializeSnapshot(objects, {
        namespace: this.options.namespace,
        now: new Date(this.now()),
      });
      const snapshot =
        deployment === null
          ? workloads
          : {
              ...workloads,
              ...deployment,
              components: workloads.components.map((component) =>
                component.id === 'argocd'
                  ? {
                      ...component,
                      health: 'healthy' as const,
                    }
                  : component,
              ),
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
