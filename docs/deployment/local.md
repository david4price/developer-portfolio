# Local Development

Everything here runs on one machine with no dependency on the original author's infrastructure.
AI stays disabled unless you configure a provider.

## Prerequisites

- Node.js 24 (`.node-version`)
- Corepack, which ships with Node.js 24. pnpm is pinned in `package.json`, so you don't need a
  global pnpm install.
- Docker with Compose v2.20 or newer (for PostgreSQL and Redis)

## Setup

```bash
git clone https://github.com/david4price/developer-portfolio.git
cd developer-portfolio
corepack enable            # or prefix pnpm commands with `corepack`
pnpm install
cp .env.example .env       # then replace every change-me value
docker compose up -d       # PostgreSQL 17 + Redis 7 on 127.0.0.1
pnpm db:migrate            # builds, then applies migrations
pnpm db:seed               # loads the project registry into PostgreSQL (idempotent)
```

## Run

In separate terminals:

```bash
pnpm dev:api      # http://127.0.0.1:3001/api/v1/health
pnpm dev:worker
pnpm dev:web      # http://localhost:3000 (PORT=3100 pnpm dev:web if 3000 is taken)
```

If you change the web port, add the new origin to `CORS_ORIGINS` in `.env`.

Useful endpoints:

| Endpoint                     | Purpose                                                        |
| ---------------------------- | -------------------------------------------------------------- |
| `GET /api/v1/health`         | Liveness, which never touches dependencies                     |
| `GET /api/v1/health/ready`   | Readiness: 200 when PostgreSQL and Redis answer, otherwise 503 |
| `GET /api/v1/projects`       | Paged project summaries from PostgreSQL (see below)            |
| `GET /api/v1/projects/:slug` | Project detail                                                 |

`GET /api/v1/projects` returns `{ items, nextCursor }`, ordered featured first, then by title.
`limit` is 1–50 (default 20). To get the next page, pass the returned `nextCursor` back as
`?cursor=`; it is `null` on the last page. Cursors are opaque, and a malformed `limit` or `cursor`
returns `400 bad_request`.

Errors use the `ApiErrorResponse` shape (`error.code`, `error.message`, `error.requestId`). When
PostgreSQL is unreachable, data endpoints return `503` with code `not_ready` so clients can retry;
query bugs and other unexpected failures stay a generic `500 internal_error`.

## Quality Checks

```bash
pnpm check              # format:check, lint, typecheck, unit tests
pnpm build              # TypeScript projects + static site in apps/web/out
pnpm test:integration   # needs the Compose services, migrations, and seed
```

## Running Without the API

The static site builds and works without the API. Leave `NEXT_PUBLIC_API_BASE_URL` unset and the
API status badge reports "not configured". With the variable set but the API stopped, it reports
"unavailable". The rest of the page is unaffected in both cases.

## Fully Containerized Stack

`compose.full.yaml` builds and runs everything in containers: dependencies, a one-shot migrate and
seed, the API, the worker, and the static site served by unprivileged nginx.

```bash
docker compose -f compose.full.yaml up -d --build
# site: http://localhost:8080   api: http://localhost:3001/api/v1/health
```

Containers run with dropped Linux capabilities and `no-new-privileges`. The API, worker, and
one-shot jobs also use a read-only root filesystem.

## Editing Content

- Projects and mini-apps: `packages/project-registry/src/data.ts`. Entries are validated, so a bad
  slug, duplicate, or non-HTTPS link fails tests and the build. Run `pnpm db:seed` after changes.
- Profile, About, and Experience: `apps/web/src/content/profile.ts`.

## Database Changes

1. Edit `apps/api/src/database/schema.ts`.
2. `pnpm --filter @portfolio/api db:generate --name <change>` writes SQL into `apps/api/drizzle/`.
3. Review the SQL and commit it with the schema change.
4. `pnpm db:migrate`.

Migrations never run at API startup. See [runbooks](../operations/runbooks.md#rollback) for the
compatibility rules that keep image rollbacks safe.

## Troubleshooting

| Symptom                                                 | Fix                                                                                           |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `Invalid environment: DATABASE_URL …` at startup        | Copy `.env.example` to `.env`; the message names every missing or invalid variable            |
| Readiness shows `postgres: down`                        | `docker compose ps`; check `POSTGRES_PORT` matches `DATABASE_URL`                             |
| `required variable POSTGRES_DB is missing` from Compose | Run Compose from the repository root, where `.env` lives                                      |
| Port already in use                                     | Change `POSTGRES_PORT`, `REDIS_PORT`, `API_PORT`, or `PORT` (web) in `.env`                   |
| `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`                | A dependency version is younger than pnpm's release-age policy; wait, or pin an older version |
