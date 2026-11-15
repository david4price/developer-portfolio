# Chat Session Verification (P5-04)

**Confirmed:** the API verifies Turnstile before creating a session; the browser integration is
implemented as a floating popup available on every page. On 2026-11-14, the reference deployment's
dedicated managed widget was provisioned for its production hostname, without pre-clearance.
The public sitekey was added only to Pages Production and a rebuild completed successfully.
The API secret and hostname allowlist are stored as SealedSecrets; production values reference
the secret and pin the two public Siteverify destination addresses observed from the API pod.
The chart activates that verification egress only when AI is enabled.

Deployment checks passed for the homepage and `/about/` (HTTP 200, one CSP allowing Turnstile),
public API readiness (HTTP 200), and an invalid-token Siteverify request from the API pod. A
temporary API-only egress policy allowed only the two resolved destinations on TCP 443 for that
probe and was removed afterward. The session endpoint returned `503 ai_disabled` without a
cookie, matching the current AI-off configuration.

**Pending:** AI remains disabled until the inference connection (P5-06) is configured. A successful
chat session, real-token replay/concurrency checks, and browser interaction remain unverified;
no browser was connected during setup. Provisioning Turnstile does not enable model replies.

## Browser Configuration

Set `NEXT_PUBLIC_API_BASE_URL` and `NEXT_PUBLIC_TURNSTILE_SITE_KEY` when building the static site.
The sitekey is public; never put the secret in a `NEXT_PUBLIC_*` variable. Both variables are
needed: without them the popup says chat is not configured and does not load Turnstile. The full
Compose build forwards both settings to the web image. Rebuild after changing either setting.

The shared layout renders a resting dog launcher. The first click lazy-loads the chat into a
comic-style speech bubble in a viewport-bounded native dialog in the browser's top layer. It has a close button, Escape and
backdrop dismissal, native keyboard focus containment, and focus restoration to the launcher.
The original artwork in `apps/web/public/` is `dog-lying-down.svg` for the closed state,
`dog-sitting.svg` for open, and `dog-standing.svg` for a message request in flight. The widget
serves committed, display-sized lossless WebP derivatives to avoid loading the multi-megabyte SVGs.
Regenerate them after editing the originals with `pnpm --filter @portfolio/web artwork:build`.
Sharp is a development-only dependency for this command and artwork validation. Replies and failures
return the dog to sitting, alongside a textual status for waiting and errors. The descriptive
`/apps/portfolio-assistant/` route points visitors to the launcher instead of mounting another chat.

The popup loads the official explicit-rendering script only while open, using action
`chat_session` and compact size so verification fits narrow screens. Expired and timed-out challenges are reset; consumed widgets are removed before
the session request, and every unsuccessful session attempt needs a fresh token. Load failures
have a retry control. Session and message calls include cookies, reject redirects, and have a
45-second timeout (covering the default queue wait plus generation); leaving the page aborts
the request. Closing hides the popup and preserves its conversation and bounded in-flight
request; closing during verification removes the widget and discards the unused token. Reopening
requires a fresh challenge until a session exists. The layout retains this state across internal
navigation. A missing/expired session returns to verification without automatically resending
the visitor's message. Browser tokens and conversation text are never put in browser storage.
Suggested project links use client-side navigation and close the popup to reveal the selected
page; reopening the launcher returns to the same conversation.
Successful session creation focuses the composer after it mounts, only while chat is open.
Short viewports hide the dog and speech-bubble tail so the controls retain the full dialog height.

Answers render as plain text. Only separately returned links that match this build's registry
and canonical relative paths become anchors; their titles come from the registry too. The UI
keeps at most 20 exchanges, disables duplicate sends, bounds input to the shared 1,000-character
limit, and gives distinct not-configured, unavailable, verification, and loaded states.

Pages CSP adds only `https://challenges.cloudflare.com` to script, frame, and connect sources
when both public settings exist. This applies to every page policy because the popup is available
throughout the site. Hash-based inline script rules stay in
place; no wildcard or inline-script exception is added. The local nginx template also allows
that exact origin. See [Cloudflare's CSP guidance](https://developers.cloudflare.com/turnstile/reference/content-security-policy/)
and [explicit widget rendering](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/).

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
   arbitrary hostnames or enable pre-clearance. Set the public sitekey in the Pages production
   build's `NEXT_PUBLIC_TURNSTILE_SITE_KEY`; the secret key belongs only in API configuration.
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
5. Keep AI off until the inference connection (P5-06) and browser acceptance are ready. Verify
   the generated CSP, then exercise the popup: confirm the launcher opens a small top-layer
   panel on desktop and mobile; keyboard focus stays within it, Escape and outside click close
   it, and focus returns to the launcher. Confirm chat code and Turnstile do not load before the
   first click, closing/reopening preserves conversation, and internal navigation never creates
   a second chat. Successful verification enables Start chat,
   used/expired/error tokens cannot be reused, Retry verification works after a script failure,
   closing removes the verification widget, blocked cookies lead back to verification, and busy/offline
   errors leave the question available to retry. Verify the rest of the static site works with
   the API off. Do not weaken hostname/action checks for browser testing.

## Validation and Rollback

Before applying changes, run `pnpm check`, `pnpm build`, `pnpm helm:check`, and the privacy scan.
For the live drill, valid hostname/action must create a secure session cookie; absent, expired,
invalid, wrong-host, wrong-action, and reused tokens must fail without a cookie. Repeat one
token concurrently and confirm that at most one session is issued: Siteverify itself may reject
every concurrent verification of a token as `timeout-or-duplicate` (observed in the 2026-11-15
drill), and the Redis claim covers the rest. Send drill tokens one at a time otherwise, within
five minutes of solving the challenge; closing the popup does not invalidate a solved token. Confirm
that non-chat routes work while Siteverify is unreachable. Do not log tokens or secret keys.

Each refused session logs one API warning, `Chat session challenge rejected`, with its
`requestId` (the one in the client's error) and `reasons`. The reasons are Siteverify's error
codes, such as `timeout-or-duplicate` (expired, already used, or sent concurrently) and
`invalid-input-response`; `hostname-mismatch` or `action-mismatch` (Cloudflare accepted the
token, but for another site or form); `missing-token`; or `replayed` (already claimed by a
session). Siteverify outages log `Chat session challenge unavailable`. Tokens, hostnames, and
secrets are never logged:

```bash
kubectl logs -n portfolio -l app.kubernetes.io/component=api --since=1h | grep 'challenge'
```

Expected impact is limited to chat session creation and the API's outbound verification traffic.
Roll back by disabling AI, reverting configuration/image changes, and removing the new egress
rule. Delete the dedicated widget after confirming it has no remaining consumer. Existing
non-chat services require no changes.
