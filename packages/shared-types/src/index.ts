/** Version prefix for every public API route. */
export const API_PREFIX = 'api/v1';

/** The chat assistant's name when none is configured (API `CHAT_ASSISTANT_NAME`, web build). */
export const DEFAULT_ASSISTANT_NAME = 'Pixel';
/**
 * A configured assistant name: 1-30 letters, spaces, hyphens, or apostrophes, starting and ending
 * with a letter. The API writes it into the system prompt, so nothing else is allowed.
 */
export const ASSISTANT_NAME_PATTERN = /^\p{L}(?:[\p{L}' -]{0,28}\p{L})?$/u;

export type ProjectKind = 'portfolio-app' | 'external-repository';

export interface ProjectSummary {
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly kind: ProjectKind;
  readonly technologies: readonly string[];
  readonly featured: boolean;
}

export interface ProjectDetail extends ProjectSummary {
  readonly description: string;
  readonly repositoryUrl: string | null;
  readonly liveUrl: string | null;
  /** Slug of the integrated mini-app under `/apps/[slug]`, when the project has one. */
  readonly miniAppSlug: string | null;
}

export type MiniAppStatus = 'available' | 'planned';

export interface MiniAppSummary {
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly status: MiniAppStatus;
}

/** Page size bounds for `GET /api/v1/projects?limit=`. */
export const PROJECT_PAGE_DEFAULT_LIMIT = 20;
export const PROJECT_PAGE_MAX_LIMIT = 50;

export interface ProjectListResponse {
  readonly items: readonly ProjectSummary[];
  /** Opaque token for the next page (`?cursor=`), or `null` on the last page. */
  readonly nextCursor: string | null;
}

export interface HealthResponse {
  readonly status: 'ok';
}

export type DependencyState = 'up' | 'down';

export interface ReadinessResponse {
  readonly status: 'ready' | 'not_ready';
  readonly checks: Readonly<Record<string, DependencyState>>;
}

export type ApiErrorCode =
  | 'bad_request'
  | 'not_found'
  | 'not_ready'
  | 'rate_limited'
  | 'ai_disabled'
  | 'ai_unavailable'
  | 'ai_overloaded'
  | 'chat_session_required'
  | 'chat_busy'
  | 'message_rejected'
  | 'challenge_failed'
  | 'challenge_unavailable'
  | 'infrastructure_disabled'
  | 'infrastructure_unavailable'
  | 'internal_error';

export interface ApiErrorResponse {
  readonly error: {
    readonly code: ApiErrorCode;
    readonly message: string;
    readonly requestId: string | null;
  };
}

/** Longest visitor message `POST /api/v1/chat/messages` accepts, in characters. */
export const CHAT_MESSAGE_MAX_LENGTH = 1_000;

/** Turnstile widget action and maximum token length for chat session creation. */
export const CHAT_SESSION_CHALLENGE_ACTION = 'chat_session';
export const CHALLENGE_TOKEN_MAX_LENGTH = 2_048;

export interface ChatSessionRequest {
  readonly turnstileToken: string;
}

/**
 * `POST /api/v1/chat/sessions`. The session ID travels only in an `HttpOnly` cookie scoped to
 * `/api/v1/chat`; the body never contains it.
 */
export interface ChatSessionResponse {
  /** ISO 8601 time after which the session and its history are gone. */
  readonly expiresAt: string;
}

export interface ChatMessageRequest {
  readonly message: string;
}

export type ChatLinkKind = 'project' | 'mini-app' | 'doc';

/**
 * A page the assistant suggests: a site page, or (`doc`) a curated architecture note's source on
 * GitHub. The API only returns links to slugs in the registry, and clients rebuild `path` from
 * their own copy of it rather than trusting the response.
 */
export interface ChatLink {
  readonly kind: ChatLinkKind;
  readonly slug: string;
  readonly title: string;
  /**
   * Site-relative path with a trailing slash for pages (`/projects/<slug>/`), or the source's
   * https URL on GitHub for `doc` links.
   */
  readonly path: string;
}

export interface ChatMessageResponse {
  /**
   * Plain text. Clients must render it as text, never as HTML, and must not turn URLs or paths in
   * it into links: navigation goes only through `links`.
   */
  readonly reply: string;
  /** Validated links to registry pages and doc sources, at most three, in reply order. */
  readonly links: readonly ChatLink[];
}

/**
 * Infrastructure Explorer (Phase 6). A sanitized snapshot of the deployment: only the allowlisted
 * fields in `docs/architecture/security.md` (release and traffic are its proposed additions),
 * never IP addresses, node names, environment variables, logs, registry paths, or other
 * namespaces.
 */
export type InfrastructureComponentId =
  'web' | 'tunnel' | 'api' | 'worker' | 'postgres' | 'redis' | 'argocd' | 'ai';

/** `unknown` means the server couldn't tell; clients must never show it as healthy. */
export type InfrastructureHealth = 'healthy' | 'progressing' | 'degraded' | 'down' | 'unknown';

/** Coarse failure category; never the underlying event or log text. */
export type InfrastructureFailure =
  'crash-loop' | 'image-pull' | 'unschedulable' | 'not-ready' | 'unreachable';

/** Bucketed request rate, never raw counts (proposed allowlist addition; needs P7-01 metrics). */
export type TrafficLevel = 'idle' | 'low' | 'busy';

export interface ReplicaCounts {
  readonly desired: number;
  readonly available: number;
  readonly ready: number;
}

export interface InfrastructureComponent {
  readonly id: InfrastructureComponentId;
  readonly health: InfrastructureHealth;
  /** Image tag only, never a registry path or digest; `null` for components without one. */
  readonly version: string | null;
  /** Workload replica counts; `null` for components outside the cluster. */
  readonly replicas: ReplicaCounts | null;
  /** `null` until request-rate buckets exist (P7-01). */
  readonly traffic: TrafficLevel | null;
  readonly failure: InfrastructureFailure | null;
}

export type InfrastructureSyncStatus = 'synced' | 'out-of-sync' | 'unknown';

export interface InfrastructureSnapshot {
  /** When the server built this snapshot (ISO 8601); clients treat old snapshots as unavailable. */
  readonly generatedAt: string;
  /** Argo CD sync status of the portfolio Application. */
  readonly sync: InfrastructureSyncStatus;
  /**
   * The latest release pinned in `images.yaml`: short commit SHA and time (proposed allowlist
   * addition). `null` when unknown.
   */
  readonly release: { readonly commit: string; readonly pinnedAt: string } | null;
  readonly components: readonly InfrastructureComponent[];
}
