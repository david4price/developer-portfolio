import type { ProjectDetail } from '@portfolio/shared-types';

export const PROJECTS_REPOSITORY = Symbol('PROJECTS_REPOSITORY');

export interface ProjectsRepository {
  /** Featured projects first, then alphabetical by title. */
  list(): Promise<readonly ProjectDetail[]>;
  findBySlug(slug: string): Promise<ProjectDetail | undefined>;
}
