import { and, asc, desc, eq, gt, lt, or, type SQL } from 'drizzle-orm';
import type { ProjectDetail } from '@portfolio/shared-types';
import { withDatabase } from '../../database/database-errors.js';
import type { Database } from '../../database/database.js';
import { type ProjectRow, projects } from '../../database/schema.js';
import type { ProjectPosition } from './project-page.js';
import type { ProjectPage, ProjectPageRequest, ProjectsRepository } from './projects.repository.js';

/** Only the columns a summary needs; `description` and links are left out of list queries. */
const summaryColumns = {
  slug: projects.slug,
  title: projects.title,
  summary: projects.summary,
  kind: projects.kind,
  technologies: projects.technologies,
  featured: projects.featured,
};

/** Rows after `position` in `featured DESC, title ASC, slug ASC` order (PostgreSQL: false < true). */
function positionedAfter(position: ProjectPosition): SQL | undefined {
  return or(
    lt(projects.featured, position.featured),
    and(
      eq(projects.featured, position.featured),
      or(
        gt(projects.title, position.title),
        and(eq(projects.title, position.title), gt(projects.slug, position.slug)),
      ),
    ),
  );
}

export function toProjectDetail(row: ProjectRow): ProjectDetail {
  return {
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    description: row.description,
    kind: row.kind,
    technologies: row.technologies,
    featured: row.featured,
    repositoryUrl: row.repositoryUrl,
    liveUrl: row.liveUrl,
    miniAppSlug: row.miniAppSlug,
  };
}

export class DrizzleProjectsRepository implements ProjectsRepository {
  constructor(private readonly database: Database) {}

  async listSummaries({ limit, after }: ProjectPageRequest): Promise<ProjectPage> {
    // Fetch one extra row to learn whether another page exists without a COUNT query.
    const rows = await withDatabase(() =>
      this.database
        .select(summaryColumns)
        .from(projects)
        .where(after === undefined ? undefined : positionedAfter(after))
        .orderBy(desc(projects.featured), asc(projects.title), asc(projects.slug))
        .limit(limit + 1),
    );
    return { items: rows.slice(0, limit), hasMore: rows.length > limit };
  }

  async findBySlug(slug: string): Promise<ProjectDetail | undefined> {
    const [row] = await withDatabase(() =>
      this.database.select().from(projects).where(eq(projects.slug, slug)).limit(1),
    );
    return row === undefined ? undefined : toProjectDetail(row);
  }
}
