import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * __title__'s items. This module owns the table: other modules never read it directly. Change it
 * here, then `pnpm --filter @portfolio/api db:generate --name <change>` writes the migration.
 */
export const __camel__Items = pgTable('__snake___items', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
