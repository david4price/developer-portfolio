# Networking

## Paths

| Path           | Route                                                                                                             | Status                                                      |
| -------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Public site    | Browser → Cloudflare edge → Cloudflare Pages (static export)                                                      | Proposed                                                    |
| Public API     | Browser → Cloudflare edge (`api.example.com`) → Cloudflare Tunnel → `cloudflared` pod → API `Service` (ClusterIP) | Proposed                                                    |
| Administration | Operator → Tailscale → host SSH / `kubectl` / Argo CD                                                             | Proposed (Tailscale itself confirmed on the reference host) |
| CI/CD          | GitHub Actions → GHCR; Argo CD on the host polls GitHub outbound                                                  | Proposed                                                    |
| Inference      | AI adapter → host bridge address → GPU runtime (OpenAI-compatible HTTP)                                           | Proposed, route requires validation                         |

Nothing in the design needs an inbound port on the home router.

## Cloudflare Tunnel

- **Proposed:** run a dedicated tunnel for the portfolio as a `cloudflared` Deployment inside the
  cluster. Its ingress maps only `api.example.com` to the API Service, and every other hostname
  returns 404.
- The reference host already runs a separate, remotely managed tunnel for other purposes. The
  portfolio does not modify it. Using a second tunnel keeps credentials, routes, and failure modes
  independent.
- Argo CD, the Kubernetes API, metrics endpoints, and internal services are never added to the
  tunnel.

## Ingress and Host Ports

- **Confirmed (reference host):** an existing reverse proxy already binds host port 80.
- **Proposed:** install K3s with `--disable traefik --disable servicelb`, so K3s never claims host
  ports 80/443.
- Because public traffic arrives through the in-cluster `cloudflared`, the API needs only a
  ClusterIP Service at first. An ingress controller is added only if several public routes need
  host- or path-based routing. If one is added, it must not bind host ports.
- The Kubernetes API (6443) is reachable only from localhost and the tailnet.

## Address Plan

| Range                              | Owner                  | Status                                                                         |
| ---------------------------------- | ---------------------- | ------------------------------------------------------------------------------ |
| `10.42.0.0/16`                     | K3s pods (default)     | Proposed; no conflict with existing Docker or LAN ranges on the reference host |
| `10.43.0.0/16`                     | K3s services (default) | Proposed; same check                                                           |
| Docker bridge ranges, LAN, tailnet | Existing               | Confirmed non-overlapping (details in the private register)                    |

## Reaching Services Outside the Cluster

| Dependency            | Approach                                                                                                                                                                        | Status                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| GPU inference runtime | Reach the runtime's port on the host's Docker bridge address from the AI adapter pod. Restrict it with a NetworkPolicy egress allowlist (K3s ships a NetworkPolicy controller). | Proposed. Validate pod → host-bridge routing and host firewall interaction first |
| PostgreSQL            | Portfolio-owned instance inside the cluster (StatefulSet + PVC), reached by Service DNS                                                                                         | Proposed                                                                         |
| Redis                 | Portfolio-owned instance inside the cluster                                                                                                                                     | Proposed                                                                         |

Namespaces do not isolate network traffic on their own. The `portfolio` namespace gets a
default-deny NetworkPolicy and explicit allow rules:

- `cloudflared` → `api` (**Confirmed** in the chart; `cloudflared` itself arrives in Phase 4)
- `api` → `postgres`, `redis` (**Confirmed** in the chart)
- `worker` → `redis` (**Confirmed**; the worker has no database access today)
- `migrate` Job → `postgres` (**Confirmed**)
- all pods → kube-dns (**Confirmed**)
- `api` (AI adapter) → inference endpoint (rule **Confirmed** in the chart: rendered from
  `api.ai.egress` when AI is enabled, and rendering fails without it; connecting the reference
  runtime is Proposed, P5-06)
- `api` → Kubernetes API, for the Infrastructure Explorer's read-only ServiceAccount (Proposed,
  P6-01)

"Confirmed" here means rendered by `infrastructure/helm/portfolio/templates/networkpolicies.yaml`;
enforcement on the reference cluster is verified after the K3s install (P3-03), including that
kubelet health probes still reach the pods.

## Host Firewall

**Confirmed (reviewed 2026-11-13):** the reference host has no firewall rules that K3s's flannel
or pod/service CIDRs would conflict with, so K3s needs no allow rules. Without a filter, though,
the K3s API (`6443/tcp`), kubelet (`10250/tcp`), and VXLAN (`8472/udp`) ports would be reachable
from the LAN.

**Proposed:** a dedicated nftables table, loaded before K3s, accepts those three ports only from
loopback, the tailnet, and pods (`cni0`), and leaves every other port and existing rule alone. The
rules, systemd unit, validation, and rollback are in the
[deployment guide](../deployment/kubernetes.md#k3s-port-guard-allow-list). Docker, Tailscale, and
K3s all write their own rules, so test the existing services after applying it.

## Failure Behavior

| Failure                        | Expected behavior                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------ |
| Home server offline            | Site stays up; API-backed widgets show "unavailable"                                             |
| Tunnel down                    | Same as above; Cloudflare returns an error and the frontend handles it                           |
| Inference runtime down or busy | Chat returns a typed `ai_unavailable` / `ai_overloaded` error; the rest of the API is unaffected |
| Tailscale down                 | Public site and API unaffected; administration unavailable                                       |
