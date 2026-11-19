# ADR 0002: Dependency Updates for Security Fixes Only

- **Status:** Accepted (2026-11-19).
- **Owner's choice:** no routine version PRs.

## Context

Dependabot opened version-update PRs every week for npm (grouped), GitHub Actions, and Docker base
images. The owner doesn't want to process package updates on a schedule. The project is a
portfolio with one operator, and most weekly bumps were minor or patch releases with nothing to act
on.

What each mechanism actually covers:

- **Dependabot alerts and security updates** support npm and GitHub Actions, not Docker. A
  security update opens a PR only when a dependency has a known vulnerability with a fix.
- **CI's `pnpm audit signatures`** checks that packages are genuinely from the registry
  (provenance). It does not check for vulnerabilities.
- **The application images** (API, worker, web) are built from floating tags
  (`node:24-trixie-slim`, `node:24-alpine`, `nginx-unprivileged:stable-alpine`) on fresh
  GitHub-hosted runners, so every release pulls the latest patch of those tags.
- **PostgreSQL, Redis, and cloudflared** are pinned by digest in the production values, so they
  change only when someone updates the digest.
- **Actions** are pinned to major tags (`@v7`), so each run uses the latest release within that
  major. Dependabot alerts may not match a bare major tag against an advisory's version range.

## Decision

- **Version updates off:** every ecosystem in `.github/dependabot.yml` has
  `open-pull-requests-limit: 0`.
- **Security on:** Dependabot alerts and Dependabot security updates are enabled in the
  repository's settings.
- **No ignore rules:** they would now only hold back security fixes.
- **Versions otherwise updated by hand:** deliberately, when a feature, a fix, or a task (such as
  P7-05, TypeScript 7) needs it.

## Consequences

- **Security fixes:** a vulnerable npm dependency raises an alert and, where a fix exists, a PR.
  Alerts for development-only tooling that never reaches the images can be dismissed with that
  reason.
- **Docker:** base images get no Dependabot coverage.
  - The application images pick up base-image patches on each release.
  - PostgreSQL, Redis, and cloudflared stay on their pinned digests until updated by hand. Check
    their upstream advisories when touching the infrastructure.
  - An image scan in CI (for example Trivy) is the step to add if this needs automating.
- **Actions:** they get patch and minor fixes within their major tag automatically; a new major is
  a manual change.
- **Dependencies drift further between deliberate updates.** Upgrades come in bigger steps, and
  each runs through the full quality gates and a review like any other change.
