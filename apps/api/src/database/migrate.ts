import { fileURLToPath } from 'node:url';
import { connectionUrl, parseEnvironment } from '@portfolio/config';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { z } from 'zod';
import { createDatabase, createPool } from './database.js';

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** Applies pending migrations. Run explicitly (`pnpm db:migrate`), never at API startup. */
async function main(): Promise<void> {
  const { DATABASE_URL } = parseEnvironment(
    z.object({ DATABASE_URL: connectionUrl('postgres:', 'postgresql:') }),
    process.env,
  );

  const pool = createPool(DATABASE_URL);
  try {
    await migrate(createDatabase(pool), { migrationsFolder });
    process.stdout.write('Migrations applied\n');
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Migration failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
