# Observability: Logs, Metrics, and Alerts (Phase 9)

**Status: Proposed.** The plan for [ADR 0004](adr-0004-observability-stack.md). Each section
becomes **Confirmed** when the Phase 9 task that builds it is done
([roadmap](../implementation-roadmap.md#phase-9-observability-19)).

**Confirmed today:** JSON logs with request ids (P2-04), the API's Prometheus metrics on a loopback
port (P7-01), and the K3s API audit log on the host (P7-06). The audit log stays root-only on the
host and is not shipped to Loki.

## Shape

```text
                          ┌──────────────── namespace: monitoring ─────────────────┐
 portfolio pods ──logs──▶ │ Alloy ──push──▶ Loki ◀──query──┐                       │
  (via the K8s API)       │                                 ├── Grafana ◀── tailnet │
 API pod :9464 ──scrape─▶ │ Prometheus ◀──scrape── KSM      │   (dashboards,        │
                          │      ▲─────────────query────────┘    alerts) ──▶ owner  │
                          └────────────────────────────────────────────────────────┘
```

- **Namespace:** `monitoring`, default-deny NetworkPolicies like `portfolio`.
- **Argo CD:** a new `monitoring` AppProject. Its sources are this repository and the upstream
  chart repositories, listed one by one. Its only destination is the `monitoring` namespace,
  and it allows no cluster-scoped kinds. There is one Application per upstream chart, each with
  its chart version and image digest pinned and its values in
  `infrastructure/monitoring/<component>/values.yaml`, plus one Application for this
  repository's own manifests (NetworkPolicies, provisioning ConfigMaps, and SealedSecrets).
- **Charts:** Grafana, Loki, and Alloy from Grafana's chart repositories (Loki's moved to
  `grafana-community` in 2026); Prometheus and kube-state-metrics from `prometheus-community`.
  P9-02 confirms each chart's current home and pins it.

## Logs

- **Collection:** one Alloy Deployment (not a DaemonSet) with `discovery.kubernetes` and
  `loki.source.kubernetes`. It reads logs through the API server, so it needs no root, no
  privileged container, and no host paths. On one node, the extra load on the API server and
  kubelet is negligible (about 8,000 lines a day).
- **Scope:** pods in `portfolio` and `monitoring`. `kube-system` and `argocd` are left out for
  now.
- **Labels (low cardinality):** `namespace`, `app` (component), `container`, `pod`. JSON fields
  such as `level`, `context`, and `message.requestId` are parsed at query time with `| json`,
  never turned into labels.
- **Storage:** Loki in monolithic (single binary) mode with filesystem storage, on a `local-path`
  volume from a `volumeClaimTemplate`, so no Argo CD prune can delete it. **Retention: 30 days**,
  matching the audit log, enforced by the compactor; the volume is 5 GiB against about 55 MB
  of raw logs a month. `local-path` doesn't enforce sizes, so retention is the real limit.
- **Privacy:** the logging rules already forbid request bodies, chat messages, tokens, cookies,
  and personal data. P9-03 checks a day of collected logs for client IPs, cookies, and tokens
  before retention is relied on. Loki is reachable only from Grafana and Alloy.

## Metrics

- **Scrape path:** the chart gains `api.metrics.scrape.enabled`. When it is on, the API sets
  `API_METRICS_HOST` to the pod's IP (Downward API `status.podIP`; no code change, since the
  setting is already a host string), and a NetworkPolicy allows ingress on 9464 only from pods
  labelled as Prometheus in the `monitoring` namespace. The port stays out of the Service, the
  tunnel, and cloudflared's policy. When it is off, it stays on loopback as in P7-01.
  `check-chart.sh` accepts exactly these two renders and still fails any other host, any
  Service port, or any wider rule.
- **Discovery:** Prometheus uses Kubernetes pod discovery in `portfolio`, keeping only API pods
  on the metrics port. Each replica is scraped on its own, so the HPA's 1–3 pods add up
  correctly with `sum()`.
- **kube-state-metrics:** limited to `portfolio` and `monitoring`. It covers restarts,
  `OOMKilled`, failed Jobs (the nightly backup), and Deployment replicas. The kubelet's cAdvisor
  metrics are left out: reading them needs `nodes/proxy`, which also allows `exec`.
- **Storage:** Prometheus server only (no Alertmanager, Pushgateway, or node-exporter), with
  `--storage.tsdb.retention.time=30d` and `retention.size=4GB` on a 5 GiB volume. That's
  roughly 300 series at a 30 s interval.

## Least privilege

- **No ClusterRoles.** The portfolio chart gains `monitoring.readers` (off by default). It
  renders one Role in `portfolio` (`get`/`list`/`watch` on pods, and `get` on `pods/log`) bound
  to the Alloy and Prometheus ServiceAccounts, and one Role for kube-state-metrics (`list`/`watch`
  on the kinds it reports). The upstream charts render no RBAC of their own in `portfolio`, so
  the `portfolio` AppProject still owns everything in its namespace. The `monitoring` chart
  grants the same reads in its own namespace.
