import { connectionUrl, parseEnvironment } from '@portfolio/config';
import { registry } from '@portfolio/project-registry';
import { z } from 'zod';
import { syncProjects } from './sync-projects.js';
import { createDatabase, createPool } from './database.js';

/** Reconciles the `projects` table with the shipped registry. Safe to run repeatedly. */
async function main(): Promise<void> {
  const { DATABASE_URL } = parseEnvironment(
    z.object({ DATABASE_URL: connectionUrl('postgres:', 'postgresql:') }),
    process.env,
  );

  const pool = createPool(DATABASE_URL);
  try {
    const result = await syncProjects(createDatabase(pool), registry.projects);
    process.stdout.write(
      `Seeded projects: ${result.upserted} upserted, ${result.removed} removed\n`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`Seed failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
