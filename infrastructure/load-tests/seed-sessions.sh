#!/usr/bin/env bash
# P7-02: seeds <count> empty chat sessions into the throwaway chat stack's Redis and prints their
# IDs, comma-separated, for chat.js's SESSIONS. The rest of the arguments are the stack's Compose
# command, e.g.:
#   seed-sessions.sh 8 docker compose -p <name> --env-file <env> -f compose.full.yaml \
#     -f infrastructure/load-tests/compose.chat.yaml > sessions
# The format follows apps/api/src/modules/chat/redis-chat-session.store.ts: key
# portfolio:chat:session:<43-character base64url id>, JSON {expiresAt, history}, with a TTL.
set -euo pipefail
count="$1"
shift
# Node.js (required by the repository) rather than `date -d`, which only GNU date has.
expires="$(node -e 'console.log(new Date(Date.now() + 7_200_000).toISOString())')"
ids=()
for _ in $(seq 1 "$count"); do
  id="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')"
  reply="$("$@" exec -T redis redis-cli SET "portfolio:chat:session:$id" \
    "{\"expiresAt\":\"$expires\",\"history\":[]}" EX 7200 NX)"
  if [[ "$reply" != "OK" ]]; then
    echo "seeding session failed: Redis replied '$reply'" >&2
    exit 1
  fi
  ids+=("$id")
done
(IFS=,; echo "${ids[*]}")
