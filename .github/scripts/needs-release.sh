#!/usr/bin/env bash
# needs-release.sh <head-sha> [<latest-ref>]: prints `true` when the api or worker image may differ
# from the last release, `false` when every change since then is one no image is built from
# (P7-10). Run from a full clone. Any doubt answers `true`.
#
# The last release is the `# source-commit:` that images.yaml pins. It's read from <latest-ref>
# (default `origin/main`, which may already hold a newer pin than <head-sha>'s own tree, when a
# release finished while this merge waited) if that pin is an ancestor of <head-sha>, else from
# <head-sha> itself.
set -euo pipefail

head="$1"
latest="${2:-origin/main}"
pins=infrastructure/environments/production/images.yaml

pinned_at() { # pinned_at <ref>: the source commit images.yaml pins there, or nothing
  git show "$1:${pins}" 2>/dev/null | sed -n 's/^# source-commit: \([0-9a-f]\{40\}\)$/\1/p' || true
}
is_ancestor() { git merge-base --is-ancestor "$1" "$2" 2>/dev/null; }

# A commit that changes only the pin file is a hand-made pin, such as reverting a release to roll
# back (the release's own commits never trigger CI). Rebuilding would undo it, so leave it alone.
if parent="$(git rev-parse --verify --quiet "${head}^")" &&
  head_changes="$(git diff --name-only --no-renames "$parent" "$head")" &&
  [[ "$head_changes" == "$pins" ]]; then
  echo false
  exit 0
fi

pinned="$(pinned_at "$latest")"
if [[ -z "$pinned" ]] || ! is_ancestor "$pinned" "$head"; then
  pinned="$(pinned_at "$head")"
fi
if [[ -z "$pinned" ]] || ! is_ancestor "$pinned" "$head"; then
  echo true
  exit 0
fi

# Captured first, so a failing diff stops the script instead of reading as "no changes".
# --no-renames lists both sides of a move: a file moved out of an image still counts.
if ! changed="$(git diff --name-only --no-renames "$pinned" "$head")"; then
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
done <<<"$changed"
echo false
