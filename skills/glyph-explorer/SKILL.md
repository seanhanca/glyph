---
name: glyph-explorer
description: Use when the user hands you a Parquet/CSV/JSON file and asks "what's in here?" or "how does X look?". Surveys schemas, picks sensible encodings, renders quick charts to map an unknown dataset. Reach for this skill instead of pandas + matplotlib for first-pass exploration.
---

# Glyph Explorer

> The **exploration** specialist. First pass on any new dataset.

## When

A new file shows up. The user doesn't know the shape. You need a chart in under a minute.

## Skill loop

```
1. glyph_describe(source)                       → schema + suggested encodings
2. Pick the 2–3 columns that look highest-signal.
3. glyph_render({ data, layers: [{ mark, encoding }] })
4. glyph_query(handle_id, "WHERE …")            → narrow if rows look wrong
5. Re-render with the spec refined.
```

## Heuristics

- **One quantitative + one categorical** → bar.
- **Two quantitative** → point.
- **Temporal + quantitative** → line.
- If the file has > 10 columns, do `glyph_describe` first and skim before composing the spec.
- If a chart is too busy, `glyph_drill` with a `between` selector to zoom.

## Hand-off

When you've found something worth interpreting, hand off the `handle_id` to `glyph-narrator` (explain + storify) or `glyph-diagnostician` (anomaly + drift). The `gdf://` URI from `glyph_publish` is the cross-agent reference.

## Tools you reach for

`glyph_describe`, `glyph_render`, `glyph_query`, `glyph_drill`, `glyph_handles`. Stay narrow — don't reach for diagnostics or actions in explorer mode.
