import type { ProjectDetail, ProjectSummary } from '@portfolio/shared-types';
import type { ProjectPosition } from './project-page.js';

export const PROJECTS_REPOSITORY = Symbol('PROJECTS_REPOSITORY');

export interface ProjectPageRequest {
  readonly limit: number;
  /** Return projects strictly after this position; `undefined` starts at the beginning. */
  readonly after: ProjectPosition | undefined;
}

export interface ProjectPage {
  readonly items: readonly ProjectSummary[];
  readonly hasMore: boolean;
}

export interface ProjectsRepository {
  /** One page of summaries: featured first, then by title, then by slug. */
  listSummaries(request: ProjectPageRequest): Promise<ProjectPage>;
  findBySlug(slug: string): Promise<ProjectDetail | undefined>;
}
