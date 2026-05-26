#!/usr/bin/env bash
# Open the five pre-written "good first issue" tickets.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; cd "$HERE"
set -a; source .env.launch; set +a

TEMPLATES=(
  "../../.github/issue-templates/good-first-issue-1.yml"
  "../../.github/issue-templates/good-first-issue-2.yml"
  "../../.github/issue-templates/good-first-issue-3.yml"
  "../../.github/issue-templates/good-first-issue-4.yml"
  "../../.github/issue-templates/good-first-issue-5.yml"
)

for tpl in "${TEMPLATES[@]}"; do
  [[ -f "$tpl" ]] || { echo "missing $tpl"; continue; }
  title=$(python3 -c "import yaml,sys; print(yaml.safe_load(open('$tpl'))['title'])")
  body=$(python3 -c "import yaml,sys; print(yaml.safe_load(open('$tpl'))['body'])")
  if [[ "${DRY_RUN:-true}" == "true" ]]; then
    echo "(DRY_RUN) would create issue: $title"
    continue
  fi
  gh issue create -R "$REPO_SLUG" -t "$title" -b "$body" -l "good first issue,help wanted"
done
