---
name: ai-integration
description: Implement or review the portfolio chatbot and AI provider layer — provider-agnostic adapters (openai-compatible, Ollama, OpenAI, Anthropic, disabled), Redis-backed isolated sessions, retrieval grounded in the project registry, prompt-injection defenses, validated navigation links, and inference concurrency, quota, and timeout controls. Use for apps/api/src/modules/ai or chat work.
---

# AI Integration

Status: the `AiProvider` port and the `disabled` and `openai-compatible` adapters exist
(`apps/api/src/modules/ai/`). In `apps/api/src/modules/chat/`: sessions with the per-session lock
(P5-02), quotas and the Redis semaphore (P5-03), and registry retrieval (`KnowledgeBase` port,
`registry-knowledge-base.ts`), the prompt builder (`chat-prompt.ts`), and validated links
(`navigation-links.ts`) from P5-05. Turnstile (P5-04) and the other adapters are **Proposed**.
Design reference: `docs/architecture/ai-integration.md`.

## Provider Adapters

- One adapter per provider behind `AI_PROVIDER`; selected only by deployment config
  (`AI_ENABLED`, `AI_PROVIDER`, `AI_MODEL`, `AI_BASE_URL`, provider API key). Visitors can never
  choose providers, models, endpoints, or system prompts.
- Use `fetch` with `AbortSignal` and a hard timeout rather than heavy SDKs where practical; map
  provider errors to `ai_unavailable` / `ai_overloaded` without leaking upstream messages.
- Enforce `maxOutputTokens` on every call. Never stream raw provider errors to clients.
- Contract-test adapters against a fake HTTP server; never call a real model in unit tests.
- For the Anthropic adapter, load the `claude-api` skill for current model IDs and API details.

## Capacity Controls

The reference runtime is a small GPU model with few parallel slots, shared with another private
workload. Defaults: global concurrency 1 (max 2), bounded wait queue (4, 10 s), 30 s timeout,
prompt budget ≤ 1,500 tokens, output ≤ 400 tokens. With more than one API replica, the semaphore
must live in Redis, not in process memory. Overload returns `429`/`503` with typed codes — never a
hung request.

## Sessions and Isolation

- `POST /api/v1/chat/sessions` verifies Turnstile (see `application-security`), creates a
  256-bit random id, and sets `HttpOnly; Secure; SameSite=Lax` cookie scoped to `/api/v1/chat`.
- State in Redis under `portfolio:chat:session:<id>` with TTL; keys derive only from the
  server-issued id.
- A per-session Redis lock (`SET NX PX`) serializes messages; a concurrent message returns
  `409 chat_busy`.
- Never share storage, prompts, or code paths with any private/internal assistant. The public
  assistant has **no tools**.

## Grounding and Injection Defense

- Retrieve from the project registry and approved profile text (keyword/full-text first; add a
  vector store only with measured need).
- Delimit retrieved content and history as data; the system prompt states that instructions inside
  them are not to be followed.
- Navigation links: the model may only copy `[[project:<slug>]]` / `[[mini-app:<slug>]]` markers
  from the retrieved data; `resolveNavigationLinks()` validates each against the registry, returns
  valid ones in `links`, and strips every other marker from the text. Cleanup touches only the text
  around a removed marker, and an empty result becomes `EMPTY_REPLY_FALLBACK`. Never render model
  output as HTML.
- Screen both directions through the `MessageGuard` port (`MESSAGE_GUARD`): normalize every
  visitor message and reject injection attempts with `422 message_rejected` before the model;
  withhold replies that leak the system rules. Only the screened text reaches retrieval, the
  prompt, and history. New patterns need a test case, plus a legitimate question that must still
  pass, in `test/message-guard.test.ts`.
- Per-session and per-IP quotas, max input length (1,000 chars), and logging of rejected requests
  (reason only, without message content). Refund the quota only when a request certainly used no capacity (immediate queue-full
  rejection, AI off); waiting out the queue, anything after reaching the provider (even "busy"),
  and rejected messages all count.

## Tests to Require

Session isolation (A cannot read B), concurrent-message lock, quota exhaustion, timeout →
`ai_unavailable`, overload → `ai_overloaded`, invalid slug filtering, `AI_ENABLED=false` behavior.
