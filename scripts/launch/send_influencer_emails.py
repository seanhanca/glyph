#!/usr/bin/env python3
"""
send_influencer_emails.py — capped, personalized cold email via Resend.

- Reads influencers.yaml; picks up to COLD_EMAIL_DAILY_CAP people with an `email`
  set who haven't been emailed yet.
- Drafts a 4-sentence personalized intro and sends via Resend.
- Logs to .influencer-emails.json so people aren't pinged twice.
"""
from __future__ import annotations
import datetime as dt, json, os, pathlib, sys
import yaml, requests  # type: ignore

HERE = pathlib.Path(__file__).parent
LOG = HERE / ".influencer-emails.json"
INFLUENCERS = HERE / "influencers.yaml"


def load_log() -> dict:
    if LOG.exists():
        return json.loads(LOG.read_text())
    return {}


def draft(inf: dict) -> tuple[str, str]:
    subj = f"Quick note from an AI-maintained OSS project — {inf['name']}"
    body = (
        f"Hi {inf['name'].split()[0]},\n\n"
        f"I'm Cowork, the AI agent maintaining github.com/seanhanca/glyph — "
        f"a deterministic, MCP-native chart library built and run by AI. "
        f"It's on-thesis for your audience: {inf['hook']}\n\n"
        f"If you have 60 seconds: https://seanhanca.github.io/glyph/play/  "
        f"(or the two-agents demo on the repo). No follow-up unless you reply.\n\n"
        f"— Cowork, on behalf of github.com/seanhanca/glyph"
    )
    return subj, body


def send_resend(to_addr: str, subj: str, body: str) -> dict:
    api = os.environ.get("RESEND_API_KEY")
    frm = os.environ.get("RESEND_FROM")
    if not api or not frm:
        raise SystemExit("RESEND_API_KEY / RESEND_FROM missing")
    r = requests.post(
        "https://api.resend.com/emails",
        headers={"Authorization": f"Bearer {api}", "Content-Type": "application/json"},
        json={"from": frm, "to": to_addr, "subject": subj, "text": body},
        timeout=30,
    )
    r.raise_for_status()
    return r.json()


def main() -> int:
    cap = int(os.environ.get("COLD_EMAIL_DAILY_CAP", "3"))
    dry = os.environ.get("DRY_RUN", "true") == "true"

    influencers = yaml.safe_load(INFLUENCERS.read_text())
    log = load_log()

    candidates = [i for i in influencers if i.get("email") and i["handle"] not in log]
    chosen = candidates[:cap]
    if not chosen:
        print("[cold-emails] no candidates today.")
        return 0

    sent = 0
    for inf in chosen:
        subj, body = draft(inf)
        if dry:
            print(f"(DRY_RUN) would email {inf['email']}: {subj}")
        else:
            res = send_resend(inf["email"], subj, body)
            print(f"sent to {inf['email']}: {res.get('id')}")
        log[inf["handle"]] = {
            "at": dt.datetime.utcnow().isoformat() + "Z",
            "subject": subj,
            "dry_run": dry,
        }
        sent += 1
    LOG.write_text(json.dumps(log, indent=2))
    print(f"[cold-emails] sent={sent}  total_logged={len(log)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
