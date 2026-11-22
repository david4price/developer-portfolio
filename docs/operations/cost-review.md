# Cost Review (P7-04)

_Reviewed 2026-11-20 against the providers' published limits and the reference deployment's
account usage (read-only `cf` and `gh` queries). Free tiers change: repeat this review yearly, or
when a provider announces new limits._

**Result: about $0.90 a month**, all of it the domain. Every service runs on a free plan, and none
of them bills for overage on that plan. The target was $0–10 a month.

## Recurring Costs

| Item                                  | Plan and limit that matters                                                                        | Use (2026-11)                                | Cost                       |
| ------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------- | -------------------------- |
| Cloudflare zone (DNS, CDN, TLS, WAF)  | Free plan                                                                                          | One zone                                     | $0                         |
| Cloudflare Pages (static site)        | Free: **500 builds a month**, one at a time, 20 min each; 20,000 files of at most 25 MiB           | 150 builds in the first 7 days (see below)   | $0                         |
| Cloudflare Tunnel                     | Zero Trust Free                                                                                    | One tunnel, API only                         | $0                         |
| Cloudflare rate limiting              | Free: one rule, counted per IP over 10 s                                                           | One rule on `/api/v1/` (P7-09)               | $0                         |
| Cloudflare Turnstile                  | Free: up to 20 widgets, 10 hostnames each, unlimited challenges and Siteverify calls               | One widget                                   | $0                         |
| Domain (`.com`, Cloudflare Registrar) | Sold at cost; renews automatically                                                                 | One domain                                   | ~$10.46 a year (~$0.87/mo) |
| GitHub repository and Actions         | Standard GitHub-hosted runners are free in public repositories; 10 GB Actions cache per repository | Public repository; ~6 MB of cache            | $0                         |
| GitHub Container Registry             | Container storage and bandwidth are currently free (one month's notice before that changes)        | Two public images, pulled anonymously by K3s | $0                         |
| Inference, K3s, PostgreSQL, Redis     | Self-hosted on the reference home server                                                           | Existing hardware                            | Not counted (see below)    |

Notes:

- **Domain:** Verisign is raising the `.com` wholesale price (reported $10.26 → $10.97). Cloudflare
  passes that through at cost, so expect about $11.20 a year (~$0.93/mo) from the next renewal.
- **Self-hosted:** the home server's electricity and hardware already exist for other workloads;
  the portfolio adds no separate bill, so it isn't counted here.
- **No paid upgrades:** nothing in this repository needs Workers, Pages Functions, Cloudflare
  paid plans, or GitHub paid runners. The site is fully static, and the API is reached through the
  tunnel.

## Limit to Watch: Pages Builds

Cost can't rise on the free plan, but builds can run out. Cloudflare's docs give the limit
without saying what happens past it; third-party reports say further builds are rejected until
the next month while the site stays on its last deployment (**Unknown**, not observed here).

The first week (2026-11-13 to 11-19, heavy development) used 150 builds: 90 production and 60
preview. **43 production builds were the release workflow's `chore(release): pin images` commits**,
which only change `infrastructure/environments/production/images.yaml` and leave the site
unchanged. At that week's pace a month would need about 640 builds; development has slowed since,
but a busy month could still reach the limit.

Fix (needs approval, it changes the Cloudflare project): build only when something the site is
built from changes. The web build reads `apps/web`, `packages/*`, the root workspace files, and
`.env`, never `docs/` or `infrastructure/`. In the Pages project's build settings, add the
build watch **exclude paths** `infrastructure/*` and `docs/*` (`*` matches across `/`). A push
still builds when any changed file falls outside them, and always when it has no file changes,
3,000 or more changed files, or 20 or more commits. That would have skipped the 43 release-pin
builds and every docs-only change, about a third of the first week's builds. Applied 2026-11-20
(**P7-07**); on 2026-11-21 the first release-pin commit after it was skipped. Still to see: the
next change under `apps/web` building as before.

## Sources

- [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/) and
  [build watch paths](https://developers.cloudflare.com/pages/configuration/build-watch-paths/)
- [Cloudflare Turnstile plans](https://developers.cloudflare.com/turnstile/plans/)
- [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [GitHub Packages billing](https://docs.github.com/en/billing/concepts/product-billing/github-packages)
- `.com` price at Cloudflare: [whtop](https://www.whtop.com/plans/cloudflare.com/135912);
  wholesale increase: [CostGoat](https://costgoat.com/compare/domains/com)
