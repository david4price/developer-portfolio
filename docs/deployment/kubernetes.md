# Kubernetes Deployment

**Status:** K3s and its port guard run on the reference host (P3-03, 2026-11-13; rollback
drilled). Argo CD v3.6.1 deploys the portfolio from `main` (P3-04, 2026-11-13). Everything after
that is Proposed. Each step that changes a running server
needs explicit approval and must have a rollback ready before it starts.

## 1. Preconditions

- The [validation register](../architecture/validation-register.md) has no open blockers for K3s:
  firewall rules reviewed, port and CIDR checks done.
- Existing services on the host are healthy, and their state has been recorded so it can be
  compared afterwards.
- A maintenance window, since iptables changes can briefly affect existing container networking.

## 2. Install K3s (approval required)

Install the port guard (below) first, then K3s:

```bash
curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION=v1.37.2+k3s1 INSTALL_K3S_EXEC="server \
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
- Pin the version (`INSTALL_K3S_VERSION`) so a reinstall restores exactly what ran before.
- `--write-kubeconfig-mode 0600` keeps `/etc/rancher/k3s/k3s.yaml` root-only. Copy it to the
  operator's `~/.kube/config` (mode 0600) and set `KUBECONFIG=$HOME/.kube/config`: the `kubectl`
  symlink K3s installs reads the root-only file unless `KUBECONFIG` is set.
- When scripting the install, wait for objects to exist before `kubectl wait`: the node registers a
  few seconds after `k3s` starts, and the add-on Deployments a few seconds after that.
  `kubectl wait --all` on zero objects fails with "no matching resources found".
- **Validate:** `kubectl get nodes` is Ready, `kubectl top nodes` works (metrics-server),
  `kubectl logs` and `kubectl exec` work, and every pre-existing service still responds.
- **Rollback:** `sudo /usr/local/bin/k3s-uninstall.sh`, then
  `sudo systemctl disable --now kube-port-guard`, then re-check the existing services. Drilled on
  2026-11-13. Two side effects to know:
  - The uninstaller treats every `/etc/systemd/system/k3s*.service` unit as another K3s service.
    If more than one exists, it removes the service but **keeps the binary and data directories**.
    Never name your own units `k3s*` (the guard was renamed from `k3s-guard` for this reason).
  - It runs `tailscale set --advertise-routes=`, which clears any subnet routes this host
    advertises over Tailscale. Re-advertise them afterwards if the host is a subnet router.

### K3s port guard (allow-list)

**Proposed.** K3s listens on all interfaces: `6443/tcp` (Kubernetes API), `10250/tcp` (kubelet),
and `8472/udp` (flannel VXLAN, unused on one node). A host without its own firewall exposes them to
the whole LAN. The guard below allows them only from loopback, the tailnet, and pods (`cni0`), and
leaves every other port and existing rule alone.

Why not enable ufw or the distribution's `nftables.service`: a default-deny ufw would also cut off
every other LAN service on the host unless each one is allowed (and Docker-published ports bypass
ufw anyway), and the stock `/etc/nftables.conf` usually starts with `flush ruleset`, which deletes
Docker's and Tailscale's rules. A separate table is a smaller change with a one-line rollback.

`/etc/kube-port-guard.nft`:

```text
table inet kube_port_guard {}
delete table inet kube_port_guard

table inet kube_port_guard {
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
`/etc/systemd/system/kube-port-guard.service`:

```ini
[Unit]
Description=Restrict K3s ports to loopback, tailnet, and pods
Before=k3s.service
After=network-pre.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/sbin/nft -f /etc/kube-port-guard.nft
ExecStop=/usr/sbin/nft delete table inet kube_port_guard

[Install]
WantedBy=multi-user.target
```

- **Apply:** `sudo nft -c -f /etc/kube-port-guard.nft` (dry run), then
  `sudo systemctl enable --now kube-port-guard`. Don't name the unit `k3s*.service` (see the
  install rollback above).
- **Validate:** `sudo nft list table inet kube_port_guard`; `nc -vz <lan-address> 6443` from another
  LAN machine times out; `kubectl get nodes` works over the tailnet; `kubectl top nodes` and
  `kubectl logs` still work; every pre-existing service still responds.
- **Rollback:** `sudo systemctl disable --now kube-port-guard` (its stop command deletes the
  table).
- Verified 2026-11-13: from a LAN device, `6443` and `10250` hang (dropped) while port 80 on the
  same host connects.

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

Manifests live in `infrastructure/argocd/`:

| File                         | Purpose                                                                                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `install/kustomization.yaml` | Upstream non-HA install, pinned to the release **commit** (not the tag)                                                                                          |
| `project.yaml`               | `portfolio` AppProject: this repository, the `portfolio` namespace, no cluster-scoped resources, only the kinds the chart renders (no Secrets)                   |
| `application.yaml`           | Chart + `environments/production/{values,images}.yaml` from `main`; automated sync with prune and self-heal; ignores `portfolio-api` replicas for the future HPA |

Install, in order:

```bash
kubectl apply --server-side --force-conflicts -k infrastructure/argocd/install
kubectl -n argocd rollout status deploy --timeout=300s
kubectl create namespace portfolio
# Secret from section 3 (random, URL-safe; never echo it)
kubectl apply -f infrastructure/argocd/project.yaml -f infrastructure/argocd/application.yaml
kubectl -n argocd get application portfolio   # Synced / Healthy
```

- **Private access:** `argocd-server` stays a ClusterIP Service: no Ingress, LoadBalancer,
  NodePort, or tunnel. The host can reach ClusterIPs, so `tailscale serve` publishes it on the
  tailnet only, with a valid certificate for the machine's tailnet name:
  `sudo tailscale serve --bg --https=8443 https+insecure://<argocd-server ClusterIP>:443`. Re-run
  it if the Service is ever recreated (its ClusterIP changes). Remove with
  `sudo tailscale serve --https=8443 off`.
- **Admin login:** user `admin`; the first password is in the `argocd-initial-admin-secret`
  Secret. Change it in the UI (User Info → Update password), then delete that Secret.
- **Pruning is safe for data:** PostgreSQL's volume comes from the StatefulSet's
  `volumeClaimTemplates`, which Argo CD doesn't own, so no sync can delete it.
- **Rollback:** `kubectl -n argocd delete application portfolio` stops management and leaves the
  workloads running (no resources finalizer). Remove Argo CD with
  `kubectl delete -k infrastructure/argocd/install`.

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
