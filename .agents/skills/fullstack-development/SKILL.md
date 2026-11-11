---
name: fullstack-development
description: Build features across this repository's stack — static Next.js/React pages and mini-apps, NestJS REST endpoints, shared TypeScript contracts, PostgreSQL via Drizzle, and Redis/BullMQ jobs. Use when a feature spans frontend and backend, or to decide where new code belongs; use api-module, db-migration, or add-project for those narrower workflows.
---

# Full-Stack Development

## Where Code Belongs

| Need                                        | Location                                            |
| ------------------------------------------- | --------------------------------------------------- |
| Page, layout, interactive widget            | `apps/web/src/app/**`, `apps/web/src/components/**` |
| Reusable presentational component           | `packages/ui`                                       |
| Request/response types, error codes         | `packages/shared-types`                             |
| Project/mini-app content and its validation | `packages/project-registry`                         |
| Endpoint, business rule, persistence        | `apps/api/src/modules/<module>`                     |
| Slow, retryable, or scheduled work          | `apps/worker` (BullMQ), enqueued by the API         |
| Environment parsing helpers                 | `packages/config`                                   |

## End-to-End Feature Flow

1. **Contract first:** add types to `shared-types`. Both sides compile against them, so a mismatch
   fails `pnpm typecheck`.
2. **Backend:** follow the `api-module` skill (port, adapter, zod validation, typed errors, tests).
   Schema changes go through `db-migration`.
3. **Async work:** if a request would take more than ~1 s or must survive retries, enqueue a
   BullMQ job and return `202` with an id. Processors validate payloads with zod, are idempotent,
   and set `attempts`/`backoff` explicitly. Queue names are constants shared by producer and
   worker.
4. **Frontend:** the site is a static export, so data is either known at build time (registry,
   profile) or fetched client-side from the API. Client fetches use `apiUrl()`, a timeout, and
   handle not-configured, unavailable, loading, error, and success states. Keep server-only code
   out of `'use client'` modules.
5. **Mini-apps:** registry entry (`add-project`), then a client component under
   `apps/web/src/mini-apps/<slug>/` loaded with `next/dynamic` from `/apps/[slug]`; flip `status`
   to `available` only when it works.

## Conventions

- Strict TypeScript, ESM; `.js` extensions in Node package imports; `@/` alias in the web app.
- Redis usage is namespaced (`portfolio:<module>:<key>`) and every key has a TTL unless it is a
  BullMQ structure.
- PostgreSQL access only through a module's adapter; no cross-module table access.
- Measure frontend performance instead of assuming it; the `cloudflare:web-perf` skill helps audit
  Core Web Vitals.

Finish with the `verify` skill.
