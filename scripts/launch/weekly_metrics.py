#!/usr/bin/env python3
"""
weekly_metrics.py — read live counts from GitHub + npm + Cowork's
action logs, append to ../../data/metrics.csv, emit
.metrics.json that maintenance.html consumes on page load, and (when
the launch-toolkit chart helper is wired) render a Glyph chart of
the launch progress for the README banner.

Idempotent. Safe to re-run every day. The orchestrator calls this at
the end of every cycle.

Reads from .env.launch:
  GITHUB_TOKEN              for higher rate limits
  REPO_SLUG                 e.g. seanhanca/glyph
  NPM_PACKAGE_CORE          @glyph/core (optional, defaults shown)
  NPM_PACKAGE_MCP           @glyph/mcp

Writes:
  scripts/launch/.metrics.json     — consumed by site/maintenance.html
  data/metrics.csv                 — append-only time series
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent.parent
ENV_PATH = HERE / ".env.launch"
METRICS_JSON = HERE / ".metrics.json"
METRICS_CSV = REPO_ROOT / "data" / "metrics.csv"
TRIAGE_LOG = HERE / ".triage.json"
POSTS_LOG = HERE / ".posts.json"
QUEUE_PATH = HERE / "chrome_queue.json"


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    if not ENV_PATH.exists():
        return env
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def gh_get(path: str, token: str | None = None) -> dict | list:
    """Minimal GitHub REST GET. Returns parsed JSON or {}."""
    url = f"https://api.github.com{path}"
    req = urllib.request.Request(url)
    if token:
        req.add_header("Authorization", f"token {token}")
    req.add_header("Accept", "application/vnd.github+json")
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError):
        return {}


def npm_downloads(package: str) -> int:
    """Last-week npm download count for a package. 0 on any failure."""
    safe = package.replace("/", "%2F").replace("@", "%40")
    url = f"https://api.npmjs.org/downloads/point/last-week/{safe}"
    try:
        with urllib.request.urlopen(url, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return int(data.get("downloads", 0))
    except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError, ValueError):
        return 0


def read_local_json(path: Path) -> dict | list | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError:
        return None


def main() -> int:
    env = load_env()
    token = env.get("GITHUB_TOKEN") or os.environ.get("GITHUB_TOKEN")
    repo_slug = env.get("REPO_SLUG", "seanhanca/glyph")
    pkg_core = env.get("NPM_PACKAGE_CORE", "@glyph/core")
    pkg_mcp = env.get("NPM_PACKAGE_MCP", "@glyph/mcp")

    # ── GitHub ─────────────────────────────────────────────────
    repo = gh_get(f"/repos/{repo_slug}", token)
    stars = repo.get("stargazers_count", 0) if isinstance(repo, dict) else 0
    forks = repo.get("forks_count", 0) if isinstance(repo, dict) else 0
    open_issues = repo.get("open_issues_count", 0) if isinstance(repo, dict) else 0

    # contributor count — list endpoint, capped at 100 in one call (good enough at launch scale)
    contribs = gh_get(f"/repos/{repo_slug}/contributors?per_page=100", token)
    contributors = len(contribs) if isinstance(contribs, list) else 0

    # ── npm ────────────────────────────────────────────────────
    core_dl = npm_downloads(pkg_core)
    mcp_dl = npm_downloads(pkg_mcp)

    # ── Cowork action logs (local, written by other launch scripts) ──
    triage = read_local_json(TRIAGE_LOG) or []
    posts = read_local_json(POSTS_LOG) or []
    queue = read_local_json(QUEUE_PATH) or []

    # filter to last 7 days
    now = datetime.now(timezone.utc)
    seven_days_ago = now.timestamp() - 7 * 86400

    def is_recent(item: dict) -> bool:
        ts = item.get("at") or item.get("timestamp") or 0
        if isinstance(ts, str):
            try:
                ts = datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
            except ValueError:
                return False
        return float(ts) >= seven_days_ago

    triage_count = sum(1 for x in (triage or []) if isinstance(x, dict) and is_recent(x))
    pr_review_count = sum(
        1 for x in (triage or []) if isinstance(x, dict) and x.get("kind") == "pr-review" and is_recent(x)
    )
    posts_count = sum(1 for x in (posts or []) if isinstance(x, dict) and is_recent(x))
    queue_count = len(queue) if isinstance(queue, list) else 0

    # ── Compose the snapshot ───────────────────────────────────
    snapshot = {
        "generated_at": now.isoformat(),
        "repo_slug": repo_slug,
        "github": {
            "stars": stars,
            "forks": forks,
            "open_issues": open_issues,
            "contributors": contributors,
        },
        "npm": {
            "core_weekly_downloads": core_dl,
            "mcp_weekly_downloads": mcp_dl,
        },
        "cowork": {
            "issues_triaged_7d": triage_count,
            "prs_reviewed_7d": pr_review_count,
            "posts_published_7d": posts_count,
            "queue_depth": queue_count,
        },
        "recent": (triage[-8:] if isinstance(triage, list) else []),
    }

    METRICS_JSON.write_text(json.dumps(snapshot, indent=2))
    print(f"wrote {METRICS_JSON}")

    # Public copy for the maintenance dashboard. site/maintenance.html fetches
    # this file on page load. Gitignored .metrics.json stays in scripts/launch/
    # so dev-time experiments don't leak into the published dashboard.
    PUBLIC_METRICS = REPO_ROOT / "site" / "maintenance" / "metrics.json"
    PUBLIC_METRICS.parent.mkdir(parents=True, exist_ok=True)
    PUBLIC_METRICS.write_text(json.dumps(snapshot, indent=2))
    print(f"wrote {PUBLIC_METRICS}")

    # ── Append to the time-series CSV ──────────────────────────
    METRICS_CSV.parent.mkdir(parents=True, exist_ok=True)
    header = "timestamp,stars,forks,open_issues,contributors,core_dl,mcp_dl,issues_triaged_7d,prs_reviewed_7d,posts_published_7d\n"
    row = f"{snapshot['generated_at']},{stars},{forks},{open_issues},{contributors},{core_dl},{mcp_dl},{triage_count},{pr_review_count},{posts_count}\n"
    if not METRICS_CSV.exists():
        METRICS_CSV.write_text(header)
    with METRICS_CSV.open("a") as f:
        f.write(row)
    print(f"appended row to {METRICS_CSV}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
