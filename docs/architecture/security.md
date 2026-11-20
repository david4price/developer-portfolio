# Security

## Threat Model Summary

The public surface is a static site and a small REST API. The main risks:

- abuse of the expensive AI endpoint
- prompt injection against the chat assistant (screened before and after the model, P5-07)
- data leaks from the Infrastructure Explorer
- injection or XSS through rendered content
- credentials leaked into the public repository
- lateral movement from the cluster into the rest of the home network

## Edge (Proposed)

- Cloudflare Free plan: TLS, CDN, DDoS mitigation, managed WAF rules where the plan provides them.
- Cloudflare Turnstile on chat session creation: server verification is **Confirmed in code**;
  the live widget and browser integration are **Proposed**. A CAPTCHA is one layer of protection,
  not the only one.
- Plan limits and costs are reviewed in the [cost review](../operations/cost-review.md) (P7-04),
  because free tiers change.

## API (Confirmed in the scaffold, unless marked)

| Control                                                                                 | Status                          |
| --------------------------------------------------------------------------------------- | ------------------------------- |
| Strict environment validation at startup; no secret defaults                            | Confirmed                       |
| CORS allowlist from configuration                                                       | Confirmed                       |
| Inputs validated with zod schemas at controller boundaries; malformed input → typed 400 | Confirmed                       |
| Request IDs and structured JSON logs; no request bodies logged                          | Confirmed                       |
| Versioned routes under `/api/v1`; no admin routes                                       | Confirmed                       |
| Security headers on API responses                                                       | Confirmed                       |
| Rate limiting (per IP, per session) in Redis                                            | Proposed (Phase 5)              |
| Body size limits                                                                        | Confirmed (Fastify `bodyLimit`) |
| Trust `CF-Connecting-IP` only when running behind the tunnel                            | Proposed                        |

## Frontend (Confirmed, P4-02)

- Headers come from `apps/web/out/_headers`, which `apps/web/scripts/write-headers.ts` writes after
  every `next build`. Cloudflare Pages applies them to every response.
