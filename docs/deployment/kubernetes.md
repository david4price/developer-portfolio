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

### Inference port guard (P5-12)

**Confirmed** on the reference host (2026-11-15). The reference inference runtime (Docker Model
Runner) has no authentication and publishes TCP `12434` on the host's loopback and Docker bridge
addresses. A LAN device that routes Docker's bridge range through the host could reach it, because
the host has no firewall of its own. This guard drops that port from every interface except
loopback, Docker bridges (`docker0`, `br-*`), and pods (`cni0`), so the host, its containers (a
private assistant among them), and the API pod keep working. The portfolio's NetworkPolicy still
limits which pod may connect.

Docker forwards a published port to the container (DNAT), so that traffic never reaches the
`input` hook: the guard also filters `forward`, matching the port the connection was originally
sent to. Each chain has a single rule that drops only on a full match (TCP, port 12434, an
interface outside the allow-list), so other traffic, including UDP and ICMP, passes untouched.

`/etc/inference-port-guard.nft`:

```text
table inet inference_port_guard {}
delete table inet inference_port_guard

# The local model runner's API (TCP 12434) has no authentication. Drop it from the LAN, the
# tailnet, and any other interface; allow the host, Docker containers, and Kubernetes pods.
# Each chain has one rule that drops only on a full match, so all other traffic passes untouched.
table inet inference_port_guard {
  # Connections to the published port's proxy on the host itself.
  chain input {
    type filter hook input priority filter - 1; policy accept;
    meta l4proto tcp tcp dport 12434 iifname != { "lo", "docker0", "cni0" } iifname != "br-*" drop
  }

  # Connections Docker rewrites (DNAT) to the container: match the port they were sent to.
  chain forward {
    type filter hook forward priority filter - 1; policy accept;
    meta l4proto tcp ct original proto-dst 12434 iifname != { "docker0", "cni0" } iifname != "br-*" drop
  }
}
```

`/etc/systemd/system/inference-port-guard.service` (loads before Docker publishes the port):

```ini
[Unit]
Description=Restrict the local model runner's port to the host, containers, and pods
Before=docker.service
After=network-pre.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/sbin/nft -f /etc/inference-port-guard.nft
ExecStop=/usr/sbin/nft delete table inet inference_port_guard

[Install]
WantedBy=multi-user.target
```

- **Apply:** `sudo nft -c -f /etc/inference-port-guard.nft` (dry run), then
  `sudo systemctl daemon-reload && sudo systemctl enable --now inference-port-guard`.
- **Validate:** `sudo nft list table inet inference_port_guard`. From another LAN device with a
  route to Docker's bridge range through the host, `curl -m 5 http://<docker-bridge-address>:12434/`
  gets no answer. On the host, the runtime's `/engines/v1/models` still answers on loopback and the
  bridge address; the API pod reaches it and the worker pod is refused; containers that use the
  runtime still work; Tailscale and the K3s port guard stay active.
- **Rollback:** `sudo systemctl disable --now inference-port-guard` (its stop command deletes the
  table).
- Verified 2026-11-15: a LAN device no longer reaches the runtime; the host, the API pod, and the
  public site work; the worker pod is refused; Docker, K3s, Tailscale, and the K3s guard unaffected.

### API audit logging (P7-06, approval required)

Without an audit log, nothing reliably records who changed what in the cluster. About three
minutes before the P6-04 offline drill started, a client nobody could identify scaled the API
Deployment to zero. A scale write does leave a managed-fields entry (`subresource: scale`), but
the drill's restore scaled it back up and took that entry over before anyone looked. So before
restoring after an unexpected change, read
`kubectl get deploy <name> -o yaml --show-managed-fields` first. K3s turns on the API server's
audit log through a drop-in, `/etc/rancher/k3s/config.yaml.d/audit.yaml`, which it reads after
`config.yaml` and merges with the flags in its systemd unit.

- **Policy** (`/etc/rancher/k3s/audit-policy.yaml`, root `0600`): Metadata level only, so who,
  which resource, when, and the response code, never request or response bodies (Secret values
  are never logged).
  - **Recorded:** `kubectl exec`, `attach`, and `port-forward`. They arrive as `get` upgrades
    on `pods/exec`, `pods/attach`, and `pods/portforward`, so these rules come before reads are
    dropped. Secret `get` and `list`, and every write: create, update, patch, delete, `scale`
    included.
  - **Dropped as noise:** other reads (`get`, `list`, `watch`, Secret watches included), health
    and discovery URLs, leases, events, endpoints, endpoint slices, and kubelets' node and pod
    status updates.

  ```yaml
  apiVersion: audit.k8s.io/v1
  kind: Policy
  omitStages: [RequestReceived]
  rules:
    - level: Metadata
      resources:
        - { group: '', resources: [pods/exec, pods/attach, pods/portforward] }
    - level: Metadata
      verbs: [get, list]
      resources:
        - { group: '', resources: [secrets] }
    - level: None
      verbs: [get, list, watch]
    - level: None
      nonResourceURLs: ['/healthz*', '/livez*', '/readyz*', '/version', '/openapi*', '/api*']
    - level: None
      resources:
        - { group: coordination.k8s.io, resources: [leases] }
        - { group: '', resources: [events, endpoints] }
        - { group: discovery.k8s.io, resources: [endpointslices] }
        - { group: events.k8s.io, resources: [events] }
    - level: None
      userGroups: ['system:nodes']
      resources:
        - { group: '', resources: [nodes/status, pods/status] }
    - level: Metadata
  ```

