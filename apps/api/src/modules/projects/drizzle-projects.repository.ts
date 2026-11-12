import { asc, desc, eq } from 'drizzle-orm';
import type { ProjectDetail } from '@portfolio/shared-types';
import { withDatabase } from '../../database/database-errors.js';
import type { Database } from '../../database/database.js';
import { type ProjectRow, projects } from '../../database/schema.js';
import type { ProjectsRepository } from './projects.repository.js';

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

  async list(): Promise<readonly ProjectDetail[]> {
    const rows = await withDatabase(() =>
      this.database.select().from(projects).orderBy(desc(projects.featured), asc(projects.title)),
    );
    return rows.map(toProjectDetail);
  }

  async findBySlug(slug: string): Promise<ProjectDetail | undefined> {
    const [row] = await withDatabase(() =>
      this.database.select().from(projects).where(eq(projects.slug, slug)).limit(1),
    );
    return row === undefined ? undefined : toProjectDetail(row);
  }
}
