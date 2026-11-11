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

## Helm Layout (proposed)

```text
infrastructure/helm/portfolio/
  Chart.yaml
  values.yaml               # safe defaults, no secrets
  templates/
    api-deployment.yaml     api-service.yaml     api-hpa.yaml
    worker-deployment.yaml
    redis.yaml              postgres.yaml        postgres-backup-cronjob.yaml
    cloudflared.yaml
    networkpolicies.yaml
    serviceaccount-explorer.yaml   # read-only, namespace-scoped Role
infrastructure/environments/production/values.yaml   # image digests, hostnames
infrastructure/argocd/portfolio-application.yaml
```

Secrets are referenced by name (`existingSecret`) and created out of band, for example with
SOPS or Sealed Secrets (to be decided). They are never stored in values files.

## Probes

| Process  | Liveness                                  | Readiness                                       |
| -------- | ----------------------------------------- | ----------------------------------------------- |
| `api`    | `GET /api/v1/health` (process only)       | `GET /api/v1/health/ready` (PostgreSQL + Redis) |
| `worker` | Exec probe or small health port (Phase 3) | Redis connection established                    |

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
