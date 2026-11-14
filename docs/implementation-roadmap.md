# Implementation Roadmap

The single checklist for this project. Start here when you pick the work back up.

## ▶ Resume Here

_Last updated: 2026-11-14_

**Current phase:** 5 (AI chatbot). Phases 3 (Kubernetes and GitOps) and 4 (public edge) are complete:
the site and API are public, hardened, autoscaled, backed up, and proven to degrade gracefully.
Phase 2 lacks only the owner's content (P2-12).

**Recently done**

- P5-04 server boundary implemented: session creation requires a Turnstile token, hostname/action
  checks, a verification timeout, and an atomic Redis replay claim. Missing/invalid tokens never
  create sessions or cookies. AI-on configuration requires a secret and allowed hostnames;
  Compose and Helm support the settings, including explicit API-only verification egress.
  Widget creation, browser integration, and the live drill are still pending approval/setup.
- Review fixes to P5-07: role tags are rejected even when attached to a word (ambiguous
  `Task<Instructions>` syntax is reserved too); messages are checked before and after
  normalization so disguised bracket forms cannot bypass the shared detector. Regression tests
  cover message screening, HTTP rejection before the model, registry validation, and prompt data.
- Follow-ups to P5-05/P5-07: one control-markup detector (`controlMarkupIn` in the registry
  package) screens messages and replies, and the registry schema rejects it in content, so data
  reaches the model exactly as written (`Array<string>`, `10⁶`) yet can never pose as prompt
  structure; quota refunds are bound to their window by its expiry time. The guard's phrasing
  limit is recorded as P5-08.
- P5-07: chat messages are screened before the model (Unicode normalization; instruction
  override, prompt extraction, role markup, jailbreak, and hidden-payload patterns →
  `422 message_rejected`), and replies that leak the system rules are withheld. Full-repo review
  fixes: quota refunded when an overload rejection used no capacity, link markers by title and
  code-safe, planned mini-apps labelled in grounding data, quiet client disconnects, nginx
  security headers on static assets, a chart guard so AI with NetworkPolicies requires an
  inference egress rule, and a per-page CSP in
  `_headers` so adding projects can't outgrow Cloudflare's 2,000-character line limit.
- P5-05: chat answers are grounded in the project registry (in-memory keyword search, top 3
  snippets in a delimited data block, whole prompt held to ~1,500 tokens). The model links pages
  only through `[[project:<slug>]]` markers; the API validates them and returns `links`, and
  unknown slugs never reach the client.
- P3-06: the API autoscales on CPU (1–3 pods). Under synthetic load it scaled 1→2→3, served
  950k requests with zero errors, and scaled back to 1; Argo CD stayed Synced with no extra syncs.
- P3-05: nightly PostgreSQL backups, restore drilled: the dump restored cleanly, migrations had
  nothing to apply, and every table's row count matched production.
- P3-08: Sealed Secrets. Every portfolio Secret now lives in Git encrypted, so the cluster can be
  rebuilt from Git plus one locally backed-up key (restore drilled).
- P4-04: offline drill. With the whole cluster stopped, the site kept serving and said "API
  unavailable"; everything recovered on its own with data intact. Phase 4 complete.
- P4-03: the API is public at `api.<domain>/api/v1/*` only, through a dedicated tunnel with
  in-cluster `cloudflared`; everything else on that host is a 404, and Argo CD has no public
  hostname. Chat quotas use the real client IP from Cloudflare.
- P5-03: chat quotas (per session, per IP) and a Redis-backed global AI semaphore with a bounded
  FIFO queue; overload is `429`/`503` with `Retry-After`, never a hung request.
- P5-02: chat sessions (`POST /api/v1/chat/sessions`, `/messages`) with a 256-bit `HttpOnly` cookie,
  Redis state with a 24-hour TTL, and a per-session lock (`409 chat_busy`). Off while
  `AI_ENABLED=false`.
