import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * __title__'s items. This module owns the table: other modules never read it directly. Change it
 * here, then `pnpm --filter @portfolio/api db:generate --name <change>` writes the migration.
 */
export const __camel__Items = pgTable(
  '__snake___items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // The list reads newest first, so it's served from this index rather than a full sort.
  (table) => [index('__snake___items_created_at_idx').on(table.createdAt)],
);
