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
  | 'internal_error';

export interface ApiErrorResponse {
  readonly error: {
    readonly code: ApiErrorCode;
    readonly message: string;
    readonly requestId: string | null;
  };
}
