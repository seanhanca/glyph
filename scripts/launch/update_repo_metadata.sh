#!/usr/bin/env bash
# update_repo_metadata.sh — sets the repo description + homepage URL.
#
# The plan's update_topics.sh handles the topic list. This script
# handles the other two metadata fields that surface to influencers
# inside 30 seconds of arriving at the repo: the one-line description
# under the repo title and the homepage URL under "About".
#
# Idempotent. Safe to re-run after each PR if the description drifts.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; cd "$HERE"
set -a; source .env.launch; set +a

DESCRIPTION="Deterministic, MCP-native charts for AI agents — AI-built, AI-maintained. 52 verbs, byte-stable SVG, DuckDB inside."
HOMEPAGE="https://seanhanca.github.io/glyph/"

echo "Updating metadata on $REPO_SLUG:"
echo "  description: $DESCRIPTION"
echo "  homepage:    $HOMEPAGE"

if [[ "${DRY_RUN:-true}" == "true" ]]; then
  echo "(DRY_RUN) skipped"
  exit 0
fi

gh api -X PATCH "/repos/$REPO_SLUG" \
  -H "Accept: application/vnd.github+json" \
  -f "description=$DESCRIPTION" \
  -f "homepage=$HOMEPAGE" >/dev/null

echo "done."
