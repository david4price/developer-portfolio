# Kubernetes

Kubernetes is optional. Contributors can run everything with Docker Compose
([local deployment](../deployment/local.md)). This document describes the reference single-node K3s
deployment, which is still **Proposed** (Phase 3).

## Workloads

| Workload          | Kind                          | Initial replicas | Scaling                                    | Notes                                                                        |
| ----------------- | ----------------------------- | ---------------: | ------------------------------------------ | ---------------------------------------------------------------------------- |
| `api`             | Deployment                    |                1 | HPA (CPU, later request rate)              | Stateless. Readiness checks PostgreSQL and Redis                             |
| `worker`          | Deployment                    |                1 | Fixed; KEDA (queue depth) only when needed | Graceful shutdown drains the active job                                      |
| `ai-adapter`      | Module inside `api` initially |                — | —                                          | Split out only if inference isolation needs its own egress policy or scaling |
| `redis`           | Deployment + PVC              |                1 | None                                       | AOF persistence for BullMQ durability                                        |
| `postgres`        | StatefulSet + PVC             |                1 | None                                       | Portfolio-owned; backups by CronJob                                          |
| `cloudflared`     | Deployment                    |              1–2 | None                                       | Outbound tunnel; routes only to `api`                                        |
| Inference runtime | —                             |                — | —                                          | Outside the cluster                                                          |

Resource requests and limits are set only after measurement (Phase 7). Every chart value has a
deliberately small placeholder default so it doesn't claim capacity it hasn't been given.

## Helm Chart

**Confirmed (in the repository, not yet deployed):** `infrastructure/helm/portfolio/`, validated in
CI and locally with `pnpm helm:check` (`helm lint --strict`, `helm template` piped to `kubeconform
-strict`, a no-`Secret` check, and failure tests for missing digests and secrets).

```text
infrastructure/helm/portfolio/
  Chart.yaml
  values.yaml               # safe defaults, no secrets
  ci/*-values.yaml          # render fixtures for CI
  templates/
    api.yaml                # Deployment + ClusterIP Service
    worker.yaml             # Deployment
    migrate-job.yaml        # migrate, then seed (Argo CD Sync hook)
    postgres.yaml           # StatefulSet + headless Service + PVC template
    redis.yaml              # Deployment + PVC + Service
    networkpolicies.yaml    # default-deny + per-component allows
```

**Proposed (later tasks):** `api-hpa.yaml` (P3-06), `postgres-backup-cronjob.yaml` (P3-05),
`cloudflared.yaml` (P4-03), the Explorer ServiceAccount and Role (P6-01),
`infrastructure/environments/production/values.yaml` with image digests (P3-02), and
`infrastructure/argocd/portfolio-application.yaml` (P3-04).

Chart behavior:

- **Images:** each image takes a `digest` (preferred) or a `tag`; rendering fails with neither, or
  with a malformed digest.
- **Secrets:** the chart renders no Secret. PostgreSQL and the API read the password from an
  existing Secret (`postgres.auth.existingSecret`, key `password`). `DATABASE_URL` is assembled
  with Kubernetes `$(VAR)` expansion, so the password never appears in a manifest.
- **Hardening:** every pod runs as a numeric non-root UID with `RuntimeDefault` seccomp, no service
  account token, and no service-link env vars. Every container has a read-only root filesystem,
  no privilege escalation, all capabilities dropped, CPU and memory requests, and a memory limit.
- **Ordering (Argo CD sync waves):** PostgreSQL and Redis (wave 0), the migrate Job (wave 1, Sync
  hook), then the API and worker (wave 2). With plain Helm the Job name carries the release
  revision, so each upgrade gets a fresh Job, and its retries cover PostgreSQL still starting.
- **Redis:** Deployment with `Recreate` strategy (a ReadWriteOnce volume can't be shared during a
  rollout); its PVC is kept if the release is uninstalled. It has no password and is reachable
  only through NetworkPolicy, as in Compose.

Secrets are referenced by name (`existingSecret`) and created out of band, for example with
SOPS or Sealed Secrets (to be decided in P3-07). They are never stored in values files.

## Probes

| Process    | Liveness                                 | Readiness                                       |
| ---------- | ---------------------------------------- | ----------------------------------------------- |
| `api`      | `GET /api/v1/health` (process only)      | `GET /api/v1/health/ready` (PostgreSQL + Redis) |
| `worker`   | None yet; needs a worker heartbeat first | None: the worker serves no traffic              |
| `postgres` | `pg_isready` (plus a startup probe)      | `pg_isready`                                    |
| `redis`    | `redis-cli ping`                         | `redis-cli ping`                                |

A crashing worker exits and is restarted; a hung worker is not yet detected. A liveness probe
that adds real signal needs a heartbeat from the worker process (for example a file touched after
each poll), which is future work.

Liveness never checks dependencies. A slow database should take a pod out of rotation, not restart
it.

## Autoscaling

- HPA needs metrics-server, which K3s bundles. Verify it before creating the HPA.
- Choose `maxReplicas` from load tests. On one node, extra replicas share the same CPU, so the
  ceiling is small.
- **GitOps interaction:** the Deployment manifest omits `spec.replicas` when the HPA is enabled,
  and the Argo CD Application ignores `/spec/replicas` on Deployments. That way Argo CD never
  reverts what the HPA changes.

## GitOps

1. CI builds images and pushes them to GHCR. Tags are human-friendly, but deployments use digests.
2. A release workflow commits the new digest to `infrastructure/environments/production/values.yaml`.
3. Argo CD, reachable only over Tailscale, polls the repository and syncs.
4. Rolling update with `maxUnavailable: 0`; readiness gates traffic.

Rollback means reverting the values commit. Database migrations must be backward compatible for
one release ([runbooks](../operations/runbooks.md#rollback)).

## Single-Node Caveats

- No physical high availability. A host reboot means downtime for the API, but not for the site.
- PVCs use K3s's local-path provisioner, so data lives on the host disk and needs off-host backups.
- The cluster shares CPU, RAM, and iptables with existing Docker workloads. Budget resources
  conservatively and watch for interference.
