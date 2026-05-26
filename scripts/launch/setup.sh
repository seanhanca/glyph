#!/usr/bin/env bash
# setup.sh — verify environment before running any launch scripts.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow(){ printf '\033[33m%s\033[0m\n' "$*"; }

need_bin() {
  if ! command -v "$1" >/dev/null 2>&1; then
    red "missing: $1"
    return 1
  fi
  green "ok: $1 ($(command -v "$1"))"
}

green "==> Checking binaries"
hard_fail=0
HARD=(jq curl python3 node ffmpeg)
SOFT=(gh)
for bin in "${HARD[@]}"; do
  need_bin "$bin" || hard_fail=1
done
for bin in "${SOFT[@]}"; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    yellow "warn: $bin not installed (needed for real GitHub PR/issue operations)"
    yellow "      on macOS: brew install $bin && gh auth login"
  else
    green "ok: $bin"
  fi
done
if [[ $hard_fail -ne 0 ]]; then
  red ""
  red "Install missing required tools first. On macOS:"
  red "  brew install jq ffmpeg python node"
  exit 1
fi

green ""
green "==> Checking .env.launch"
if [[ ! -f .env.launch ]]; then
  red ".env.launch not found. cp .env.launch.example .env.launch and fill it in."
  exit 1
fi
# shellcheck disable=SC1091
set -a; source .env.launch; set +a

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  yellow "warn: GITHUB_TOKEN not set in .env.launch (required before flipping DRY_RUN=false)"
fi
if [[ -z "${REPO_SLUG:-}" ]]; then
  yellow "warn: REPO_SLUG not set (will fall back to current repo's remote)"
fi
green "ok: .env.launch loaded"

green ""
green "==> Checking GitHub auth"
if command -v gh >/dev/null 2>&1; then
  if gh auth status >/dev/null 2>&1; then
    green "ok: gh auth status"
  elif [[ -n "${GITHUB_TOKEN:-}" ]] && GH_TOKEN="$GITHUB_TOKEN" gh auth status >/dev/null 2>&1; then
    green "ok: gh auth via GITHUB_TOKEN"
  else
    yellow "gh not authenticated. Run: gh auth login  (or set GITHUB_TOKEN in .env.launch)"
  fi
else
  yellow "skipping gh auth check (gh not installed in this environment)"
fi

green ""
green "==> Python deps"
python3 -m pip install --user --quiet --break-system-packages \
  pyyaml feedparser anthropic requests jinja2 2>/dev/null || \
  python3 -m pip install --user --quiet \
    pyyaml feedparser anthropic requests jinja2
green "ok: python deps installed"

green ""
green "All checks passed. You're ready to run:"
green "  ./orchestrate.sh week1"
green ""
yellow "Reminder: DRY_RUN=${DRY_RUN:-true}. Flip to 'false' in .env.launch when you want real posts."
