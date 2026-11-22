import { defineConfig } from 'drizzle-kit';

// Used only by `drizzle-kit generate`, which diffs the schema offline. Migrations are applied by
// `pnpm db:migrate`, never at application startup. Feature modules own their tables in
// `src/modules/<name>/<name>.schema.ts` (P8-02), next to the code that uses them.
export default defineConfig({
  dialect: 'postgresql',
  schema: ['./src/database/schema.ts', './src/modules/*/*.schema.ts'],
  out: './drizzle',
});
