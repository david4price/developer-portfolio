# Implementation Roadmap and Backlog

Legend: ✅ done · 🔜 next · ⏳ pending · 🔒 needs explicit approval before touching a running server
or an external account.

## Phase Overview

| Phase | Goal                                                                | Status                                                                                               |
| ----- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1     | Read-only inventory of the reference host                           | ✅ Done (open questions listed in the [register](architecture/validation-register.md#still-unknown)) |
| 2     | Application foundation: monorepo, web, API, worker, local stack, CI | ✅ Scaffold done and run end to end. P2-12, P2-14, P2-15 still open                                  |
| 3     | K3s, Helm, Argo CD, GHCR releases, HPA                              | ⏳                                                                                                   |
| 4     | Public frontend, DNS, tunnel, TLS/CORS                              | ⏳                                                                                                   |
| 5     | AI chatbot                                                          | ⏳                                                                                                   |
| 6     | Infrastructure Explorer                                             | ⏳                                                                                                   |
| 7     | Hardening, load tests, restore drills, cost review                  | ⏳                                                                                                   |

## Backlog

### Phase 1: Inventory

| ID       | Task                                                       | Depends | Acceptance criteria                                              | Approval                    |
| -------- | ---------------------------------------------------------- | ------- | ---------------------------------------------------------------- | --------------------------- |
| P1-01 ✅ | Hardware, GPU, Docker, network, database, and AI inventory | —       | Register written; no host changes                                | —                           |
| P1-02 ⏳ | Host firewall rules                                        | —       | Rules recorded in the private register; K3s allow-list drafted   | Owner runs an elevated read |
| P1-03 ⏳ | Domain and existing tunnel hostnames                       | —       | Domain chosen; no hostname collision with existing tunnel routes | Owner                       |
| P1-04 ⏳ | Off-host backup destination                                | —       | Destination, credentials owner, and cost recorded                | Owner                       |

### Phase 2: Foundation

| ID       | Task                                                                                                                                                                               | Depends | Acceptance criteria                                                                                                                                     | Approval                        |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| P2-01 ✅ | pnpm workspace, strict TS, ESM, ESLint, Prettier                                                                                                                                   | —       | `pnpm check` passes                                                                                                                                     | —                               |
| P2-02 ✅ | Shared packages: config, shared-types, project-registry, ui                                                                                                                        | P2-01   | Registry validation tests pass                                                                                                                          | —                               |
| P2-03 ✅ | Static Next.js site with all planned routes                                                                                                                                        | P2-02   | `pnpm build` exports every registry route to `apps/web/out`                                                                                             | —                               |
| P2-04 ✅ | NestJS API: health, readiness, projects, typed errors, request IDs, CORS, JSON logs                                                                                                | P2-02   | Unit tests cover liveness, readiness failure, 404/400 shapes, CORS                                                                                      | —                               |
| P2-05 ✅ | PostgreSQL schema, migrations, idempotent seed                                                                                                                                     | P2-04   | Migration generated; integration job migrates and seeds twice                                                                                           | —                               |
| P2-06 ✅ | Redis client and readiness                                                                                                                                                         | P2-04   | Readiness reports Redis down without hanging                                                                                                            | —                               |
| P2-07 ✅ | BullMQ worker shell with validated `noop` job                                                                                                                                      | P2-02   | Worker tests pass; graceful shutdown closes the worker                                                                                                  | —                               |
| P2-08 ✅ | AI provider port with `disabled` adapter                                                                                                                                           | P2-04   | Starts with AI off; enabling an unimplemented provider fails startup                                                                                    | —                               |
| P2-09 ✅ | Local Compose (deps) and full Compose stack                                                                                                                                        | P2-05   | `docker compose config` passes; ports bound to loopback                                                                                                 | —                               |
| P2-10 ✅ | Dockerfiles (api, worker, web)                                                                                                                                                     | P2-09   | Build steps reproduced outside Docker; CI builds images                                                                                                 | —                               |
| P2-11 ✅ | CI: check, integration, secret scan, signatures, image builds (first run green on PR #1, 2026-11-11)                                                                               | P2-01   | Workflow green on first push                                                                                                                            | —                               |
| P2-12 🔜 | Replace placeholder profile and experience content                                                                                                                                 | —       | No placeholder text on About/Experience                                                                                                                 | Owner content                   |
| P2-13 ✅ | Run the full local stack once on a development machine (2026-11-11: all routes, API, CORS, CSP, worker job, outage recovery verified over HTTP; browser rendering not yet checked) | P2-09   | `compose.full.yaml` up; site at :8080 shows "API online"                                                                                                | 🔒 if run on the reference host |
| P2-14 ⏳ | Map the API's dependency-outage errors to 503 `not_ready` instead of 500                                                                                                           | P2-04   | `/projects` with DB down returns 503 with a typed code                                                                                                  | —                               |
| P2-15 ⏳ | Bring `GET /api/v1/projects` in line with Project Rule 8: select only summary columns and paginate (`limit` ≤ 50 + cursor)                                                         | P2-04   | Query selects summary columns only; response has `items` + `nextCursor`; limit validated by zod; contract updated in `shared-types`; tests cover paging | —                               |

### Phase 3: Kubernetes and GitOps

| ID    | Task                                                              | Depends      | Acceptance criteria                                              | Approval           |
| ----- | ----------------------------------------------------------------- | ------------ | ---------------------------------------------------------------- | ------------------ |
| P3-01 | Helm chart: api, worker, redis, postgres, NetworkPolicies, probes | P2-*         | `helm lint` and `helm template` pass in CI; no secrets in values | —                  |
| P3-02 | Release workflow: GHCR push by digest, values commit              | P2-11        | Digest-pinned values committed only from `main`                  | GitHub settings 🔒 |
| P3-03 | Install K3s with Traefik/ServiceLB disabled                       | P1-02        | Node Ready; existing services unaffected; rollback tested        | 🔒                 |
| P3-04 | Install Argo CD, private over Tailscale                           | P3-03        | UI reachable only via tailnet; Application synced                | 🔒                 |
| P3-05 | PostgreSQL backups CronJob + restore drill                        | P3-03, P1-04 | One successful restore recorded                                  | 🔒                 |
| P3-06 | HPA for api; Argo ignores replicas                                | P3-04        | Scale-out observed under synthetic load; no sync flapping        | 🔒                 |
| P3-07 | Secrets management decision (SOPS vs Sealed Secrets)              | P3-03        | ADR in `docs/architecture`                                       | —                  |

### Phase 4: Public Edge

| ID    | Task                                                        | Depends      | Acceptance criteria                                          | Approval |
| ----- | ----------------------------------------------------------- | ------------ | ------------------------------------------------------------ | -------- |
| P4-01 | Cloudflare Pages deployment of `apps/web/out`               | P1-03        | Site live; preview builds for PRs without secrets            | 🔒       |
| P4-02 | `_headers` with CSP (hash-based scripts), HSTS              | P4-01        | Security headers scan passes; no console CSP errors          | —        |
| P4-03 | Dedicated tunnel + in-cluster cloudflared, API-only ingress | P3-04, P1-03 | Only `/api/v1/*` reachable publicly; Argo CD unreachable     | 🔒       |
| P4-04 | Offline drill                                               | P4-03        | With the cluster stopped, site loads and shows "unavailable" | 🔒       |

### Phase 5: AI Chatbot

| ID    | Task                                                                | Depends | Acceptance criteria                                             | Approval      |
| ----- | ------------------------------------------------------------------- | ------- | --------------------------------------------------------------- | ------------- |
| P5-01 | `openai-compatible` adapter with timeout and abort                  | P2-08   | Contract tests against a fake server; no SDK lock-in            | —             |
| P5-02 | Sessions in Redis with secure cookies and per-session lock          | P2-06   | Concurrent requests in one session → one 409; sessions isolated | —             |
| P5-03 | Quotas, global concurrency semaphore, bounded queue                 | P5-01   | Load test shows 429/503 instead of timeouts                     | —             |
| P5-04 | Turnstile verification                                              | P5-02   | Invalid or missing tokens rejected server-side                  | Cloudflare 🔒 |
| P5-05 | Registry-grounded retrieval and validated navigation links          | P5-01   | Unknown slugs never reach the client                            | —             |
| P5-06 | Connect to the reference inference runtime via NetworkPolicy egress | P3-03   | Only the API pod can reach it; private assistant unaffected     | 🔒            |

### Phase 6: Infrastructure Explorer

| ID    | Task                                                      | Depends | Acceptance criteria                                               | Approval |
| ----- | --------------------------------------------------------- | ------- | ----------------------------------------------------------------- | -------- |
| P6-01 | Read-only ServiceAccount + Role for `portfolio` namespace | P3-03   | `kubectl auth can-i` denies secrets, logs, exec                   | 🔒       |
| P6-02 | Allowlist serializer + 10–15 s cache                      | P6-01   | Snapshot tests prove no IPs, node names, env, or other namespaces | —        |
| P6-03 | Argo CD read-only token for sync status                   | P3-04   | Token scoped to one Application                                   | 🔒       |
| P6-04 | React dashboard with explicit "unavailable" state         | P6-02   | Offline drill shows "unavailable", never "healthy"                | —        |

### Phase 7: Hardening

| ID    | Task                                                                    | Depends | Acceptance criteria                                          | Approval |
| ----- | ----------------------------------------------------------------------- | ------- | ------------------------------------------------------------ | -------- |
| P7-01 | Prometheus-style metrics (latency, errors, queue depth, inference time) | P3-*    | Metrics endpoint not publicly routed                         | —        |
| P7-02 | Load tests and final resource requests/limits                           | P7-01   | Documented `maxReplicas` and limits                          | 🔒       |
| P7-03 | Clean-machine reproducibility check                                     | P2-*    | Fresh clone works from [local.md](deployment/local.md) alone | —        |
| P7-04 | Cost review against current Cloudflare and GitHub limits                | P4-*    | Monthly estimate within $0–10                                | —        |

## Recommended Next Task

**P2-12:** replace the placeholder profile content. P2-14 and P2-15 are small API follow-ups. Phase 3 can start after the open Phase 1 items
(P1-02 to P1-04) are answered.
