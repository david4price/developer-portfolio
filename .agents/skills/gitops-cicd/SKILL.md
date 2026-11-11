---
name: gitops-cicd
description: Write or review GitHub Actions workflows, GHCR image publishing, digest-pinned GitOps values, Argo CD Applications, and rollback procedures for this repository. Use for .github/ and infrastructure/argocd/ or environments/ changes, release design, or deployment troubleshooting. Never pushes, tags, releases, or syncs without an explicit request.
---

# GitOps and CI/CD

Status: CI (`.github/workflows/ci.yml`) exists; release workflow, GHCR publishing, and Argo CD are
**Proposed** (Phase 3).

## CI (current)

Jobs: `check` (install, `pnpm audit signatures`, `pnpm check`, `pnpm build`), `integration`
(PostgreSQL + Redis service containers, migrate, seed twice, integration tests), `secrets`
(gitleaks), `images` (build api/worker/web, no push).

Rules for any workflow change:

- Top-level `permissions: contents: read`; widen per job only when required (e.g.
  `packages: write` in the release job).
- `pull_request` workflows never receive deploy credentials, publish images, or run on
  self-hosted runners. Fork PRs are untrusted code.
- Use `pnpm install --frozen-lockfile`; never relax pnpm's supply-chain policies in CI.
- Pin actions to a major version; Dependabot keeps them current.
- Keep CI fast: path filters only when they can't skip required checks.

## Release Flow (Phase 3 target)

1. Trigger on push to `main` (after CI) or a version tag.
2. Build api, worker, web images; push to `ghcr.io/<owner>/developer-portfolio-<app>` with a
   version/sha tag; record the **digest**.
3. Commit the digests to `infrastructure/environments/production/values.yaml` with a bot identity
   (or open a PR). Never deploy mutable tags.
4. Argo CD (private, reached over Tailscale) polls the repo and syncs. No inbound connectivity
   from GitHub to the cluster.
5. Migrations run as an Argo CD PreSync Job and must be backward compatible (`db-migration`).

## Argo CD Application

- Source: this repo, path `infrastructure/environments/production` (Helm values) or the chart
  with value files; `targetRevision: main`.
- `syncPolicy.automated` with `prune: true` and `selfHeal: true` once stable.
- `ignoreDifferences` on `apps/Deployment` `/spec/replicas` for HPA-managed workloads.
- Never expose the Argo CD server publicly; read-only tokens for the Infrastructure Explorer are
  scoped to one project/application.

## Rollback

Revert the digest commit; Argo CD rolls back. Database rollback is never automatic — the
compatibility rules in `docs/operations/runbooks.md#rollback` make the previous image work with the
new schema.

## Safety

Creating tags, releases, GitHub settings, secrets, environments, or running workflows manually is
outward-facing: confirm with the user first.
