/**
 * Raw objects from the cluster, exactly as the Kubernetes API returns them. They carry far more
 * than may ever be shown (pod IPs, node names, environment variables, annotations); only the
 * snapshot serializer reads them, and it keeps the allowlisted fields alone.
 */
export interface ClusterObjects {
  readonly deployments: readonly unknown[];
  readonly statefulSets: readonly unknown[];
  readonly pods: readonly unknown[];
}

/** Port for reading the portfolio's workloads from the cluster. */
export interface ClusterReader {
  read(signal: AbortSignal): Promise<ClusterObjects>;
}

/** Why a read failed. Safe to log: never the response body or anything from the cluster. */
/**
 * `credentials`: the mounted token or cluster CA couldn't be read (check the service account
 * mount), as opposed to `network` (the API server couldn't be reached or verified).
 */
export type ClusterReadFailure =
  'timeout' | 'network' | 'credentials' | 'status' | 'invalid_response';

export class ClusterReadError extends Error {
  constructor(
    readonly reason: ClusterReadFailure,
    readonly status: number | null = null,
  ) {
    super('The cluster could not be read');
    this.name = 'ClusterReadError';
  }
}
