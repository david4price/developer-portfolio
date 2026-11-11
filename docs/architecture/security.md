# Security

## Threat Model Summary

The public surface is a static site and a small REST API. The main risks:

- abuse of the expensive AI endpoint
- data leaks from the Infrastructure Explorer
- injection or XSS through rendered content
- credentials leaked into the public repository
- lateral movement from the cluster into the rest of the home network

## Edge (Proposed)

- Cloudflare Free plan: TLS, CDN, DDoS mitigation, managed WAF rules where the plan provides them.
- Cloudflare Turnstile on chat session creation, verified server-side with the secret key. A
  CAPTCHA is one layer of protection, not the only one.
- Plan limits and costs must be checked before launch, because free tiers change.

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

## Frontend (Proposed, Phase 4)

- Content Security Policy via Cloudflare Pages `_headers`: `default-src 'self'`; `connect-src`
  limited to the API origin and Turnstile; `frame-src` limited to Turnstile; no `unsafe-eval`.
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy` set to deny unused features, and HSTS.
- No `dangerouslySetInnerHTML` on API or model output. Model output is rendered as text or a
  sanitized markdown subset.

## Sessions (Proposed, Phase 5)

- Session IDs: 256-bit random values from a CSPRNG, kept server-side in Redis with a TTL.
- Cookie flags: `HttpOnly; Secure; SameSite=Lax; Path=/api/v1/chat`.
- No user accounts and no personal data. Conversation TTL is 24 hours.

## Infrastructure Explorer (Proposed, Phase 6)

- Namespace-scoped `Role` with only `get`/`list` on `deployments`, `replicasets`, and `pods` in the
  `portfolio` namespace. No access to `secrets`, `configmaps`, logs, `exec`, or other namespaces.
- Argo CD access uses a read-only project role token scoped to the portfolio Application.
- Responses go through an explicit allowlist serializer, which emits only:
  - app name
  - health and sync status
  - image version (tag, not registry path)
  - desired, available, and ready counts
  - rollout progress
  - a coarse failure category
  - the last-updated time
- Results are cached for 10–15 s. Visitors never trigger live Kubernetes API calls directly.
- Never exposed:
  - IP addresses
  - node names and details
  - environment variables
  - raw events or logs
  - namespaces other than the allowlisted one

## Repository Hygiene (Confirmed)

- `.env*` is ignored, except `.env.example`, which holds placeholders only.
- CI runs secret scanning (gitleaks) and a dependency audit on every push and pull request.
- The CI workflow has read-only permissions and no deploy step. Untrusted pull requests never get
  credentials or reach self-hosted runners.
- Documentation describes the reference deployment with placeholders. Real hostnames, addresses,
  and device names live outside this repository.

## Supply Chain (Proposed)

- Images are built on GitHub-hosted runners, published to GHCR, and deployed by digest.
- Dependabot covers npm, GitHub Actions, and Docker base images.
- Runtime images run as a non-root user with no build tooling (multi-stage builds).
