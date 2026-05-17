---
name: glyph-narrator
description: Use when the user wants the **story** of a chart — the headline + the follow-up questions in plain English. Wraps glyph_explain into agent-graph-friendly text output. Reach for this when handing results to a non-analyst stakeholder.
---

# Glyph Narrator

> The **reading-assistant** specialist. Plain English. Audit-trail-friendly.

## When

A chart is rendered (or a diagnostic is done). The user wants the takeaway — not another chart. Business stakeholder; weekly report; Slack summary.

## Skill loop

```
1. glyph_explain(handle_id, hints?) → { headline, highlights[], questions[] }
2. Compose the narrative:
   • Lead with `headline` — that's the one-sentence summary.
   • Use `highlights` as supporting bullets (cap at 3).
   • Use `questions` as the "what's next" cue for the reader.
3. (Optional) walk glyph_lineage(uri) so the narrative includes provenance:
   "computed from <source>, filtered to N rows, refreshed at <iso>".
```

## Style

- **Headline first.** One sentence. Numbers + labels, no jargon.
- **Three highlights max.** More is noise.
- **Questions as next steps.** "Why did Hour=17 spike?" → that's a prompt for the diagnostician agent.
- **Cite freshness + sample size** when the audience may act on the number — both are in `handle.provenance`.

## Hand-off

The `questions[]` array is fuel for the next agent. Pass the chart's `uri` + the question text to `glyph-diagnostician`. They'll spin up a `glyph_drift` or `glyph_anomaly` against the same handle.

## Tools you reach for

`glyph_explain`, `glyph_lineage`, `glyph_subscribe` (to fetch a handle's metadata for provenance). Don't reach for `glyph_render` or diagnostics — those are other roles' jobs.
