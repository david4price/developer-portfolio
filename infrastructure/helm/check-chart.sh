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
done

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
expect_failure 'api.ai.model is required' \
  -f "$chart/ci/ai-enabled-values.yaml" --set api.ai.model=
expect_failure 'postgres.auth.existingSecret is required' \
  -f "$chart/ci/digests-values.yaml" --set postgres.auth.existingSecret=

if ((failures > 0)); then
  echo "$failures check(s) failed" >&2
  exit 1
fi
echo "chart checks passed"
