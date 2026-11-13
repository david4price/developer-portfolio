# Static Site on Cloudflare Pages

**Status:** live on the project's `pages.dev` address since 2026-11-13 (P4-01). The custom domain is
attached separately (see below).

The site is the static export in `apps/web/out`. Cloudflare Pages builds it from GitHub, so no
Cloudflare credential lives in this repository or in GitHub Actions.

## Why Git integration

Cloudflare builds every push to `main` (production) and every pull-request branch (preview) itself.
Pull-request builds therefore never see a deploy token, and the only values they get are the plain
build variables below. The alternative, uploading from GitHub Actions, would need an API token in
the repository and couldn't publish PR previews without exposing it to PR workflows.

The Cloudflare GitHub App is installed on **this repository only**. Cloudflare doesn't build pull
requests from forks.

## Project Settings

| Setting                | Value                                                             |
| ---------------------- | ----------------------------------------------------------------- |
| Production branch      | `main`                                                            |
| Framework preset       | None                                                              |
| Build command          | `corepack enable && pnpm install --frozen-lockfile && pnpm build` |
| Build output directory | `apps/web/out`                                                    |
| Root directory         | repository root                                                   |
| Preview deployments    | all branches; PR comments on                                      |

Build variables (plain text, not secrets):

| Variable                          | Production             | Preview |
| --------------------------------- | ---------------------- | ------- |
| `NODE_VERSION`                    | `24`                   | `24`    |
| `SKIP_DEPENDENCY_INSTALL`         | `1`                    | `1`     |
| `NEXT_TELEMETRY_DISABLED`         | `1`                    | `1`     |
| `COREPACK_ENABLE_DOWNLOAD_PROMPT` | `0`                    | `0`     |
| `NEXT_PUBLIC_API_BASE_URL`        | `https://api.<domain>` | _unset_ |

- `SKIP_DEPENDENCY_INSTALL` turns off the builder's own install, so pnpm (the version pinned in
  `packageManager`, via Corepack) installs with `--frozen-lockfile` and the workspace's
  supply-chain policies, exactly as CI does.
- Previews have no API URL, so their API badge says "not configured" and they never call the
  production API. Production points at the API hostname that the tunnel serves from P4-03; until
  then its badge honestly says "unavailable".

## Security Headers

`pnpm build` writes `apps/web/out/_headers` (see
[security](../architecture/security.md#frontend-confirmed-p4-02)). Pages applies it on deploy;
nothing is configured in the dashboard. Check a deployment with
`curl -sI https://<deployment>/ | grep -i -E 'content-security|strict-transport'`.

## Custom Domain

Attach the apex domain to the project (dashboard: the project → **Custom domains**, or
`cf pages projects domains create <project> --name <domain>`). Pages then needs a proxied `CNAME`
from the apex to `<project>.pages.dev` in the zone; the dashboard creates it, the API does not.
Check that the domain's status becomes `active` and that `https://<domain>/` serves the **same HTML**
as `<project>.pages.dev`, not just a 200. A Worker can claim the hostname too: a read-only
`AAAA <domain> → 100::` record means the domain belongs to a Worker, not to Pages.

## Zone Settings

Set on the reference zone on 2026-11-13 (dashboard search finds each by name):

| Setting                         | Value | Why                                                           |
| ------------------------------- | ----- | ------------------------------------------------------------- |
| Always Use HTTPS                | On    | `http://` gets a 301 to `https://`; HSTS keeps browsers there |
| Minimum TLS Version             | 1.2   | TLS 1.0/1.1 are deprecated; only very old clients lack 1.2    |
| Bot Fight Mode                  | Off   | Injects an inline script the CSP can't hash; static site      |
| JavaScript Detections           | Off   | Same script; on the free plan it follows Bot Fight Mode       |
| Web Analytics (beacon injected) | On    | Allowed in the CSP by its two exact hosts                     |

Keep Rocket Loader and email obfuscation off for the same reason as JavaScript Detections. The API
gets its own abuse controls (Turnstile, Redis rate limits) in Phase 5.

## Rollback

Every deployment stays available. Roll production back to an earlier one in the dashboard
(Deployments → ⋯ → Rollback) or with `cf pages projects deployments rollback`. A revert on `main`
redeploys too.
