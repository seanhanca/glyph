#!/usr/bin/env python3
"""
influencer_engine.py — daily monitor + reply drafter.

For each influencer in influencers.yaml:
  - Pull their latest 5 RSS items (if RSS is configured)
  - Check for topic match
  - If matched and not already replied: ask an LLM to draft a short, substantive
    reply that links to a specific Glyph artifact, then queue it for
    Claude-in-Chrome approval via chrome_queue.json.

This script never posts directly. All outbound goes through chrome_queue.json.
"""
from __future__ import annotations
import argparse, datetime as dt, hashlib, json, os, pathlib, sys
from typing import Iterable

import yaml  # type: ignore

try:
    import feedparser  # type: ignore
except ImportError:
    feedparser = None

HERE = pathlib.Path(__file__).parent
QUEUE = HERE / "chrome_queue.json"
SEEN = HERE / ".influencer-seen.json"
INFLUENCERS = HERE / "influencers.yaml"

DEMO_LINKS = {
    "mcp":              "https://github.com/seanhanca/glyph#use-it-from-an-llm-agent",
    "duckdb":           "https://github.com/seanhanca/glyph#use-it-as-a-typescript-library",
    "grammar-of-graphics": "https://github.com/seanhanca/glyph/blob/main/docs/LEARN.md",
    "agents":           "https://seanhanca.github.io/glyph/math/life-in-glyph.html",
    "visualization":    "https://seanhanca.github.io/glyph/play/",
    "ggplot2":          "https://github.com/seanhanca/glyph/blob/main/docs/LEARN.md",
    "d3":               "https://github.com/seanhanca/glyph/blob/main/D3-COMPARISON.md",
}


def load_seen() -> dict:
    if SEEN.exists():
        return json.loads(SEEN.read_text())
    return {}


def save_seen(d: dict) -> None:
    SEEN.write_text(json.dumps(d, indent=2))


def load_queue() -> list:
    if QUEUE.exists():
        return json.loads(QUEUE.read_text())
    return []


def save_queue(q: list) -> None:
    QUEUE.write_text(json.dumps(q, indent=2))


def fp_of(entry) -> str:
    """Stable fingerprint for an RSS/X entry."""
    raw = (entry.get("id") or entry.get("link") or entry.get("title") or "")[:512]
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def topic_hit(text: str, topics: Iterable[str]) -> list[str]:
    low = (text or "").lower()
    return [t for t in topics if t.lower() in low]


def best_demo_link(matched: list[str]) -> str:
    for m in matched:
        if m in DEMO_LINKS:
            return DEMO_LINKS[m]
    return DEMO_LINKS["agents"]


def draft_reply(influencer: dict, entry: dict, matched: list[str]) -> str:
    """Stub — replace with a real LLM call if ANTHROPIC_API_KEY is set."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    title = entry.get("title", "")
    link  = entry.get("link", "")
    demo  = best_demo_link(matched)
    if not api_key:
        return (
            f"Hi {influencer['name']} — saw your note on \"{title}\". "
            f"This is exactly the audience Glyph is built for: {influencer['hook']} "
            f"Quick demo if you have 60 seconds: {demo}"
        )
    try:
        import anthropic  # type: ignore
        client = anthropic.Anthropic(api_key=api_key)
        msg = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=300,
            messages=[{
                "role": "user",
                "content": (
                    f"Draft a 2-3 sentence reply to {influencer['name']}'s post titled "
                    f"\"{title}\". Be substantive, not promotional. The reply should "
                    f"engage with their point, then mention Glyph naturally if relevant "
                    f"(angle: {influencer['hook']}). Include this link: {demo}. "
                    f"Sign off implicitly — no \"Best regards.\" No emoji. Under 280 chars."
                ),
            }],
        )
        return msg.content[0].text.strip()
    except Exception as e:
        return f"[fallback] Hi {influencer['name']} — {influencer['hook']} {demo}"


def fetch_entries(inf: dict) -> list[dict]:
    if not inf.get("rss") or feedparser is None:
        return []
    feed = feedparser.parse(inf["rss"])
    return [
        {"title": e.get("title", ""), "link": e.get("link", ""), "id": e.get("id", ""),
         "summary": e.get("summary", "")[:1000]}
        for e in feed.entries[:5]
    ]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["bootstrap", "daily", "followup", "amplify"],
                    default="daily")
    args = ap.parse_args()

    influencers = yaml.safe_load(INFLUENCERS.read_text())
    seen = load_seen()
    queue = load_queue()

    queued_now = 0
    for inf in influencers:
        h = inf["handle"]
        seen_for = set(seen.get(h, []))
        entries = fetch_entries(inf)
        for entry in entries:
            fp = fp_of(entry)
            if fp in seen_for:
                continue
            matched = topic_hit(
                f"{entry['title']} {entry['summary']}",
                inf.get("topics", []),
            )
            if not matched:
                seen_for.add(fp)
                continue
            draft = draft_reply(inf, entry, matched)
            queue.append({
                "kind": "x_reply",
                "queued_at": dt.datetime.utcnow().isoformat() + "Z",
                "influencer": h,
                "in_reply_to": entry.get("link"),
                "matched_topics": matched,
                "draft": draft,
            })
            seen_for.add(fp)
            queued_now += 1
        seen[h] = sorted(seen_for)

    save_seen(seen)
    save_queue(queue)
    print(f"[influencer_engine] mode={args.mode}  queued={queued_now}  queue_len={len(queue)}")


if __name__ == "__main__":
    sys.exit(main())
