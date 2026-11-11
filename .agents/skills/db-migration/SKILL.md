---
name: db-migration
description: Change the PostgreSQL schema of the API safely — edit the Drizzle schema, generate and review SQL, keep migrations backward compatible for image rollback, and update repositories, seeds, and tests. Use for any table, column, index, or constraint change under apps/api; not for running migrations against shared or production databases.
---

# Database Migration

Schema: `apps/api/src/database/schema.ts`. Migrations: `apps/api/drizzle/` (SQL plus `meta/`
snapshots, all committed). Migrations run only through `pnpm db:migrate`, never at API startup.

## 1. Plan for Rollback

Every migration must work with **both** the new and the previous application image, because
rollback reverts the image, not the database.

| Change                                   | Safe pattern                                                                            |
| ---------------------------------------- | --------------------------------------------------------------------------------------- |
| Add column                               | Nullable or with a default                                                              |
| Add table / index                        | Safe; large-table indexes: plan `CREATE INDEX CONCURRENTLY` in a hand-written migration |
| Rename column/table                      | Add new → dual-write → backfill → switch reads → drop old, across releases              |
| Drop column/table                        | Release N stops using it; release N+1 drops it                                          |
| Tighten constraint (`NOT NULL`, `CHECK`) | Backfill first, then constrain in a later release                                       |
| Change type                              | New column + backfill, not an in-place `ALTER TYPE`                                     |

If the requested change can't be made backward compatible in one step, split it and tell the user
which part ships now. Add follow-ups to `docs/implementation-roadmap.md`.

## 2. Change

1. Edit `schema.ts`.
2. Generate (offline, no database needed):

   ```bash
   pnpm --filter @portfolio/api db:generate --name <short_snake_case_change>
   ```

3. Read the generated SQL. Reject destructive statements (`DROP`, type changes, renames) that
   violate step 1. Never edit already-committed migrations; add a new one instead.
4. Update the code in the same change:
   - `drizzle-projects.repository.ts` (or the relevant adapter) and its row mapping
   - `sync-projects.ts` if registry-seeded columns changed
   - `@portfolio/shared-types` only if the HTTP contract changes
   - unit tests with in-memory fakes; integration tests in `test/integration/`

## 3. Verify

```bash
pnpm check
pnpm build
```

Apply migrations only to a disposable local database the user already runs (or approved starting):

```bash
pnpm db:migrate && pnpm db:seed && pnpm db:seed && pnpm test:integration
```

Seeding twice must succeed (idempotency). If no local database is available, report the
integration run as not run; CI runs it with service containers.

Finish with the `verify` skill. Never run `db:migrate` against a shared or production database
without an explicit request.
