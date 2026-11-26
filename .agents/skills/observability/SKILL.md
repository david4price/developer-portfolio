---
name: observability
description: Add or review logging, health and readiness checks, metrics, deployment status monitoring, and troubleshooting for this project's API, worker, and Kubernetes deployment — including the sanitized public Infrastructure Explorer. Use when instrumenting code, adding health checks or metrics, building status views, or diagnosing a failure from logs and probes.
---

# Observability

Status: JSON logs, request ids, liveness, readiness, API metrics (P7-01), and the Infrastructure
Explorer (Phase 6) are implemented. Phase 9 adds Grafana, Loki, Prometheus, and Alloy
([ADR 0004](../../../docs/architecture/adr-0004-observability-stack.md),
[plan](../../../docs/architecture/observability.md)); follow the plan, and keep log fields and
metric labels low-cardinality so Loki and Prometheus stay small.

## Logging (implemented)

- Nest `ConsoleLogger` in JSON mode; level from `LOG_LEVEL` via `logLevelsUpTo()`.
- Log structured objects: `{ message, requestId, ...fields }`. The HTTP access log (one line per
  request: method, matched route, status, duration) lives in `configureApp()`.
- Request ids: incoming `x-request-id` is reused only if it matches `[A-Za-z0-9._-]{1,64}`;
  otherwise a UUID is generated. Every response and error body carries it.
- Never log request bodies, chat messages, cookies, tokens, connection strings, or personal data.
  Log matched route patterns, not raw URLs with query strings.
- Worker logs include `queue`, `jobId`, `attempt`.

## Health (implemented)

- `/api/v1/health`: liveness, no dependencies.
- `/api/v1/health/ready`: each `ReadinessCheck` probed concurrently with a 1.5 s timeout; 503 with
  per-dependency `up`/`down` when any fails. Add checks via `HealthModule.forChecks`.
- Worker health endpoint is still to do (Phase 3), so Kubernetes can probe it.

## Metrics (implemented, P7-01)

- `ApiMetrics` (`apps/api/src/metrics/`) owns one `@prometheus-io/client` registry, provided by
  the global `MetricsModule`; `createTestApp()` includes it, and tests read it with
  `app.get(ApiMetrics)` and `render()`.
- `main.ts` serves `GET /metrics` on `API_METRICS_HOST:API_METRICS_PORT` (default
  `127.0.0.1:9464`), apart from the public port. In Kubernetes it is never in the Service or
  tunnel. It stays on the pod's loopback, or, with `api.metrics.scrape.enabled` (production,
  P9-04), `0.0.0.0`, with the pod IP opened to the monitoring namespace's Prometheus alone by
  one NetworkPolicy rule. `pnpm helm:check` accepts only those two renders.
- What's measured: `http_request_duration_seconds` (method, route pattern, status class, from
  `configureApp()`), `api_errors_total` (code, from `ApiExceptionFilter`),
  `http_client_disconnects_total` (abandoned requests, kept out of the error count),
  `readiness_dependency_up`, `ai_inference_duration_seconds` (outcome; `MeteredAiProvider`),
  `ai_queue_waiting`, `ai_queue_wait_seconds`, and `ai_capacity_rejections_total`
  (`MeteredAiConcurrencyLimiter`; `precheck` is a full queue found before screening),
  `chat_screening_refusals_total` (reason, started; `ChatService`), plus process and Node.js
  runtime metrics.
- New metrics go through an intent-named `ApiMetrics` method. Labels are low-cardinality and
  server-chosen (route pattern, status class, error code, fixed outcome names), never ids, slugs,
  or anything from the request.
- The worker has no metrics yet: it runs only the `noop` job. Add queue depth and job duration
  when it does real work.

## Infrastructure Explorer (Phase 6)

- A NestJS module polls the Kubernetes API (read-only ServiceAccount) and Argo CD (read-only token)
  every 10–15 s and caches a snapshot; visitors read the cache, never trigger API calls.
- Serialize through an explicit allowlist: app name, health, sync status, image tag, desired/
  available/ready replicas, rollout progress, coarse failure category, last-updated time.
- Snapshot tests assert no IPs, node names, env vars, namespaces outside the allowlist, or raw
  events/logs appear.
- Stale or failed polling reports **unavailable**, never "healthy" or "crashed".

## Troubleshooting Order

1. Liveness: is the process up?
2. Readiness `checks`: which dependency is down?
3. Logs filtered by `requestId`: which request failed, and why?
4. Kubernetes events and rollout status (operators only, over Tailscale).

Runbooks: `docs/operations/runbooks.md`.
