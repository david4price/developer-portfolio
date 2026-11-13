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

Install the port guard (below) first, then K3s:

```bash
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="server \
  --disable traefik \
  --disable servicelb \
  --write-kubeconfig-mode 0600 \
  --tls-san <tailnet-hostname>" sh -
```

- `--disable traefik --disable servicelb` keep K3s off host ports 80/443, which another reverse
  proxy may already own. The chart creates only ClusterIP Services, so nothing gets a NodePort.
- The API server stays on all interfaces instead of `--bind-address <tailnet-address>`: pods reach
  it through the node address, and binding it to the tailnet would make the cluster depend on
  Tailscale being up. The port guard limits who can connect instead.
- Default CIDRs (`10.42.0.0/16` pods, `10.43.0.0/16` services) must not overlap Docker, LAN, or VPN
  ranges.
- **Validate:** `kubectl get nodes` is Ready, `kubectl top nodes` works (metrics-server), and every
  pre-existing service still responds.
- **Rollback:** `/usr/local/bin/k3s-uninstall.sh`, then re-check the existing services.

### K3s port guard (allow-list)

**Proposed.** K3s listens on all interfaces: `6443/tcp` (Kubernetes API), `10250/tcp` (kubelet),
and `8472/udp` (flannel VXLAN, unused on one node). A host without its own firewall exposes them to
the whole LAN. The guard below allows them only from loopback, the tailnet, and pods (`cni0`), and
leaves every other port and existing rule alone.

Why not enable ufw or the distribution's `nftables.service`: a default-deny ufw would also cut off
every other LAN service on the host unless each one is allowed (and Docker-published ports bypass
ufw anyway), and the stock `/etc/nftables.conf` usually starts with `flush ruleset`, which deletes
Docker's and Tailscale's rules. A separate table is a smaller change with a one-line rollback.

`/etc/k3s-guard.nft`:

```text
table inet k3s_guard {}
delete table inet k3s_guard

table inet k3s_guard {
  chain input {
    type filter hook input priority filter - 1; policy accept;
    iifname { "lo", "tailscale0", "cni0" } accept
    tcp dport { 6443, 10250 } drop
    udp dport 8472 drop
  }
}
```

The first two lines make the file safe to load repeatedly. Only the `input` hook is used, so traffic
Docker forwards to containers is untouched. Load it at boot, before K3s, with
`/etc/systemd/system/k3s-guard.service`:

```ini
[Unit]
Description=Restrict K3s ports to loopback, tailnet, and pods
Before=k3s.service
After=network-pre.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/sbin/nft -f /etc/k3s-guard.nft
ExecStop=/usr/sbin/nft delete table inet k3s_guard

[Install]
WantedBy=multi-user.target
```

- **Apply:** `sudo nft -c -f /etc/k3s-guard.nft` (dry run), then
  `sudo systemctl enable --now k3s-guard`.
- **Validate:** `sudo nft list table inet k3s_guard`; `nc -vz <lan-address> 6443` from another
  LAN machine times out; `kubectl get nodes` works over the tailnet; `kubectl top nodes` and
  `kubectl logs` still work; every pre-existing service still responds.
- **Rollback:** `sudo systemctl disable --now k3s-guard` (its stop command deletes the table).

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
2. The release workflow (`.github/workflows/release.yml`) starts only after CI succeeds on a push
   to `main`. It builds the api and worker images, pushes them to GHCR tagged with the commit SHA,
   and commits their digests to `infrastructure/environments/production/images.yaml`. People
   edit `values.yaml` next to it, which pins PostgreSQL and Redis by digest. The workflow refuses
   to replace a newer pin with an older build, and its commits don't trigger CI, so it can't
   loop. Its token permissions are set per job (`packages: write` to push, `contents: write` to
   commit), so the repository's default read-only setting stays as is. New GHCR packages start
   private: make `portfolio-api` and `portfolio-worker` public once, after the first release, so
   the cluster can pull them without a pull secret.
3. Argo CD syncs. The rolling update uses `maxUnavailable: 0`, and readiness gates traffic.
4. Run migrations as a pre-sync Job, only for backward-compatible migrations (see runbooks).

## 6. Public Exposure (Phase 4)

- Create a dedicated Cloudflare Tunnel and run `cloudflared` in the `portfolio` namespace.
- Tunnel ingress has only `api.<domain>` mapped to `http://portfolio-api.portfolio.svc:3001`
  (release `portfolio`), plus a catch-all 404.
- Set `CORS_ORIGINS` to the public site origin.

## Rollback

See [runbooks](../operations/runbooks.md#rollback).
