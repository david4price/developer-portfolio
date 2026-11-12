# Implementation Roadmap

The single checklist for this project. Start here when you pick the work back up.

## ▶ Resume Here

_Last updated: 2026-11-12_

**Current phase:** 2 (Foundation) is almost done. Phase 3 is waiting on owner input.

**Recently done**

- Foundation merged to `main` (PR #1); first CI run green on all jobs.
- Full Compose stack verified end to end, including outage recovery.
- Agent rules (`AGENTS.md`, `.claude/rules/`) and ten project skills (`.agents/skills/`).
- Cloudflare account connected to the `cf` CLI; no domain on it yet.

**Next up, in order**

1. **P2-12:** replace the placeholder profile and experience content (needs the owner's text).
2. **P2-14:** return 503 `not_ready` instead of 500 when the database is down.
3. **P2-15:** paginate `GET /api/v1/projects` and select only summary columns.

**Waiting on the owner** (these unblock Phases 3 and 4)

- [ ] Choose a domain and add it to Cloudflare (P1-03).
- [ ] List the public hostnames on the existing Cloudflare tunnel (P1-03).
- [ ] Share the host firewall rules (P1-02).
- [ ] Pick an off-host backup destination (P1-04).

**Kept outside this repository:** the verified host inventory (private register), the privacy-scan
denylist (`~/.config/developer-portfolio/`), `.env`, and CLI logins. They exist only on the
reference host.

## How to Use This File

- Tick a box in the same pull request that completes the task, and refresh **Resume Here**.
- Task IDs are stable; reference them in branch names, commits, and PRs (e.g. `feat/p2-14-...`).
- A task is done only when its **done when** criterion is met. Note caveats in the line.
- 🔒 means the task changes a running server or an external account and needs explicit approval
  first (see `AGENTS.md`, Operational Safety).

## Phase 1: Inventory (1/4)

Read-only inventory of the reference host. Findings:
[validation register](architecture/validation-register.md).

- [x] **P1-01** Hardware, GPU, Docker, network, database, and AI inventory. _Done when:_ register
      written, no host changes.
- [ ] **P1-02** Host firewall rules. _Done when:_ rules recorded in the private register and a K3s
      allow-list drafted. _Owner:_ needs an elevated read.
- [ ] **P1-03** Domain and existing tunnel hostnames. _Done when:_ domain chosen and on Cloudflare,
      with no hostname collision with existing tunnel routes. _Status:_ Cloudflare account
      connected; no domain yet.
- [ ] **P1-04** Off-host backup destination. _Done when:_ destination, credential owner, and cost
      recorded.

## Phase 2: Foundation (12/15)

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
- [ ] **P2-14** Return 503 `not_ready` instead of 500 when a dependency is down. _Needs:_ P2-04.
      _Done when:_ `/projects` with the database down returns 503 with a typed code.
- [ ] **P2-15** Bring `GET /api/v1/projects` in line with Project Rule 8. _Needs:_ P2-04. _Done
      when:_ query selects summary columns only; response has `items` + `nextCursor`; `limit` (≤ 50)
      validated by zod; contract updated in `shared-types`; tests cover paging.

## Phase 3: Kubernetes and GitOps (0/7)

- [ ] **P3-01** Helm chart: api, worker, redis, postgres, NetworkPolicies, probes. _Needs:_ Phase 2. _Done when:_ `helm lint` and `helm template` pass in CI; no secrets in values.
- [ ] **P3-02** 🔒 Release workflow: GHCR push by digest, values commit. _Needs:_ P2-11. _Done
      when:_ digest-pinned values committed only from `main`. Changes GitHub settings.
- [ ] **P3-03** 🔒 Install K3s with Traefik and ServiceLB disabled. _Needs:_ P1-02. _Done when:_
      node Ready, existing services unaffected, rollback tested.
- [ ] **P3-04** 🔒 Install Argo CD, private over Tailscale. _Needs:_ P3-03. _Done when:_ UI
      reachable only via the tailnet; Application synced.
- [ ] **P3-05** 🔒 PostgreSQL backup CronJob and restore drill. _Needs:_ P3-03, P1-04. _Done
      when:_ one successful restore recorded.
- [ ] **P3-06** 🔒 HPA for api; Argo CD ignores replicas. _Needs:_ P3-04. _Done when:_ scale-out
      observed under synthetic load with no sync flapping.
- [ ] **P3-07** Secrets management decision (SOPS vs Sealed Secrets). _Needs:_ P3-03. _Done
      when:_ ADR in `docs/architecture/`.

## Phase 4: Public Edge (0/4)

- [ ] **P4-01** 🔒 Cloudflare Pages deployment of `apps/web/out`. _Needs:_ P1-03. _Done when:_
      site live; PR previews build without secrets.
- [ ] **P4-02** `_headers` with CSP (hash-based scripts) and HSTS. _Needs:_ P4-01. _Done when:_
      security-header scan passes; no CSP errors in the console.
- [ ] **P4-03** 🔒 Dedicated tunnel with in-cluster cloudflared, API-only ingress. _Needs:_ P3-04,
      P1-03. _Done when:_ only `/api/v1/*` reachable publicly; Argo CD unreachable.
- [ ] **P4-04** 🔒 Offline drill. _Needs:_ P4-03. _Done when:_ with the cluster stopped, the site
      loads and shows "unavailable".

## Phase 5: AI Chatbot (0/6)

- [ ] **P5-01** `openai-compatible` adapter with timeout and abort. _Needs:_ P2-08. _Done when:_
      contract tests pass against a fake server.
- [ ] **P5-02** Redis sessions with secure cookies and a per-session lock. _Needs:_ P2-06. _Done
      when:_ concurrent requests in one session yield one 409; sessions isolated.
- [ ] **P5-03** Quotas, global concurrency semaphore, bounded queue. _Needs:_ P5-01. _Done when:_
      load test shows 429/503 instead of timeouts.
- [ ] **P5-04** 🔒 Turnstile verification. _Needs:_ P5-02. _Done when:_ invalid or missing tokens
      rejected server-side. Creates a Cloudflare widget.
- [ ] **P5-05** Registry-grounded retrieval and validated navigation links. _Needs:_ P5-01. _Done
      when:_ unknown slugs never reach the client.
- [ ] **P5-06** 🔒 Connect to the reference inference runtime with a NetworkPolicy egress rule.
      _Needs:_ P3-03. _Done when:_ only the API pod can reach it; the private assistant is
      unaffected.

## Phase 6: Infrastructure Explorer (0/4)

- [ ] **P6-01** 🔒 Read-only ServiceAccount and Role for the `portfolio` namespace. _Needs:_
      P3-03. _Done when:_ `kubectl auth can-i` denies secrets, logs, and exec.
- [ ] **P6-02** Allowlist serializer with a 10–15 s cache. _Needs:_ P6-01. _Done when:_ snapshot
      tests prove no IPs, node names, env, or other namespaces leak.
- [ ] **P6-03** 🔒 Argo CD read-only token for sync status. _Needs:_ P3-04. _Done when:_ token
      scoped to one Application.
- [ ] **P6-04** React dashboard with an explicit "unavailable" state. _Needs:_ P6-02. _Done when:_
      offline drill shows "unavailable", never "healthy".

## Phase 7: Hardening (0/4)

- [ ] **P7-01** Prometheus-style metrics (latency, errors, queue depth, inference time). _Needs:_
      Phase 3. _Done when:_ metrics endpoint is not publicly routed.
- [ ] **P7-02** 🔒 Load tests and final resource requests and limits. _Needs:_ P7-01. _Done when:_
      `maxReplicas` and limits documented.
- [ ] **P7-03** Clean-machine reproducibility check. _Needs:_ Phase 2. _Done when:_ a fresh clone
      works from [local.md](deployment/local.md) alone.
- [ ] **P7-04** Cost review against current Cloudflare and GitHub limits. _Needs:_ Phase 4. _Done
      when:_ monthly estimate is within $0–10.
