#!/usr/bin/env bash
# Checks the Phase 9 monitoring stack without touching a cluster (ADR 0004):
#   - every Application in infrastructure/argocd/monitoring stays inside the `monitoring` project
#     (sources listed there, one destination namespace) and pins its chart to an exact version;
#   - each upstream chart archive matches the sha256 recorded on its Application;
#   - every chart renders with its production values, passes kubeconform, and holds to the
#     guardrails in check_manifests.
# Needs `helm`, `kubeconform`, `yq` (mikefarah, v4), and network access to the chart repositories.
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

# docs <jq filter>: runs the filter over the YAML documents on stdin as one JSON array (yq only
# converts; jq evaluates, since yq's multi-document semantics differ from jq's).
docs() {
  yq ea -o=json '[.] | map(select(. != null))' | jq -r "$1"
}

# render <helm template args…>: prints the manifests, or the reason and status 1 when the chart
# fails to render or renders nothing (an empty render would pass every guardrail). Runs in a
# command substitution, so the caller records the failure.
render() {
  local output
  if ! output="$(helm template "$@" --namespace "$namespace" 2>&1)"; then
    printf "doesn't render: %s\n" "$output"
    return 1
  elif [[ -z "$(docs '.[] | .kind' <<<"$output")" ]]; then
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

# check_manifests <name> <manifests>: guardrails for everything deployed into the namespace.
check_manifests() {
  local name="$1" manifests="$2" kind found
  kubeconform -strict -summary -output text <<<"$manifests"

  # Only kinds the project allows (so no ClusterRole, Ingress, or Secret), all in the namespace.
  while read -r kind; do
    grep -qxF "$kind" <<<"$allowed_kinds" ||
      fail "$name renders $kind, which the monitoring project doesn't allow"
  done < <(docs '.[] | (.apiVersion | sub("/?v[0-9][^/]*$"; "")) + "/" + .kind' <<<"$manifests" |
    sort -u)
  found="$(docs '.[] | select((.metadata.namespace // "'"$namespace"'") != "'"$namespace"'") |
    .kind + "/" + .metadata.name' <<<"$manifests")"
  [[ -z "$found" ]] || fail "$name renders resources outside $namespace: $found"

  # Nothing published outside the cluster.
  found="$(docs '.[] | select(.kind == "Service" and (.spec.type // "ClusterIP") != "ClusterIP") |
    .metadata.name' <<<"$manifests")"
  [[ -z "$found" ]] || fail "$name renders a NodePort or LoadBalancer Service: $found"

  # Pods: no host access, every image pinned by digest, every container with resource requests.
  local pods='.[] | select(.spec.template.spec != null)'
  local containers="$pods"' | .spec.template.spec | (.containers // []) + (.initContainers // []) | .[]'
  found="$(docs "$pods"' | select(.spec.template.spec | .hostNetwork or .hostPID or .hostIPC or
    any(.volumes[]?; .hostPath != null)) | .kind + "/" + .metadata.name' <<<"$manifests")"
  [[ -z "$found" ]] || fail "$name renders host namespaces or hostPath volumes: $found"
  found="$(docs "$containers"' | select(.securityContext.privileged) | .name' <<<"$manifests")"
  [[ -z "$found" ]] || fail "$name renders a privileged container: $found"
  found="$(docs "$containers"' | select(.image | test("@sha256:[0-9a-f]{64}$") | not) | .image' \
    <<<"$manifests")"
  [[ -z "$found" ]] || fail "$name renders an image without a sha256 digest: $found"
  found="$(docs "$containers"' | select(.resources.requests == null) | .name' <<<"$manifests")"
  [[ -z "$found" ]] || fail "$name renders a container without resource requests: $found"
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
  while read -r repo; do
    grep -qxF "$repo" <<<"$source_repos" ||
      fail "$name: source $repo isn't listed in the monitoring project"
  done < <(yq '.spec.sources[].repoURL' "$app")

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
# Grafana: no ingress until P9-05 sets the tailnet proxy's range, no internet until alerts.
policies="$(render monitoring "$own_chart" -f "$own_chart/ci/default-values.yaml" \
  -s templates/networkpolicies.yaml)" || fail "the NetworkPolicies $policies"
[[ "$(docs '.[] | select(.metadata.name == "monitoring-grafana") | .spec.ingress // [] | length' \
  <<<"$policies")" == 0 ]] || fail "Grafana allows ingress with no ingressCidrs"
[[ "$(docs '[.[] | select(.metadata.name == "monitoring-grafana") | .spec.egress[].to[] |
  select(.ipBlock != null)] | length' <<<"$policies")" == 0 ]] ||
  fail "Grafana has internet egress with alerts off"
# Every pod in the namespace is covered by the default deny.
[[ "$(docs '.[] | select(.metadata.name == "monitoring-default-deny") | .spec.podSelector == {} and
  (.spec.policyTypes | contains(["Ingress", "Egress"]))' <<<"$policies")" == true ]] ||
  fail "the default-deny policy must select every pod for ingress and egress"

if ((failures > 0)); then
  echo "$failures monitoring check(s) failed" >&2
  exit 1
fi
echo "monitoring checks passed"
