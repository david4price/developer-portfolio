# Local Development

Everything here runs on one machine with no dependency on the original author's infrastructure.
AI stays disabled unless you configure a provider.

## Prerequisites

- Node.js 24 (`.node-version`)
- Corepack, which ships with Node.js 24. pnpm is pinned in `package.json`, so you don't need a
  global pnpm install, but `pnpm` must be on your `PATH`: the root scripts call it themselves.
- Docker with Compose v2.20 or newer (for PostgreSQL and Redis)

## Setup

```bash
git clone https://github.com/david4price/developer-portfolio.git
cd developer-portfolio
corepack enable            # puts pnpm on PATH (see below if it needs sudo)
pnpm bootstrap
```

`pnpm bootstrap` (P8-01) checks Node.js and Docker Compose, creates `.env` from `.env.example` with
a generated database password (an existing `.env` is never touched), installs dependencies, starts
PostgreSQL 17 and Redis 7 on 127.0.0.1 and waits until they're healthy, then applies migrations
and seeds the registry. It's safe to run again. By hand, the same steps are:

```bash
pnpm install
cp .env.example .env       # then replace every change-me value (two places)
docker compose up -d --wait
pnpm db:migrate            # builds, then applies migrations
pnpm db:seed               # loads the project registry into PostgreSQL (idempotent)
```

`pnpm db:reset` deletes the local PostgreSQL and Redis data (this project's Compose volumes only,
after you type `reset`), then starts them empty, migrates, and seeds.

`corepack enable` writes a `pnpm` link next to `node`. With a system-wide Node.js (for example in
`/usr/bin`) that needs `sudo`; instead, link it into a directory of your own that is on `PATH`:
`corepack enable --install-directory ~/.local/bin pnpm`. Running `corepack pnpm <script>` without
either doesn't work for `pnpm check`, `pnpm build`, `pnpm db:migrate`, or the `dev:*` scripts:
they call `pnpm` again and fail with `pnpm: not found`.

## Run

```bash
pnpm dev          # API, worker, and site together, with prefixed output; Ctrl-C stops all
```

Or one per terminal:

```bash
pnpm dev:api      # http://127.0.0.1:3001/api/v1/health
pnpm dev:worker
pnpm dev:web      # http://localhost:3000 (PORT=3100 pnpm dev:web if 3000 is taken)
```

If you change the web port, add the new origin to `CORS_ORIGINS` in `.env`.

Useful endpoints:

| Endpoint                     | Purpose                                                                 |
| ---------------------------- | ----------------------------------------------------------------------- |
| `GET /api/v1/health`         | Liveness, which never touches dependencies                              |
| `GET /api/v1/health/ready`   | Readiness: 200 when PostgreSQL and Redis answer, otherwise 503          |
| `GET /api/v1/projects`       | Paged project summaries from PostgreSQL (see below)                     |
| `GET /api/v1/projects/:slug` | Project detail                                                          |
| `POST /api/v1/chat/sessions` | `{ turnstileToken }` → session cookie; `503 ai_disabled` while AI off   |
| `POST /api/v1/chat/messages` | `{ message }` → `{ reply, links }` (see below)                          |
| `GET /api/v1/infrastructure` | Sanitized deployment snapshot; `503 infrastructure_disabled` by default |

Metrics (P7-01) are served apart from the API, at `http://127.0.0.1:9464/metrics` in the
Prometheus text format (`API_METRICS_HOST` and `API_METRICS_PORT`; the port must differ from
`API_PORT`). The metrics port is never part of `/api/v1`: request durations by route pattern and
status class, error responses by code, abandoned requests (`http_client_disconnects_total`, not
counted as errors), readiness per dependency, AI inference time by outcome, the
AI wait queue, and process and Node.js runtime metrics. Nothing scrapes them by default; read them
with `curl`. In `compose.full.yaml` the API binds them inside its container, so other containers on
the Compose network can reach `api:9464` too. In Kubernetes they stay on the pod's loopback unless
`api.metrics.scrape.enabled` opens them to Prometheus alone (production, P9-04).

`GET /api/v1/projects` returns `{ items, nextCursor }`, ordered featured first, then by title.
`limit` is 1–50 (default 20). To get the next page, pass the returned `nextCursor` back as
`?cursor=`; it is `null` on the last page. Cursors are opaque, and a malformed `limit` or `cursor`
returns `400 bad_request`.

