# Kubernetes Deployment

**Status: Proposed (Phase 3).** Nothing here has been applied to the reference host yet. Each step
that changes a running server needs explicit approval and must have a rollback ready before it
starts.

## 1. Preconditions

- The [validation register](../architecture/validation-register.md) has no open blockers for K3s:
  firewall rules reviewed, port and CIDR checks done.
- Existing services on the host are healthy, and their state has been recorded so it can be
  compared afterwards.
- A maintenance window, since iptables changes can briefly affect existing container networking.

## 2. Install K3s (approval required)

```bash
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="server \
  --disable traefik \
  --disable servicelb \
  --write-kubeconfig-mode 0600 \
  --bind-address <tailnet-or-loopback-address> \
  --tls-san <tailnet-hostname>" sh -
```

- `--disable traefik --disable servicelb` keep K3s off host ports 80/443, which another reverse
  proxy may already own.
- Default CIDRs (`10.42.0.0/16` pods, `10.43.0.0/16` services) must not overlap Docker, LAN, or VPN
  ranges.
- **Validate:** `kubectl get nodes` is Ready, `kubectl top nodes` works (metrics-server), and every
  pre-existing service still responds.
- **Rollback:** `/usr/local/bin/k3s-uninstall.sh`, then re-check the existing services.

## 3. Secrets

Create secrets out of band; they never go in Git:

```bash
kubectl create namespace portfolio
# URL-safe characters only: the chart embeds the password in DATABASE_URL.
kubectl -n portfolio create secret generic portfolio-postgres --from-literal=password='<password>'
kubectl -n portfolio create secret generic portfolio-tunnel --from-file=credentials.json  # Phase 4
```

The chart reads `portfolio-postgres` (key `password`) for both PostgreSQL and the API; override
the name with `postgres.auth.existingSecret`. It never creates or renders a Secret.

## Chart Validation (no cluster needed)

```bash
pnpm helm:check   # helm lint --strict, helm template | kubeconform -strict, guardrail tests
```

Requires `helm` and `kubeconform` on `PATH`; CI installs pinned versions.

On the reference deployment, these Secrets live in Git as `SealedSecret` resources under
`infrastructure/environments/production/secrets/`, sealed offline with the committed public
certificate. The controller install, certificate, key backup, and rotation are in
[ADR 0001](../architecture/adr-0001-secrets-management.md). The `kubectl create secret` commands
above remain the way to run the chart without the owner's controller.

## 4. Argo CD (private)

- Install into the `argocd` namespace. Don't expose it with an Ingress, LoadBalancer, or tunnel.
- Reach it over Tailscale: `kubectl -n argocd port-forward svc/argocd-server 8443:443` from an SSH
  session, or a tailnet-only proxy.
- The Application tracks `infrastructure/environments/production` on `main` and ignores
  `/spec/replicas` on HPA-managed Deployments.

## 5. Release Flow

1. Merge to `main`. CI passes.
2. The release workflow builds and pushes images to GHCR and commits their digests to
   `infrastructure/environments/production/values.yaml`.
3. Argo CD syncs. The rolling update uses `maxUnavailable: 0`, and readiness gates traffic.
4. Run migrations as a pre-sync Job, only for backward-compatible migrations (see runbooks).

## 6. Public Exposure (Phase 4)

- Create a dedicated Cloudflare Tunnel and run `cloudflared` in the `portfolio` namespace.
- Tunnel ingress has only `api.<domain>` mapped to `http://portfolio-api.portfolio.svc:3001`
  (release `portfolio`), plus a catch-all 404.
- Set `CORS_ORIGINS` to the public site origin.

## Rollback

See [runbooks](../operations/runbooks.md#rollback).
