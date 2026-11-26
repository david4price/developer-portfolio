#!/usr/bin/env bash
# Lints and renders the portfolio chart, validates the manifests against Kubernetes schemas, and
# checks the chart's guardrails. Needs `helm`, `kubeconform`, `yq`, and `jq` on PATH; touches no
# cluster.
#   pnpm helm:check
set -euo pipefail

chart="$(cd "$(dirname "${BASH_SOURCE[0]}")/portfolio" && pwd)"
failures=0

fail() {
  echo "FAIL: $*" >&2
  failures=$((failures + 1))
}

render() {
  helm template portfolio "$chart" --namespace portfolio "$@"
}

# API metrics (P7-01, P9-04) are never in a Service, a container port, or the tunnel, and only two
# renders are accepted:
#   - loopback: API_METRICS_HOST is 127.0.0.1 and no NetworkPolicy rule names the port;
#   - scrape: API_METRICS_HOST is 0.0.0.0 (the pod's loopback, for port-forward, and its pod IP),
#     the pod isn't on the host network, and exactly one rule names the port: ingress to the API
#     from the monitoring namespace's Prometheus pods, on that port alone. No rule that applies to
#     the API pods may admit every port.
# The host is set in `env`, which wins over `envFrom`. Needs yq and jq.
check_metrics() {
  local name="$1" json port mode problems
  json="$(yq ea -o=json '[.] | map(select(. != null))' <<<"$2")" || { fail "$name: render isn't YAML"; return; }
  port="$(jq -r '[.[] | select(.kind == "Deployment" and .metadata.name == "portfolio-api") |
    .spec.template.spec.containers[] | select(.name == "api") | .env[]? |
    select(.name == "API_METRICS_PORT") | .value] | first // ""' <<<"$json")"
  if ! [[ "$port" =~ ^[0-9]+$ ]]; then
    fail "$name renders no numeric API_METRICS_PORT"
    return
  fi
  mode="$(jq -r '[.[] | select(.kind == "Deployment" and .metadata.name == "portfolio-api") |
    .spec.template.spec.containers[] | select(.name == "api") | .env[]? |
    select(.name == "API_METRICS_HOST")] |
    if length != 1 then "missing"
    elif .[0].valueFrom != null then "other"
    elif .[0].value == "127.0.0.1" then "loopback"
    elif .[0].value == "0.0.0.0" then "scrape"
    else "other" end' <<<"$json")"
  problems="$(jq -r --argjson port "$port" --arg mode "$mode" '
    def is_port: (. == $port) or (. == ($port | tostring));
    # The API pods labels, to find every NetworkPolicy that applies to them.
    ([.[] | select(.kind == "Deployment" and .metadata.name == "portfolio-api") |
      .spec.template.metadata.labels] | first // {}) as $api_labels
    | def selects_api: (.spec.podSelector.matchLabels // {}) as $want |
        ($want | to_entries | all(.value == $api_labels[.key])) and
        ((.spec.podSelector.matchExpressions // []) | length == 0);
    # Every NetworkPolicy rule that names the metrics port, or a range that could include it.
    [.[] | select(.kind == "NetworkPolicy") as $policy |
      (($policy.spec.ingress // [] | map({dir: "ingress", rule: .})) +
       ($policy.spec.egress // [] | map({dir: "egress", rule: .})))[] |
      select(any(.rule.ports[]?; (.port | is_port) or .endPort != null)) |
      . + {policy: $policy.metadata.name}] as $rules
    | (.[] | select(.kind == "Service") | .spec.ports[]? |
        select((.port | is_port) or (.targetPort | is_port)) | "a Service exposes the metrics port"),
      # Containers anywhere: Deployments, StatefulSets, Jobs, and CronJobs alike.
      ([.. | objects | (.containers?, .initContainers?) | arrays | .[]] | .[] |
        .ports[]? | select((.containerPort | is_port) or (.hostPort != null and (.hostPort | is_port))) |
        "a container declares the metrics port"),
      (if $mode == "loopback" then
         ($rules[] | "\(.policy) names the metrics port with loopback metrics")
       elif $mode == "scrape" then
         (if ($rules | length) != 1 then "\($rules | length) NetworkPolicy rules name the metrics port, not 1"
          else $rules[0] as $r |
            (if $r.policy != "portfolio-api" or $r.dir != "ingress" then
               "the metrics port rule must be ingress in portfolio-api" else empty end),
            (if $r.rule.ports != [{protocol: "TCP", port: $port}] then
               "the metrics port rule must allow TCP \($port) alone" else empty end),
            (if $r.rule.from != [{
                  namespaceSelector: {matchLabels: {"kubernetes.io/metadata.name": "monitoring"}},
                  podSelector: {matchLabels: {"app.kubernetes.io/name": "prometheus",
                    "app.kubernetes.io/instance": "prometheus", "app.kubernetes.io/component": "server"}}}]
             then "the metrics port rule must admit only the monitoring namespace'"'"'s Prometheus pods"
             else empty end)
          end),
         # A rule with no ports, or a ports entry without a port, admits every port.
         (.[] | select(.kind == "NetworkPolicy" and selects_api) | .metadata.name as $policy |
           .spec.ingress[]? | select(((.ports // []) | length == 0) or any(.ports[]; .port == null)) |
           "\($policy) has an ingress rule that admits every port of the API pods"),
         # On the host network the bind would be every node interface, outside any NetworkPolicy.
         (.[] | select(.kind == "Deployment" and .metadata.name == "portfolio-api") |
           select(.spec.template.spec.hostNetwork == true) | "the API pod must not use the host network")
       else "API_METRICS_HOST must be the value 127.0.0.1, or 0.0.0.0 with scraping (got \($mode))" end)
    ' <<<"$json")" || { fail "$name: metrics check couldn't run"; return; }
  [[ -z "$problems" ]] || while read -r problem; do fail "$name: $problem"; done <<<"$problems"
}

for values in "$chart"/ci/*-values.yaml; do
  name="$(basename "$values")"
  echo "== $name"
  helm lint --strict "$chart" -f "$values"

  manifests="$(render -f "$values")"
  kubeconform -strict -summary -output text <<<"$manifests"

  # Secrets are created out of band; the chart must never render one.
  if grep -qE '^kind: Secret$' <<<"$manifests"; then
    fail "$name renders a Secret"
  fi
  check_metrics "$name" "$manifests"
done

# Production values on top of CI placeholders; images.yaml exists after the first release.
echo "== environments/production"
production="$(cd "$chart/../../environments/production" && pwd)"
production_args=(-f "$chart/ci/digests-values.yaml" -f "$production/values.yaml")
if [[ -f "$production/images.yaml" ]]; then
  production_args+=(-f "$production/images.yaml")
fi
helm lint --strict "$chart" "${production_args[@]}"
production_manifests="$(render "${production_args[@]}")"
kubeconform -strict -summary -output text <<<"$production_manifests"
check_metrics "environments/production" "$production_manifests"

# expect_failure <expected error text> <render args…>: rendering must fail with that message.
expect_failure() {
  local expected="$1"
  shift
  local output
  if output="$(render "$@" 2>&1 >/dev/null)"; then
    fail "expected failure ($expected) but rendering succeeded"
  elif ! grep -qF "$expected" <<<"$output"; then
    fail "expected '$expected', got: $output"
  fi
}

echo "== guardrails"
expect_failure 'needs a digest or a tag'
expect_failure 'digest must look like sha256' \
  -f "$chart/ci/digests-values.yaml" --set api.image.digest=sha256:abc
expect_failure 'api.ai.model or an environment source for AI_MODEL' \
  -f "$chart/ci/ai-enabled-values.yaml" --set api.ai.model=
expect_failure 'api.ai.egress.cidr and api.ai.egress.port are required' \
  -f "$chart/ci/ai-network-policy-values.yaml" --set api.ai.egress.port=0
expect_failure 'api.turnstile.existingSecret is required' \
  -f "$chart/ci/ai-enabled-values.yaml" --set api.turnstile.existingSecret=
expect_failure 'api.turnstile.secretKey is required' \
  -f "$chart/ci/ai-enabled-values.yaml" --set api.turnstile.secretKey=
expect_failure 'api.turnstile.hostnames or an environment source' \
  -f "$chart/ci/ai-enabled-values.yaml" --set api.turnstile.hostnames=
expect_failure 'api.turnstile.egressCidrs is required' \
  -f "$chart/ci/ai-network-policy-values.yaml" --set-json 'api.turnstile.egressCidrs=[]'
expect_failure 'api.trustCloudflareClientIp requires cloudflared.enabled' \
  -f "$chart/ci/digests-values.yaml" --set cloudflared.enabled=false
expect_failure 'api.trustCloudflareClientIp requires cloudflared.enabled' \
  -f "$chart/ci/digests-values.yaml" --set networkPolicy.enabled=false
expect_failure 'postgres.backup.hostPath is required' \
  -f "$chart/ci/digests-values.yaml" --set postgres.backup.hostPath=
expect_failure 'api.infrastructure.apiServerEgress.cidr and .port are required' \
  -f "$chart/ci/infrastructure-values.yaml" --set api.infrastructure.apiServerEgress.cidr=
expect_failure 'postgres.auth.existingSecret is required' \
  -f "$chart/ci/digests-values.yaml" --set postgres.auth.existingSecret=
expect_failure 'argocd.enabled requires api.infrastructure.enabled' \
  -f "$chart/ci/argocd-values.yaml" --set api.infrastructure.enabled=false
expect_failure 'argocd requires serverUrl, application, project, existingSecret' \
  -f "$chart/ci/argocd-values.yaml" --set api.infrastructure.argocd.existingSecret=
expect_failure 'argocd requires namespace, podLabels, and port' \
  -f "$chart/ci/argocd-values.yaml" --set api.infrastructure.argocd.port=0

# The reader Role must grant exactly get/list on the three kinds the serializer reads, bound to
# the API's account alone: an exact match, so any added verb, resource, or subject fails.
echo "== infrastructure reader Role"
expected_rules="rules:
  - apiGroups: [apps]
    resources: [deployments, statefulsets]
    verbs: [get, list]
  - apiGroups: ['']
    resources: [pods]
    verbs: [get, list]"
expected_role_ref="roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: portfolio-api-infrastructure-reader"
expected_subjects="subjects:
  - kind: ServiceAccount
    name: portfolio-api
    namespace: portfolio"
# section <kind> <key>: the lines from "<key>:" to the end of that kind's document.
section() {
  awk -v kind="kind: $1" -v key="$2:" '
    /^---/ { in_doc = 0; in_key = 0 }
    $0 == kind { in_doc = 1 }
    in_doc && $0 == key { in_key = 1 }
    in_key { print }
  ' <<<"$reader"
}
if ! reader="$(render -f "$chart/ci/infrastructure-values.yaml" -s templates/api-rbac.yaml 2>&1)"; then
  fail "infrastructure RBAC doesn't render: $reader"
else
  [[ "$(section Role rules)" == "$expected_rules" ]] ||
    fail "the reader Role must grant exactly get/list on deployments, statefulsets, pods"
  [[ "$(section RoleBinding roleRef | sed '/^subjects:/,$d')" == "$expected_role_ref" ]] ||
    fail "the reader RoleBinding must reference the reader Role (not a ClusterRole)"
  [[ "$(section RoleBinding subjects)" == "$expected_subjects" ]] ||
    fail "the reader RoleBinding must bind only the API's ServiceAccount"
  [[ "$(grep -cE '^kind: (Role|RoleBinding|ClusterRole|ClusterRoleBinding)$' <<<"$reader")" == 2 ]] ||
    fail "the reader must be exactly one Role and one RoleBinding (no cluster-wide RBAC)"
fi
# Monitoring log reader (P9-03): exactly pods get/list/watch and pods/log get, bound to Alloy's
# account in the monitoring namespace alone; nothing renders while it's off.
echo "== monitoring log reader Role"
expected_rules="rules:
  - apiGroups: ['']
    resources: [pods]
    verbs: [get, list, watch]
  - apiGroups: ['']
    resources: [pods/log]
    verbs: [get]"
expected_role_ref="roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: portfolio-monitoring-log-reader"
expected_subjects="subjects:
  - kind: ServiceAccount
    name: alloy
    namespace: monitoring"
if ! reader="$(render -f "$chart/ci/monitoring-values.yaml" -s templates/monitoring-readers.yaml 2>&1)"; then
  fail "monitoring readers don't render: $reader"
else
  [[ "$(section Role rules)" == "$expected_rules" ]] ||
    fail "the log reader Role must grant exactly pods get/list/watch and pods/log get"
  [[ "$(section RoleBinding roleRef | sed '/^subjects:/,$d')" == "$expected_role_ref" ]] ||
    fail "the log reader RoleBinding must reference the log reader Role (not a ClusterRole)"
  [[ "$(section RoleBinding subjects)" == "$expected_subjects" ]] ||
    fail "the log reader RoleBinding must bind only the monitoring namespace's alloy account"
  [[ "$(grep -cE '^kind: (Role|RoleBinding|ClusterRole|ClusterRoleBinding)$' <<<"$reader")" == 2 ]] ||
    fail "the log reader must be exactly one Role and one RoleBinding"
fi
expect_failure 'monitoring.readers.logs requires namespace and serviceAccount' \
  -f "$chart/ci/monitoring-values.yaml" --set monitoring.readers.logs.serviceAccount=
expect_failure 'monitoring.readers.logs requires namespace and serviceAccount' \
  -f "$chart/ci/monitoring-values.yaml" --set monitoring.readers.logs.namespace=

# check_metrics must refuse widened renders (P9-04): each case edits a passing scrape render.
echo "== metrics guardrail refusals"
scrape_render="$(render -f "$chart/ci/metrics-scrape-values.yaml")"
# expect_metrics_refused <description> <yq edit>: check_metrics must report at least one problem.
expect_metrics_refused() {
  local edited found
  edited="$(yq "$2" <<<"$scrape_render")" || { fail "metrics refusal case '$1' doesn't apply"; return; }
  found="$(failures=0; check_metrics probe "$edited" >/dev/null 2>&1; echo "$failures")"
  ((found > 0)) || fail "check_metrics accepted $1"
}
api_policy='select(.kind == "NetworkPolicy" and .metadata.name == "portfolio-api")'
api_deploy='select(.kind == "Deployment" and .metadata.name == "portfolio-api")'
expect_metrics_refused "a Service port on the metrics port" \
  '(select(.kind == "Service" and .metadata.name == "portfolio-api") | .spec.ports) += [{"port": 9464}]'
expect_metrics_refused "a CronJob container port on the metrics port" \
  '(select(.kind == "CronJob") | .spec.jobTemplate.spec.template.spec.containers[0].ports) = [{"containerPort": 9464}]'
expect_metrics_refused "the host network" "($api_deploy | .spec.template.spec.hostNetwork) = true"
expect_metrics_refused "a cloudflared rule open to every TCP port" \
  "($api_policy | .spec.ingress[0].ports) = [{\"protocol\": \"TCP\"}]"
expect_metrics_refused "a second rule naming the metrics port" \
  "($api_policy | .spec.ingress) += [{\"ports\": [{\"port\": 9464}]}]"
expect_metrics_refused "the metrics rule from another namespace" \
  "($api_policy | .spec.ingress[1].from[0].namespaceSelector.matchLabels) = {\"kubernetes.io/metadata.name\": \"default\"}"
expect_metrics_refused "the metrics rule from any pod in monitoring" \
  "del($api_policy | .spec.ingress[1].from[0].podSelector)"
expect_metrics_refused "a port range" "($api_policy | .spec.ingress[1].ports[0].endPort) = 9500"
expect_metrics_refused "a namespace-wide policy admitting every port" \
  '(select(.kind == "NetworkPolicy" and .metadata.name == "portfolio-default-deny") | .spec.ingress) = [{}]'
expect_metrics_refused "loopback metrics with the rule still there" \
  "($api_deploy | .spec.template.spec.containers[0].env[] | select(.name == \"API_METRICS_HOST\") | .value) = \"127.0.0.1\""
expect_metrics_refused "a host other than the two" \
  "($api_deploy | .spec.template.spec.containers[0].env[] | select(.name == \"API_METRICS_HOST\") | .value) = \"192.0.2.10\""

# Metrics readers (P9-04): pod discovery (list/watch pods) for Prometheus, and exactly the kinds
# kube-state-metrics reports for it; each bound to its own account in monitoring alone.
echo "== monitoring metrics reader Roles"
if ! readers="$(render -f "$chart/ci/metrics-scrape-values.yaml" -s templates/monitoring-readers.yaml 2>&1)"; then
  fail "metrics readers don't render: $readers"
else
  readers_json="$(yq ea -o=json '[.] | map(select(. != null))' <<<"$readers")"
  expected='[
    {"kind":"Role","name":"portfolio-monitoring-pod-discovery",
     "rules":[{"apiGroups":[""],"resources":["pods"],"verbs":["list","watch"]}]},
    {"kind":"RoleBinding","name":"portfolio-monitoring-pod-discovery",
     "roleRef":{"apiGroup":"rbac.authorization.k8s.io","kind":"Role","name":"portfolio-monitoring-pod-discovery"},
     "subjects":[{"kind":"ServiceAccount","name":"prometheus-server","namespace":"monitoring"}]},
    {"kind":"Role","name":"portfolio-monitoring-state-reader",
     "rules":[{"apiGroups":[""],"resources":["pods","persistentvolumeclaims"],"verbs":["list","watch"]},
              {"apiGroups":["apps"],"resources":["deployments","statefulsets"],"verbs":["list","watch"]},
              {"apiGroups":["batch"],"resources":["jobs","cronjobs"],"verbs":["list","watch"]},
              {"apiGroups":["autoscaling"],"resources":["horizontalpodautoscalers"],"verbs":["list","watch"]}]},
    {"kind":"RoleBinding","name":"portfolio-monitoring-state-reader",
     "roleRef":{"apiGroup":"rbac.authorization.k8s.io","kind":"Role","name":"portfolio-monitoring-state-reader"},
     "subjects":[{"kind":"ServiceAccount","name":"kube-state-metrics","namespace":"monitoring"}]}]'
  # Exactly these four objects (the log reader is off in this fixture): any added verb, resource,
  # subject, or ClusterRole fails.
  [[ "$(jq -c 'map({kind, name: .metadata.name, rules, roleRef, subjects} |
      with_entries(select(.value != null))) | sort_by(.kind, .name)' <<<"$readers_json")" == \
    "$(jq -c 'sort_by(.kind, .name)' <<<"$expected")" ]] ||
    fail "the metrics readers must be exactly the pod discovery and state reader Roles and bindings"
fi
expect_failure 'monitoring.readers.metrics requires namespace, prometheusServiceAccount, and stateServiceAccount' \
  -f "$chart/ci/metrics-scrape-values.yaml" --set monitoring.readers.metrics.stateServiceAccount=
expect_failure 'api.metrics.scrape.enabled requires networkPolicy.enabled' \
  -f "$chart/ci/metrics-scrape-values.yaml" --set networkPolicy.enabled=false
expect_failure 'api.metrics.scrape.from.namespace and .podLabels are required' \
  -f "$chart/ci/metrics-scrape-values.yaml" --set api.metrics.scrape.from.namespace=

# No template anywhere may render cluster-wide RBAC, with the view on or off.
for values in "$chart/ci/infrastructure-values.yaml" "$chart/ci/digests-values.yaml" \
  "$chart/ci/monitoring-values.yaml" "$chart/ci/metrics-scrape-values.yaml"; do
  if render -f "$values" | grep -qE '^kind: (ClusterRole|ClusterRoleBinding)$'; then
    fail "$(basename "$values") renders cluster-wide RBAC"
  fi
done
if render -f "$chart/ci/digests-values.yaml" | grep -qE '^kind: (ServiceAccount|Role|RoleBinding)$'; then
  fail "the chart renders RBAC with the infrastructure view off"
fi

# The model and address may come only from the environment Secret: the chart then sets neither,
# so the Secret's values aren't overridden (container env wins over envFrom).
echo "== AI settings from envSecret"
if ! from_secret="$(render -f "$chart/ci/ai-enabled-values.yaml" --set api.ai.model= \
  --set api.ai.baseUrl= --set api.envSecret=portfolio-api-env 2>&1)"; then
  fail "AI settings from envSecret don't render: $from_secret"
elif grep -qE 'name: AI_(MODEL|BASE_URL)$' <<<"$from_secret"; then
  fail "chart sets AI_MODEL or AI_BASE_URL that should come from envSecret"
fi

if ((failures > 0)); then
  echo "$failures check(s) failed" >&2
  exit 1
fi
echo "chart checks passed"
