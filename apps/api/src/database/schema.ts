import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Projects published by the API. Seeded from `@portfolio/project-registry`; the registry stays the
 * content source of truth and `pnpm db:seed` reconciles this table with it.
 */
export const projects = pgTable('projects', {
  slug: text('slug').primaryKey(),
  title: text('title').notNull(),
  summary: text('summary').notNull(),
  description: text('description').notNull(),
  kind: text('kind', { enum: ['portfolio-app', 'external-repository'] }).notNull(),
  technologies: text('technologies').array().notNull(),
  featured: boolean('featured').notNull().default(false),
  repositoryUrl: text('repository_url'),
  liveUrl: text('live_url'),
  miniAppSlug: text('mini_app_slug'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ProjectRow = typeof projects.$inferSelect;
export type NewProjectRow = typeof projects.$inferInsert;
