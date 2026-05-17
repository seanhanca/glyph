---
name: glyph-orchestrator
description: Use when the user has a multi-step analytic question that needs several agents/skills coordinated — register metrics once, hand handles between agents, build the storyboard. Reach for this in agent-graph topologies where Glyph is the substrate, not the renderer.
---

# Glyph Orchestrator

> The **agent-graph coordinator**. Composes the other four roles.

## When

The user's question is multi-stage:
- *"Compare Q1 vs Q2 MRR, find the segment that drove the move, draft a one-pager."*
- *"Audit which customers churned, group them, attach a deck."*

One skill can't do all of this. The orchestrator sequences the others.

## Skill loop

```
1. Register the shared vocabulary once:
     glyph_metrics_register([{ name: "mrr", sql: "..." }, ...])
   Every downstream agent now references the same definitions.

2. Hand the source as a gdf:// URI:
     glyph_render(spec) → handle
     glyph_publish(handle_id) → { uri, version }
   Pass `uri` to every sub-agent (explorer, diagnostician, narrator).

3. Sub-agents work in parallel where possible:
     • explorer renders contextual charts
     • diagnostician runs anomaly / drift / decompose
     • narrator writes the headline + questions
   Each call returns a new handle (chained lineage) that you can
   reference in the final storyboard.

4. Walk the full graph:
     glyph_lineage(final_uri, depth: 16)
   The whole reasoning chain — every transform, every diagnostic —
   is auditable from this one call.

5. Assemble the storyboard (rendered charts + narratives + links).
```

## Coordination patterns

- **Shared filters across charts** — use the same `gdf://` URI as `data.source` in every spec; downstream filters via `data.transform` keep handles independent but lineage-connected.
- **Shared dimensions** — every chart in the storyboard groups by the same field; the metric layer enforces that the *values* don't drift.
- **Checkpoints** — between sub-agent calls, `glyph_handles()` lists everything the session knows. Useful for showing the user intermediate state before continuing.

## Hand-off

This *is* the hand-off. The orchestrator dispatches; the four specialist skills (`glyph-explorer`, `glyph-diagnostician`, `glyph-narrator`, `glyph-operator`) execute. Return the assembled storyboard to the user.

## Tools you reach for

`glyph_metrics_register`, `glyph_metrics`, `glyph_publish`, `glyph_subscribe`, `glyph_lineage`, `glyph_handles`. The specialist verbs (`glyph_render`, `glyph_explain`, the diagnostics, the preview) get delegated to the role skills above.
