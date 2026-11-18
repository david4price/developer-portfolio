import type {
  InfrastructureComponent,
  InfrastructureSnapshot,
  ReplicaCounts,
} from '@portfolio/shared-types';

/**
 * The live snapshot from `GET /api/v1/infrastructure` (P6-04). The response is checked field by
 * field before the page uses it: anything unexpected makes it "unavailable" rather than drawn.
 */

const COMPONENT_IDS = new Set([
  'web',
  'tunnel',
  'api',
  'worker',
  'ai',
  'postgres',
  'redis',
  'argocd',
]);
const HEALTH = new Set(['healthy', 'progressing', 'degraded', 'down', 'unknown']);
const FAILURES = new Set(['crash-loop', 'image-pull', 'unschedulable', 'not-ready', 'unreachable']);
const TRAFFIC = new Set(['idle', 'low', 'busy']);
const SYNC = new Set(['synced', 'out-of-sync', 'unknown']);

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isTime = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 10_000;
const shortText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;
const oneOf = <T extends string>(allowed: ReadonlySet<string>, value: unknown): value is T =>
  typeof value === 'string' && allowed.has(value);

function parseReplicas(value: unknown): ReplicaCounts | null | undefined {
  if (value === null) return null;
  if (!record(value)) return undefined;
  const { desired, available, ready } = value;
  return isCount(desired) && isCount(available) && isCount(ready)
    ? { desired, available, ready }
    : undefined;
}

function parseComponent(value: unknown): InfrastructureComponent | undefined {
  if (!record(value)) return undefined;
  const replicas = parseReplicas(value.replicas);
  const { id, health, version, traffic, failure } = value;
  if (
    !oneOf<InfrastructureComponent['id']>(COMPONENT_IDS, id) ||
    !oneOf<InfrastructureComponent['health']>(HEALTH, health) ||
    replicas === undefined ||
    // The API's own bound: a tag of at most 128 characters, or a short digest.
    !(version === null || shortText(version, 128)) ||
    !(traffic === null || oneOf(TRAFFIC, traffic)) ||
    !(failure === null || oneOf(FAILURES, failure))
  ) {
    return undefined;
  }
  return {
    id,
    health,
    version,
    replicas,
    traffic: traffic as InfrastructureComponent['traffic'],
    failure: failure as InfrastructureComponent['failure'],
  };
}

/** The snapshot if the response has exactly the expected shape, otherwise `null`. */
export function parseSnapshot(value: unknown): InfrastructureSnapshot | null {
  if (!record(value) || !isTime(value.generatedAt) || !oneOf(SYNC, value.sync)) return null;
  const { release, components, ageSeconds } = value;
  const age =
    typeof ageSeconds === 'number' &&
    Number.isInteger(ageSeconds) &&
    ageSeconds >= 0 &&
    ageSeconds <= 10 ** 9
      ? ageSeconds
      : undefined;
  if (ageSeconds !== undefined && age === undefined) return null;
  let parsedRelease: InfrastructureSnapshot['release'] = null;
  if (release !== null) {
    if (!record(release) || !shortText(release.commit, 40) || !isTime(release.pinnedAt)) {
      return null;
    }
    parsedRelease = { commit: release.commit, pinnedAt: release.pinnedAt };
  }
  if (!Array.isArray(components) || components.length > COMPONENT_IDS.size) return null;
  const parsed = components.map(parseComponent);
  if (parsed.some((component) => component === undefined)) return null;
  const list = parsed as InfrastructureComponent[];
  if (new Set(list.map(({ id }) => id)).size !== list.length) return null;
  return {
    generatedAt: value.generatedAt,
    ...(age === undefined ? {} : { ageSeconds: age }),
    sync: value.sync as InfrastructureSnapshot['sync'],
    release: parsedRelease,
    components: list,
  };
}

export type LiveResult =
  | { readonly kind: 'snapshot'; readonly snapshot: InfrastructureSnapshot }
  /** The deployment has the live view off (`503 infrastructure_disabled`). */
  | { readonly kind: 'disabled' }
  /** Anything else: network error, timeout, error status, or an unexpected body. */
  | { readonly kind: 'unavailable' };

/** One request for the live snapshot; it never throws. */
export async function fetchLiveSnapshot(
  url: string,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<LiveResult> {
  try {
    const response = await fetchImpl(url, {
      signal,
      credentials: 'omit',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const code = record(body) && record(body.error) ? body.error.code : undefined;
      return code === 'infrastructure_disabled' ? { kind: 'disabled' } : { kind: 'unavailable' };
    }
    const snapshot = parseSnapshot(body);
    return snapshot === null ? { kind: 'unavailable' } : { kind: 'snapshot', snapshot };
  } catch {
    return { kind: 'unavailable' };
  }
}

/**
 * The visitor's own view of the website: the page loaded, so it is being served. The cluster
 * can't see Cloudflare Pages, so the API reports it as unknown; this fills that in, client-side
 * only, and never for anything else.
 */
export function withVisitorWebsite(snapshot: InfrastructureSnapshot): InfrastructureSnapshot {
  return {
    ...snapshot,
    components: snapshot.components.map((component) =>
      component.id === 'web' && component.health === 'unknown'
        ? { ...component, health: 'healthy' }
        : component,
    ),
  };
}