- **Config:** `/etc/rancher/k3s/config.yaml.d/audit.yaml`, root `0644`. It holds no secrets, and
  K3s's bundled `kubectl` reads its config files too, warning `permission denied` on every call
  if it can't. Keep secrets such as `token:` in `config.yaml` itself, at `0600`. If `config.yaml`
  ever sets `kube-apiserver-arg`, move these lines into it, because a later file's list replaces
  an earlier one's.

  ```yaml
  kube-apiserver-arg:
    - audit-policy-file=/etc/rancher/k3s/audit-policy.yaml
    - audit-log-path=/var/lib/rancher/k3s/server/logs/audit.log
    - audit-log-maxage=30
    - audit-log-maxbackup=9
    - audit-log-maxsize=100
  ```

- **Apply:** check what's already there: `sudo ls -la /etc/rancher/k3s/`, plus `config.yaml.d/`
  if it exists. Install the policy and the drop-in as root, then `sudo systemctl restart k3s`.
  The control plane (kubectl, Argo CD syncs, the HPA) is unavailable during the restart, for
  under a minute; running pods keep serving.
- **Validate:**
  - `kubectl get nodes` is `Ready`.
  - After any change (an Argo CD sync, a `kubectl scale`), run
    `sudo tail -n 5 /var/lib/rancher/k3s/server/logs/audit.log`. It shows JSON lines with
    `user.username`, `verb`, `objectRef`, and `responseStatus.code`.
  - To find who scaled the API: `sudo grep '"subresource":"scale"' …/audit.log`.
  - To find who exec'd into a pod: `sudo grep '"subresource":"exec"' …/audit.log`.
- **Note:** Metadata still records each request's URI. For `exec` that includes the command and
  its arguments, and for `attach` and `port-forward` their parameters. Anything in those
  arguments, such as a token expanded by your shell, sits in plain text in the root-only log
  for up to 30 days, across up to 10 files. Treat the log as sensitive and never pass a secret
  on an `exec` command line.
- **Restart side effect:** for about a minute after the restart, the HPA can't read CPU
  metrics, so Argo CD briefly reports the app `Degraded`. It recovers on its own.
- **Rollback:** remove `/etc/rancher/k3s/config.yaml.d/audit.yaml` and restart K3s. If K3s
  doesn't come back after applying, that's the fix; check `journalctl -u k3s` for the policy
  error first.
- **Retention:** the active file plus 9 rotated ones of 100 MB (1 GB at most), deleted after 30
  days, whichever limit comes first. On the reference host about 13 events a minute (~19 MB a
  day) means the 30 days apply.
- **Checking without root:** with an admin kubeconfig, `kubectl get --raw /metrics | grep
apiserver_audit` shows three counters:
  - `apiserver_audit_event_total`: events written to the log.
  - `apiserver_audit_error_total`: events that failed to write (should stay absent or 0).
  - `apiserver_audit_level_total`: requests per policy level, `None` (dropped) included.
- **Applied on the reference host (2026-11-19):**
  - The node, workloads, and Argo CD came back healthy.
  - Metadata events are counting, with no audit errors.
  - Each test request was recorded with its user and source:
    - a `kubectl exec` (verb `get`, subresource `exec`, response `101`);
    - a Secret `get`;
    - a server-side dry-run `create`.

## 3. Secrets

The reference deployment keeps every Secret in Git as a **SealedSecret** (ADR 0001, P3-08). The
Sealed Secrets controller runs in `kube-system`, installed by the Argo CD Application
`infrastructure/argocd/sealed-secrets.yaml` (chart 2.22.0, image pinned by digest, automatic key
renewal off) under the `platform` AppProject. The `portfolio` Application syncs
`infrastructure/environments/production/secrets/` as a second source, at sync wave −1.

| SealedSecret          | Keys           | Used by                                        |
| --------------------- | -------------- | ---------------------------------------------- |
| `portfolio-postgres`  | `password`     | PostgreSQL and the API (`DATABASE_URL`)        |
| `portfolio-tunnel`    | `token`        | cloudflared (`TUNNEL_TOKEN`)                   |
| `portfolio-api-env`   | `CORS_ORIGINS` | API environment (`api.envSecret`); real domain |
| `portfolio-turnstile` | `secret-key`   | API session verification when AI is enabled    |

