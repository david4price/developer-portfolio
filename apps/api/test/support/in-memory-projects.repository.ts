import { toProjectSummary } from '@portfolio/project-registry';
import type { ProjectDetail } from '@portfolio/shared-types';
import type { ProjectPosition } from '../../src/modules/projects/project-page.js';
import type {
  ProjectPage,
  ProjectPageRequest,
  ProjectsRepository,
} from '../../src/modules/projects/projects.repository.js';

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** `featured DESC, title ASC, slug ASC`, matching the PostgreSQL adapter. */
export function compareProjects(left: ProjectPosition, right: ProjectPosition): number {
  if (left.featured !== right.featured) return left.featured ? -1 : 1;
  return compareText(left.title, right.title) || compareText(left.slug, right.slug);
}

/** In-memory `ProjectsRepository` with the same ordering and keyset semantics as PostgreSQL. */
export class InMemoryProjectsRepository implements ProjectsRepository {
  private readonly projects: readonly ProjectDetail[];

  constructor(projects: readonly ProjectDetail[]) {
    this.projects = [...projects].sort(compareProjects);
  }

  async listSummaries({ limit, after }: ProjectPageRequest): Promise<ProjectPage> {
    const remaining =
      after === undefined
        ? this.projects
        : this.projects.filter((project) => compareProjects(project, after) > 0);
    return {
      items: remaining.slice(0, limit).map(toProjectSummary),
      hasMore: remaining.length > limit,
    };
  }

  async findBySlug(slug: string): Promise<ProjectDetail | undefined> {
    return this.projects.find((project) => project.slug === slug);
  }
}
