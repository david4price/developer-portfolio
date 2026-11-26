# ADR 0004: Self-Hosted Grafana, Loki, and Prometheus for Logs, Metrics, and Alerts

- **Status:** Accepted (2026-11-25), owner's choice: Grafana's open-source stack. Phase 9.
  Plan: [observability](observability.md) (**Proposed** until each Phase 9 task confirms it).
- **Supersedes:** the "no Prometheus server or Grafana until the roadmap calls for them" note
  in the `observability` skill and the overview's "no scraper" row.

## Context

The API writes JSON logs with request ids (P2-04) and serves Prometheus metrics on a loopback port
(P7-01), but nothing keeps or watches either:

- **Logs vanish with the pod.** `kubectl logs` shows only the current container and what the node
  still holds. An error at 3 a.m. is gone by the next rollout, and no one is told it happened.
- **Metrics are read by hand.** Each pod is read over `kubectl port-forward`, its counters start
  at zero on restart, and there is no history, so "has the error rate changed since the last
  release?" can't be answered.
- **Nothing alerts.** The owner learns about a failed backup, a crash-looping pod, a dependency
  that stays down, or the Argo CD token warning (P6-05) only by looking.

The constraints are the project's own: free (P7-04's $0–10 a month), open source, self-hosted on
the one K3s node, least privilege, deployed through Argo CD, nothing public, and proportionate to a
portfolio's traffic (measured on 2026-11-25: about 1.8 MB of logs a day across the namespace).

## Decision

Run Grafana's open-source stack in a new `monitoring` namespace, managed by Argo CD:

| Piece                             | Role                                                                                                            | License    |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------- |
| **Grafana Alloy**                 | Tails pod logs through the Kubernetes API (`loki.source.kubernetes`: no root, no host paths) and sends to Loki. | Apache 2.0 |
| **Loki** (monolithic, filesystem) | Stores and searches logs; indexes labels only.                                                                  | AGPLv3     |
| **Prometheus** (server only)      | Scrapes the API's metrics and kube-state-metrics; keeps history.                                                | Apache 2.0 |
| **kube-state-metrics**            | Pod restarts, OOM kills, failed Jobs, replica counts, for `portfolio` and `monitoring` only.                    | Apache 2.0 |
| **Grafana**                       | Dashboards, log search, and alerting (no separate Alertmanager).                                                | AGPLv3     |

Dashboards, data sources, and alert rules are provisioned from Git; the UI cannot save changes
over them. Grafana is reachable on the tailnet only, like Argo CD.

**Considered and not chosen:**

- **Hosted services** (Datadog, Grafana Cloud's free tier): not self-hosted, send logs off the
  host, and free tiers change.
- **SigNoz / OpenObserve:** one product instead of four, built on OpenTelemetry, but SigNoz needs
  ClickHouse (more memory than this whole stack) and both are less widely known than Grafana.
- **ELK / OpenSearch:** full-text indexing costs gigabytes of memory for megabytes of logs.
- **Sentry self-hosted:** not open source under its current license, and about twenty containers.
  GlitchTip (Sentry-compatible, open source) stays an option if grouped exceptions with stack
  traces are ever wanted; Loki covers error logs for now.

## Consequences

- **Four upstream charts to keep current.** Chart versions and image digests are pinned in Git
  and updated by hand ([ADR 0002](adr-0002-dependency-updates.md)). Loki's and Grafana's charts
  moved to the `grafana-community` repository in 2026 (confirmed and pinned in P9-02). CI checks
  each chart archive's sha256, which Argo CD doesn't.
- **The metrics port opens to one pod.** The API binds metrics to every pod interface instead of
  loopback alone (loopback keeps `kubectl port-forward` working),
  and a NetworkPolicy lets only Prometheus reach it. It stays out of the Service, the tunnel, and
  every other policy; `pnpm helm:check` enforces the new rule in place of the loopback one.
- **Reads are granted by the namespace that owns them.** The portfolio chart, not the monitoring
  Applications, creates the Role that lets the monitoring ServiceAccounts list pods and read their
  logs, so the `portfolio` AppProject still owns everything in `portfolio` and no ClusterRole is
  added.
- **The stack can't report its own host going down.** It runs on the same node it watches; an
  outside uptime check is a separate, later decision.
- **AGPL is fine here:** Grafana and Loki run unmodified for the owner's own use.
- **About 1–1.5 GiB of memory and two small volumes** on a node with ~24 GiB available; P9-07
  measures the real figures.
