# Grafana alert rules

Alert rule groups in Grafana's file-provisioning format, as JSON (one file per group or more),
provisioned in the cluster (P9-06) and in the local stack (`compose.observability.yaml`, P9-08).
Contact points never go here: the cluster's comes from a SealedSecret.

`pnpm check` runs `scripts/check-monitoring-files.mjs` on every file here. Files sit at the top level
(Grafana doesn't read subdirectories here), and YAML is refused so every rule gets checked. A file
must:

- be a JSON object with `apiVersion: 1` and a non-empty `groups` list;
- give each group a `name`, `folder`, and `interval`, and at least one rule;
- give each rule a unique `uid` of 1–40 letters, digits, `-`, or `_`, a `title`, a `condition`
  that names one of its `data` queries, and only the provisioned data sources (`prometheus`,
  `loki`) or Grafana's expressions (`__expr__`) as `datasourceUid`.
