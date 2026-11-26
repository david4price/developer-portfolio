# Observability: Logs, Metrics, and Alerts (Phase 9)

**Status: Proposed.** The plan for [ADR 0004](adr-0004-observability-stack.md). Each section
becomes **Confirmed** when the Phase 9 task that builds it is done
([roadmap](../implementation-roadmap.md#phase-9-observability-19)).

**Confirmed today:** JSON logs with request ids (P2-04), the API's Prometheus metrics on a loopback
port (P7-01), and the K3s API audit log on the host (P7-06). The audit log stays root-only on the
host and is not shipped to Loki. **In Git, not applied (P9-02):** the manifests described under
[Layout](#layout), checked by `pnpm helm:check`.

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
  and it allows no cluster-scoped kinds. There is one Application per upstream chart, plus one
  for this repository's own manifests (NetworkPolicies and Roles now; SealedSecrets and
  provisioning ConfigMaps in P9-05 and P9-06).

## Layout

In Git since P9-02, applied by hand from P9-03 (🔒), like the other Argo CD files:

| Path                                                            | Holds                                                                                                         |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `infrastructure/argocd/monitoring-project.yaml`                 | The `monitoring` AppProject.                                                                                  |
| `infrastructure/argocd/monitoring/<name>.yaml`                  | One Application per release: chart, exact version, and the archive's sha256 (annotation).                     |
| `infrastructure/environments/production/monitoring/<name>.yaml` | Each release's values, image digests included (multi-source `$values` from `main`).                           |
| `infrastructure/helm/monitoring/`                               | This repository's chart: default-deny and per-pod NetworkPolicies, and the collectors' Roles in `monitoring`. |
| `infrastructure/monitoring/check-monitoring.sh`                 | The CI check, run by `pnpm helm:check`.                                                                       |

**Pinned (Confirmed, 2026-11-25).** These are the newest stable releases that were at least a week
old, in the spirit of pnpm's minimum release age:

| Release            | Chart repository                             | Chart version | App version             |
| ------------------ | -------------------------------------------- | ------------- | ----------------------- |
| loki               | `grafana-community.github.io/helm-charts`    | 21.4.1        | Loki 3.7.10             |
| alloy              | `grafana.github.io/helm-charts`              | 1.16.0        | Alloy v1.22.0           |
| prometheus         | `prometheus-community.github.io/helm-charts` | 29.47.2       | Prometheus v3.16.0      |
| kube-state-metrics | `prometheus-community.github.io/helm-charts` | 9.0.1         | kube-state-metrics 2.20 |
| grafana            | `grafana-community.github.io/helm-charts`    | 14.5.0        | Grafana 13.3.1          |

Loki's and Grafana's charts now live in `grafana-community`. The `grafana` repository's
Grafana chart is deprecated, and its Loki chart serves Grafana Enterprise Logs. Every image
is pinned by its multi-arch index digest. Grafana uses its `-distroless` image.

**What the check enforces** (`pnpm helm:check`, CI's Helm job):

- **Applications:** each stays in the project, with every source listed there, one destination,
  an exact chart version, and values from this directory.
- **Charts:** each chart archive's sha256 matches the one recorded on its Application. Argo CD
  itself doesn't verify it, so CI catches a republished version.
- **Every render:**
  - passes kubeconform (this repository's chart also passes `helm lint --strict`);
  - uses only the kinds the project allows (so no ClusterRole, Ingress, or Secret);
  - stays in the namespace, with no NodePort or LoadBalancer;
  - has no host namespaces, host paths, or privileged containers;
  - pins every image by digest and gives every container resource requests.
- **This repository's chart:** it refuses to render without the API server range, and Grafana
  gets no ingress or internet until P9-05 and P9-06 set them.
- **Selectors:** the pod labels, ports, and ServiceAccounts the policies and Roles name in
  `infrastructure/helm/monitoring/values.yaml` must match what the upstream charts (and the
  portfolio chart's API pods) actually render. A chart upgrade that renames one fails CI, so a
  policy can't silently match nothing.

A render that fails or comes out empty is a failure, never a pass. A failing step is counted and
the check carries on, so one run reports every problem. Each guardrail was checked by breaking it
on purpose.

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
- **Storage:** Loki in monolithic (single binary) mode with filesystem storage (TSDB, schema
  v13), on a `local-path` volume from a `volumeClaimTemplate`, so no Argo CD prune can delete it. **Retention: 30 days**,
  matching the audit log, enforced by the compactor; the volume is 5 GiB against about 55 MB
  of raw logs a month. `local-path` doesn't enforce sizes, so retention is the real limit.
- **Privacy:** the logging rules already forbid request bodies, chat messages, tokens, cookies,
  and personal data. P9-03 checks a day of collected logs for client IPs, cookies, and tokens
  before retention is relied on. Loki is reachable only from Alloy, Grafana, Prometheus
  (which reads Loki's own metrics), and other Loki pods (itself, through its Services).

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
- **Config reloads:** the chart's config reloader sidecar runs beside Prometheus and calls its
  reload endpoint over localhost when the ConfigMap changes. The chart doesn't restart the pod
  on config changes, so without the sidecar a synced scrape config would never apply.

## Least privilege

- **No ClusterRoles.** The portfolio chart gains `monitoring.readers` (off by default, P9-03 and
  P9-04). It renders a log reader Role in `portfolio` (`get`/`list`/`watch` on pods, `get` on
  `pods/log`) for Alloy, pod discovery (`list`/`watch` on pods) for Prometheus, and a state
  reader (`list`/`watch` on the kinds it reports) for kube-state-metrics. The upstream charts
  render no RBAC, so the `portfolio` AppProject still owns everything in its namespace.
- **In `monitoring` (Confirmed in Git, P9-02):** the monitoring chart grants Alloy the log reader
  and kube-state-metrics the state reader there. Prometheus needs no Role in `monitoring`: it
  scrapes Loki, Alloy, and kube-state-metrics through their Services.
- **Charts' own RBAC turned off:** Loki's chart, by default, gives Loki a ClusterRole that reads
  every ConfigMap and Secret in the cluster, for a rules sidecar this stack doesn't use. Its values
  turn both off. The Alloy, Prometheus, kube-state-metrics, and Grafana charts have
  `rbac.create: false`.
- **Unchanged:** the API's Infrastructure Explorer account still can't read logs
  (P6-01's `can-i` checks).
- **Audit log:** the P7-06 policy drops `get` on `pods/log` as routine reads, so Alloy adds
  nothing to it.
- **Containers:** non-root, read-only root filesystem, `cap_drop: [ALL]`, no service account
  token where none is needed (Loki, Grafana), and resource requests and memory limits on every
  container. Alloy runs as `nobody` with an `emptyDir` for its positions file. Grafana's
  root `chown` init container is off.
- **NetworkPolicies in `monitoring`:**

  | Pod                | Ingress from                        | Egress to                                                             |
  | ------------------ | ----------------------------------- | --------------------------------------------------------------------- |
  | Alloy              | Prometheus (12345, its metrics)     | API server (6443), Loki (3100), DNS                                   |
  | Loki               | Alloy, Grafana, Prometheus; Loki    | Loki (3100, gRPC 9095, memberlist 7946), DNS                          |
  | Prometheus         | Grafana                             | API pods (9464), kube-state-metrics, Loki, Alloy, API server, DNS     |
  | kube-state-metrics | Prometheus                          | API server (6443), DNS                                                |
  | Grafana            | the tailnet proxy's address (P9-05) | Loki, Prometheus, DNS, HTTPS 443 outside private ranges (alerts only) |

  Even as a single replica, Loki calls itself through its own Services: the compactor over gRPC
  (`common.compactor_grpc_address`) and the memberlist ring. So Loki pods may reach each other on
  3100, 9095, and 7946. **Unknown:** the source address
  of `tailscale serve`'s connection to Grafana's ClusterIP, as a NetworkPolicy sees it (the
  node's private address, or its pod-network address). Until P9-05 measures it,
  `networkPolicy.grafana.ingressCidrs` is empty and nothing can reach Grafana.

## Grafana

- **Access:** a ClusterIP Service only, published on the tailnet with `tailscale serve`, the same
  way as Argo CD (a separate HTTPS port). There is no Ingress, tunnel, or public hostname.
  Anonymous access, sign-up, public dashboards, and external snapshots are off. The admin
  password comes from the `grafana-admin` SealedSecret (P9-05); until it exists, the pod
  doesn't start.
- **Storage:** a 1 GiB volume for alert state and sessions. Grafana runs as a single Deployment
  with the `Recreate` strategy (SQLite on a ReadWriteOnce volume), and the claim carries
  `Prune=false` and Helm's `keep`, so Argo CD never deletes it.
- **No phoning home:** usage reporting, update checks, and plugin update checks are off, and no
  plugins are installed at runtime.
- **As code:** data sources (in Grafana's values since P9-02: Prometheus and Loki by Service
  name, not editable), dashboards (`infrastructure/monitoring/dashboards/*.json`), and alert
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

**Confirmed (P9-08)** in CI on every push. Rule 5 asks for every feature to run locally. The opt-in
`compose.observability.yaml` runs the cluster's Grafana, Loki, Prometheus, and Alloy images (same
digests, which `pnpm helm:check` enforces) beside `compose.full.yaml`
([how to use it](../deployment/local.md#local-observability-optional)):

- **Same names:** the data source uids (`prometheus`, `loki`), Prometheus job names, and log
  labels (`namespace`, `app`, `container`, `pod`) match the cluster's, so dashboards, alert rules,
  and queries work in both.
- **Prometheus** scrapes the API's metrics port on the Compose network; that port is published
  only on the host's loopback.
- **Alloy** reads this Compose project's container logs through `loki.source.docker`. Mounting the
  Docker socket is root-equivalent even read-only, so the file is opt-in, documented, and meant
  for contributors' own machines, never a shared host. Alloy runs as the image's root user for
  the socket, with no capabilities and a read-only root filesystem.
- **Exposure:** only Grafana is published, on `127.0.0.1`; its admin password is required
  (`GRAFANA_ADMIN_PASSWORD`).
- **Retention:** 7 days.
- **Files:** `pnpm check` validates the dashboards and alert rules (`scripts/check-monitoring-files.mjs`),
  so a broken JSON or rule fails CI for everyone.
- **CI:** the `observability` job starts both files and checks, through Grafana's data sources,
  that the API's metrics reach Prometheus and a request's log line reaches Loki.

## Capacity

Requests as set in P9-02, to be confirmed in P9-07:

| Pod                | CPU | Memory request | Memory limit |
| ------------------ | --- | -------------- | ------------ |
| Loki               | 50m | 256Mi          | 512Mi        |
| Prometheus         | 55m | 272Mi          | 544Mi        |
| Grafana            | 25m | 192Mi          | 384Mi        |
| Alloy              | 25m | 128Mi          | 256Mi        |
| kube-state-metrics | 10m | 64Mi           | 128Mi        |

Prometheus's figures include its config reloader (5m, 16Mi, limit 32Mi).

That's about 900 MiB requested and 1.8 GiB at most, on a node with roughly 24 GiB available.
Loki sets `GOMEMLIMIT` to 85% of its limit. Disk: two 5 GiB `local-path` volumes (Loki,
Prometheus) and 1 GiB for Grafana.
