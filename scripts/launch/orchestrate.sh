#!/usr/bin/env bash
# orchestrate.sh — single entry point for the Glyph launch.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"
set -a; source .env.launch; set +a

cmd="${1:-help}"

log() { printf '\033[36m[orchestrate]\033[0m %s\n' "$*"; }

run() {
  log "→ $*"
  if [[ "${DRY_RUN:-true}" == "true" ]]; then
    log "  (DRY_RUN) skipped"
  else
    "$@"
  fi
}

queue_chrome() {
  # Append a Claude-in-Chrome action to the queue.
  local kind="$1" payload="$2"
  python3 - <<PY
import json, os, datetime
path = "chrome_queue.json"
q = json.load(open(path)) if os.path.exists(path) else []
q.append({"kind": "$kind", "payload": $payload, "queued_at": datetime.datetime.utcnow().isoformat()+"Z"})
json.dump(q, open(path,"w"), indent=2)
print(f"queued {q[-1]['kind']}")
PY
}

case "$cmd" in
  week1)
    log "Week 1 — Front door"
    run ./update_topics.sh
    run ./submit_awesome_lists.sh
    run ./generate_hero_clip.sh
    log "Drafting X thread"
    python3 -c "
import json
draft = open('templates/x-thread-week1.md').read()
print('Thread draft:\\n', draft)
"
    queue_chrome "x_thread" "{\"draft_file\": \"templates/x-thread-week1.md\"}"
    queue_chrome "linkedin_post" "{\"draft_file\": \"templates/linkedin-week1.md\"}"
    run python3 influencer_engine.py --mode bootstrap
    log "Week 1 dispatched. Check chrome_queue.json for approvals."
    ;;

  week2)
    log "Week 2 — Show, don't tell"
    run ./render_hero_demos.sh
    run ./post_devto.sh templates/devto-two-agents.md
    run ./post_hashnode.sh templates/devto-two-agents.md
    run ./post_medium.sh templates/devto-two-agents.md
    run ./post_discord.sh --channels=anthropic,mcp,langchain,crewai,duckdb,aiengineer,llamaindex \
       --message-file templates/discord-week2.md
    run ./upload_youtube_short.sh out/demo-a.mp4 "Two AI agents fix a chart together"
    queue_chrome "reddit_reply" "{\"subreddits\": [\"LocalLLaMA\", \"ChatGPTCoding\", \"dataisbeautiful\", \"MachineLearning\", \"Python\"], \"draft_file\": \"templates/reddit-week2.md\"}"
    run python3 influencer_engine.py --mode followup
    ;;

  week3)
    log "Week 3 — Plug into agent ecosystems"
    run ./submit_plugins.sh   # Anthropic, Codex, Gemini via gh; Cursor goes to chrome_queue
    run ./pr_langchain.sh
    run ./pr_crewai.sh
    run ./pr_llamaindex.sh
    run ./send_newsletter_pitches.sh
    run python3 influencer_engine.py --mode amplify
    ;;

  week4)
    log "Week 4 — Show HN + flywheel"
    run ./post_devto.sh templates/essay-agent-native-viz.md
    run ./post_hashnode.sh templates/essay-agent-native-viz.md
    run ./post_medium.sh templates/essay-agent-native-viz.md
    queue_chrome "show_hn" "{\"title\": \"Show HN: Glyph — deterministic, MCP-native charts for AI agents (AI-built and AI-maintained)\", \"url\": \"https://github.com/$REPO_SLUG\", \"comment_zero_file\": \"templates/hn-comment-zero.md\"}"
    run ./open_good_first_issues.sh
    run ./submit_product_hunt.sh
    run ./open_office_hour_discussion.sh
    run python3 weekly_metrics.py --update-readme
    ;;

  influencers)
    log "Influencer engine (daily)"
    run python3 influencer_engine.py --mode daily
    run python3 send_influencer_emails.py
    ;;

  health)
    log "Health check"
    run ./setup.sh
    run python3 weekly_metrics.py --print
    log "Chrome queue length:"
    python3 -c "import json,os; q=json.load(open('chrome_queue.json')) if os.path.exists('chrome_queue.json') else []; print(f'  {len(q)} pending')"
    ;;

  *)
    cat <<EOF
Usage: ./orchestrate.sh <command>

  week1        Front door (README, topics, awesome-list PRs, X thread)
  week2        Hero demos + cross-posts + Discord fan-out
  week3        Plugin marketplaces + framework PRs + newsletter pitches
  week4        Show HN + essay + good-first-issues + Product Hunt
  influencers  Daily influencer monitor + cold emails
  health       Verify environment and report status

Flip DRY_RUN=false in .env.launch when you're ready to execute for real.
EOF
    exit 1
    ;;
esac
