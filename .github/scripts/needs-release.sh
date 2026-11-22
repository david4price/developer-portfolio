#!/usr/bin/env bash
# needs-release.sh <head-sha>: prints `true` when the api or worker image may differ from the last
# release, `false` when every change since then is one no image is built from (P7-10). Run from a
# full clone. The last release is the `# source-commit:` that images.yaml pins at <head-sha>; when
# it's missing or not an ancestor, it answers `true`, so a doubt always means a release.
set -euo pipefail

head="$1"
pins=infrastructure/environments/production/images.yaml

pinned="$(git show "${head}:${pins}" 2>/dev/null | sed -n 's/^# source-commit: \([0-9a-f]\{40\}\)$/\1/p' || true)"
if [[ -z "$pinned" ]] || ! git merge-base --is-ancestor "$pinned" "$head" 2>/dev/null; then
  echo true
  exit 0
fi

# Paths that never reach the api or worker image (each keeps only its own app's build output):
# docs and Markdown anywhere, agent instructions, the static site (Cloudflare Pages builds it),
# the load-test scripts, and the pin file itself (the release's own commits).
while IFS= read -r path; do
  [[ -z "$path" ]] && continue
  case "$path" in
    "$pins" | docs/* | *.md | .agents/* | .claude/* | apps/web/* | infrastructure/load-tests/*) ;;
    *)
      echo true
      exit 0
      ;;
  esac
done < <(git diff --name-only "$pinned" "$head")
echo false
