import type { DependencyState, ReadinessResponse } from '@portfolio/shared-types';

export const READINESS_CHECKS = Symbol('READINESS_CHECKS');

export interface ReadinessCheck {
  readonly name: string;
  /** Resolves when the dependency is usable; rejects otherwise. */
  check(): Promise<void>;
}

const CHECK_TIMEOUT_MS = 1_500;

async function probe(check: ReadinessCheck, timeoutMs: number): Promise<DependencyState> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
  });

  try {
    await Promise.race([check.check(), timeout]);
    return 'up';
  } catch {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}

/** Runs all checks concurrently; each is bounded by `timeoutMs` so readiness never hangs. */
export async function evaluateReadiness(
  checks: readonly ReadinessCheck[],
  timeoutMs = CHECK_TIMEOUT_MS,
): Promise<ReadinessResponse> {
  const states = await Promise.all(checks.map((check) => probe(check, timeoutMs)));
  const entries = checks.map((check, index) => [check.name, states[index] ?? 'down'] as const);

  return {
    status: states.every((state) => state === 'up') ? 'ready' : 'not_ready',
    checks: Object.fromEntries(entries),
  };
}
