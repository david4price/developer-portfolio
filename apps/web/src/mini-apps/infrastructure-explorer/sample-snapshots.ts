import type { InfrastructureComponent, InfrastructureSnapshot } from '@portfolio/shared-types';

/**
 * Sample data for the prototype, in the exact shape the API will return (P6-02), so live data can
 * replace it without layout changes. Versions and commits are made up.
 */
export const SAMPLE_SCENARIOS = ['steady', 'rollout', 'degraded', 'offline', 'stale'] as const;
export type SampleScenario = (typeof SAMPLE_SCENARIOS)[number];

export const SCENARIO_LABELS: Readonly<Record<SampleScenario, string>> = {
  steady: 'Steady',
  rollout: 'Rollout in progress',
  degraded: 'Redis down',
  offline: 'API offline',
  stale: 'Stale data',
};

const VERSION = 'a1b2c3d';
const NEXT_VERSION = 'e4f5a6b';

const steadyComponents: readonly InfrastructureComponent[] = [
  { id: 'web', health: 'healthy', version: null, replicas: null, traffic: 'low', failure: null },
  { id: 'tunnel', health: 'healthy', version: null, replicas: null, traffic: 'low', failure: null },
  {
    id: 'api',
    health: 'healthy',
    version: VERSION,
    replicas: { desired: 1, available: 1, ready: 1 },
    traffic: 'low',
    failure: null,
  },
  {
    id: 'worker',
    health: 'healthy',
    version: VERSION,
    replicas: { desired: 1, available: 1, ready: 1 },
    traffic: 'idle',
    failure: null,
  },
  { id: 'ai', health: 'healthy', version: null, replicas: null, traffic: 'idle', failure: null },
  {
    id: 'postgres',
    health: 'healthy',
    version: '17',
    replicas: { desired: 1, available: 1, ready: 1 },
    traffic: 'low',
    failure: null,
  },
  {
    id: 'redis',
    health: 'healthy',
    version: '8',
    replicas: { desired: 1, available: 1, ready: 1 },
    traffic: 'busy',
    failure: null,
  },
  { id: 'argocd', health: 'healthy', version: null, replicas: null, traffic: null, failure: null },
];

function withChanges(
  changes: Partial<Record<InfrastructureComponent['id'], Partial<InfrastructureComponent>>>,
): readonly InfrastructureComponent[] {
  return steadyComponents.map((component) => ({ ...component, ...changes[component.id] }));
}

const iso = (time: number) => new Date(time).toISOString();

/** The sample snapshot for a scenario at `now`, or `null` when the API can't be reached. */
export function sampleSnapshot(
  scenario: SampleScenario,
  now: number,
): InfrastructureSnapshot | null {
  const fresh = { generatedAt: iso(now - 4_000), sync: 'synced' as const };
  switch (scenario) {
    case 'steady':
      return {
        ...fresh,
        release: { commit: VERSION, pinnedAt: iso(now - 3 * 3_600_000) },
        components: steadyComponents,
      };
    case 'rollout':
      return {
        ...fresh,
        sync: 'out-of-sync',
        release: { commit: NEXT_VERSION, pinnedAt: iso(now - 90_000) },
        components: withChanges({
          api: {
            health: 'progressing',
            version: NEXT_VERSION,
            replicas: { desired: 2, available: 1, ready: 1 },
          },
          worker: { health: 'progressing', version: NEXT_VERSION },
          argocd: { health: 'progressing' },
        }),
      };
    case 'degraded':
      return {
        ...fresh,
        release: { commit: VERSION, pinnedAt: iso(now - 3 * 3_600_000) },
        components: withChanges({
          redis: {
            health: 'down',
            replicas: { desired: 1, available: 0, ready: 0 },
            traffic: null,
            failure: 'crash-loop',
          },
          api: { health: 'degraded' },
          worker: { health: 'degraded', traffic: null },
        }),
      };
    case 'offline':
      return null;
    case 'stale':
      return {
        generatedAt: iso(now - 10 * 60_000),
        sync: 'synced',
        release: { commit: VERSION, pinnedAt: iso(now - 3 * 3_600_000) },
        components: steadyComponents,
      };
  }
}
