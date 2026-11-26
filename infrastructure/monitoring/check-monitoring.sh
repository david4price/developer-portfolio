#!/usr/bin/env bash
# Checks the Phase 9 monitoring stack without touching a cluster (ADR 0004):
#   - every Application in infrastructure/argocd/monitoring stays inside the `monitoring` project
#     (sources listed there, one destination namespace) and pins its chart to an exact version;
#   - each upstream chart archive matches the sha256 recorded on its Application;
#   - every chart renders with its production values, passes kubeconform, and holds to the
#     guardrails in check_manifests.
#   - the monitoring chart's selectors (pod labels, ports, ServiceAccounts) match what the upstream
#     charts and the portfolio chart render.
# Needs `helm`, `kubeconform`, `yq` (mikefarah, v4), `jq`, and network access to the chart
# repositories.
#   pnpm helm:check
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
apps="$root/infrastructure/argocd/monitoring"
project="$root/infrastructure/argocd/monitoring-project.yaml"
values_dir="$root/infrastructure/environments/production/monitoring"
own_chart="$root/infrastructure/helm/monitoring"
repository=https://github.com/david4price/developer-portfolio.git
namespace=monitoring
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
failures=0

fail() {
  echo "FAIL: $*" >&2
  failures=$((failures + 1))
}

# The project: no cluster-scoped kinds, one destination, and the kinds its Applications may create.
[[ "$(yq '.spec.clusterResourceWhitelist | length' "$project")" == 0 ]] ||
  fail "the monitoring project must allow no cluster-scoped kinds"
[[ "$(yq -o=json -I=0 '[.spec.destinations[] | .server + " " + .namespace]' "$project")" == \
  "[\"https://kubernetes.default.svc $namespace\"]" ]] ||
  fail "the monitoring project's only destination must be the $namespace namespace"
allowed_kinds="$(yq '.spec.namespaceResourceWhitelist[] | .group + "/" + .kind' "$project")"
source_repos="$(yq '.spec.sourceRepos[]' "$project")"

# to_json: the YAML documents on stdin as one JSON array (yq converts; jq evaluates, since yq's
# multi-document semantics differ from jq's).
to_json() {
  yq ea -o=json '[.] | map(select(. != null))'
}

# render <helm template args…>: prints the manifests, or the reason and status 1 when the chart
# fails to render or renders nothing (an empty render would pass every guardrail). Runs in a
# command substitution, so the caller records the failure. Helm's warnings go to stderr and stay
# out of the manifests.
render() {
  local output
  if ! output="$(helm template "$@" --namespace "$namespace" 2>"$work/helm.err")"; then
    printf "doesn't render: %s\n" "$(cat "$work/helm.err")"
    return 1
  elif [[ "$(to_json <<<"$output" | jq 'map(select(.kind != null)) | length')" == 0 ]]; then
    echo "renders nothing"
    return 1
  fi
  printf '%s\n' "$output"
}

# render_and_check <name> <helm template args…>
render_and_check() {
  local name="$1" manifests
  shift
  if manifests="$(render "$@")"; then
    check_manifests "$name" "$manifests"
  else
    fail "$name $manifests"
  fi
}

# The monitoring chart's NetworkPolicies and Roles name the upstream pods by label, port, and
# ServiceAccount (infrastructure/helm/monitoring/values.yaml). Release → key in that file.
declare -A contract_keys=([alloy]=alloy [loki]=loki [prometheus]=prometheus
  [kube-state-metrics]=kubeStateMetrics [grafana]=grafana)
own_values="$(yq -o=json '.' "$own_chart/values.yaml")"
# jq's `contains` matches strings by substring ("loki-x" contains "loki"); matchLabels is exact.
exact_labels='def has_labels($want): . as $have | $want | to_entries | all(.value == $have[.key]);'

