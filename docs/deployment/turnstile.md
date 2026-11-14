# Chat Session Verification (P5-04)

**Confirmed:** the API verifies Turnstile before creating a session. **Proposed:** creation of the
reference deployment's widget, secret provisioning, the embedded browser widget, and a live
verification drill. These operational steps have not been performed by this implementation.

## Request and Verification

`POST /api/v1/chat/sessions` accepts `{ "turnstileToken": "<fresh-token>" }` (at most 2,048
characters). The client widget must use action `chat_session`. The session-attempt quota runs
before any verification request. The adapter posts to the fixed HTTPS Siteverify endpoint with
no redirects, a 5-second deadline including the body, and an 8 KiB response cap. A successful
response must match an explicitly configured hostname and the expected action.

[Cloudflare's Siteverify documentation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
describes five-minute tokens and eventual consistency of remote replay rejection. After remote
verification, the API atomically claims the token in Redis with `SET NX EX 300`. Only its SHA-256
digest appears in the key (`portfolio:chat:challenge:<digest>`); the token and secret are never
logged or stored. This prevents concurrent or nearby requests on different replicas from opening
multiple sessions with one token. A failed session write leaves the claim consumed; obtain a new
token to retry. Verification and Redis outages never grant sessions.

## Reference Deployment (Approval Required)

1. Inspect existing widgets with the authenticated `cf` CLI. Create a dedicated managed widget
   named `portfolio-chat` restricted to the current production site's hostname. Do not allow
   arbitrary hostnames or enable pre-clearance. The public sitekey belongs in the future client
   widget configuration; the secret key belongs only in API configuration.
2. Seal the secret using the existing Sealed Secrets process in the
   [Kubernetes guide](kubernetes.md#3-secrets), without writing plaintext into the repository.
   Configure `api.turnstile.existingSecret` and `api.turnstile.secretKey` (default `secret-key`).
   The chart references this Secret and never renders one.
3. Supply `TURNSTILE_HOSTNAMES` through `api.envSecret` or `api.envConfigMap` so the real hostname
   stays outside public plaintext configuration. Generic deployments can instead use
   `api.turnstile.hostnames`, a comma-separated string. API startup requires both secret and
   hostnames whenever AI is enabled, including local development.
4. Inspect the destination addresses of `challenges.cloudflare.com` from the deployment's DNS
   environment and configure reviewed destination CIDRs in `api.turnstile.egressCidrs`.
   The chart allows API-only TCP 443 to those CIDRs and fails rendering if AI and NetworkPolicies
   are enabled without them. Standard NetworkPolicy cannot restrict DNS names or URL paths;
   these CIDRs permit other HTTPS services at the same addresses. Review address changes during
   deployment and maintenance. The application always uses the fixed Siteverify URL.
5. Keep AI off until the inference connection (P5-06) and browser integration are ready. Browser
   integration must load Cloudflare's widget, set action `chat_session`, reset expired/used
   tokens, and add the exact required hosts to the site's CSP using Cloudflare's
   [CSP guidance](https://developers.cloudflare.com/turnstile/reference/content-security-policy/).
   Keep the current CSP until the widget is embedded.

## Validation and Rollback

Before applying changes, run `pnpm check`, `pnpm build`, `pnpm helm:check`, and the privacy scan.
For the live drill, valid hostname/action must create a secure session cookie; absent, expired,
invalid, wrong-host, wrong-action, and reused tokens must fail without a cookie. Repeat one
token concurrently through multiple replicas and confirm exactly one session is issued. Confirm
that non-chat routes work while Siteverify is unreachable. Do not log tokens or secret keys.

Expected impact is limited to chat session creation and the API's outbound verification traffic.
Roll back by disabling AI, reverting configuration/image changes, and removing the new egress
rule. Delete the dedicated widget after confirming it has no remaining consumer. Existing
non-chat services require no changes.
