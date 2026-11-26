# Grafana dashboards

One JSON file per dashboard, provisioned read-only in the cluster (P9-05) and in the local stack
(`compose.observability.yaml`, P9-08). Edits made in Grafana's UI aren't saved: export the
dashboard's JSON and commit it here.

`pnpm check` runs `scripts/check-monitoring-files.mjs` on every file here. A dashboard must:

- sit at the top level of this directory, named with letters, digits, `.`, `-`, and `_` only
  (the cluster ships dashboards as flat ConfigMap keys);
- be a JSON object with a `title` and a unique `uid` of 1–40 letters, digits, `-`, or `_`;
- have `id` absent or `null`, so Grafana assigns its own;
- name only the provisioned data sources by uid, `prometheus` or `loki`, Grafana's built-in ones
  (`-- Grafana --`, `-- Mixed --`, `-- Dashboard --`), or one of its own data source variables
  (`$name`, `${name}`, `${name:format}`, `[[name]]`) whose `query` is `prometheus` or `loki`;
- not be an "export for sharing externally" (`__inputs`, `${DS_…}` placeholders that file
  provisioning can't fill): export without that option.
