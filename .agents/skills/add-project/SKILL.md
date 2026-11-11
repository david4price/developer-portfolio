---
name: add-project
description: Add, update, or remove a portfolio project or integrated mini-app in the project registry, then re-seed and verify the static routes and API. Use for portfolio content changes in packages/project-registry; not for profile/About/Experience text (apps/web/src/content/profile.ts) or for building a mini-app's functionality.
---

# Add or Update a Portfolio Project

The registry (`packages/project-registry/src/data.ts`) is the single source of truth. It drives the
static `/projects/[slug]` and `/apps/[slug]` pages, the API's `projects` table (via seed), and later
the chatbot's grounding and navigation links.

## 1. Gather the Facts

Ask the user for anything missing. Never invent achievements, metrics, employers, or links.

| Field                       | Rule                                                                |
| --------------------------- | ------------------------------------------------------------------- |
| `slug`                      | kebab-case, ≤ 64 chars, unique, stable (it is a public URL)         |
| `title` / `summary`         | ≤ 80 / ≤ 200 chars; summary is one sentence                         |
| `description`               | ≤ 4,000 chars, plain text                                           |
| `kind`                      | `portfolio-app` (lives in this monorepo) or `external-repository`   |
| `technologies`              | 1–20 short names, most important first                              |
| `featured`                  | shown on the homepage when `true`                                   |
| `repositoryUrl` / `liveUrl` | `https://` or `null`; required repository for `external-repository` |
| `miniAppSlug`               | slug of an entry in `miniApps`, or `null`                           |

Mini-apps have `slug`, `title`, `summary`, and `status` (`planned` until the app actually works).

## 2. Edit

- Add or modify the entry in `data.ts`. Keep featured projects first.
- Public content only: no private hostnames, addresses, or internal service names. Describe
  self-hosted infrastructure generically ("a single-node K3s cluster").
- Renaming a slug breaks public URLs. Avoid it; if unavoidable, mention the broken link to the user.
- If a new validation rule is needed, add it to `schema.ts` with a test in
  `packages/project-registry/test/registry.test.ts`.

## 3. Verify

```bash
pnpm exec tsc -b packages/project-registry
pnpm --filter @portfolio/project-registry test
pnpm build                                            # route list must include the new slug
```

Check the build output lists `/projects/<slug>` (and `/apps/<miniAppSlug>` if added). Removed
entries must disappear from the route list.

If a local database is running (never start one without approval):

```bash
pnpm db:seed   # upserts registry entries and deletes rows no longer listed
```

Finish with the `verify` skill.
