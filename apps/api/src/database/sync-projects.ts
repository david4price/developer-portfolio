import { notInArray, sql } from 'drizzle-orm';
import type { ProjectDetail } from '@portfolio/shared-types';
import type { Database } from './database.js';
import { type NewProjectRow, projects } from './schema.js';

function toRow(project: ProjectDetail): NewProjectRow {
  return {
    slug: project.slug,
    title: project.title,
    summary: project.summary,
    description: project.description,
    kind: project.kind,
    technologies: [...project.technologies],
    featured: project.featured,
    repositoryUrl: project.repositoryUrl,
    liveUrl: project.liveUrl,
    miniAppSlug: project.miniAppSlug,
  };
}

/** Upserts every registry project and deletes rows the registry no longer lists, atomically. */
export async function syncProjects(
  database: Database,
  source: readonly ProjectDetail[],
): Promise<{ upserted: number; removed: number }> {
  return database.transaction(async (tx) => {
    const rows = source.map(toRow);

    if (rows.length > 0) {
      await tx
        .insert(projects)
        .values(rows)
        .onConflictDoUpdate({
          target: projects.slug,
          set: {
            title: sql`excluded.title`,
            summary: sql`excluded.summary`,
            description: sql`excluded.description`,
            kind: sql`excluded.kind`,
            technologies: sql`excluded.technologies`,
            featured: sql`excluded.featured`,
            repositoryUrl: sql`excluded.repository_url`,
            liveUrl: sql`excluded.live_url`,
            miniAppSlug: sql`excluded.mini_app_slug`,
            updatedAt: sql`now()`,
          },
        });
    }

    const slugs = rows.map((row) => row.slug);
    const removed =
      slugs.length > 0
        ? await tx.delete(projects).where(notInArray(projects.slug, slugs)).returning()
        : await tx.delete(projects).returning();

    return { upserted: rows.length, removed: removed.length };
  });
}