Chat needs `AI_ENABLED=true` and an AI provider. Replies are plain text; `links` lists pages the
assistant suggested, each checked against the project registry (`kind`, `slug`, `title`, `path`).
A `doc` link points at an architecture note's source on GitHub, and `path` is that URL.
The assistant speaks as the site's dog companion; `CHAT_ASSISTANT_NAME` sets its name (default
`Pixel`; letters, spaces, hyphens, and apostrophes, at most 30). The API removes emoji from
replies. The popup shows the name from the build setting `NEXT_PUBLIC_ASSISTANT_NAME`: for
`pnpm dev`, set it to the same value; `compose.full.yaml` passes `CHAT_ASSISTANT_NAME` to the web
build itself and ignores `NEXT_PUBLIC_ASSISTANT_NAME`. An invalid web value fails the build.
The design and limits are in [AI integration](../architecture/ai-integration.md#chat-design-phase-5).

### Chat session verification

Enabling AI also requires `TURNSTILE_SECRET_KEY` (no default) and `TURNSTILE_HOSTNAMES`, a
comma-separated list of exact browser hostnames such as `portfolio.example.com,localhost`.
Hostnames have no scheme, port, path, or wildcard. Supply the same variables for
`compose.full.yaml`; it forwards AI and Turnstile settings while keeping AI off by default.

The client completes a Turnstile widget configured with action `chat_session`, then posts
`{ "turnstileToken": "<fresh-token>" }` to `/api/v1/chat/sessions` with credentials included.
The sitekey is public; the secret key stays in API configuration. A missing or rejected token,
wrong hostname/action, or replay returns `403 challenge_failed`; malformed input returns
`400 bad_request`. Provider outages, invalid upstream credentials, malformed responses, and a
5-second verification timeout return `503 challenge_unavailable`. No rejection sets a cookie or
creates a session. Reset the widget and obtain a fresh token after an unsuccessful attempt.
Session-attempt quotas apply before verification, including rejected attempts. Redis outages
fail closed with `503 not_ready`.

There is no environment flag that bypasses verification when AI is enabled. Unit and contract
tests use an injected fake verifier or local HTTP server; they never contact Cloudflare. The
published [Turnstile test keys](https://developers.cloudflare.com/turnstile/troubleshooting/testing/)
return a fixed hostname and omit the action, so they cannot exercise this adapter's complete
hostname/action check. Use a development widget with real keys for that manual check; do not
weaken the checks to accommodate dummy responses. AI-off development needs no Cloudflare account.
Open the chat UI with the floating artwork button in the bottom-right corner of any page. It
opens a small overlay; Escape, the close button, or clicking outside closes it. Closing and
reopening preserves the conversation, including across site navigation. Set the public
`NEXT_PUBLIC_TURNSTILE_SITE_KEY` alongside `NEXT_PUBLIC_API_BASE_URL` before starting or building
the web app. The popup says "not configured" and loads no verification script if either is absent.
The same public sitekey is a build argument in `compose.full.yaml`. Changing it requires a new
static build. The secret stays in API configuration. After successful verification, select
**Start chat**, then send a question; blocked cookies or an expired session require fresh
verification. Browser and live acceptance checks are still pending; see the
[Turnstile guide](turnstile.md).

`GET /api/v1/infrastructure` serves the Infrastructure Explorer's snapshot (P6-02): allowlisted
fields only (component health, image tag or short digest, replica counts, a coarse failure
category, when it was built, and `ageSeconds`: its age when served, on the server's clock), cached
for 12 s, with `Cache-Control: no-store`. It is off by
default (`INFRASTRUCTURE_SOURCE=disabled` → `503 infrastructure_disabled`). `kubernetes` reads
the portfolio's Deployments, StatefulSets, and Pods (by component label) in
`INFRASTRUCTURE_NAMESPACE` (default `portfolio`) through
the in-cluster API server, so it only works inside a pod with the read-only Role from P6-01, using
the token and cluster CA mounted with its service account (that CA is trusted for these requests
only); outside a pod it fails startup. If the cluster
can't be read the last snapshot is served as it was, or `503 infrastructure_unavailable` before
the first one; each failed read is logged as a warning with its reason and status only. Locally,
leave it disabled. With AI enabled on the `openai-compatible` provider, each refresh also asks
`GET <AI_BASE_URL>/models` (no prompt, no GPU time, 1.5 s deadline) to light the AI building:
healthy when `AI_MODEL` is listed under exactly that name (or by a llama.cpp server), degraded on
`429` or the runtime's own JSON `503`, and down when the model is missing or the runtime can't be
reached. Only that state is returned, never the model's name or the runtime's address. While the
view is enabled, the API also counts visitor requests and replied chat messages in Redis
(per-minute keys that expire after 7 minutes) and returns each as a `traffic` bucket: `idle`,
`low`, or `busy` over a sliding 5-minute window. Health probes and `GET /api/v1/infrastructure` itself
aren't counted.

The optional P6-03 Argo CD source runs alongside that Kubernetes reader. Set `ARGOCD_ENABLED=true`
and all of `ARGOCD_SERVER_URL` (an HTTPS origin), `ARGOCD_APPLICATION`, `ARGOCD_PROJECT`,
`ARGOCD_TOKEN_FILE`, and `ARGOCD_CA_FILE` (absolute paths to mounted files). It requires the
Kubernetes infrastructure source; keep it off for normal local/Compose development. No Argo CD
account is needed to clone, build, or test this project. The token and CA are reread on refresh,
TLS trust is confined to this reader, redirects are refused, and reads share the snapshot's 5 s
deadline and 12 s cache. Argo CD failure leaves current workload data available but sets sync to
`unknown`, release to `null`, and the Argo CD component to `unknown`. A successful read marks
that component reachable (`healthy`); this is not the Application's aggregate health.

`release` describes the last successfully deployed **GitOps revision**, not the API source or
build commit. Its `commit` is seven hex characters; the existing `pinnedAt` field carries Argo CD's
deployment time. The comparison target is never reported as already deployed. See
[token provisioning and rotation](kubernetes.md#argo-cd-explorer-token-p6-03).

Messages are screened before they reach the model: an injection attempt gets
`422 message_rejected` and is not stored. A message too heavy for the classifier to score within
`CHAT_GUARD_TIMEOUT_MS` gets `422 message_too_long`; when the classifier is busy or failing, the
chat answers `503 ai_overloaded` (try again)
([Message Screening](../architecture/ai-integration.md#message-screening-confirmed-p5-07)).

Errors use the `ApiErrorResponse` shape (`error.code`, `error.message`, `error.requestId`). When
PostgreSQL is unreachable, data endpoints return `503` with code `not_ready` so clients can retry;
query bugs and other unexpected failures stay a generic `500 internal_error`.

## Quality Checks

```bash
pnpm check              # format:check, lint, typecheck, unit tests, dashboard and alert files
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
# metrics: http://127.0.0.1:9464/metrics (published on the host's loopback only)
```

Containers run with dropped Linux capabilities and `no-new-privileges`. The API, worker, and
one-shot jobs also use a read-only root filesystem.

## Local Observability (optional)

`compose.observability.yaml` adds the cluster's monitoring stack (Phase 9) beside the
containerized stack. It uses the same Grafana, Loki, Prometheus, and Alloy images, pinned by the
same digests, and the same data source uids, dashboards, and alert rules. Queries written locally
therefore work in the cluster.

```bash
docker compose -f compose.full.yaml -f compose.observability.yaml up -d --build
# Grafana: http://localhost:3300, user admin, password GRAFANA_ADMIN_PASSWORD from .env
docker compose -f compose.full.yaml -f compose.observability.yaml down   # add -v to drop the data
```

- **What it collects:**
  - **Logs:** every container in this Compose project, through the Docker socket, labelled like
    the cluster's: `namespace` is `portfolio` for the app and `monitoring` for the stack itself,
    and `app` and `container` are the Compose service. Example: `{namespace="portfolio", app="api"}`.
  - **Metrics:** the API's metrics (`job="portfolio-api"`), plus Loki's and Alloy's own.
  - **Kept for 7 days.**
- **Only Grafana is published,** on `127.0.0.1:${GRAFANA_PORT}` (3300). Loki and Prometheus are
  reached through it (Explore).
- **`GRAFANA_ADMIN_PASSWORD`** is required. `pnpm bootstrap` generates its own value; with an
  older `.env`, add it by hand (see `.env.example`). Grafana keeps the password it was first
  started with in its data volume: after changing it, run `down -v` (which also drops the logs
  and metrics) or reset it from Grafana.
- **The Docker socket is root-equivalent** on your machine, even mounted read-only. Use this on
  your own computer, never on a shared host. With rootless Docker, Colima, or another socket
  path, set `DOCKER_SOCKET`.
- **Not included:** kube-state-metrics (there is no Kubernetes), and so the pod restart and Job
  panels stay empty.
- **Dashboards and alert rules** live in `infrastructure/monitoring/dashboards/` and
  `infrastructure/monitoring/alerts/` (JSON). `pnpm check` validates them (`pnpm monitoring:files`);
  each directory's README lists the rules. Changes made in Grafana's UI aren't saved: export the
  JSON and commit it.
- **CI** runs `.github/scripts/observability-smoke.sh` on every push. It finds an API request's log
  line in Loki and the API's metrics in Prometheus, both through Grafana's data sources.

## Editing Content

- New project: `pnpm new:project` (P8-02) asks a few questions and scaffolds it from
  `scripts/templates/project/`: a project page; or also a mini-app on `/apps/<slug>`; or also an
  API module (`GET /api/v1/<slug>/items`, with a test); or also a table the module owns, with its
  migration. It registers everything (registry, site, API) and checks every answer before writing,
  so a refused one changes nothing. CI generates sample projects and runs every check on them, so
  the templates stay working.
- Projects and mini-apps: one file each in `packages/project-registry/src/projects/` and
  `src/mini-apps/`, listed in that folder's `index.ts`. Entries are validated, so a bad slug,
  duplicate, or non-HTTPS link fails tests and the build. Run `pnpm db:seed` after changes. A
  mini-app's page shows the view registered for its slug in `apps/web/src/mini-apps/index.ts`.
- Profile, About (including the optional "Beyond the code" interests, `personal`), and Experience:
  `packages/project-registry/src/profile-data.ts` (validated by the same schema checks as
  projects).
- About's photos sit behind the interest cards they belong to: list each under its interest's
  `photos` (file name, alt text, and the large file's width and height). A card with photos
  shows a few prints peeking out from behind it and opens all of them as framed prints, without
  captions. Put two WebP files in `apps/web/public/photos/`:
  - `<file>-sm.webp`, at most 900 px on the long edge, shown on the page;
  - `<file>-lg.webp`, at most 1,800 px, opened on click.

  Strip all metadata (EXIF, XMP, and GPS: phone photos often carry it) and convert to sRGB
  first; never upscale. Web tests check every listed photo exists in both sizes, matches its
  listed size, carries no metadata, stays within a size budget, and that no file is unlisted.
  The photos are public in the repository's history for good, so leave out anything that shows
  where you live.

- Architecture notes for the chat assistant: `packages/project-registry/src/docs-data.ts`. Keep each
  note short (400 characters at most), current, and free of private details; `source` must be a
  file or folder in this repository (folders end with `/`), and `repositoryUrl`/`branch` point the
  links at your fork.

## Database Changes

1. Edit `apps/api/src/database/schema.ts`.
2. `pnpm --filter @portfolio/api db:generate --name <change>` writes SQL into `apps/api/drizzle/`.
3. Review the SQL and commit it with the schema change.
4. `pnpm db:migrate`.

Migrations never run at API startup. See [runbooks](../operations/runbooks.md#rollback) for the
compatibility rules that keep image rollbacks safe.

## Troubleshooting

| Symptom                                                                     | Fix                                                                                                                                        |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `Invalid environment: DATABASE_URL …` at startup                            | Copy `.env.example` to `.env`; the message names every missing or invalid variable                                                         |
| Readiness shows `postgres: down`                                            | `docker compose ps`; check `POSTGRES_PORT` matches `DATABASE_URL`                                                                          |
| `required variable POSTGRES_DB is missing` from Compose                     | Run Compose from the repository root, where `.env` lives                                                                                   |
| Port already in use                                                         | Change `POSTGRES_PORT`, `REDIS_PORT`, `API_PORT`, `API_METRICS_PORT`, or `PORT` (web) in `.env`                                            |
| `pnpm bootstrap`: `DATABASE_URL uses port … but POSTGRES_PORT is …`         | The apps connect through `DATABASE_URL`/`REDIS_URL`; Compose publishes on `POSTGRES_PORT`/`REDIS_PORT`. Use the same port in both          |
| `pnpm bootstrap`: `.env is missing, but the database volume … still exists` | Restore your `.env`; or delete the old local data with `docker compose --env-file .env.example down --volumes` and run again               |
| `pnpm db:reset`: `The full stack is running`                                | Stop it first: `docker compose -f compose.full.yaml down`                                                                                  |
| `pnpm new:project` refuses a slug                                           | The reason is printed; the slug's generated names or files would clash with existing ones. Pick another                                    |
| `ENOTFOUND postgres` from `migrate` after a failed `up`                     | A half-started stack (e.g. a port clash) can leave containers off the network: `docker compose -f compose.full.yaml down`, then `up` again |
| `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`                                    | A dependency version is younger than pnpm's release-age policy; wait, or pin an older version                                              |
