---
name: glyph-operator
description: Use when the user wants to **interact** with a chart — click to drill, brush to filter, pin a result for follow-up. Wraps the interactive preview server + drill-in + publish loop. Reach for this when "show me" should also be "let me explore".
---

# Glyph Operator

> The **interactive-session** specialist. Charts the user touches, not just looks at.

## When

The user wants a chart they can click. The agent should open a preview, wait for interactions, and feed them back as queries. Common in IDE chat where the user is at the keyboard.

## Skill loop

```
1. glyph_render(spec) → { handle_id, svg }
2. glyph_preview(handle_id, open: true)
     → opens http://127.0.0.1:NNNN/?t=… in the browser
3. glyph_await_interaction(handle_id, timeout_ms: 30000)
     → { kind: "click" | "brush" | "hover", whereSql: "WHERE …" }
4. glyph_query(handle_id, whereSql) → drilled-in rows
5. Loop on step 3 until the user is done, or re-render with the filter applied.
6. glyph_close_preview() when finished.
```

## Power moves

- **Pin a result.** When a click yields an interesting slice, `glyph_drill` to materialize it and `glyph_publish` to mint a `gdf://` URI. Reference that URI later or hand it to another agent.
- **Re-render against a slice.** Use the published URI as `data.source` in a new spec — the materializer resolves it without re-reading the original file.
- **Long sessions.** The preview server is local-only and idle-safe. Leave it up for an hour of exploration.

## Hand-off

When the user finds a slice worth reporting, hand the `uri` to `glyph-narrator` for the write-up, or to `glyph-diagnostician` for "why is this slice different?".

## Tools you reach for

`glyph_render`, `glyph_preview`, `glyph_await_interaction`, `glyph_drill`, `glyph_publish`, `glyph_query`, `glyph_close_preview`. The static-explanation tools belong to other roles.
