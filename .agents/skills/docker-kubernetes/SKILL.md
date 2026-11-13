---
name: docker-kubernetes
description: Write or review this project's container images, Docker Compose files, and Kubernetes manifests or Helm charts for single-node K3s — Deployments, Services, Ingress, probes, resources, HPA, KEDA, NetworkPolicies, and PVCs. Use for files under infrastructure/, compose*.yaml, or Dockerfiles. Never installs or changes a live cluster or host without an explicit request.
---

# Docker and Kubernetes

Status: Docker/Compose are implemented; the Helm chart exists (P3-01) but nothing is deployed
yet (Phase 3). Read
`docs/architecture/kubernetes.md` and `docs/deployment/kubernetes.md` first.

## Images (`infrastructure/docker/`)

- `node-service.Dockerfile` builds `api` or `worker` (`--build-arg APP=…`) with
  `pnpm install --filter "@portfolio/<app>..."`, `tsc -b`, `pnpm deploy --prod`; runtime runs as
  `node`. `web.Dockerfile` builds the static export and serves it with unprivileged nginx on 8080.
- A new workspace package must have `files: ["dist"]` or `pnpm deploy` ships it without code.
- Validate builds without Docker by replaying the `RUN` steps in a scratch copy, or let CI's
  `images` job build them. Building images on a shared host needs approval.

## Compose

- `compose.yaml` (PostgreSQL + Redis for development) and `compose.full.yaml` (everything).
- Loopback-only ports, `${VAR:?}` for credentials, `cap_drop: [ALL]`, `no-new-privileges`,
  `read_only` where possible, health checks with `depends_on` conditions.
- Validate: `docker compose --env-file .env.example -f <file> config --quiet`.

## Kubernetes / Helm (Phase 3)

- Chart at `infrastructure/helm/portfolio/`; environment values in
  `infrastructure/environments/production/values.yaml` with image **digests**.
- Every container: requests (and memory limits), `runAsNonRoot`, `readOnlyRootFilesystem`,
  `allowPrivilegeEscalation: false`, dropped capabilities.
- Probes: liveness `GET /api/v1/health`, readiness `GET /api/v1/health/ready`, sensible
  `startupProbe` for slow boots. Liveness never checks dependencies.
- Rollouts: `maxUnavailable: 0`; PodDisruptionBudget only when replicas > 1.
- HPA on `api` (CPU first, measured targets). When enabled, omit `spec.replicas` and have Argo CD
  ignore `/spec/replicas`. Pick `maxReplicas` from load tests — one node means replicas share CPU.
- KEDA only when queue depth justifies it (scale the worker on BullMQ wait-list length).
- NetworkPolicies: default-deny per namespace, explicit allows listed in
  `docs/architecture/networking.md`. Namespaces alone don't isolate traffic.
- Stateful services (PostgreSQL, Redis) use PVCs on the local-path provisioner and need off-host
  backups.
- Secrets are referenced (`existingSecret`), never templated from values.

## Validation

```bash
pnpm helm:check   # infrastructure/helm/check-chart.sh
```

It lints the chart, renders every `ci/*-values.yaml` through `kubeconform -strict`, rejects
rendered Secrets, and asserts the guardrails fail with their messages (missing image reference,
malformed digest, AI without a model, missing Secret name). Add a `ci/*-values.yaml` fixture for
new options and an `expect_failure` case for new `required`/`fail` guards. CI's `helm` job runs
the same script with pinned tools. Install `helm`/`kubeconform` locally only with approval
(a checksum-verified download into a temporary directory is enough).

## K3s on the Reference Host

Installation flags, preconditions, and rollback are in `docs/deployment/kubernetes.md`. Bundled
Traefik and ServiceLB stay disabled because another reverse proxy owns host ports 80/443. Any
install, upgrade, or `kubectl apply` against the real cluster requires an explicit request and a
stated rollback.
