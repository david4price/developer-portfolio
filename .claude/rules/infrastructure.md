---
paths:
  - 'infrastructure/**'
  - 'compose*.yaml'
  - '.github/**'
  - '.env.example'
  - 'pnpm-workspace.yaml'
---

# Infrastructure and CI Rules

- Compose: publish ports on `127.0.0.1` only; require credentials with `${VAR:?message}`; never
  add plaintext secret defaults. App containers keep `cap_drop: [ALL]`,
  `no-new-privileges`, and `read_only` where the image allows it.
- Validate Compose with `docker compose --env-file .env.example -f <file> config --quiet`. Never
  print the full rendered config; it can contain interpolated secrets.
- Images: multi-stage, pinned base major versions, `pnpm deploy --prod`, run as a non-root user,
  no build tooling in the runtime stage.
- Helm/Kubernetes (Phase 3): no secrets in values files (reference existing Secrets), image
  digests in `infrastructure/environments/*`, resource requests on every container, liveness
  separate from readiness, NetworkPolicies default-deny. Argo CD must ignore `spec.replicas` for
  HPA-managed Deployments.
- GitHub Actions: workflow `permissions` default to `contents: read`; grant more per job only when
  needed. Pull requests never get deploy credentials or self-hosted runners. Pin actions to a
  major version (Dependabot updates them).
- Keep pnpm supply-chain settings in `pnpm-workspace.yaml` intact; don't add release-age
  exclusions or allow build scripts without a stated reason.
- Anything that changes a running system is out of scope unless explicitly requested; see the
  Operational Safety section in `AGENTS.md`.
