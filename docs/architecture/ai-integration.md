# AI Integration

## Provider Port

The API depends on an `AiProvider` port, never on a specific vendor SDK or model.

| Adapter             | Use                                                                                                    | Status               |
| ------------------- | ------------------------------------------------------------------------------------------------------ | -------------------- |
| `disabled`          | Default. Chat endpoints return `ai_disabled`; everything else works                                    | Confirmed            |
| `openai-compatible` | Any OpenAI-style `/v1/chat/completions` server: Docker Model Runner, llama.cpp server, vLLM, LM Studio | Adapter done (P5-01) |
| `ollama`            | Ollama native API                                                                                      | Proposed             |
| `openai`            | OpenAI API                                                                                             | Proposed             |
| `anthropic`         | Anthropic Messages API                                                                                 | Proposed             |

The provider is chosen at deploy time by configuration. Visitors cannot choose providers, models,
endpoints, or system prompts.

```env
# Disabled (default)
AI_ENABLED=false

# Self-hosted OpenAI-compatible runtime (the reference deployment uses this)
AI_ENABLED=true
AI_PROVIDER=openai-compatible
AI_MODEL=<model-id>
AI_BASE_URL=http://<inference-host>:<port>/engines/v1

# Ollama
AI_ENABLED=true
AI_PROVIDER=ollama
AI_MODEL=<model>
AI_BASE_URL=http://ollama:11434

# Hosted API
AI_ENABLED=true
AI_PROVIDER=openai
AI_MODEL=<model>
OPENAI_API_KEY=<set in a secret store, never committed>
```

API keys stay server-side.

## Reference Deployment (Confirmed)

- Runtime: Docker Model Runner (llama.cpp backend) with an OpenAI-compatible API. It runs outside
  Kubernetes on a 4 GB laptop GPU.
- Model: a 4 B-parameter instruct model, 4-bit quantized (≈2.3 GiB).
- Capacity: 4 parallel slots with an 8k context each. The model unloads after about 5 minutes
  idle and reloads in about 2 seconds.
- Measured throughput: about 170 tokens/s prompt processing and about 30 tokens/s generation. A
  1.6k-token prompt takes about 10 s end to end.
- The runtime already serves a separate private assistant. The portfolio must leave it capacity.

These numbers set the resource-protection defaults below. They are not general guarantees.

## Resource Protection (implemented in P5-03 unless noted)

All limits live in Redis, so they hold across API replicas. Each is configurable through the
environment (`CHAT_*`); the defaults below apply when unset.

| Control                      | Default                                                       | Where / setting                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Global inference concurrency | 1 (the reference host allows at most 2)                       | Redis semaphore with expiring leases, so a crashed replica can't keep a slot (`CHAT_AI_MAX_CONCURRENCY`, 1–4)                                   |
| Bounded wait queue           | 4 requests, FIFO, 10 s max wait                               | Redis; newcomers never jump waiters; full queue or timeout → `503 ai_overloaded` + `Retry-After` (`CHAT_AI_QUEUE_MAX`, `CHAT_AI_QUEUE_WAIT_MS`) |
| Per-session quota            | 30 messages per session (24 h lifetime)                       | Redis fixed window (`CHAT_SESSION_MESSAGE_LIMIT`)                                                                                               |
| Per-IP quotas                | 60 messages / hour and 10 new sessions / hour                 | Redis fixed window; IPv6 counted per /64 (`CHAT_IP_MESSAGES_PER_HOUR`, `CHAT_IP_SESSIONS_PER_HOUR`); `429 rate_limited` + `Retry-After`         |
| Client IP                    | Socket address; `CF-Connecting-IP` only when trusted          | `CHAT_TRUST_CF_CONNECTING_IP=true` only where a NetworkPolicy admits nothing but `cloudflared` (P4-03)                                          |
| Max input                    | 1,000 characters per message                                  | Request validation                                                                                                                              |
| Prompt budget                | ≤ 1,500 tokens (system + retrieved context + history)         | Prompt builder: history capped at 8 turns / 4,000 characters                                                                                    |
| Output limit                 | 400 tokens                                                    | Provider call                                                                                                                                   |
| Response timeout             | 30 s                                                          | Provider call with abort                                                                                                                        |
| Bot challenge                | Turnstile verified server-side on session creation (Proposed) | P5-04                                                                                                                                           |

Quotas count only messages that would reach the model: a `409 chat_busy` or `401` costs nothing.
The integration suite includes a load test: 12 visitors at once against concurrency 1 and a queue
of 2 get 3 answers and 9 immediate `503 ai_overloaded` responses; none hang.

## Chat Design (Phase 5)

Implemented so far (P5-02): `POST /api/v1/chat/sessions` (201, sets the session cookie; `503
ai_disabled` while AI is off) and `POST /api/v1/chat/messages` (`{ "message": string }` →
`{ "reply": string }`) with the per-session lock, a fixed system prompt, and trimmed history (at
most 8 turns or 4,000 characters per prompt, 20 turns stored). Errors: `401 chat_session_required`,
`409 chat_busy`, `503 ai_disabled | ai_overloaded | ai_unavailable`. Session details are in
[security](security.md#sessions-confirmed-p5-02). Still Proposed: Turnstile (P5-04), quotas (P5-03),
retrieval and links (P5-05).

1. **Session:** `POST /api/v1/chat/sessions` verifies Turnstile and sets an opaque, random session
   cookie (`HttpOnly; Secure; SameSite=Lax`). State lives in Redis under a namespaced key with a
   TTL.
2. **Per-session lock:** a Redis lock with a short TTL. A second message while one is in flight
   returns `409 chat_busy`, so the conversation can't interleave.
3. **Retrieval:** keyword / full-text search over the project registry and approved profile text.
   A vector database is added only if measured answer quality requires one.
4. **Prompt:** a fixed system prompt, retrieved snippets (clearly delimited and treated as data),
   and a trimmed history.
5. **Navigation:** the model may suggest links only by registry slug. The API validates each slug
   against the registry and drops anything else.
6. **Output:** plain text or a restricted markdown subset, rendered without raw HTML.

## Isolation

- Portfolio chat sessions, prompts, and history never share storage, keys, or code paths with the
  reference host's private assistant.
- The public assistant has no tools: no infrastructure, home automation, container, filesystem, or
  command access.
- Visitor A's session can never read visitor B's state. Keys come from the server-generated session
  ID only.
