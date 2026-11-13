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

## Frontend (Confirmed, P4-02)

- Headers come from `apps/web/out/_headers`, which `apps/web/scripts/write-headers.ts` writes after
  every `next build`. Cloudflare Pages applies them to every response.
- Content Security Policy, with no `unsafe-inline` and no `unsafe-eval`:
  - `script-src 'self'` plus the SHA-256 hash of every inline script in every exported page. The
    build fails if a script is left uncovered or the policy outgrows a `_headers` line.
  - `style-src 'self'` (the export has no inline styles), `img-src 'self' data:`,
    `font-src 'self'`.
  - `connect-src 'self'` plus the API origin from `NEXT_PUBLIC_API_BASE_URL`. Previews have none, so
    they can't call the production API. Turnstile is added with P5-04.
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
