#!/usr/bin/env bash
# Scans files that would be committed (tracked + untracked, excluding git-ignored) for private
# infrastructure details. Exits 1 when anything is found, 2 when the scan itself fails.
#
# Generic checks: private/CGNAT IPv4 host addresses, email addresses, *.lan and *.ts.net hostnames.
# Owner-specific checks: fixed strings, one per line, from a denylist kept OUTSIDE the repository:
#   ${PORTFOLIO_PRIVATE_DENYLIST:-$HOME/.config/developer-portfolio/private-denylist.txt}
set -euo pipefail

root="$(git -C "${1:-.}" rev-parse --show-toplevel)"
cd "$root"
denylist="${PORTFOLIO_PRIVATE_DENYLIST:-$HOME/.config/developer-portfolio/private-denylist.txt}"

files=()
while IFS= read -r -d '' file; do
  case "$file" in
    pnpm-lock.yaml | */drizzle/meta/*) continue ;;
  esac
  [[ -f "$file" ]] && files+=("$file")
done < <(git ls-files --cached --others --exclude-standard -z)

# Prints `file:line:match` for each match. grep exits 1 for "no match"; anything above is an error
# and must fail the scan rather than read as clean.
matches() {
  local output status=0
  output="$(grep -I -n -o "$@" -- "${files[@]}")" || status=$?
  if ((status > 1)); then
    printf 'privacy scan failed: grep exited %d\n' "$status" >&2
    exit 2
  fi
  [[ -n "$output" ]] && printf '%s\n' "$output"
  return 0
}

findings=0
report() {
  printf '%s %s\n' "$1" "$2"
  findings=1
}

# Host addresses in private and CGNAT ranges. Network addresses ending in .0.0 (CIDR examples such
# as the K3s defaults) are allowed.
ip_pattern='\b(10\.[0-9]{1,3}|172\.(1[6-9]|2[0-9]|3[01])|192\.168|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7]))\.[0-9]{1,3}\.[0-9]{1,3}\b'
while IFS= read -r match; do
  [[ -z "$match" || "$match" =~ \.0\.0$ ]] && continue
  report 'private address:' "$match"
done <<<"$(matches -E -e "$ip_pattern")"

while IFS= read -r match; do
  [[ -z "$match" || "$match" =~ (noreply@|@example\.(com|org|net)$|git@github\.com) ]] && continue
  report 'email address:' "$match"
done <<<"$(matches -E -e '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}')"

while IFS= read -r match; do
  [[ -z "$match" ]] && continue
  report 'private hostname:' "$match"
done <<<"$(matches -E -i -e '\b[a-z0-9-]+\.(lan|ts\.net)\b')"

if [[ -f "$denylist" ]]; then
  patterns="$(grep -vE '^[[:space:]]*(#|$)' "$denylist" || true)"
  if [[ -n "$patterns" ]]; then
    while IFS= read -r match; do
      [[ -z "$match" ]] && continue
      report 'denylisted term:' "$match"
    done <<<"$(matches -i -F -f <(printf '%s\n' "$patterns"))"
  fi
else
  printf 'note: no private denylist at %s; ran generic checks only\n' "$denylist" >&2
fi

if ((findings == 0)); then
  printf 'privacy scan: clean (%d files)\n' "${#files[@]}"
fi
exit "$findings"
