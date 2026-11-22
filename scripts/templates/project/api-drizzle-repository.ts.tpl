import { desc } from 'drizzle-orm';
import type { __Pascal__Item } from '@portfolio/shared-types';
import { withDatabase } from '../../database/database-errors.js';
import type { Database } from '../../database/database.js';
import { __camel__Items } from './__slug__.schema.js';
import type { __Pascal__Repository } from './__slug__.repository.js';

/** __title__'s items in PostgreSQL. Outages surface as `503 not_ready` (`withDatabase`). */
export class Drizzle__Pascal__Repository implements __Pascal__Repository {
  constructor(private readonly database: Database) {}

  list(limit: number): Promise<readonly __Pascal__Item[]> {
    return withDatabase(async () => {
      const rows = await this.database
        .select()
        .from(__camel__Items)
        .orderBy(desc(__camel__Items.createdAt))
        .limit(limit);
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        createdAt: row.createdAt.toISOString(),
      }));
    });
  }
}