- P4-02: hash-based CSP and security headers live on the custom domain; zone hardened (HTTPS
  redirect, TLS 1.2 minimum, no edge script injection). Settings in the
  [Pages guide](deployment/cloudflare-pages.md#zone-settings).
- P4-01: the static site is live on Cloudflare Pages, built by Cloudflare from GitHub on every
  push to `main`, with a preview for every PR
  ([guide](deployment/cloudflare-pages.md)).
- P3-04: Argo CD v3.6.1 syncs the `portfolio` Application from `main` (Synced/Healthy); the UI is
  tailnet-only via `tailscale serve`. NetworkPolicies verified enforced: another namespace can't
  reach PostgreSQL, Redis, or the API, and the API has no internet egress.
- P6-04 design: [Infrastructure Explorer visual design](architecture/infrastructure-explorer.md)
  (flux-capacitor-inspired animated map).
- P3-03: K3s v1.37.2 installed with Traefik and ServiceLB off, behind the `kube-port-guard`
  nftables table. The LAN can't reach 6443/10250. The rollback drill found two uninstaller
  pitfalls, now in the [deployment guide](deployment/kubernetes.md#2-install-k3s-approval-required).
- P3-02: release workflow builds api and worker after CI passes on `main`, pushes them to GHCR
  (public packages), and commits their digests to `environments/production/images.yaml`. First
  run succeeded on 2026-11-13.
- P1-04: backups stay on the reference host for now (owner's call: not a production service).
- P5-01: `openai-compatible` adapter (`fetch`, 30 s timeout combined with the caller's abort,
  `max_tokens` on every call, no redirects, capped reply size). Failures become typed
  `ai_unavailable` / `ai_overloaded` errors without upstream text. Not yet reachable: no chat
  endpoint exists until P5-02.
- P1-02: host firewall reviewed (no conflicting rules); K3s ports get a dedicated nftables guard
  ([deployment guide](deployment/kubernetes.md#k3s-port-guard-allow-list)).
- P3-07: secrets go in Git as Sealed Secrets
  ([ADR 0001](architecture/adr-0001-secrets-management.md)); controller install is P3-08.
- P3-01: Helm chart (api, worker, PostgreSQL, Redis, migrate Job, default-deny NetworkPolicies),
  checked by `pnpm helm:check` locally and in CI.
- P2-15: `GET /api/v1/projects` is keyset-paginated (`limit` ≤ 50, `nextCursor`) and selects
  summary columns only.
- P1-03: domain is an active Cloudflare zone; no hostname collisions with the existing tunnel.
- P2-14: PostgreSQL outages return `503 not_ready` instead of 500.
- Foundation merged to `main` (PR #1); first CI run green on all jobs.
- Full Compose stack verified end to end, including outage recovery.
- Agent rules (`AGENTS.md`, `.claude/rules/`) and ten project skills (`.agents/skills/`).

**Next up, in order**

1. **P5-04:** 🔒 finish Turnstile setup: the server boundary is ready; create the dedicated
   Cloudflare widget, integrate it in the browser, provision the secret and egress, and run a
   live drill ([guide](deployment/turnstile.md)).
2. **P5-06:** 🔒 connect the API to the reference inference runtime (NetworkPolicy egress rule).
3. **P2-12:** replace the placeholder profile and experience content (owner will send the text
   later). Moving the profile into a shared package lets the chat index it too.

**Open pull requests:** none; #29 (control markup, refund windows) is merged. P5-04 implementation
is on `feat/p5-04-turnstile`. Open every PR against `main`.

**Waiting on the owner** (the domain for Phase 4 is ready)

- [x] Backup destination (P1-04): local for now.
- [x] Router forwards no ports to the reference host (confirmed 2026-11-13).
- [x] `portfolio-api` and `portfolio-worker` GHCR packages are public (anonymous pull verified).
- [ ] Send rough bullets for About and Experience (roles, years, stack, highlights) to draft P2-12.

**Kept outside this repository:** the verified host inventory (private register), the privacy-scan
denylist (`~/.config/developer-portfolio/`), `.env`, and CLI logins. They exist only on the
reference host.

## How to Use This File

- Tick a box in the same pull request that completes the task, and refresh **Resume Here**.
- Task IDs are stable; reference them in branch names, commits, and PRs (e.g. `feat/p2-14-...`).
- A task is done only when its **done when** criterion is met. Note caveats in the line.
- 🔒 means the task changes a running server or an external account and needs explicit approval
  first (see `AGENTS.md`, Operational Safety).

## Phase 1: Inventory (4/4)

Read-only inventory of the reference host. Findings:
[validation register](architecture/validation-register.md).

- [x] **P1-01** Hardware, GPU, Docker, network, database, and AI inventory. _Done when:_ register
      written, no host changes.
- [x] **P1-02** Host firewall rules. _Done when:_ rules recorded in the private register and a K3s
      allow-list drafted. Reviewed 2026-11-13: no rules conflict with K3s; the allow-list is a
      dedicated nftables table limiting 6443, 10250, and 8472/udp to loopback, tailnet, and pods.
- [x] **P1-03** Domain and existing tunnel hostnames. _Done when:_ domain chosen and on Cloudflare,
      with no hostname collision with existing tunnel routes. Verified 2026-11-12: zone active with
      no DNS records; the existing tunnel publishes no hostnames. Name kept in the private register.
- [x] **P1-04** Off-host backup destination. _Done when:_ destination, credential owner, and cost
      recorded. Owner's decision, 2026-11-13: backups stay on the reference host (owner holds
      access, $0) because this is not a production service. P3-05 and P3-08 back up to a local
      directory outside the cluster; a disk failure loses both data and backups. Pick an
      off-host destination before treating the site as production.

## Phase 2: Foundation (14/15)

- [x] **P2-01** pnpm workspace, strict TS, ESM, ESLint, Prettier. _Done when:_ `pnpm check` passes.
- [x] **P2-02** Shared packages: config, shared-types, project-registry, ui. _Needs:_ P2-01.
      _Done when:_ registry validation tests pass.
- [x] **P2-03** Static Next.js site with all planned routes. _Needs:_ P2-02. _Done when:_
      `pnpm build` exports every registry route to `apps/web/out`.
- [x] **P2-04** NestJS API: health, readiness, projects, typed errors, request IDs, CORS, JSON logs.
      _Needs:_ P2-02. _Done when:_ unit tests cover liveness, readiness failure, 404/400 shapes,
      CORS.
- [x] **P2-05** PostgreSQL schema, migrations, idempotent seed. _Needs:_ P2-04. _Done when:_
      integration job migrates and seeds twice.
- [x] **P2-06** Redis client and readiness. _Needs:_ P2-04. _Done when:_ readiness reports Redis
      down without hanging.
- [x] **P2-07** BullMQ worker with validated `noop` job. _Needs:_ P2-02. _Done when:_ worker tests
      pass and graceful shutdown closes the worker.
- [x] **P2-08** AI provider port with `disabled` adapter. _Needs:_ P2-04. _Done when:_ starts with
      AI off; enabling an unimplemented provider fails startup.
- [x] **P2-09** Compose for dependencies and the full stack. _Needs:_ P2-05. _Done when:_
      `docker compose config` passes with ports bound to loopback.
- [x] **P2-10** Dockerfiles (api, worker, web). _Needs:_ P2-09. _Done when:_ CI builds all images.
- [x] **P2-11** CI: check, integration, secret scan, signatures, image builds. _Needs:_ P2-01.
      _Done when:_ workflow green. First green run on PR #1, 2026-11-11.
- [ ] **P2-12** Replace placeholder profile and experience content. _Done when:_ no placeholder
      text on About or Experience. _Owner:_ provides the content.
- [x] **P2-13** 🔒 Run the full stack once. _Needs:_ P2-09. _Done when:_ `compose.full.yaml` up and
      the site works against the API. Verified 2026-11-11 over HTTP (routes, API, CORS, CSP, worker
      job, outage recovery); browser rendering not yet checked.
- [x] **P2-14** Return 503 `not_ready` instead of 500 when a dependency is down. _Needs:_ P2-04.
      _Done when:_ `/projects` with the database down returns 503 with a typed code. Unit test runs
      the real Drizzle adapter against a refused port; query errors stay 500.
- [x] **P2-15** Bring `GET /api/v1/projects` in line with Project Rule 8. _Needs:_ P2-04. _Done
      when:_ query selects summary columns only; response has `items` + `nextCursor`; `limit` (≤ 50)
      validated by zod; contract updated in `shared-types`; tests cover paging. Keyset cursor on
      (featured, title, slug); no index added, since the table holds only a few rows.

## Phase 3: Kubernetes and GitOps (8/8)

- [x] **P3-01** Helm chart: api, worker, redis, postgres, NetworkPolicies, probes. _Needs:_
      Phase 2. _Done when:_ `helm lint` and `helm template` pass in CI; no secrets in values. CI
      job `helm` runs `pnpm helm:check` (also kubeconform and guardrail tests). Worker liveness
      waits for a heartbeat. NetworkPolicy enforcement verified on K3s 2026-11-13 (P3-04).
- [x] **P3-02** 🔒 Release workflow: GHCR push by digest, values commit. _Needs:_ P2-11. _Done
      when:_ digest-pinned values committed only from `main`. First run 2026-11-13 committed
      `images.yaml` to `main`. `release.yml` runs after CI succeeds on a `main` push, uses per-job
      token permissions (no repository setting changed), and never pins an older build over a
      newer one.
- [x] **P3-03** 🔒 Install K3s with Traefik and ServiceLB disabled. _Needs:_ P1-02. _Done when:_
      node Ready, existing services unaffected, rollback tested, K3s ports (6443, 10250,
      8472/udp) unreachable from the LAN. Done 2026-11-13: v1.37.2+k3s1; all existing containers
      and their health unchanged through install, uninstall, and reinstall; LAN check by the
      owner. The first uninstall left the binary and data behind because the guard unit was named
      `k3s-guard.service`; renamed to `kube-port-guard` and drilled again cleanly.
- [x] **P3-04** 🔒 Install Argo CD, private over Tailscale. _Needs:_ P3-03. _Done when:_ UI
      reachable only via the tailnet; Application synced. Done 2026-11-13: pinned to the v3.6.1
      release commit; least-privilege `portfolio` AppProject; deployed revision and image digests
      match `main`; UI is a ClusterIP Service published only by `tailscale serve` (HTTPS 8443).
- [x] **P3-05** 🔒 PostgreSQL backup CronJob and restore drill. _Needs:_ P3-03, P1-04. _Done
      when:_ one successful restore recorded. Done 2026-11-13: nightly CronJob to a host directory
      outside K3s's data, 7 daily + 4 weekly; restore recorded in the
      [runbook](operations/runbooks.md#restore-drill). The first run showed that K3s refuses a
      new pod's connections for about two seconds, so the job now waits for PostgreSQL (#27).
- [x] **P3-06** 🔒 HPA for api; Argo CD ignores replicas. _Needs:_ P3-04. _Done when:_ scale-out
      observed under synthetic load with no sync flapping. Done 2026-11-13: CPU HPA (1–3
      replicas, 70%), Deployment omits `replicas` when enabled. Three minutes of load against
      the API's ClusterIP scaled it 1→2→3 (30 s apart) with zero failed requests; it returned to
      1 five and six minutes after the load stopped. Argo CD's sync history didn't change.
- [x] **P3-07** Secrets management decision (SOPS vs Sealed Secrets). _Needs:_ P3-03. _Done
      when:_ ADR in `docs/architecture/`. Owner chose Sealed Secrets, 2026-11-12:
      [ADR 0001](architecture/adr-0001-secrets-management.md).
- [x] **P3-08** 🔒 Install the Sealed Secrets controller, commit its public certificate, back up
      its key off-host. _Needs:_ P3-03, P1-04. _Done when:_ chart version and image digest pinned;
      automatic key renewal off; `sealed-secrets.pem` committed; key backup restored once into a
      throwaway cluster and a test `SealedSecret` unseals there. Done 2026-11-13: chart 2.22.0,
      image 0.41.2 by digest, `--key-renew-period 0`; the key is backed up **locally**, not
      off-host (P1-04); the restore was drilled in a throwaway K3s in Docker. The PostgreSQL
      password, tunnel token, and CORS origin are now SealedSecrets synced by Argo CD.

## Phase 4: Public Edge (4/4)

- [x] **P4-01** 🔒 Cloudflare Pages deployment of `apps/web/out`. _Needs:_ P1-03. _Done when:_
      site live; PR previews build without secrets. Live on `pages.dev` 2026-11-13 via Git
      integration (Cloudflare builds; no token in GitHub). Previews get no API URL and no secrets;
      first preview was this PR (#15). Custom domain: see
      [Cloudflare Pages](deployment/cloudflare-pages.md#custom-domain).
- [x] **P4-02** `_headers` with CSP (hash-based scripts) and HSTS. _Needs:_ P4-01. _Done when:_
      security-header scan passes; no CSP errors in the console. Done 2026-11-13 (#16, #17):
      generated `_headers` with a hash-based CSP; on the custom domain every header is present,
      `http://` redirects to HTTPS, TLS below 1.2 is refused, and headless Chromium shows 0 CSP
      violations on every page and client-side navigation. Edge script injection (Bot Fight Mode)
      turned off; Web Analytics allowed by exact host. External graders (securityheaders.com, SSL
      Labs) weren't run from here.
- [x] **P4-03** 🔒 Dedicated tunnel with in-cluster cloudflared, API-only ingress. _Needs:_ P3-04,
      P1-03. _Done when:_ only `/api/v1/*` reachable publicly; Argo CD unreachable.
      Done 2026-11-13 (#21): dedicated tunnel `portfolio-api` (4 edge connections); publicly,
      `/api/v1/health`, `/health/ready`, and `/projects` answer 200 while `/`, `/metrics`, `/api`,
      `/api/v2/*`, `/.env`, and an Argo-style path get the tunnel's 404; CORS admits only the site
      origin; the zone has no hostname for Argo CD. The live site's badge shows "API online".
- [x] **P4-04** 🔒 Offline drill. _Needs:_ P4-03. _Done when:_ with the cluster stopped, the site
      loads and shows "unavailable". Done 2026-11-13: `k3s-killall.sh` for about 3 minutes; the
      site served 200 throughout with "API unavailable — the site still works", and everything
      recovered on its own with data intact
      ([runbook](operations/runbooks.md#offline-drill-p4-04)).

## Phase 5: AI Chatbot (5/8)

- [x] **P5-01** `openai-compatible` adapter with timeout and abort. _Needs:_ P2-08. _Done when:_
      contract tests pass against a fake server. Tests cover timeouts (headers and mid-body), caller
      abort, 429/503 → overloaded, other errors, malformed and oversized replies, and redirects.
      `AI_BASE_URL` (http/https) is required for this provider. No API-key support yet.
- [x] **P5-02** Redis sessions with secure cookies and a per-session lock. _Needs:_ P2-06. _Done
      when:_ concurrent requests in one session yield one 409; sessions isolated. Done 2026-11-13:
      unit tests (concurrent message → one `409 chat_busy`, a busy session doesn't block another,
      no cross-session history) and Redis integration tests (one lock winner of 20, owner-only
      release, no TTL extension or resurrection). Chat stays off publicly until P5-03 and P5-04.
- [x] **P5-03** Quotas, global concurrency semaphore, bounded queue. _Needs:_ P5-01. _Done when:_
      load test shows 429/503 instead of timeouts. Done 2026-11-13: Redis-backed FIFO semaphore
      with expiring leases and a bounded queue, per-session and per-IP quotas with `Retry-After`.
      Load test (real Redis): 12 concurrent visitors, capacity 1 + queue 2 → 3 answered, 9
      immediate `503 ai_overloaded`, none hung.
- [ ] **P5-04** 🔒 Turnstile verification. _Needs:_ P5-02. _Done when:_ invalid or missing tokens
      rejected server-side. Server boundary implemented with hostname/action binding, bounded
      Siteverify calls, rate limits before verification, and Redis single-use token claims.
      Tests cover failure paths and concurrent replay. _Pending:_ create the Cloudflare widget,
      embed it in the browser, provision production settings, and run the live drill. See the
      [setup guide](deployment/turnstile.md).
- [x] **P5-05** Registry-grounded retrieval and validated navigation links. _Needs:_ P5-01. _Done
      when:_ unknown slugs never reach the client. Done 2026-11-14: unit tests drop unknown,
      wrong-kind, and malformed markers (none of their text reaches the response) and check that
      the prompt stays within budget at the worst case. Profile text is not indexed yet: it lives
      in the web app until P2-12.
- [ ] **P5-06** 🔒 Connect to the reference inference runtime with a NetworkPolicy egress rule.
      _Needs:_ P3-03. _Done when:_ only the API pod can reach it; the private assistant is
      unaffected. The chart side exists: set `api.ai.egress.cidr`/`port` (rendering fails without
      them when AI and NetworkPolicies are on).
- [x] **P5-07** Screen messages to and from the model. _Needs:_ P5-05. _Done when:_ injection
      attempts are rejected before the model, hidden characters never reach it, and replies that
      leak the system rules are withheld. Done 2026-11-14: `MessageGuard` port with a rule-based
      adapter; unit tests cover each rejection class, obfuscated variants, legitimate questions
      that must pass, and leak detection; service tests show rejected messages never reach the
      model or history and still cost quota.
- [ ] **P5-08** Classifier-based message screening. _Needs:_ P5-06, P5-07. _Done when:_ a
      classifier adapter behind `MESSAGE_GUARD` beats the rule-based one on the cases in
      `apps/api/test/message-guard.test.ts` plus a larger labelled set, within the latency and GPU
      budget the reference runtime leaves (it also serves the private assistant). Rules can't
      separate "print the initial prompt" from "does the CLI display its original prompt?" without
      trading one error for another.

## Phase 6: Infrastructure Explorer (0/4)

- [ ] **P6-01** 🔒 Read-only ServiceAccount and Role for the `portfolio` namespace. _Needs:_
      P3-03. _Done when:_ `kubectl auth can-i` denies secrets, logs, and exec.
- [ ] **P6-02** Allowlist serializer with a 10–15 s cache. _Needs:_ P6-01. _Done when:_ snapshot
      tests prove no IPs, node names, env, or other namespaces leak.
- [ ] **P6-03** 🔒 Argo CD read-only token for sync status. _Needs:_ P3-04. _Done when:_ token
      scoped to one Application.
- [ ] **P6-04** React dashboard with an explicit "unavailable" state. _Needs:_ P6-02. _Done when:_
      offline drill shows "unavailable", never "healthy".
      Design: animated infrastructure map in a flux-capacitor-inspired style
      ([visual design](architecture/infrastructure-explorer.md)). A prototype with fake data can come
      first.

## Phase 7: Hardening (0/5)

- [ ] **P7-01** Prometheus-style metrics (latency, errors, queue depth, inference time). _Needs:_
      Phase 3. _Done when:_ metrics endpoint is not publicly routed.
- [ ] **P7-02** 🔒 Load tests and final resource requests and limits. _Needs:_ P7-01. _Done when:_
      `maxReplicas` and limits documented.
- [ ] **P7-03** Clean-machine reproducibility check. _Needs:_ Phase 2. _Done when:_ a fresh clone
      works from [local.md](deployment/local.md) alone.
- [ ] **P7-04** Cost review against current Cloudflare and GitHub limits. _Needs:_ Phase 4. _Done
      when:_ monthly estimate is within $0–10.
- [ ] **P7-05** Upgrade to TypeScript 7 once typescript-eslint supports it. _Done when:_
      typescript-eslint's peer range includes TS 7; `pnpm check`, build, and integration tests pass;
      Nest dependency injection still works (decorator metadata); the TypeScript major-version
      ignore is removed from `.github/dependabot.yml`. Dependabot PR #2 was the first attempt
      (failed lint).