# check_contract <name> <manifests as JSON>: the release's workload carries the labels the
# policies select, listens on the ports they allow, and runs as the account the Roles bind, so a
# chart upgrade that renames any of them fails here instead of silently matching nothing.
check_contract() {
  local name="$1" json="$2" key="${contract_keys[$1]:-}" problems
  [[ -n "$key" ]] || return 0
  if ! problems="$(jq -r --argjson own "$own_values" --arg key "$key" "$exact_labels"'
    ($own.pods[$key]) as $labels
    | ([$own.ports[$key], (if $key == "loki" then $own.ports.lokiGrpc, $own.ports.lokiMemberlist
        else empty end)]) as $ports
    | ($own.readers.serviceAccounts[$key] // null) as $account
    | [.[] | select(.kind == "Deployment" or .kind == "StatefulSet")
        | select(.spec.template.metadata.labels | has_labels($labels))] as $matches
    | if ($matches | length) != 1 then
        "pods.\($key) labels match \($matches | length) workloads, not 1"
      else
        $matches[0].spec.template.spec as $pod
        | ([$pod.containers[].ports[]?.containerPort]) as $open
        | ($ports[] | select(. as $p | $open | index($p) | not) | "ports: \(.) isn'"'"'t a container port"),
          (if $account != null and $pod.serviceAccountName != $account then
             "readers.serviceAccounts.\($key) is \($account), the pod runs as \($pod.serviceAccountName)"
           else empty end)
      end' <<<"$json")"; then
    fail "$name: the contract check couldn't run"
  elif [[ -n "$problems" ]]; then
    while read -r problem; do fail "$name: monitoring chart values: $problem"; done <<<"$problems"
  fi
}

# check_manifests <name> <manifests>: guardrails for everything deployed into the namespace.
check_manifests() {
  local name="$1" manifests="$2" json kind found
  kubeconform -strict -summary -output text <<<"$manifests" || fail "$name fails kubeconform"
  if ! json="$(to_json <<<"$manifests")"; then
    fail "$name: the render isn't valid YAML"
    return
  fi
  # q <jq filter>: one result per line; a failing filter is a failure, never an empty pass.
  q() {
    jq -r "$1" <<<"$json" || { fail "$name: query failed: $1"; echo "query failed"; }
  }

  # Only kinds the project allows (so no ClusterRole, Ingress, or Secret), all in the namespace.
  for kind in $(q '.[] | (.apiVersion | sub("/?v[0-9][^/]*$"; "")) + "/" + .kind' | sort -u); do
    grep -qxF "$kind" <<<"$allowed_kinds" ||
      fail "$name renders $kind, which the monitoring project doesn't allow"
  done
  found="$(q '.[] | select((.metadata.namespace // "'"$namespace"'") != "'"$namespace"'") |
    .kind + "/" + .metadata.name')"
  [[ -z "$found" ]] || fail "$name renders resources outside $namespace: $found"

  # Nothing published outside the cluster.
  found="$(q '.[] | select(.kind == "Service" and (.spec.type // "ClusterIP") != "ClusterIP") |
    .metadata.name')"
  [[ -z "$found" ]] || fail "$name renders a NodePort or LoadBalancer Service: $found"

  # Pods: no host access, every image pinned by digest, every container with resource requests.
  local pods='.[] | select(.spec.template.spec != null)'
  local containers="$pods"' | .spec.template.spec | (.containers // []) + (.initContainers // []) | .[]'
  found="$(q "$pods"' | select(.spec.template.spec | .hostNetwork or .hostPID or .hostIPC or
    any(.volumes[]?; .hostPath != null)) | .kind + "/" + .metadata.name')"
  [[ -z "$found" ]] || fail "$name renders host namespaces or hostPath volumes: $found"
  found="$(q "$containers"' | select(.securityContext.privileged) | .name')"
  [[ -z "$found" ]] || fail "$name renders a privileged container: $found"
  found="$(q "$containers"' | select(.image | test("@sha256:[0-9a-f]{64}$") | not) | .image')"
  [[ -z "$found" ]] || fail "$name renders an image without a sha256 digest: $found"
  found="$(q "$containers"' | select(.resources.requests == null) | .name')"
  [[ -z "$found" ]] || fail "$name renders a container without resource requests: $found"
  # Remembered for the local stack's check below.
  q "$containers"' | .image' >>"$work/images"

  check_contract "$name" "$json"
}

shopt -s nullglob
app_files=("$apps"/*.yaml)
((${#app_files[@]} > 0)) || fail "no Applications in $apps"

for app in "${app_files[@]}"; do
  name="$(basename "$app" .yaml)"
  values="$values_dir/$name.yaml"
  echo "== $name"
  [[ "$(yq '.kind + "/" + .metadata.name + "/" + .spec.project' "$app")" == \
    "Application/$name/$namespace" ]] ||
    fail "$name: must be an Application named after its file, in the $namespace project"
  [[ "$(yq '.spec.destination.server + " " + .spec.destination.namespace' "$app")" == \
    "https://kubernetes.default.svc $namespace" ]] ||
    fail "$name: destination must be the $namespace namespace of the local cluster"
  [[ -f "$values" ]] || { fail "$name: missing $values"; continue; }
  if ! repos="$(yq '.spec.sources[].repoURL' "$app")"; then
    fail "$name: can't read its sources"
    continue
  fi
  for repo in $repos; do
    grep -qxF "$repo" <<<"$source_repos" ||
      fail "$name: source $repo isn't listed in the monitoring project"
  done

  chart="$(yq '.spec.sources[0].chart // ""' "$app")"
  if [[ -z "$chart" ]]; then
    # This repository's own chart.
    [[ "$(yq '.spec.sources[0].repoURL + " " + .spec.sources[0].path' "$app")" == \
      "$repository infrastructure/helm/monitoring" ]] ||
      fail "$name: a source without a chart must be this repository's monitoring chart"
    [[ "$(yq '.spec.sources[0].helm.valueFiles' "$app")" == \
      "- ../../environments/production/monitoring/$name.yaml" ]] ||
      fail "$name: valueFiles must be ../../environments/production/monitoring/$name.yaml"
    render_and_check "$name" "$name" "$own_chart" -f "$values"
    # Its other source: the namespace's SealedSecrets, and nothing else (ADR 0001).
    secrets_path=infrastructure/environments/production/monitoring/secrets
    [[ "$(yq -o=json '.spec.sources[1:]' "$app" | jq -c 'map({repoURL, targetRevision, path})')" == \
      "[{\"repoURL\":\"$repository\",\"targetRevision\":\"main\",\"path\":\"$secrets_path\"}]" ]] ||
      fail "$name: its only other source must be $secrets_path"
    for secret in "$root/$secrets_path"/*; do
      [[ "$secret" == *.sealedsecret.yaml ]] || { fail "$secret isn't a .sealedsecret.yaml file"; continue; }
      [[ "$(yq ea -o=json '[.] | map(select(. != null))' "$secret" |
        jq -r --arg ns "$namespace" 'map(select(.kind != "SealedSecret" or .metadata.namespace != $ns or
          (.spec.template.metadata.namespace // $ns) != $ns)) | length')" == 0 ]] ||
        fail "$secret must hold only SealedSecrets for the $namespace namespace"
      # Gitleaks skips these files, so no plaintext may ride along beside the ciphertext.
      [[ "$(yq ea -o=json '[.] | map(select(. != null))' "$secret" |
        jq '[.[] | select(.stringData != null or .data != null or .spec.template.data != null or
          .spec.template.stringData != null)] | length')" == 0 ]] ||
        fail "$secret holds plaintext (stringData or data) beside its encryptedData"
    done
    continue
  fi

  repo="$(yq '.spec.sources[0].repoURL' "$app")"
  version="$(yq '.spec.sources[0].targetRevision' "$app")"
  expected_sha="$(yq '.metadata.annotations["developer-portfolio/chart-sha256"] // ""' "$app")"
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "$name: chart version '$version' isn't exact"
  [[ "$expected_sha" =~ ^[0-9a-f]{64}$ ]] || fail "$name: no chart sha256 annotation"
  [[ "$(yq '.spec.sources[0].helm.releaseName' "$app")" == "$name" ]] ||
    fail "$name: releaseName must be $name"
  [[ "$(yq '.spec.sources[0].helm.valueFiles' "$app")" == \
    "- \$values/infrastructure/environments/production/monitoring/$name.yaml" ]] ||
    fail "$name: valueFiles must be \$values/infrastructure/environments/production/monitoring/$name.yaml"
  [[ "$(yq '.spec.sources[1].repoURL + " " + .spec.sources[1].targetRevision + " " + .spec.sources[1].ref' "$app")" == \
    "$repository main values" ]] || fail "$name: the second source must be this repository's main as \$values"

  mkdir -p "$work/$name"
  if ! helm pull "$chart" --repo "$repo" --version "$version" --destination "$work/$name" >/dev/null; then
    fail "$name: can't download $chart $version from $repo"
    continue
  fi
  archive="$work/$name/$chart-$version.tgz"
  actual_sha="$(sha256sum "$archive" | cut -d' ' -f1)"
  if [[ "$actual_sha" != "$expected_sha" ]]; then
    fail "$name: $chart $version archive is $actual_sha, recorded $expected_sha"
    continue
  fi
  render_and_check "$name" "$name" "$archive" -f "$values"
done

echo "== monitoring chart (CI values)"
for values in "$own_chart"/ci/*-values.yaml; do
  helm lint --strict "$own_chart" -f "$values" >/dev/null || fail "$(basename "$values") fails lint"
  render_and_check "$(basename "$values")" monitoring "$own_chart" -f "$values"
done
if output="$(helm template monitoring "$own_chart" --namespace "$namespace" 2>&1)"; then
  fail "the monitoring chart renders without networkPolicy.apiServerEgress.cidr"
elif ! grep -qF 'networkPolicy.apiServerEgress.cidr and .port are required' <<<"$output"; then
  fail "expected the apiServerEgress error, got: $output"
fi
# Grafana: no pod ingress (the node's tailnet proxy needs none), no internet until alerts.
if policies="$(render monitoring "$own_chart" -f "$own_chart/ci/default-values.yaml" \
  -s templates/networkpolicies.yaml)"; then
  policies="$(to_json <<<"$policies")"
  [[ "$(jq '.[] | select(.metadata.name == "monitoring-grafana") | .spec.ingress // [] | length' \
    <<<"$policies")" == 0 ]] || fail "Grafana allows ingress with no ingressCidrs"
  [[ "$(jq '[.[] | select(.metadata.name == "monitoring-grafana") | .spec.egress[].to[] |
    select(.ipBlock != null)] | length' <<<"$policies")" == 0 ]] ||
    fail "Grafana has internet egress with alerts off"
  # Every pod in the namespace is covered by the default deny.
  [[ "$(jq '.[] | select(.metadata.name == "monitoring-default-deny") | .spec.podSelector == {} and
    (.spec.policyTypes | contains(["Ingress", "Egress"]))' <<<"$policies")" == true ]] ||
    fail "the default-deny policy must select every pod for ingress and egress"
else
  fail "the NetworkPolicies $policies"
fi

# The portfolio chart binds its log reader to Alloy's account by name. As production renders it
# (the values Argo CD layers), it must be the account the monitoring chart binds, which
# check_contract compared with the pod Alloy actually runs as.
echo "== portfolio readers and metrics rule (production)"
production="$root/infrastructure/environments/production"
production_args=(-f "$root/infrastructure/helm/portfolio/ci/digests-values.yaml" -f "$production/values.yaml")
[[ -f "$production/images.yaml" ]] && production_args+=(-f "$production/images.yaml")
if reader="$(render portfolio "$root/infrastructure/helm/portfolio" "${production_args[@]}" \
  -s templates/monitoring-readers.yaml)"; then
  # Each binding's subject, by binding: the accounts the monitoring chart names, which
  # check_contract compared with the pods' own accounts.
  [[ "$(to_json <<<"$reader" | jq -c '[.[] | select(.kind == "RoleBinding") |
    {(.metadata.name): [.subjects[] | .kind + " " + .namespace + "/" + .name]}] | add')" == \
    "$(jq -c --arg ns "$namespace" '.readers.serviceAccounts as $sa | {
      "portfolio-monitoring-log-reader": ["ServiceAccount \($ns)/\($sa.alloy)"],
      "portfolio-monitoring-pod-discovery": ["ServiceAccount \($ns)/\($sa.prometheus)"],
      "portfolio-monitoring-state-reader": ["ServiceAccount \($ns)/\($sa.kubeStateMetrics)"]}' \
      <<<"$own_values")" ]] ||
    fail "production's portfolio readers must bind exactly the $namespace namespace's Alloy, Prometheus, and kube-state-metrics accounts"
else
  fail "the production portfolio readers $reader"
fi
# The API's metrics port admits the pods the monitoring chart calls Prometheus, in this namespace.
if api_policy="$(render portfolio "$root/infrastructure/helm/portfolio" "${production_args[@]}" \
  -s templates/networkpolicies.yaml)"; then
  [[ "$(to_json <<<"$api_policy" | jq -c --argjson own "$own_values" --arg ns "$namespace" '
    [.[] | select(.metadata.name == "portfolio-api") | .spec.ingress[] |
      select(any(.ports[]?; .port == $own.networkPolicy.portfolio.metricsPort)) | .from] ==
    [[{namespaceSelector: {matchLabels: {"kubernetes.io/metadata.name": $ns}},
       podSelector: {matchLabels: $own.pods.prometheus}}]]')" == true ]] ||
    fail "production's API metrics rule must admit exactly the $namespace namespace's Prometheus pods"
else
  fail "the production portfolio NetworkPolicies $api_policy"
fi

# The local stack (compose.observability.yaml, P9-08) runs exactly the cluster's images.
echo "== local stack images"
if ! compose_images="$(yq '.services[].image' "$root/compose.observability.yaml")"; then
  fail "can't read compose.observability.yaml"
else
  for image in $compose_images; do
    digest="${image##*@}"
    [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || { fail "local stack image $image has no digest"; continue; }
    # Repository and digest must match (the digest is what runs). The tag isn't compared: some
    # charts render the image by digest alone, without one.
    repository="${image%@*}"
    repository="${repository%:*}"
    repository="${repository#docker.io/}"
    grep -qxE "(docker\.io/)?${repository//./\\.}(:[^@]+)?@$digest" "$work/images" ||
      fail "local stack image $image isn't one the cluster's charts render"
  done
fi

# Prometheus reaches the API pods by the labels the portfolio chart gives them.
echo "== portfolio API pod labels"
if portfolio="$(render portfolio "$root/infrastructure/helm/portfolio" \
  -f "$root/infrastructure/helm/portfolio/ci/digests-values.yaml" -s templates/api.yaml)"; then
  [[ "$(to_json <<<"$portfolio" | jq --argjson own "$own_values" "$exact_labels"'[.[] |
    select(.kind == "Deployment") | .spec.template.metadata.labels |
    has_labels($own.networkPolicy.portfolio.apiPodLabels)] | any')" == true ]] ||
    fail "networkPolicy.portfolio.apiPodLabels don't match the portfolio API pods"
else
  fail "the portfolio API $portfolio"
fi

if ((failures > 0)); then
  echo "$failures monitoring check(s) failed" >&2
  exit 1
fi
echo "monitoring checks passed"
