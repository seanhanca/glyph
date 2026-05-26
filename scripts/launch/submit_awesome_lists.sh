#!/usr/bin/env bash
# Fork-and-PR pattern for awesome-* lists.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; cd "$HERE"
set -a; source .env.launch; set +a

BLURB_FILE="templates/awesome-blurb.md"
[[ -f "$BLURB_FILE" ]] || { echo "Missing $BLURB_FILE"; exit 1; }
BLURB="$(cat "$BLURB_FILE")"

# repo:filepath:section-marker
TARGETS=(
  "punkpeye/awesome-mcp-servers:README.md:## Visualization"
  "hesreallyhim/awesome-claude-code:README.md:## MCP Servers"
  "Shubhamsaboo/awesome-llm-apps:README.md:## AI Agent Tools"
  "krzemienski/awesome-data-visualization:README.md:## JavaScript Libraries"
  "davified/awesome-duckdb:README.md:## Tools"
  "markusschanta/awesome-jupyter:README.md:## Visualization"
)

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

for entry in "${TARGETS[@]}"; do
  IFS=":" read -r repo file marker <<< "$entry"
  echo ""
  echo "=== $repo ==="
  if [[ "${DRY_RUN:-true}" == "true" ]]; then
    echo "(DRY_RUN) would fork, edit $file under '$marker', open PR"
    continue
  fi
  (
    cd "$WORKDIR"
    gh repo fork "$repo" --clone --remote=false 2>/dev/null || gh repo fork "$repo" --clone
    name="${repo##*/}"
    cd "$name"
    branch="add-glyph-$(date +%Y%m%d)"
    git checkout -b "$branch"

    # Insert blurb after the section marker.
    python3 - "$file" "$marker" "$BLURB" <<'PY'
import sys, pathlib
path, marker, blurb = sys.argv[1], sys.argv[2], sys.argv[3]
p = pathlib.Path(path)
text = p.read_text()
if marker not in text:
    # Fall back: append to the file
    text = text.rstrip() + "\n\n" + marker + "\n" + blurb + "\n"
else:
    text = text.replace(marker, marker + "\n" + blurb, 1)
p.write_text(text)
print(f"patched {path}")
PY
    git add "$file"
    git -c "user.name=Cowork" -c "user.email=launch@glyph" \
        commit -m "Add Glyph: deterministic, MCP-native charts for AI agents"
    git push -u origin "$branch"
    gh pr create --repo "$repo" --base main --head "$(gh api /user -q .login):$branch" \
      --title "Add Glyph: deterministic, MCP-native charts for AI agents" \
      --body "$BLURB

> This PR was opened by Cowork on behalf of the Glyph maintainers as part of an AI-managed launch. The library itself is AI-built and AI-maintained; details: https://github.com/$REPO_SLUG"
  )
done
echo ""
echo "All PRs opened."