- **Unchanged:** the API's Infrastructure Explorer account still can't read logs
  (P6-01's `can-i` checks).
- **Audit log:** the P7-06 policy drops `get` on `pods/log` as routine reads, so Alloy adds
  nothing to it.
- **Containers:** non-root, read-only root filesystem where the image allows, `cap_drop: [ALL]`,
  no service account token mounted where none is needed (Loki, Grafana), and resource requests
  and limits on every container.
- **NetworkPolicies in `monitoring`:**

  | Pod                | Ingress from                             | Egress to                                                             |
  | ------------------ | ---------------------------------------- | --------------------------------------------------------------------- |
  | Alloy              | none                                     | API server (6443), Loki (3100), DNS                                   |
  | Loki               | Alloy, Grafana                           | DNS                                                                   |
  | Prometheus         | Grafana                                  | API pods (9464), kube-state-metrics, API server (6443), DNS           |
  | kube-state-metrics | Prometheus                               | API server (6443), DNS                                                |
  | Grafana            | the node's private range (tailnet proxy) | Loki, Prometheus, DNS, HTTPS 443 outside private ranges (alerts only) |

## Grafana

- **Access:** a ClusterIP Service only, published on the tailnet with `tailscale serve`, the same
  way as Argo CD (a separate HTTPS port). There is no Ingress, tunnel, or public hostname.
  Anonymous access and sign-up are off, and the admin password comes from a SealedSecret.
- **No phoning home:** usage reporting, update checks, and plugin update checks are off, and no
  plugins are installed at runtime.
- **As code:** data sources, dashboards (`infrastructure/monitoring/dashboards/*.json`), and alert
  rules are provisioned from ConfigMaps with UI edits disabled. A change made in the UI is
  exported and committed.
- **Dashboards:** an API overview (requests, p95 by route, 5xx and errors by code, client
  disconnects, readiness per dependency), chat and AI (inference time by outcome, queue waiting and
  wait time, capacity rejections, screening refusals), workloads (restarts, OOM kills, replicas
  against the HPA, backup Job results), and logs (errors and warnings by component, plus a
  request-id lookup).

## Alerts

Grafana-managed rules, evaluated every minute. Thresholds are starting points that P9-06 tunes
against real traffic.

| Alert                  | Source     | Condition (starting point)                                                                     |
| ---------------------- | ---------- | ---------------------------------------------------------------------------------------------- |
| API down               | Prometheus | no API scrape target `up` for 5 min                                                            |
| Dependency down        | Prometheus | `readiness_dependency_up == 0` for 3 min                                                       |
| Server errors          | Prometheus | 5xx above 5% of requests over 10 min, with at least 20 requests                                |
| Slow API               | Prometheus | p95 of `http_request_duration_seconds` above 1 s for 15 min (P7-02 measured 2.8 ms at 200 rps) |
| Crash loop / OOM       | KSM        | more than 3 restarts in 15 min, or last termination `OOMKilled`                                |
| Backup failed          | KSM        | the PostgreSQL backup Job failed, or no successful run in 26 h                                 |
| Error logs             | Loki       | more than 5 `error`/`fatal` lines from one component in 10 min                                 |
| Argo CD token expiring | Loki       | the P6-05 reminder's warning or error line appears (once a day)                                |
| Monitoring broken      | Prometheus | Loki or Alloy not ingesting for 15 min, or Prometheus volume above 80%                         |

- **Contact point:** the owner's choice (see the roadmap's "Waiting on the owner"). Its whole
  definition, including its type, destination, and any token, comes from a SealedSecret mounted
  as a provisioning file, so nothing about it is in Git. Forks get no contact point, and alerts
  show in Grafana only.
- **Known gap:** if the node is down, nothing here can alert. An external uptime check is a
  separate decision.

## Local development

Rule 5 asks for every feature to run locally. An opt-in `compose.observability.yaml` adds the same
Grafana, Loki, Prometheus, and Alloy images with the same provisioned dashboards and rules:

- Prometheus scrapes the API's metrics port on the Compose network.
- Alloy reads container logs through `loki.source.docker`. Mounting the Docker socket is
  root-equivalent even read-only, so it is opt-in, bound to `127.0.0.1`, documented, and meant
  for contributors' own machines, never a shared host.
- `pnpm check` validates the dashboards and rules, so a broken JSON or rule fails CI for everyone.

## Capacity

Expected requests (to be confirmed under load in P9-07): Loki 256Mi, Prometheus 256Mi, Grafana
192Mi, Alloy 128Mi, and kube-state-metrics 64Mi. That's under 1 GiB requested, with limits of
about 1.5 GiB, on a node with roughly 24 GiB available. Disk: two 5 GiB `local-path` volumes.
