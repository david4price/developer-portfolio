---
name: verify
description: Run this repository's full pre-handoff verification — format, lint, typecheck, unit tests, build, Compose rendering, whitespace, and a privacy scan for private infrastructure details. Use before reporting work as done, before commits, and after any change to code, configuration, or docs. Does not start containers or touch live systems.
---

# Verify

Run every step from the repository root and report each result. A step that cannot run is
reported as **not run** with the reason — never as passed.

## 1. Toolchain

```bash
corepack pnpm --version   # must match packageManager in package.json
```

Root scripts call `pnpm` recursively. If `pnpm` is not on `PATH`, either run `corepack enable`
(when the user permits) or put corepack shims in a temporary directory:
`corepack enable --install-directory <tmp>/bin pnpm` and prepend it to `PATH`.

## 2. Code Quality

```bash
pnpm check   # format:check, lint (zero warnings), typecheck, unit tests
pnpm build   # TypeScript projects + static export to apps/web/out
```

On a formatting failure, run `pnpm format`, then re-run `pnpm check`. Fix lint and type errors at
the source; don't add `eslint-disable` or `@ts-expect-error` without a stated reason.

## 3. Configuration

Only if Compose files, `.env.example`, or Dockerfiles changed:

```bash
docker compose --env-file .env.example -f compose.yaml config --quiet
docker compose --env-file .env.example -f compose.full.yaml config --quiet
```

Never print the rendered configuration.

## 4. Integration Tests (conditional)

`pnpm test:integration` needs PostgreSQL and Redis with migrations and seed applied. Run it only
if those are already available locally or the user approved starting `compose.yaml`. Otherwise
report "not run — CI covers it".

## 5. Repository Hygiene

```bash
bash .agents/skills/verify/scripts/privacy-scan.sh
git diff --check
git status --short
```

The privacy scan checks files that would be committed for private/CGNAT IP addresses, email
addresses, `.lan`/`.ts.net` hostnames, and owner-specific terms from a denylist kept outside the
repo (`$PORTFOLIO_PRIVATE_DENYLIST`, default `~/.config/developer-portfolio/private-denylist.txt`).
Any finding blocks handoff: replace the value with a placeholder. Never add private terms to files
inside the repository, including this skill.

Confirm `git status` shows only intended changes and that no build output (`dist/`, `.next/`,
`out/`, `.test-dist/`) or `.env` is untracked-but-not-ignored.

## 6. Report

Summarize as a short table: step, result (passed / failed / not run), and detail. Include test
counts from `pnpm check`.
