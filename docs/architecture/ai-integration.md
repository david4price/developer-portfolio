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

## Resource Protection (Proposed defaults)

| Control                      | Default                                                             | Where                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Global inference concurrency | 1 (max 2 on the reference host)                                     | In-process semaphore per API replica × replica count, or a Redis-backed semaphore once there is more than one replica |
| Bounded wait queue           | 4 requests, 10 s max wait                                           | API                                                                                                                   |
| Per-session quota            | 20 messages / hour                                                  | Redis                                                                                                                 |
| Per-IP quota                 | 60 requests / hour across sessions                                  | Redis (client IP from `CF-Connecting-IP`, trusted only behind the tunnel)                                             |
| Max input                    | 1,000 characters per message                                        | DTO validation                                                                                                        |
| Prompt budget                | ≤ 1,500 tokens (system + retrieved context + history)               | Prompt builder                                                                                                        |
| Output limit                 | 400 tokens                                                          | Provider call                                                                                                         |
| Response timeout             | 30 s                                                                | Provider call with abort                                                                                              |
| Overload response            | `429` / `503` with a typed error code                               | API                                                                                                                   |
| Bot challenge                | Cloudflare Turnstile token verified server-side on session creation | API                                                                                                                   |

## Chat Design (Proposed, Phase 5)

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
