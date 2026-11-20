#!/usr/bin/env bash
# Lints and renders the portfolio chart, validates the manifests against Kubernetes schemas, and
# checks the chart's guardrails. Needs `helm` and `kubeconform` on PATH; touches no cluster.
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

  # API metrics stay on the pod's loopback (P7-01): never bound wider, and never a port of a
  # container, Service, or NetworkPolicy (the default metricsPort is 9464).
  if grep -qE 'API_METRICS_HOST|port: 9464$' <<<"$manifests"; then
    fail "$name exposes the API metrics port"
  fi
done

# Production values on top of CI placeholders; images.yaml exists after the first release.
echo "== environments/production"
production="$(cd "$chart/../../environments/production" && pwd)"
production_args=(-f "$chart/ci/digests-values.yaml" -f "$production/values.yaml")
if [[ -f "$production/images.yaml" ]]; then
  production_args+=(-f "$production/images.yaml")
fi
helm lint --strict "$chart" "${production_args[@]}"
kubeconform -strict -summary -output text <<<"$(render "${production_args[@]}")"

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
# No template anywhere may render cluster-wide RBAC, with the view on or off.
for values in "$chart/ci/infrastructure-values.yaml" "$chart/ci/digests-values.yaml"; do
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
