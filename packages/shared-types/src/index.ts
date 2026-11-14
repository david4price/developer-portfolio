/** Version prefix for every public API route. */
export const API_PREFIX = 'api/v1';

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

export type ChatLinkKind = 'project' | 'mini-app';

/** A site page the assistant suggests. The API only returns links to slugs in the registry. */
export interface ChatLink {
  readonly kind: ChatLinkKind;
  readonly slug: string;
  readonly title: string;
  /** Site-relative path with a trailing slash, e.g. `/projects/<slug>/`. */
  readonly path: string;
}

export interface ChatMessageResponse {
  /**
   * Plain text. Clients must render it as text, never as HTML, and must not turn URLs or paths in
   * it into links: navigation goes only through `links`.
   */
  readonly reply: string;
  /** Validated links to registry pages, at most three, in the order the reply mentions them. */
  readonly links: readonly ChatLink[];
}
