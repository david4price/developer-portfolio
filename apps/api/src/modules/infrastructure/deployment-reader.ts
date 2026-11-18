import type { InfrastructureSnapshot, InfrastructureSyncStatus } from '@portfolio/shared-types';

/** Only deployment facts that may leave the Argo CD boundary. */
export interface DeploymentStatus {
  readonly sync: InfrastructureSyncStatus;
  readonly release: InfrastructureSnapshot['release'];
}

/** Optional source; its failure must not hide the workload snapshot. */
export interface DeploymentReader {
  read(signal: AbortSignal): Promise<DeploymentStatus>;
}

export class DeploymentReadError extends Error {
  constructor(
    readonly reason: 'credentials' | 'network' | 'timeout' | 'status' | 'invalid_response',
    readonly status: number | null = null,
  ) {
    super('The deployment status could not be read');
    this.name = 'DeploymentReadError';
  }
}
