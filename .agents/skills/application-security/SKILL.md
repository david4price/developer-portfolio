---
name: application-security
description: Design or review security for this project — secure API design, input validation, rate limiting, Cloudflare edge (TLS, WAF, Turnstile, Tunnel), Tailscale-only administration, CSP and security headers, session cookies, Kubernetes least privilege, network isolation, secrets handling, and keeping private infrastructure details out of the public repo. Use for security reviews and any change to auth, sessions, public endpoints, headers, or exposure.
---

# Application Security

Reference: `docs/architecture/security.md` and `docs/architecture/networking.md`.

## Review Checklist for Any Change

- **Exposure:** does it add a public route, port, hostname, or tunnel ingress? Public traffic
  reaches only `/api/v1/*` on the API Service. Admin surfaces (Argo CD, Kubernetes API, metrics)
  stay on Tailscale.
- **Input:** every param, query, body, header used in logic, and queue payload is validated with
  zod and size-limited (Fastify `bodyLimit` is 16 KiB).
- **Abuse:** expensive or stateful endpoints have per-IP and per-session limits in Redis, timeouts,
  and bounded queues. Turnstile alone is not abuse protection.
- **Output:** error bodies use `ApiException` codes only; no stack traces, SQL, upstream errors,
  internal hostnames, or IPs. Frontend never uses `dangerouslySetInnerHTML` for API/model data.
- **Secrets:** read from environment/Secrets, never defaulted, logged, committed, or put in
  `NEXT_PUBLIC_*`.
- **Privacy:** run `bash .agents/skills/verify/scripts/privacy-scan.sh`; public docs use
  placeholders.
- **Dependencies:** no new build-script allowances or release-age exclusions without reason.

## Edge (Phase 4)

- Cloudflare: TLS, CDN, managed WAF rules on the free plan, DDoS mitigation. Verify plan limits
  before relying on a feature.
- Turnstile: verify tokens server-side via Siteverify on session creation; bind to the expected
  hostname and action. The `cloudflare:turnstile-spin` skill covers implementation.
- Client IP: trust `CF-Connecting-IP` only when traffic provably arrives through the tunnel; never
  trust arbitrary `X-Forwarded-For`.
- Tunnel: a dedicated tunnel whose ingress maps only the API hostname plus a catch-all 404.
- CSP via Cloudflare Pages `_headers`: hash-based scripts, `connect-src` limited to the API and
  Turnstile, `frame-ancestors 'none'`, HSTS.

## Sessions

256-bit random ids, server-side state with TTL, `HttpOnly; Secure; SameSite=Lax`, narrow `Path`.
CORS allowlist exact origins with `credentials: true` only where cookies are needed.

## Kubernetes Least Privilege (Phase 3/6)

Non-root, read-only root filesystem, dropped capabilities, no service account token automount
unless needed. The Infrastructure Explorer's ServiceAccount gets namespace-scoped `get`/`list` on
deployments, replicasets, and pods only — verify with `kubectl auth can-i`. NetworkPolicies
default-deny; namespaces are not isolation.

## Reporting

For reviews, list findings by severity with file:line, the concrete exploit or failure scenario,
and the fix. Don't change live Cloudflare, Tailscale, firewall, or cluster settings without an
explicit request.
