import { Logger } from '@nestjs/common';
import type { InfrastructureSnapshot } from '@portfolio/shared-types';
import { type ClusterReader, ClusterReadError } from './cluster-reader.js';
import { serializeSnapshot } from './snapshot-serializer.js';

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
      const objects = await this.reader.read(AbortSignal.timeout(this.timeoutMs));
      const snapshot = serializeSnapshot(objects, {
        namespace: this.options.namespace,
        now: new Date(this.now()),
      });
      this.cached = { snapshot, at: this.now() };
      this.failedAt = null;
      return snapshot;
    } catch (error) {
      this.failedAt = this.now();
      // Only the typed reason and status: never a response body or anything from the cluster.
      this.logger.warn({
        message: 'Infrastructure snapshot refresh failed',
        reason: error instanceof ClusterReadError ? error.reason : 'unexpected',
        status: error instanceof ClusterReadError ? error.status : null,
        servingPrevious: this.cached !== null,
      });
      if (!(error instanceof ClusterReadError)) {
        this.logger.error(error instanceof Error ? error.stack : String(error));
      }
      return this.fallback();
    }
  }

  private fallback(): Promise<InfrastructureSnapshot> {
    return this.cached === null
      ? Promise.reject(new InfrastructureUnavailableError())
      : Promise.resolve(this.cached.snapshot);
  }
}
