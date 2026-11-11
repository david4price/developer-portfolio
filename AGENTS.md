# Developer Portfolio — Agent Rules

## What This Repository Is

A **public** monorepo: static Next.js site (`apps/web`), NestJS REST API (`apps/api`), BullMQ worker
(`apps/worker`), and shared packages (`packages/*`). Anyone must be able to clone and run it without
the original author's infrastructure, AI model, or Cloudflare account.

Architecture, decisions, and status live in `docs/`. Read `docs/architecture/overview.md` before
structural changes and `docs/implementation-roadmap.md` before starting backlog work.

## Project Rules

1. **Architecture first.** Follow the documented architecture: one modular-monolith API, one
   worker, a static site, shared packages. Don't add services, frameworks, or dependencies the docs
   don't call for; propose an architecture change (and update `docs/architecture/`) before
   building one. Prefer the platform and existing packages over new libraries.
2. **Clean code.** Apply SOLID, DRY, KISS, and separation of concerns as this repo does: thin
   controllers and entrypoints, logic behind ports, adapters for I/O, one responsibility per
   module, no cross-module persistence access. Strict TypeScript with no `any`, no non-null
   assertions to silence the compiler, and names that say what things are. Remove dead code rather
   than commenting it out.
3. **Security first.** Never expose secrets, internal infrastructure, or administrative endpoints.
   Validate every input at the boundary, return typed errors without internals, and grant the
   least privilege that works (containers, ServiceAccounts, tokens, CI permissions). Details:
   [Public Repository Boundary](#public-repository-boundary) and the `application-security`
   skill.
4. **Infrastructure safety.** Inspect before modifying, read-only first. Never disrupt existing
   Docker services, networking, databases, or Tailscale without approval; see
   [Operational Safety](#operational-safety).
5. **Reproducibility.** Every feature must run in local development, in `compose.full.yaml`, and
   (from Phase 3) on Kubernetes. That means configuration only through validated environment
   variables with `.env.example` entries, no host-specific paths or hidden local state, stateless
   processes, and any new service added to both Compose files and the Helm chart plan.
6. **Testing.** Add meaningful tests with every behavior change: unit tests for logic and
   HTTP contracts (including failure paths), integration tests for adapters against real
   PostgreSQL/Redis. Work is complete only after the [quality gates](#quality-gates) pass; report
   anything that could not run.
7. **Documentation.** Update docs in the same change as the code: architecture
   (`docs/architecture/`, labelled **Confirmed**, **Proposed**, or **Unknown**), environment
   variables (`.env.example`, `docs/deployment/local.md`), API endpoints (the endpoint table in
   `docs/deployment/local.md` until a dedicated API reference exists), README, and roadmap status.
8. **Performance.** Prefer lightweight solutions: static rendering over runtime work, lazy-loaded
   mini-apps (`next/dynamic`), no client JavaScript where HTML suffices, indexed and bounded
   queries (select needed columns, paginate lists), Redis caching only where measured, and
   stateless API replicas. Measure before optimizing and before claiming a performance result.

## Public Repository Boundary

- Never commit real infrastructure details: IP addresses, hostnames, tailnet names, container names,
  device or hardware identifiers, email addresses, domain-specific tunnel routes, or account IDs.
  Use placeholders such as `<inference-host>`, `api.example.com`, `<tailnet-hostname>`.
- The verified inventory of the reference deployment is private and lives outside this repository.
  The public mirror is `docs/architecture/validation-register.md`; keep it sanitized.
- Never commit secrets. `.env*` is ignored except `.env.example`, which holds placeholders only.
  Configuration schemas must not provide defaults for secrets.
- Run the `verify` skill (it includes a privacy scan) before every handoff.

## Operational Safety

Repository changes never authorize changes to running systems. Without an explicit request for
that specific action, do not:

- start, stop, build, or recreate containers on a shared host (rendering Compose with
  `config --quiet` is fine);
- install or modify K3s, Helm releases, Argo CD, Cloudflare (DNS, tunnels, Pages, WAF), Tailscale,
  firewall rules, or reverse proxies;
- run migrations or seeds against any database other than a disposable local one;
- create, push, or merge branches, tags, releases, or pull requests.

When an operational step is requested, first state the change, expected impact, validation, and
rollback. Items marked 🔒 in the roadmap always need this.

## Toolchain

- Node.js 24, pnpm pinned through `packageManager`. pnpm may not be installed globally: use
  `corepack pnpm …`, and make sure nested `pnpm` calls in scripts resolve (e.g. `corepack enable`
  or corepack shims on `PATH`).
- Strict TypeScript, ESM, `.js` extensions in relative imports of Node packages.
- Do not bypass pnpm's supply-chain policies in `pnpm-workspace.yaml` (minimum release age,
  `allowBuilds`). If a brand-new version is rejected, pick an older one.
- Tests use `node:test` against compiled output, not Vitest or Jest.

## Quality Gates

Before handoff run, from the repository root:

```bash
pnpm check   # format:check, lint, typecheck, unit tests
pnpm build   # TypeScript projects + static export
```

Plus `docker compose --env-file .env.example -f compose.yaml config --quiet` (and the same for
`compose.full.yaml`) after Compose changes, and `git diff --check`. Report anything that could not
run, such as integration tests that need PostgreSQL and Redis.

## Working Agreements

- Inspect `git status --short` first and preserve unrelated work.
- Keep changes scoped; keep format-only changes separate from behavior changes where practical.
- Follow existing patterns. Area rules live in `.claude/rules/`: read the one for the area you are
  editing (`api.md`, `web.md`, `packages.md`, `infrastructure.md`, `docs.md`).
- Skills for recurring workflows live in `.agents/skills/` (also visible as `.claude/skills/`).
