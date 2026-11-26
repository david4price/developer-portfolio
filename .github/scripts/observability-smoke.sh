#!/usr/bin/env bash
# End-to-end check of the opt-in local observability stack (P9-08): starts compose.full.yaml with
# compose.observability.yaml, makes an API request, and through Grafana's provisioned data sources
# finds the API's metrics in Prometheus and that request's log line in Loki.
#
# It starts containers and mounts the Docker socket: run it in CI or on your own machine, never on
# a shared host. Needs a .env (from .env.example, placeholders replaced). Leaves the stack running;
# stop it with: docker compose -f compose.full.yaml -f compose.observability.yaml down -v
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
compose=(docker compose -f compose.full.yaml -f compose.observability.yaml)
[[ -f .env ]] || { echo ".env is missing (copy .env.example)" >&2; exit 1; }
env_value() { sed -n "s/^$1=//p" .env | tail -1; }
api="http://127.0.0.1:$(env_value API_PORT)"
grafana="http://127.0.0.1:$(env_value GRAFANA_PORT)"
password="$(env_value GRAFANA_ADMIN_PASSWORD)"
[[ -n "$password" && "$password" != change-me-local-only ]] ||
  { echo "set GRAFANA_ADMIN_PASSWORD in .env" >&2; exit 1; }

on_failure() {
  echo "--- observability logs" >&2
  "${compose[@]}" ps -a >&2 || true
  "${compose[@]}" logs --no-color --tail=60 loki alloy prometheus grafana >&2 || true
}
trap on_failure ERR

# wait_for <seconds> <description> <command…>: retries the command every 3 s until it succeeds.
wait_for() {
  local limit="$1" what="$2" deadline=$((SECONDS + $1))
  shift 2
  until "$@" >/dev/null 2>&1; do
    if ((SECONDS >= deadline)); then
      echo "FAIL: $what (gave up after ${limit}s)" >&2
      return 1
    fi
    sleep 3
  done
  echo "ok: $what"
}

# grafana_get <path> [curl -G args…]: an authenticated GET through Grafana.
grafana_get() {
  local path="$1"
  shift
  curl -fsS -G -u "admin:$password" "$grafana$path" "$@"
}

"${compose[@]}" up -d --build

wait_for 180 "API ready" curl -fsS "$api/api/v1/health/ready"
request_id="$(curl -fsS -D - -o /dev/null "$api/api/v1/health" |
  tr -d '\r' | awk 'tolower($1) == "x-request-id:" { print $2 }')"
[[ -n "$request_id" ]] || { echo "FAIL: the API returned no x-request-id" >&2; exit 1; }
echo "ok: request $request_id"

wait_for 90 "Grafana healthy" curl -fsS "$grafana/api/health"

prometheus_has_api() {
  grafana_get /api/datasources/proxy/uid/prometheus/api/v1/query \
    --data-urlencode 'query=up{job="portfolio-api", namespace="portfolio"}' |
    jq -e '.data.result | any(.value[1] == "1")'
}
wait_for 120 "Prometheus scrapes the API (through Grafana)" prometheus_has_api

loki_has_request() {
  grafana_get /api/datasources/proxy/uid/loki/loki/api/v1/query_range \
    --data-urlencode "query={namespace=\"portfolio\", app=\"api\"} |= \"$request_id\"" \
    --data-urlencode "start=$(($(date +%s) - 900))000000000" |
    jq -e '.data.result | length > 0'
}
wait_for 120 "Loki has the request's log line (through Grafana)" loki_has_request

loki_has_monitoring() {
  grafana_get /api/datasources/proxy/uid/loki/loki/api/v1/label/namespace/values |
    jq -e '.data | index("monitoring") != null and index("portfolio") != null'
}
wait_for 60 "Loki labels the stack's own logs namespace=monitoring" loki_has_monitoring

# Provisioned files load: data sources are read-only, and every committed dashboard is present.
grafana_get /api/datasources | jq -e '[.[] | .uid] | sort == ["loki", "prometheus"]' >/dev/null
echo "ok: exactly the two provisioned data sources"
expected="$(find infrastructure/monitoring/dashboards -name '*.json' | wc -l)"
found="$(grafana_get /api/search --data-urlencode type=dash-db | jq length)"
[[ "$found" == "$expected" ]] ||
  { echo "FAIL: Grafana shows $found dashboard(s), the repository has $expected" >&2; exit 1; }
echo "ok: $found dashboard(s) provisioned"

echo "observability smoke test passed"
