#!/usr/bin/env bash
# Publish a markdown file to dev.to as a draft. Add --publish to publish immediately.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; cd "$HERE"
set -a; source .env.launch; set +a

FILE="${1:?Usage: post_devto.sh <markdown-file> [--publish]}"
PUBLISH=false
[[ "${2:-}" == "--publish" ]] && PUBLISH=true

[[ -z "${DEVTO_API_KEY:-}" ]] && { echo "DEVTO_API_KEY missing"; exit 1; }
[[ -f "$FILE" ]] || { echo "File not found: $FILE"; exit 1; }

# Front-matter (--- … ---) is honored by dev.to: title, description, tags, canonical_url.
BODY="$(cat "$FILE")"

PAYLOAD=$(jq -n --arg body "$BODY" --argjson published "$PUBLISH" \
  '{article: {body_markdown: $body, published: $published}}')

if [[ "${DRY_RUN:-true}" == "true" ]]; then
  echo "(DRY_RUN) would POST to dev.to with $(echo "$PAYLOAD" | wc -c) bytes; published=$PUBLISH"
  exit 0
fi

curl -fsS -X POST https://dev.to/api/articles \
  -H "api-key: $DEVTO_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" | jq '{id, url, published, title}'
