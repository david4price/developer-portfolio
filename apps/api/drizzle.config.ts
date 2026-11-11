import { defineConfig } from 'drizzle-kit';

// Used only by `drizzle-kit generate`, which diffs the schema offline. Migrations are applied by
// `pnpm db:migrate`, never at application startup.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/schema.ts',
  out: './drizzle',
});
