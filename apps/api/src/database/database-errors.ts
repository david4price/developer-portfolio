import { DependencyUnavailableError } from '../common/dependency-unavailable.error.js';

/** Socket-level failures reported by Node while connecting to or talking with PostgreSQL. */
const NETWORK_ERROR_CODES: ReadonlySet<string> = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

/**
 * SQLSTATE codes meaning the server cannot serve us right now, as opposed to a bad query.
 * Class 08 (connection exception) is matched by prefix.
 */
const UNAVAILABLE_SQLSTATES: ReadonlySet<string> = new Set([
  '53300', // too_many_connections
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now (starting up or in recovery)
]);

/** `pg` and `pg-pool` report these without an error code. */
const UNAVAILABLE_MESSAGES: readonly string[] = [
  'timeout exceeded when trying to connect',
  'Connection terminated unexpectedly',
  'Connection terminated due to connection timeout',
];

const MAX_CAUSE_DEPTH = 5;

function readCode(error: Error): string | undefined {
  const code: unknown = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function isUnavailableSignal(error: Error): boolean {
  const code = readCode(error);
  if (code !== undefined) {
    if (NETWORK_ERROR_CODES.has(code) || UNAVAILABLE_SQLSTATES.has(code) || code.startsWith('08')) {
      return true;
    }
  }
  return UNAVAILABLE_MESSAGES.some((message) => error.message.startsWith(message));
}

/**
 * True when `error` (or anything in its cause chain, which Drizzle and `pg-pool` use to wrap
 * driver errors) means PostgreSQL is unreachable or refusing work.
 */
export function isDatabaseUnavailableError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current instanceof Error; depth += 1) {
    if (isUnavailableSignal(current)) {
      return true;
    }
    if (current instanceof AggregateError && current.errors.some(isDatabaseUnavailableError)) {
      return true;
    }
    current = current.cause;
  }
  return false;
}

/**
 * Runs a database operation, translating outages into `DependencyUnavailableError` so callers get
 * a retryable 503. Every other error propagates unchanged.
 */
export async function withDatabase<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      throw new DependencyUnavailableError('postgres', { cause: error });
    }
    throw error;
  }
}