- Content Security Policy, with no `unsafe-inline` and no `unsafe-eval`:
  - `script-src 'self'` plus SHA-256 hashes of inline scripts, per path: `/*` allows the scripts
    every page shares plus the not-found page's (unknown URLs match only `/*`), and each page
    with a script of its own gets a rule for its URL that detaches the `/*` policy and allows
    exactly its own hashes. Without the detach, Cloudflare joins both values and browsers enforce
    both. The build fails if a line passes 2,000 characters or the file passes 100 rules
    (Cloudflare's limits; about 98 pages).
  - `style-src 'self'` (the export has no inline styles), `img-src 'self' data:`,
    `font-src 'self'`.
  - `connect-src 'self'` plus the API origin from `NEXT_PUBLIC_API_BASE_URL`. Previews have none, so
    they can't call the production API. Turnstile hosts will be added when its browser widget is
    embedded; the server verification boundary already exists (P5-04).
  - The only third party is **Cloudflare Web Analytics** (cookie-less): the edge injects its beacon
    on the custom domain, so `script-src` allows `https://static.cloudflareinsights.com` and
    `connect-src` allows `https://cloudflareinsights.com`. Nothing broader.
  - Cloudflare features that inject **inline** scripts at the edge (JavaScript Detections, Rocket
    Loader, email obfuscation) can't be hashed and stay off for the zone; a CSP violation in the
    console on the custom domain but not on `pages.dev` means one was switched on.
  - `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`,
    `upgrade-insecure-requests`.
- `Strict-Transport-Security: max-age=31536000` (no `includeSubDomains`: not every host under the
  domain is guaranteed to serve HTTPS), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` denying camera,
  microphone, geolocation, payment, and USB, and `Cross-Origin-Opener-Policy: same-origin`.
- Plain-HTTP requests to the custom domain are redirected by the zone's **Always Use HTTPS**
  setting; HSTS then keeps browsers on HTTPS.
- The local nginx image (`compose.full.yaml`) still uses a looser policy with `unsafe-inline`; it
  only serves loopback.
- No `dangerouslySetInnerHTML` on API or model output. Model output is rendered as text or a
  sanitized markdown subset.

## Sessions (Confirmed, P5-02)

- Session IDs: 256-bit random values from a CSPRNG (`randomBytes(32)`, base64url), kept
  server-side in Redis under `portfolio:chat:session:<id>` with a 24-hour TTL. Only the cookie
  carries the ID; response bodies never do.
- Cookie: `portfolio_chat`, `HttpOnly; Secure; SameSite=Lax; Path=/api/v1/chat; Max-Age=86400`, no
  `Domain` (host-only). The API accepts only a value of exactly the shape it issues.
- Per-session lock: `SET portfolio:chat:lock:<id> <token> NX PX` for the AI timeout plus 15 s; a
  second message while one is in flight gets `409 chat_busy`. Release is compare-and-delete, so a
  holder whose lock expired can't free a newer one. Unknown IDs are rejected before any lock key
  is written.
- Writing history uses `KEEPTTL XX`: it never extends a session's life or recreates an expired
  one.
- No user accounts and no personal data. Visitors can't choose the model, prompt, or provider: the
  message body is `{ "message": string }` (≤ 1,000 characters) and nothing else.
- Every message is normalized and screened for injection before it reaches the model, and every
  reply is checked for system-prompt leaks
  ([Message Screening](ai-integration.md#message-screening-confirmed-p5-07)).
- While `AI_ENABLED=false`, no sessions are issued (`503 ai_disabled`). Per-IP and per-session
  quotas plus a global AI semaphore apply (P5-03, see
  [AI integration](ai-integration.md#resource-protection-implemented-in-p5-03-unless-noted)).
  **Don't enable chat publicly before Turnstile (P5-04)**: per-IP quotas alone don't stop a client
  with many addresses.
- Session creation requires a server-verified Turnstile token (P5-04, **Confirmed in code**),
  matching an explicit hostname allowlist and action `chat_session`. Failed challenges issue no
  cookie and consume the session-attempt quota. A Redis claim of the token's SHA-256 digest
  enforces single use across replicas even during remote replay-detection propagation. Tokens
  and secrets are never logged or persisted. Verification outages fail closed. Live widget
  setup and browser integration remain **Proposed**; see the
  [Turnstile guide](../deployment/turnstile.md).

## Infrastructure Explorer (serializer Confirmed in code, P6-02; access Confirmed in the chart, P6-01)

- Namespace-scoped `Role` with only `get`/`list` on `deployments`, `statefulsets`, and `pods` in
  the `portfolio` namespace (PostgreSQL is a StatefulSet; ReplicaSets aren't needed), bound to the
  API's own ServiceAccount (`templates/api-rbac.yaml`, rendered only with
  `api.infrastructure.enabled`). Only the API pod mounts a token; every other pod keeps
  `automountServiceAccountToken: false`. `pnpm helm:check` compares the rendered Role and
  RoleBinding to the exact expected rules, role reference, and subject, and fails if any template
  renders a ClusterRole or ClusterRoleBinding, so any added verb, resource, subject, or wider
  binding fails CI. The reader trusts the cluster CA for its own requests only (not process-wide). The Argo CD project allows ServiceAccount, Role, and RoleBinding in the namespace, and
  still no cluster-scoped kinds. No access to `secrets`, `configmaps`, logs, `exec`, or other namespaces.
- **Confirmed (P6-03):** Argo CD access uses an expiring project-role token with exactly
  `applications, get, portfolio/portfolio`. Live permission probes deny sync, update, delete,
  override, restart, logs, exec, and other Applications/projects. Argo CD implicitly permits a
  project-role token to read its own project metadata. The token and server CA are encrypted in
  a SealedSecret and mounted read-only into the API alone (not environment variables). Only the
  API gets egress to the selected Argo CD server pods in its namespace, on TCP 8080. Requests
  verify that CA per reader, refuse redirects, cap replies at 512 KiB, check the Application name
  and project, and retain only sync plus a short deployed GitOps revision and deployment time.
  Argo CD failures yield unknown deployment facts without hiding fresh workload data. Live
  credential/adapter checks passed; production API activation awaits this change's rollout.
- Responses go through an explicit allowlist serializer
  (`apps/api/src/modules/infrastructure/snapshot-serializer.ts`): raw objects are parsed with
  schemas that name only the needed fields, so every other key is dropped, and objects from other
  namespaces or without a known component label are ignored. Leak tests plant IPs, node names, env
  values, secret names, registry paths, annotations, and other namespaces in realistic objects and
  check none reach the output. It emits only:
  - app name
  - health and sync status
  - image version (tag, not registry path; a short `sha256:` prefix for images pinned by digest;
    the 7-character source commit from the workload's version label for the API and worker)
  - desired, available, and ready counts
  - rollout progress
  - a coarse failure category
  - the last-updated time, and the snapshot's age when served (`ageSeconds`, derived from it)
  - the last deployed GitOps revision: short commit SHA and deployment time from Argo CD
    history (P6-03); never the pending comparison target or raw Application object
  - the AI model's health and coarse failure, from the chat adapter's status check (`GET /models`
    on the runtime, P6-04). The reply is only compared with the configured model; the model's
    name, the runtime's address, and the reply itself are never returned or logged. The check
    sends no prompt, refuses redirects, and reads at most 64 KiB
  - a bucketed request rate for the API, its tunnel, and the AI model (`idle`, `low`, `busy`;
    P6-04): Redis counters per source per minute, over a sliding 5-minute window. Never raw
    counts, routes, or anything per client; health probes and the explorer's own polling
    aren't counted
- Results are cached for 12 s, concurrent requests share one read, and a failed read is not
  retried for 12 s; visitors never trigger live Kubernetes API calls directly. The endpoint is off
  unless `INFRASTRUCTURE_SOURCE=kubernetes`.
- Never exposed:
  - IP addresses
  - node names and details
  - environment variables
  - raw events or logs
  - namespaces other than the allowlisted one

## Cluster API Audit Log (Confirmed on the reference host, P7-06)

- **Recorded:** K3s's API server logs every write (`scale` included), every `exec`, `attach`,
  and `port-forward`, and every Secret `get` and `list`. Each entry has the user, source,
  resource, and response code.
- **Level:** Metadata only, so request and response bodies, and Secret values with them, are
  never recorded.
- **Dropped:** other reads and routine controller traffic.
- **Retention:** 30 days, at most 1 GB, in a root-only log on the host.
- **Request URIs are recorded,** so `exec` commands and their arguments, and `attach` and
  `port-forward` parameters, are in the log. Treat the log as sensitive, and never pass a secret
  on an `exec` command line.
- Setup, validation, and rollback:
  [Kubernetes guide](../deployment/kubernetes.md#api-audit-logging-p7-06-approval-required).

## Repository Hygiene (Confirmed)

- `.env*` is ignored, except `.env.example`, which holds placeholders only.
- CI runs secret scanning (gitleaks) and a package signature audit (`pnpm audit signatures`) on
  every push and pull request.
- The CI workflow has read-only permissions and no deploy step. Untrusted pull requests never get
  credentials or reach self-hosted runners.
- Documentation describes the reference deployment with placeholders. Real hostnames, addresses,
  and device names live outside this repository.

## Supply Chain (Proposed)

- Images are built on GitHub-hosted runners, published to GHCR, and deployed by digest.
- Dependency updates are for security fixes only
  ([ADR 0002](adr-0002-dependency-updates.md)). Routine version PRs are off, and versions are
  updated deliberately.
  - **Covered:** Dependabot alerts and security updates cover npm and GitHub Actions, opening a
    PR only for a known vulnerability. They are the vulnerability check: CI's
    `pnpm audit signatures` checks provenance, not vulnerabilities.
  - **Docker isn't covered.** The application images pick up base-image patches on each release
    (floating tags, fresh runners). PostgreSQL, Redis, and cloudflared stay on their pinned
    digests until updated by hand.
- Runtime images run as a non-root user with no build tooling (multi-stage builds).
