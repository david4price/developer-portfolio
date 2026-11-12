/**
 * Thrown by an adapter when a backing dependency (PostgreSQL, Redis, …) cannot be reached.
 * The exception filter renders it as `503 not_ready`, so clients can retry instead of treating
 * an outage as a server bug. Query and logic errors must not use this type.
 */
export class DependencyUnavailableError extends Error {
  constructor(
    readonly dependency: string,
    options?: ErrorOptions,
  ) {
    super(`${dependency} is unavailable`, options);
    this.name = 'DependencyUnavailableError';
  }
}
