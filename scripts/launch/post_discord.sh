#!/usr/bin/env bash
# Fan-out a message to multiple Discord channels via webhooks.
# Usage: post_discord.sh --channels=anthropic,mcp,duckdb --message-file templates/discord-week2.md
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; cd "$HERE"
set -a; source .env.launch; set +a

CHANNELS=""
MSG_FILE=""
for arg in "$@"; do
  case "$arg" in
    --channels=*) CHANNELS="${arg#*=}";;
    --message-file) shift; MSG_FILE="$1";;
    --message-file=*) MSG_FILE="${arg#*=}";;
  esac
done

[[ -z "$CHANNELS" || -z "$MSG_FILE" ]] && {
  echo "Usage: post_discord.sh --channels=anthropic,mcp --message-file <path>"
  exit 1
}

MESSAGE="$(cat "$MSG_FILE")"

IFS=',' read -r -a chan_arr <<< "$CHANNELS"
for c in "${chan_arr[@]}"; do
  var="DISCORD_WEBHOOK_$(echo "$c" | tr a-z A-Z)"
  url="${!var:-}"
  if [[ -z "$url" ]]; then
    echo "skip $c (no $var configured)"
    continue
  fi
  if [[ "${DRY_RUN:-true}" == "true" ]]; then
    echo "(DRY_RUN) would POST to $c webhook ($(echo "$MESSAGE" | wc -c) bytes)"
    continue
  fi
  # Discord limits content to 2000 chars.
  payload=$(jq -n --arg content "$MESSAGE" '{content: $content}')
  curl -fsS -X POST "$url" -H "Content-Type: application/json" -d "$payload" \
    && echo "ok: $c" || echo "fail: $c"
  sleep 1
done
