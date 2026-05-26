#!/usr/bin/env bash
# Prune GitHub topics to the highest-signal five.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; cd "$HERE"
set -a; source .env.launch; set +a

TOPICS='["mcp","ai-agents","data-visualization","grammar-of-graphics","duckdb"]'

echo "Setting topics on $REPO_SLUG to: $TOPICS"
if [[ "${DRY_RUN:-true}" == "true" ]]; then
  echo "(DRY_RUN) skipped"
  exit 0
fi

gh api -X PUT "/repos/$REPO_SLUG/topics" \
  -H "Accept: application/vnd.github.mercy-preview+json" \
  -f "names[]=mcp" -f "names[]=ai-agents" -f "names[]=data-visualization" \
  -f "names[]=grammar-of-graphics" -f "names[]=duckdb"

echo "done."
