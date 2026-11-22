#!/usr/bin/env bash
# Tests needs-release.sh against a throwaway git repository. Run: bash .github/scripts/needs-release.test.sh
set -euo pipefail

script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/needs-release.sh"
repo="$(mktemp -d)"
trap 'rm -rf "$repo"' EXIT
cd "$repo"
git init -q -b main
git config user.email test@example.com
git config user.name test
pins=infrastructure/environments/production/images.yaml
failures=0

commit() { # commit <path> [content]: writes the file and commits it; prints the new SHA
  mkdir -p "$(dirname "$1")"
  echo "${2:-$RANDOM}" >>"$1"
  git add -A
  git commit -qm "change $1"
  git rev-parse HEAD
}
pin() { # pin <sha>: a release commit, as release.yml writes it
  mkdir -p "$(dirname "$pins")"
  printf '# Generated\n# source-commit: %s\napi: {}\n' "$1" >"$pins"
  git add -A
  git commit -qm "chore(release): pin images for ${1::7}"
}
expect() { # expect <answer> <head> <label>
  local got
  got="$(bash "$script" "$2")"
  if [[ "$got" != "$1" ]]; then
    echo "FAIL: $3: expected $1, got $got" >&2
    failures=$((failures + 1))
  else
    echo "ok: $3"
  fi
}

base="$(commit apps/api/src/main.ts)"
expect true "$base" 'no pin file yet'
pin "$base"
expect false "$(git rev-parse HEAD)" 'only the release commit since'
expect false "$(commit docs/guide.md)" 'docs only'
expect false "$(commit README.md)" 'Markdown at the root'
expect false "$(commit .agents/skills/x/SKILL.md)" 'agent instructions'
expect false "$(commit apps/web/src/page.tsx)" 'the static site only'
expect false "$(commit infrastructure/load-tests/read-path.js)" 'load-test scripts only'
expect true "$(commit apps/api/src/app.ts)" 'API code'
pin "$(git rev-parse HEAD)"
expect true "$(commit pnpm-lock.yaml)" 'the lockfile'
pin "$(git rev-parse HEAD)"
expect true "$(commit infrastructure/helm/portfolio/values.yaml)" 'the chart'
pin "$(git rev-parse HEAD)"
expect true "$(commit infrastructure/docker/node-service.Dockerfile)" 'a Dockerfile'
pin "$(git rev-parse HEAD)"
commit docs/a.md >/dev/null
expect true "$(commit packages/config/src/index.ts)" 'docs and code together'

# A pinned commit that isn't an ancestor (history rewritten): release, to be safe.
pin "$(printf '%040d' 0)"
expect true "$(commit docs/b.md)" 'pinned commit not an ancestor'

if ((failures > 0)); then
  echo "$failures check(s) failed" >&2
  exit 1
fi
echo 'needs-release checks passed'
