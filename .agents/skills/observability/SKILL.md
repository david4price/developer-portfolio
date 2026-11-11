---
name: observability
description: Add or review logging, health and readiness checks, metrics, deployment status monitoring, and troubleshooting for this project's API, worker, and Kubernetes deployment — including the sanitized public Infrastructure Explorer. Use when instrumenting code, adding health checks or metrics, building status views, or diagnosing a failure from logs and probes.
---

# Observability

Status: JSON logs, request ids, liveness, and readiness are implemented. Metrics and the
Infrastructure Explorer are **Proposed** (Phases 6–7). Keep it proportionate: no Prometheus or
Grafana until the roadmap calls for them.

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

## Metrics (Phase 7)

Expose Prometheus-format metrics on a separate, non-public port or path excluded from the tunnel:
HTTP latency histogram and error rate by route, readiness state, BullMQ queue depth and job
duration, AI inference duration and rejected requests, process memory/CPU. Use low-cardinality
labels (route pattern, status class), never user ids or slugs from untrusted input.

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
