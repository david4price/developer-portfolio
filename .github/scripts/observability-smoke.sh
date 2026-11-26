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
# setting <name> <default>: as Compose resolves it: the exported value, then .env's (without
# surrounding quotes), then the default.
setting() {
  local value
  value="$(printenv "$1" || true)"
  if [[ -z "$value" ]]; then
    value="$(sed -n "s/^$1=//p" .env | tail -1)"
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"
  fi
  echo "${value:-$2}"
}
api="http://127.0.0.1:$(setting API_PORT 3001)"
grafana="http://127.0.0.1:$(setting GRAFANA_PORT 3300)"
password="$(setting GRAFANA_ADMIN_PASSWORD '')"
[[ -n "$password" && "$password" != change-me-local-only ]] ||
  { echo "set GRAFANA_ADMIN_PASSWORD in .env" >&2; exit 1; }

started=false
# On any failure once the stack is up: the observability containers' state and logs.
on_exit() {
  local status=$?
  if ((status != 0)) && [[ "$started" == true ]]; then
    echo "--- observability logs" >&2
    "${compose[@]}" ps -a >&2 || true
    "${compose[@]}" logs --no-color --tail=60 loki alloy prometheus grafana >&2 || true
  fi
}
trap on_exit EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

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

started=true
"${compose[@]}" up -d --build

wait_for 180 "API ready" curl -fsS "$api/api/v1/health/ready"
request_id="$(curl -fsS -D - -o /dev/null "$api/api/v1/health" |
  tr -d '\r' | awk 'tolower($1) == "x-request-id:" { print $2 }')"
[[ -n "$request_id" ]] || fail "the API returned no x-request-id"
echo "ok: request $request_id"

wait_for 90 "Grafana healthy" curl -fsS "$grafana/api/health"
status="$(curl -sS -o /dev/null -w '%{http_code}' -u "admin:$password" "$grafana/api/user" || true)"
[[ "$status" == 200 ]] || fail "Grafana answered $status to admin login. The password is set when \
grafana-data is created; after changing GRAFANA_ADMIN_PASSWORD, run down -v (or reset it in Grafana)"

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
datasources="$(grafana_get /api/datasources)" || fail "Grafana's data source list didn't load"
jq -e '[.[] | .uid] | sort == ["loki", "prometheus"]' <<<"$datasources" >/dev/null ||
  fail "Grafana's data sources aren't exactly the provisioned loki and prometheus"
echo "ok: exactly the two provisioned data sources"
expected="$(find infrastructure/helm/monitoring/dashboards -maxdepth 1 -name '*.json' | wc -l)"
found="$(grafana_get /api/search --data-urlencode type=dash-db | jq length)"
[[ "$found" == "$expected" ]] || fail "Grafana shows $found dashboard(s), the repository has $expected"
echo "ok: $found dashboard(s) provisioned"

# Read-only and private: provisioned dashboards refuse saves, and nothing answers anonymously.
api_dashboard="$(grafana_get /api/dashboards/uid/portfolio-api)" ||
  fail "the Portfolio API dashboard didn't load"
status="$(jq '{dashboard: .dashboard, overwrite: true}' <<<"$api_dashboard" |
  curl -sS -o /dev/null -w '%{http_code}' -u "admin:$password" -H 'Content-Type: application/json' \
    -X POST --data @- "$grafana/api/dashboards/db" || true)"
[[ "$status" == 400 ]] || fail "saving a provisioned dashboard answered $status, not 400"
echo "ok: provisioned dashboards refuse saves"
status="$(curl -sS -o /dev/null -w '%{http_code}' "$grafana/api/search" || true)"
[[ "$status" == 401 ]] || fail "an anonymous request answered $status, not 401"
echo "ok: anonymous access refused"

# P9-05: a server error is followed to its log lines. Redis stops for a moment, so readiness
# answers 503; the API dashboard's own 5xx panel query must find that request's id, and the Loki
# data source must turn request ids into links to the Logs dashboard.
"${compose[@]}" stop redis >/dev/null
response="$(curl -sS -D - -o /dev/null -w 'status: %{http_code}\n' "$api/api/v1/health/ready" |
  tr -d '\r' || true)"
error_id="$(awk 'tolower($1) == "x-request-id:" { print $2 }' <<<"$response")"
error_status="$(awk '$1 == "status:" { print $2 }' <<<"$response")"
"${compose[@]}" start redis >/dev/null
[[ -n "$error_id" && "$error_status" == 503 ]] ||
  fail "readiness with Redis stopped answered $error_status (request id '${error_id}'), not 503"
echo "ok: a 503 from readiness ($error_id)"
panel_query="$(jq -r '.dashboard.panels[] | select(.type == "logs") | .targets[0].expr' <<<"$api_dashboard")"
[[ -n "$panel_query" ]] || fail "the Portfolio API dashboard has no server error logs panel"
dashboard_finds_error() {
  grafana_get /api/datasources/proxy/uid/loki/loki/api/v1/query_range \
    --data-urlencode "query=$panel_query |= \"$error_id\"" \
    --data-urlencode "start=$(($(date +%s) - 900))000000000" |
    jq -e '.data.result | length > 0'
}
wait_for 90 "the API dashboard's 5xx panel finds the request" dashboard_finds_error
jq -e '.[] | select(.uid == "loki") | .jsonData.derivedFields[] |
  select(.name == "requestId" and (.url | contains("/d/portfolio-logs/")))' <<<"$datasources" >/dev/null ||
  fail "the Loki data source doesn't link request ids to the Logs dashboard"
echo "ok: request ids link to the Logs dashboard"

echo "observability smoke test passed"