The API environment Secret also supplies `TURNSTILE_HOSTNAMES`, the inference settings
`AI_MODEL` and `AI_BASE_URL` (the chart sets neither when `api.ai.model`/`api.ai.baseUrl` are
empty, so the Secret's values apply), and, optionally, `CHAT_ASSISTANT_NAME` (a name the owner
prefers not to keep in Git). Keeping these sealed preserves the public repository boundary.
To add or change one key without re-entering the others, pipe a Secret holding only that key
into `kubeseal … --merge-into infrastructure/environments/production/secrets/<name>.sealedsecret.yaml`
(with `kubectl --kubeconfig <file>` if the default K3s kubeconfig isn't readable); check it with
`kubeseal --validate` before committing. Turnstile's reference setup is recorded in the
[verification guide](turnstile.md).

**Seal a new or changed value** offline with the committed certificate; the plaintext goes through
a pipe only, never a file in the repository:

```bash
kubectl create secret generic <name> -n portfolio --from-literal=<key>='<value>' \
  --dry-run=client -o yaml \
  | kubeseal --cert infrastructure/environments/production/sealed-secrets.pem -o yaml \
  > infrastructure/environments/production/secrets/<name>.sealedsecret.yaml
```

Add `metadata.annotations."argocd.argoproj.io/sync-wave": "-1"` and commit. The source values
belong in the owner's password manager: they can't be read back from Git.

**Adopting a hand-made Secret:** the controller won't overwrite a Secret it didn't create. Annotate
it with `sealedsecrets.bitnami.com/managed=true` before the matching SealedSecret is synced.

**Key backup and restore.** The controller's key pair was exported once (2026-11-13) to a `0600`
file on the reference host, outside the cluster's data directory and both repositories. The path
is in the private register (P1-04: local backups for now). To rebuild:

1. Apply the backed-up key Secret to `kube-system` **before** the controller starts (strip
   `resourceVersion`, `uid`, and other cluster-specific metadata).
2. Sync the `sealed-secrets` Application, then the `portfolio` Application.

Drilled on 2026-11-13: in a throwaway K3s (in Docker), the restored key unsealed a test
SealedSecret sealed with the committed certificate to its exact original value.

**Without the owner's key** (forks, local clusters): create the same named Secrets with
`kubectl create secret …`; the chart only references them by name and never renders a Secret.

## Chart Validation (no cluster needed)

```bash
pnpm helm:check   # helm lint --strict, helm template | kubeconform -strict, guardrail tests
```

Requires `helm`, `kubeconform`, `yq` (mikefarah v4), and `jq` on `PATH`; CI installs pinned
versions of the first three. The second half (`infrastructure/monitoring/check-monitoring.sh`)
downloads the monitoring stack's pinned charts from their repositories, checks each archive's
sha256, and renders them with the production values
([what it enforces](../architecture/observability.md#layout)).

On the reference deployment, these Secrets live in Git as `SealedSecret` resources under
`infrastructure/environments/production/secrets/`, sealed offline with the committed public
certificate. The controller install, certificate, key backup, and rotation are in
[ADR 0001](../architecture/adr-0001-secrets-management.md). The `kubectl create secret` commands
above remain the way to run the chart without the owner's controller.

## 4. Argo CD (private)

Manifests live in `infrastructure/argocd/`:

| File                         | Purpose                                                                                                                                             |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `install/kustomization.yaml` | Upstream non-HA install, pinned to the release **commit** (not the tag)                                                                             |
| `project.yaml`               | `portfolio` AppProject: this repository, the `portfolio` namespace, no cluster-scoped resources, only the kinds the chart renders (no Secrets)      |
| `application.yaml`           | Chart + `environments/production/{values,images}.yaml` from `main`; automated sync with prune and self-heal; ignores `portfolio-api` replicas (HPA) |

Install, in order:

```bash
kubectl apply --server-side --force-conflicts -k infrastructure/argocd/install
kubectl -n argocd rollout status deploy --timeout=300s
kubectl create namespace portfolio
# Secret from section 3 (random, URL-safe; never echo it)
kubectl apply -f infrastructure/argocd/project.yaml -f infrastructure/argocd/application.yaml
kubectl -n argocd get application portfolio   # Synced / Healthy
```

- **Argo CD doesn't manage itself:** the AppProjects and Applications in `infrastructure/argocd/`
  were applied by hand, so merging a change to them changes nothing in the cluster. Re-apply the
  changed file after the merge (`kubectl diff -f <file>` first, then `kubectl apply -f <file>`).
  Until then a sync that needs a newly allowed kind fails with `resource <kind> is not permitted
in project portfolio`; if it has already failed, re-apply, then trigger a sync.
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

### API autoscaling (P3-06)

`api.autoscaling.enabled` renders a CPU-based HorizontalPodAutoscaler (production: 1–3 replicas
at 70% of the CPU request; scale up by one pod per 30 s, down by one per 60 s after a 5-minute
calm). While it's on, the Deployment omits `replicas`, so the HPA alone sets the count, and the
Application additionally ignores `/spec/replicas` on `portfolio-api` (`RespectIgnoreDifferences`).
Chat limits (P5-03) live in Redis, so they hold across replicas. metrics-server ships with K3s.

### API metrics (P7-01, P9-04)

Each API pod serves Prometheus metrics on `api.metricsPort` (9464). The port is never in the
Service, the tunnel, or a container port, so no visitor can reach it. The chart sets
`API_METRICS_HOST` in the container's `env`, so a value in `envSecret` or `envConfigMap` is
ignored. `pnpm helm:check` accepts exactly two renders:

- **Loopback** (the default): `127.0.0.1`, and no NetworkPolicy rule names the port.
- **Scraped** (`api.metrics.scrape.enabled`, production since P9-04): `0.0.0.0`. Loopback still
  serves `kubectl port-forward`, and exactly one rule names the port: ingress to the API from
  the `monitoring` namespace's Prometheus pods, on TCP 9464 alone. It requires NetworkPolicies
  and a pod off the host network, so no other pod (cloudflared included) can reach it.

Prometheus keeps the history (see [Monitoring stack](#monitoring-stack-phase-9-approval-required)).
To read one pod directly, over the private kubeconfig:

```bash
kubectl -n portfolio port-forward deploy/portfolio-api 9464:9464
curl -s http://127.0.0.1:9464/metrics | grep -v '^#'
```

Counters are per pod and start at zero when a pod starts; with the HPA at more than one replica,
read each pod (`port-forward pod/<name>`) and add them up.

### Monitoring stack (Phase 9, approval required)

Grafana, Loki, Prometheus, Alloy, and kube-state-metrics in the `monitoring` namespace
([ADR 0004](../architecture/adr-0004-observability-stack.md),
[plan](../architecture/observability.md)). The manifests are in Git (P9-02) and checked by
`pnpm helm:check`. Like the other files in `infrastructure/argocd/`, the project and
Applications are applied by hand, so merging them changes nothing in the cluster; once applied,
Argo CD keeps each in sync with `main`.

1. **Namespace, project, and policies** (applied 2026-11-25). Do this first, so the default-deny
   policies and Roles exist before any pod:

   ```bash
   kubectl create namespace monitoring
   kubectl apply -f infrastructure/argocd/monitoring-project.yaml
   kubectl apply -f infrastructure/argocd/monitoring/monitoring.yaml
   ```

2. **Logs (P9-03).**
   - **Loki** (applied 2026-11-25): `kubectl apply -f infrastructure/argocd/monitoring/loki.yaml`.
     Ready in about a minute, with a 5 GiB `local-path` volume.
   - **The portfolio chart's log reader:** `monitoring.readers.logs.enabled` (production: on)
     gives Alloy's account in `monitoring` one Role in `portfolio`: `get`/`list`/`watch` on pods
     and `get` on `pods/log`, nothing else (`pnpm helm:check` compares it exactly). Argo CD syncs
     it from `main`.
   - **Alloy** (applied 2026-11-25), after that sync:
     `kubectl apply -f infrastructure/argocd/monitoring/alloy.yaml`.
   - **Validate:**
     - Alloy's account reads pods and their logs in `portfolio` and `monitoring`, and nothing
       more. Expect `yes` for the first two commands and `no` for the rest:

       ```bash
       sa=system:serviceaccount:monitoring:alloy
       kubectl auth can-i get pods --subresource=log -n portfolio --as=$sa        # yes
       kubectl auth can-i get pods --subresource=log -n monitoring --as=$sa       # yes
       kubectl auth can-i get secrets -n portfolio --as=$sa                       # no
       kubectl auth can-i get secrets -n monitoring --as=$sa                      # no
       kubectl auth can-i create pods --subresource=exec -n portfolio --as=$sa    # no
       kubectl auth can-i create pods --subresource=exec -n monitoring --as=$sa   # no
       kubectl auth can-i list pods -n kube-system --as=$sa                       # no
       ```

     - The API's Explorer account still can't read logs:
       `kubectl auth can-i get pods --subresource=log -n portfolio --as=system:serviceaccount:portfolio:portfolio-api`
       returns `no`.
     - Alloy runs as non-root with no host paths:
       `kubectl -n monitoring get deploy alloy -o jsonpath='{.spec.template.spec.containers[0].securityContext.runAsUser} {.spec.template.spec.volumes}'`
       shows `65534` and no `hostPath`.
     - A request id from a live request is found in Loki:
       `kubectl -n monitoring port-forward svc/loki 3100:3100`, then query
       `{namespace="portfolio", container="api"} |= "<request id>"` on `/loki/api/v1/query_range`.
     - Retention is `30d` under `limits_config` in Loki's `/config`.
     - A pod in another namespace can't reach `loki.monitoring.svc:3100`.
     - **Privacy, after a day of collection:** search the last 24 hours of everything Alloy
       collects, `{namespace=~"portfolio|monitoring"}`, for client addresses, cookies, tokens, and
       chat text, and review each match (words like "token" also appear in harmless messages,
       such as the P6-05 expiry warning). For example:
       - IPv4: `|~ "\\b[0-9]{1,3}(\\.[0-9]{1,3}){3}\\b"`;
       - IPv6 (three or more colons, so `hh:mm:ss` times don't match):
         `|~ "(?i)([0-9a-f]{0,4}:){3,7}[0-9a-f]{1,4}"`;
       - forwarding headers and address fields:
         `|~ "(?i)x-forwarded-for|cf-connecting-ip|remote.?addr|client.?ip"`;
       - values rather than words: `|~ "(?i)bearer [a-z0-9._-]{10,}|cookie:\\s*\\S+|set-cookie"`.

       A real leak is fixed at its source before retention is relied on.
3. **Metrics (P9-04).**
   - **The portfolio chart** (production: on):
     - `api.metrics.scrape.enabled` binds the API's metrics to `0.0.0.0` and opens the pod IP's
       9464 to Prometheus alone. The API rolls once.
     - `monitoring.readers.metrics` gives Prometheus pod discovery (`list`/`watch` on pods) and
       kube-state-metrics `list`/`watch` on the kinds it reports, both in `portfolio`.
     - `pnpm helm:check` compares both Roles exactly.
   - **Prometheus and kube-state-metrics** (applied 2026-11-26), after that sync:
     `kubectl apply -f infrastructure/argocd/monitoring/kube-state-metrics.yaml -f infrastructure/argocd/monitoring/prometheus.yaml`.
   - **Validate:**
     - Every target is up: `kubectl -n monitoring port-forward svc/prometheus-server 9090:80`,
       then `up` on `/api/v1/query` shows `portfolio-api` (one per API pod), `kube-state-metrics`,
       `loki`, `alloy`, and `prometheus` at 1.
     - kube-state-metrics sees only its two namespaces: `count by (namespace) (kube_pod_info)`
       shows `portfolio` and `monitoring`.
     - `/metrics` on the public API host returns 404.
     - A pod in another namespace, and cloudflared in `portfolio`, can't connect to an API pod's
       IP on 9464.
     - The new accounts can't read Secrets:

       ```bash
       kubectl auth can-i list pods -n portfolio --as=system:serviceaccount:monitoring:prometheus-server              # yes
       kubectl auth can-i get secrets -n portfolio --as=system:serviceaccount:monitoring:prometheus-server            # no
       kubectl auth can-i list deployments -n portfolio --as=system:serviceaccount:monitoring:kube-state-metrics      # yes
       kubectl auth can-i get secrets -n portfolio --as=system:serviceaccount:monitoring:kube-state-metrics           # no
       kubectl auth can-i list pods -n kube-system --as=system:serviceaccount:monitoring:kube-state-metrics           # no
       ```
4. **Grafana (P9-05, applied 2026-11-26).**
   - **In Git:** the `grafana-admin` SealedSecret (in
     `environments/production/monitoring/secrets/`, synced by the `monitoring` Application) and
     the dashboards ConfigMap (the `monitoring` chart).
   - **Apply:** re-apply the `monitoring` Application, which gained the secrets source
     (Applications aren't synced from Git), then Grafana once the Secret and ConfigMap exist:
     `kubectl apply -f infrastructure/argocd/monitoring/monitoring.yaml`, then
     `kubectl apply -f infrastructure/argocd/monitoring/grafana.yaml`.
   - **Publish on the tailnet** (owner, `sudo`). Like Argo CD, it uses the Service's ClusterIP;
     re-run this if the Service is ever recreated:

     ```bash
     ip=$(kubectl -n monitoring get svc grafana -o jsonpath='{.spec.clusterIP}')
     sudo tailscale serve --bg --https=8444 "http://$ip:80"
     ```

     Remove it with `sudo tailscale serve --https=8444 off`.

   - **Log in** as `admin`; the password is in the Secret:
     `kubectl -n monitoring get secret grafana-admin -o jsonpath='{.data.admin-password}' | base64 -d`.
   - **Validate:**
     - The page loads on the tailnet at `https://<tailnet-hostname>:8444`, and nowhere else.
     - An anonymous `/api/search` answers 401.
     - The four dashboards are in the Portfolio folder, and a save is refused.
     - A `requestId` in a log line opens the Logs dashboard filtered to that request.

5. **Alerts (P9-06, applied 2026-11-26).**
   - **Rules** in `infrastructure/helm/monitoring/alerts/` reach Grafana through the `monitoring`
     chart's `grafana-alert-rules-<hash>` ConfigMap.
   - **Contact point:** the `grafana-alerting-<n>` SealedSecret holds the contact point and the
     notification policy, sealed by the owner from a local file outside the repository (the
     private register says how). Grafana's HTTPS egress (`alertEgress`) is on in production.
   - **Restart on change:** Grafana reads both at startup, so their names follow their content.
     - **After changing a rule:** put the new `grafana-alert-rules-<hash>` in Grafana's values
       (`pnpm helm:check` prints it).
     - **After re-sealing the contact point:** seal it as `grafana-alerting-<n+1>` and name it in
       the values. Delete the old sealed file in a later commit, once Grafana runs with the new
       one and its contact point shows in Grafana.
     - **Effect:** Argo CD restarts Grafana, and a Grafana pod that syncs before the new rules
       ConfigMap exists waits for it. The Secret is optional: if Grafana starts first, it runs
       without a contact point until `kubectl -n monitoring rollout restart deploy/grafana`.
     - **Cleanup:** old `grafana-alert-rules-<hash>` ConfigMaps aren't pruned. Delete them by
       hand once no pod mounts them.
   - **Validate:**
     - Grafana lists the nine rules in "Portfolio alerts".
     - A test notification reaches the owner. Grafana 13 serves this as
       `POST /apis/notifications.alerting.grafana.app/v1beta1/namespaces/default/receivers/<uid>/test`,
       with the receiver's integration as `{"integration": …}`. The receiver's uid is listed
       under `…/receivers`; the old `/api/alertmanager/…/receivers/test` answers 410.
     - Each rule has fired and resolved once in a drill, without an outage:
       - **Real triggers** for three rules: a throwaway pod in `portfolio` logging JSON error
         lines, a Job named `portfolio-postgres-backup-<x>` that exits 1, and a pod in
         `monitoring` that crashes.
       - **The rest:** copies with a flipped threshold, created through
         `/api/v1/provisioning/alert-rules` (header `X-Disable-Provenance: true`) in a temporary
         folder, flipped back once they fired, then deleted.
       - **Timing:** resolved messages follow at each group's next 5-minute interval. Error logs
         clears 10 minutes after the last line, and Crash loop up to 15 minutes after the pod
         is gone.
       - **Counting:** `grafana_alerting_notifications_total` on Grafana's `/metrics` counts the
         sends; a failed send shows in `grafana_alerting_notifications_failed_total`.

**Rollback:**

- `kubectl -n argocd delete application <name>` stops management and leaves the workloads (no
  resources finalizer). `kubectl delete namespace monitoring` then removes everything, including
  the logs and metrics volumes and Grafana's volume (protected from Argo CD pruning and Helm uninstall, but not from deleting the
  namespace).
- Grafana's tailnet address: `sudo tailscale serve --https=8444 off`.
- Turning `monitoring.readers.logs.enabled` or `.metrics.enabled` off removes those portfolio
  Roles on the next sync. Turning `api.metrics.scrape.enabled` off puts the metrics back on
  loopback and removes their NetworkPolicy rule (the API rolls once).
- Nothing in `portfolio` depends on monitoring.

### Infrastructure Explorer reader (P6-01, approval required)

`api.infrastructure.enabled` (production: on) gives the API its own ServiceAccount with a
namespaced, read-only Role (get/list on deployments, statefulsets, pods), mounts its token (the
reader trusts the mounted cluster CA for its own requests only), sets
`INFRASTRUCTURE_SOURCE=kubernetes`, and allows the API's egress to the API server
(`apiServerEgress`: the node's private range on `6443`). The account, Role, and binding are pruned
last, so a rollback moves the API off them before they go.

- **Order matters.** The `portfolio` AppProject must allow ServiceAccount, Role, and RoleBinding
  before Argo CD syncs the chart, or the whole sync is rejected. Apply the project first:
  `kubectl diff -f infrastructure/argocd/project.yaml`, then
  `kubectl apply -f infrastructure/argocd/project.yaml` (it only adds those three kinds). Then
  merge; Argo CD creates the account, Role, and binding before the API (sync wave 2) rolls out.
- **Impact:** one rolling restart of the API (new account, token, and environment); with
  `maxUnavailable: 0` the old pod serves until the new one is ready. Nothing else changes. The
  reader that trusts the cluster CA per request ships in the API image built from the same merge,
  which the release pins a few minutes later; until then the previous image reads with the feature
  on and logs `Infrastructure snapshot refresh failed` (TLS can't be verified). No page reads the
  endpoint yet, so this is harmless; validate after the pin has synced.
- **Validate:**
  - `kubectl auth can-i list pods -n portfolio --as=system:serviceaccount:portfolio:portfolio-api`
    → yes; the same for `get secrets`, `get pods --subresource=log`,
    `create pods --subresource=exec`, and `list pods -n kube-system` → no.
  - Inside the API pod, `GET /api/v1/infrastructure` returns `200` with the tunnel, API, worker,
    PostgreSQL, and Redis known and no address, node name, or secret in the body; the API logs
    show no `Infrastructure snapshot refresh failed` warnings.
- **Rollback:** set `api.infrastructure.enabled: false` in the production values (or revert the
  commit) and merge; Argo CD restarts the API without the token and removes the account, Role,
  and binding (the endpoint answers `infrastructure_disabled` again). The extra project kinds can
  stay; to remove them, revert `project.yaml` and apply it after the chart no longer renders them.

### Argo CD Explorer token (P6-03)

**Confirmed:** the token is provisioned and the adapter was checked against live Argo CD on
2026-11-18. Production API activation awaits merging the integration and its image
rollout. `api.infrastructure.argocd.enabled` mounts `portfolio-argocd-reader` into the API only
and permits API egress to Argo CD server pods in the `argocd` namespace on TCP 8080 (the Service's
443 is translated to that pod port). No public Argo CD route or extra Kubernetes RBAC is added.

- **Permission:** the `explorer` role in `infrastructure/argocd/project.yaml` grants exactly
  `p, proj:portfolio:explorer, applications, get, portfolio/portfolio, allow`. Argo CD also grants
  its project-role tokens read access to their own project's metadata. Live `can-i` probes
  allowed those reads and denied sync/update/delete/override/restart, logs, exec, repositories,
  clusters, and other Applications/projects. Listing Applications returned only `portfolio`.
- **Provisioning order:** apply the reviewed AppProject first, issue the role token, seal its
  `token` and Argo CD server `ca.crt` into `portfolio-argocd-reader` in the `portfolio` namespace,
  and wait for the controller to create that Secret. Only then merge the production settings.
  Use the existing Argo CD administrator session or the matching CLI's `--core` mode with an
  authorized Kubernetes context whose namespace is `argocd`; no password reset or broader
  permissions for Argo CD's own ServiceAccount are needed. The installed server image includes
  that matching CLI; it can be copied temporarily to the operator's machine for core mode.
  `argocd --core proj role create-token portfolio explorer --expires-in 2160h --token-only`
  issues a 90-day token: capture stdout privately, never print it or pass it in shell arguments.
  See [Sealed Secrets](#3-secrets) for sealing; the repository holds ciphertext only.
- **Configuration:** `api.infrastructure.argocd` supplies `serverUrl`, `application`, `project`,
  `existingSecret`, `tokenKey`, `caKey`, plus the target namespace, pod labels, and port. The
  deployment maps these to `ARGOCD_*` settings described in [local.md](local.md). The token and
  certificate are mounted read-only with mode `0440` and the pod's group; files are reread on
  each refresh, so rotation requires no restart. Trust is local to this reader; redirects are
  rejected and no response body or credential is logged.
- **Validate after release:** wait for Argo CD to sync the new image pin, then read
  `GET /api/v1/infrastructure` from inside the API pod. Expect `200`, `Cache-Control: no-store`,
  `sync: synced`, a seven-character deployed GitOps revision, and deployment time. This revision
  is distinct from the API's build/source commit; the existing `release.pinnedAt` field carries
  deployment time. Check API logs for `Deployment status refresh failed` warnings and repeat the
  read-only permission probes. During the merge-to-image-pin window, the previous image ignores
  the new settings and continues serving workload data with unknown deployment facts.
- **Availability:** Argo CD failure clears sync/release and its reachability health to unknown;
  fresh workload data still returns `200`. The optional source does not affect readiness. A
  successful read marks the Argo CD component reachable, not the Application aggregate healthy.
- **Reminder:** the API checks the token on startup and every hour, whether or not anyone opens
  the explorer. From 14 days before its expiry (its JWT `exp` claim) it logs a warning once a day
  (`Argo CD explorer token expires soon; rotate it`, with the expiry date and days left, never
  the token), and an error once the token has expired. A Redis key per token expiry, level, and
  UTC day keeps it to one line a day across replicas and restarts; a rotated token or the move
  to expired logs at once, and if Redis is down it logs anyway. Roadmap task P6-05 tracks the
  rotation.
- **Outside the cluster too:** the reference deployment's operator also gets a chat-bot
  reminder, and outage alerts, from a separate watcher in their homelab. It reads only the
  public `GET /api/v1/infrastructure` snapshot (no credentials, no inbound port), and the
  token's expiry date is set in its own configuration. Update that date after each rotation.
- **Rotate before 2027-02-16:** issue a second 90-day token, seal it (and the current server CA)
  into the same Secret, publish/apply the SealedSecret, and validate after the 12 s cache expires.
  Revoke the previous token only after that succeeds; retain its ID/issued-at outside Git until
  revocation. Do not keep the same token past expiry. Argo CD supports revocation with
  `argocd proj role delete-token portfolio explorer <token-id-or-issued-at>`. Last, set the new
  expiry date in any external reminder (such as the watcher above), or it keeps reminding and,
  after the old date, reports the token as expired.
- **Rollback:** disable `api.infrastructure.argocd.enabled` through GitOps and wait for the API
  rollout, then revoke the token and remove its SealedSecret. Remove the now-unused `explorer`
  role last. The workload reader remains enabled. If access must be revoked immediately, revoke
  first: only deployment facts become unknown until the rollback rolls out.

Argo CD references: [project roles and expiring tokens](https://argo-cd.readthedocs.io/en/stable/user-guide/projects/#project-roles),
[Application API project scope](https://argo-cd.readthedocs.io/en/stable/developer-guide/api-docs/#applications-api).

## 5. Release Flow

1. Merge to `main`. CI passes.
2. The release workflow (`.github/workflows/release.yml`) starts only after CI succeeds on a push
   to `main`. It builds the api and worker images, pushes them to GHCR tagged with the commit SHA,
   and commits their digests to `infrastructure/environments/production/images.yaml`, each with
   the source commit it was built from (`image.revision`, quoted). The chart puts that commit in
   the API and worker workloads' `app.kubernetes.io/version` label, and the Infrastructure
   Explorer shows it short as their version (P6-04). People
   edit `values.yaml` next to it, which pins PostgreSQL and Redis by digest. The workflow refuses
   to replace a newer pin with an older build, and its commits don't trigger CI, so it can't
   loop. Its token permissions are set per job (`packages: write` to push, `contents: write` to
   commit), so the repository's default read-only setting stays as is. New GHCR packages start
   private: make `portfolio-api` and `portfolio-worker` public once, after the first release, so
   the cluster can pull them without a pull secret.

   It first checks whether anything since the last release (the `# source-commit:` in
   `images.yaml`) can change an image (P7-10, `.github/scripts/needs-release.sh`). When every
   change is docs, Markdown, `.agents/` or `.claude/`, the static site (`apps/web/`, which
   Cloudflare Pages builds), or `infrastructure/load-tests/`, it builds and pins nothing, so no
   pod restarts; those changes ride along with the next release that does build. Anything else,
   or any doubt (no pin, a pin that isn't an ancestor, or a failing diff), releases; a file moved
   out of an image counts on both sides. The last release is the newer of the pins in the merge's
   own tree and on `main` as it is now, so a release that finished while this merge waited
   counts. The Infrastructure Explorer's version stays at the last released commit. To roll back,
   revert the code change, not the release commit ([runbooks](../operations/runbooks.md#rollback)).

3. Argo CD syncs. The rolling update uses `maxUnavailable: 0`, and readiness gates traffic.
4. Run migrations as a pre-sync Job, only for backward-compatible migrations (see runbooks).

## 6. Public Exposure (P4-03)

A **dedicated, remotely managed** tunnel (`portfolio-api`) serves only the API; the reference
host's other tunnel is untouched. With `cf`:

1. `cf tunnels create --body '{"name":"portfolio-api","config_src":"cloudflare"}'`
2. Ingress rules (`cf tunnels config update <id> --body …`), in order:
   - `hostname: api.<domain>`, `path: ^/api/v1/` → `http://portfolio-api.portfolio.svc.cluster.local:3001`
   - catch-all → `http_status:404`

   So the tunnel can reach nothing but the API Service, and only for `/api/v1/*`.

3. `cf tunnels token get <id>` into the `portfolio-tunnel` Secret (section 3), without printing it.
4. Chart: `cloudflared.enabled: true` (image pinned by digest). The Deployment has no Service and
   no ingress; its NetworkPolicy allows egress only to the API and to public addresses on 7844
   (tunnel, TCP/UDP) and 443. Private, tailnet, link-local, and loopback ranges are excluded.
5. Once the tunnel reports **healthy**, add a proxied DNS `CNAME api.<domain> → <id>.cfargotunnel.com`.

The API's NetworkPolicy admits only `cloudflared`, so every request carries Cloudflare's
`CF-Connecting-IP`; production sets `api.trustCloudflareClientIp: true` for chat quotas. The chart
refuses that setting unless `cloudflared.enabled` and `networkPolicy.enabled` are both true.
`CORS_ORIGINS` comes from the `portfolio-api-public` ConfigMap (`api.envConfigMap`).

**Verify:** `https://api.<domain>/api/v1/health` returns 200; `/`, `/metrics`, and any non-API path
on that host return 404; no public hostname reaches Argo CD.

**Rollback:** delete the DNS record (the API is offline at once), then set
`cloudflared.enabled: false`, or delete the tunnel.

## Rollback

See [runbooks](../operations/runbooks.md#rollback).
