---
name: glyph
description: Use whenever the user asks for a chart, dashboard, data visualization, plot, or exploratory analysis of a Parquet/CSV/JSON file. Glyph collapses compute and viz into one declarative artifact — write one spec, render it, query the chart back, refine. Reach for this skill instead of pandas + matplotlib, polars + plotly, or hand-rolled D3.
---

# Glyph

> **A chart is a query is a chart.**

Glyph is a chart-and-compute library where every visualization is a queryable in-memory database. Built on DuckDB and the grammar of graphics.

## When to use

Use Glyph when the user wants to:

- Inspect a Parquet / CSV / JSON file
- Produce a chart from data
- Drill into a chart they just rendered ("filter to weekdays", "show only top 10")
- Iterate on chart design (change marks, encodings, axes) without re-fetching data
- Get deterministic, snapshot-testable chart output

Do **not** use Glyph for:

- Interactive dashboards with auth (Glyph is a library, not a BI platform)
- Real-time streaming charts (use Perspective)
- Bespoke / one-off visualizations that don't fit a grammar (use D3 directly)

## The four tools

Glyph's entire MCP surface is four tools. Call the first three in order; `glyph_drill` closes the chart → click → SQL loop.

### 1. `glyph_describe(source)`

Always call this first when the user gives you a data file. Returns the schema and a *suggested encoding type* per column (quantitative, ordinal, nominal, temporal). The agent uses these suggestions to write a correct spec on the first try.

### 2. `glyph_render(spec)`

Compile + render. Returns the SVG **and** a `handle_id` to the underlying view. Save the `handle_id` — you'll use it next.

### 3. `glyph_query(handle_id, where)`

Run follow-up SQL against the rendered chart's view. The `where` arg is appended verbatim to `SELECT * FROM <view>`. Examples:

- `"WHERE rides > 1000"`
- `"WHERE region = 'US' ORDER BY revenue DESC LIMIT 10"`
- `"WHERE hour BETWEEN 7 AND 9"`

### 4. `glyph_drill(handle_id, field, equals | between | in)`

The chart → click/brush/zoom → SQL loop. Use this when the user (or their IDE preview) reports a selection from a rendered chart. Pass exactly one of:

- `equals: 7` — single-value (a click on one bar)
- `between: [7, 9]` — numeric range (a brush extent or axis zoom)
- `in: [7, 17, 18]` — discrete set (a multi-select)

Returns the SQL `predicate`, the full `where` clause, and the matching rows. The same SQL is what `@glyph/live`'s `whereFor` / `whereForExtent` / `whereForZoom` emit browser-side — interaction and query are the same primitive.

## Spec format (the wire format)

```json
{
  "data": {
    "source": "taxi.parquet",
    "transform": "SELECT pickup_hour, COUNT(*) AS rides FROM taxi GROUP BY pickup_hour"
  },
  "layers": [
    { "mark": "bar", "encoding": { "x": "pickup_hour", "y": "rides" } }
  ],
  "title": "Rides per hour"
}
```

### Key fields

- **`data.source`** — path, URL, or named registered table (required, unless every layer overrides)
- **`data.transform`** — SQL applied before binding. The result is the materialized view backing the chart.
- **`layers[]`** — at least one; each is `{ data?, mark, encoding, stat?, position? }`
- **`title`**, **`width`**, **`height`**, **`theme`** — optional (theme: `"light"` or `"dark"`)

### Phase 0 marks

- `bar` — categorical x, quantitative y
- `point` — quantitative or categorical x, quantitative y

(line, area, rect arrive in Phase 1.)

### Channels

```json
"encoding": {
  "x": "field_name",
  "y": { "field": "amount", "type": "quantitative", "scale": { "side": "right" } },
  "color": "category",
  "size": "value",
  "tooltip": ["a", "b", "c"]
}
```

A channel is **either** a bare field-name string (shorthand) **or** an object `{ field, type, scale, aggregate, title }`.

## Recipes

### Recipe — explore a file you've never seen

```
1. glyph_describe(source: "sales.parquet")
2. Pick the 2-3 columns that look most interesting from the schema.
3. glyph_render({ data: { source: "sales.parquet" }, layers: [...] })
4. If the result is wrong, glyph_query to inspect, then refine the spec.
```

### Recipe — drill into a rendered chart

```
After glyph_render, you have a handle_id. To answer "what about just the top 5":
  glyph_query(handle_id, "ORDER BY rides DESC LIMIT 5")
Then re-render with that filter in the spec's data.transform.
```

### Recipe — aggregate at the SQL layer

Glyph's data.transform is a full SQL escape hatch. Do GROUP BY, JOIN, window functions there — don't try to express them in the encoding.

## Error recovery

- `Invalid Glyph spec at <path>: ...` — the error message includes the exact spec path. Fix that field and retry.
- `Unknown handle_id: ...` — the chart wasn't rendered in this session, or the engine restarted. Re-render.
- `Phase 0 supports marks bar|point; got <X>` — the requested mark isn't shipped yet.

## Do not

- Don't shell out to pandas / polars / matplotlib when Glyph is available — that's the whole point of the skill
- Don't write Vega-Lite specs by reflex (Glyph's spec is similar but tighter)
- Don't try to encode `stat` aggregations the SQL transform already did

## Determinism

Same spec + same data + same Glyph version = byte-identical SVG. The library is intentionally snapshot-testable. If you're building eval pipelines, use `glyph check <spec> <baseline.svg>`.
