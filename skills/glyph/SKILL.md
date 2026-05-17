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

## The thirteen tools

Glyph's MCP surface (9 Phase 0/1 + 4 Phase 3 Tier A GDF verbs):

1. `glyph_describe` — inspect a data file before writing a spec
2. `glyph_render` — compile + render a spec; returns SVG + PNG + handle
3. `glyph_query` — follow-up SQL against a chart's view
4. `glyph_import` — bring data in from another MCP tool (CSV / JSON-rows / URL)
5. `glyph_preview` — open an interactive chart in the user's browser
6. `glyph_await_interaction` — long-poll the click → agent loop
7. `glyph_close_preview` — stop the preview server
8. `glyph_drill` — predicate-driven drill-in (selection → rows)
9. `glyph_publish` — promote a handle to a gdf:// URI (cross-agent ref)
10. `glyph_subscribe` — resolve a gdf:// URI to its DataHandle
11. `glyph_lineage` — walk a handle's lineage tree
12. `glyph_handles` — list every DataHandle in the session
0. `glyph_capabilities` — feature detection

### 0. `glyph_capabilities()` *(call once at session start)*

Returns the library version, supported spec versions, marks, stats, renderers, engines, and the versioned tool list. Use it to detect whether a newer verb (e.g. `glyph_act`) is available before invoking it.

### 1. `glyph_describe(source)`

Always call this first when the user gives you a data file. Returns the schema and a *suggested encoding type* per column (quantitative, ordinal, nominal, temporal). The agent uses these suggestions to write a correct spec on the first try.

### 2. `glyph_render(spec)`

Compile + render. Returns the SVG **and** a `handle_id` to the underlying view. Save the `handle_id` — you'll use it next.

### 3. `glyph_query(handle_id, where)`

Run follow-up SQL against the rendered chart's view. The `where` arg is appended verbatim to `SELECT * FROM <view>`. Examples:

- `"WHERE rides > 1000"`
- `"WHERE region = 'US' ORDER BY revenue DESC LIMIT 10"`
- `"WHERE hour BETWEEN 7 AND 9"`

### 4. `glyph_import(payload, name?)` *(cross-MCP data bridge)*

When data comes from **another MCP tool** (ClickHouse, Postgres, BigQuery, Publora, etc.) and you want to chart it, use this verb instead of stuffing rows into the spec's `data.transform` string. Three kinds:

- `{ kind: "csv", data: "<csv text>" }` — paste the CSV the upstream tool returned
- `{ kind: "json-rows", rows: [{...}, ...], schema?: [{name, type}] }` — plug in a tool's rows array directly
- `{ kind: "url", url: "...", format?: "csv|parquet|json" }` — let DuckDB fetch it; works for http/https, local file:// paths, and S3 URIs

Returns `{ name, resolvedSource, schema, rowCount }`. Use `resolvedSource` (or the registered `name`) as `data.source` in the next `glyph_render`. **This is the recommended path for the cross-MCP scenario.**

#### The `data_handle` convention (for MCP tool authors and orchestrators)

Any MCP tool returning tabular data can voluntarily include a `data_handle` block in its result:

```json
{
  "content": [{ "type": "text", "text": "..." }],
  "data_handle": { "kind": "json-rows", "rows": [...], "schema": [...] }
}
```

When you (the agent) see a `data_handle` in a tool result, forward it to `glyph_import` directly — no copy, no token-expensive stringification of the full row set. This is opt-in for upstream tools; Glyph reads it if present and ignores it otherwise.

### 5. `glyph_preview(handle_id?, open?)` *(opens an interactive chart in a browser)*

Starts an opt-in, **localhost-only** HTTP server inside the MCP process that hosts a single-page app rendering the chart with `@glyph/live` click/hover/brush handlers. Returns `{ url, token, port }`. Pass `open: true` to also launch the user's default browser.

When the user interacts (clicks a bar, drags a brush), the page POSTs the event to the server. The agent picks it up via `glyph_await_interaction`.

### 6. `glyph_await_interaction(handle_id, timeout_ms?)` *(long-poll the click → agent loop)*

Long-polls (default 30 s, max 60 s) for the next user interaction on the preview chart. Returns:

```json
{ "kind": "click", "binding": { "row": 7, "attrs": { "x": "2024-03-12" } }, "whereSql": "WHERE \"day\" = '2024-03-12'" }
```

or `{}` on timeout. Typically called immediately after `glyph_preview`. The `whereSql` field is ready to hand to `glyph_query` or `glyph_drill` for the next step.

### 7. `glyph_close_preview()` *(stop the server)*

Idempotent shutdown. Any parked `glyph_await_interaction` calls resolve to `{}`. The server also stops automatically on MCP exit.

### 8. `glyph_drill(handle_id, field, equals | between | in)`

The chart → click/brush/zoom → SQL loop. Use this when the user (or their IDE preview) reports a selection from a rendered chart. Pass exactly one of:

- `equals: 7` — single-value (a click on one bar)
- `between: [7, 9]` — numeric range (a brush extent or axis zoom)
- `in: [7, 17, 18]` — discrete set (a multi-select)

Returns the SQL `predicate`, the full `where` clause, and the matching rows. The same SQL is what `@glyph/live`'s `whereFor` / `whereForExtent` / `whereForZoom` emit browser-side — interaction and query are the same primitive.

### 9. `glyph_publish(handle_id, scope?)` *(Phase 3 GDF)*

Promote a session-local handle to a globally addressable `gdf://<session>/<id>` URI so another agent (or another MCP session in the same process) can reference it. Returns `{ uri, version }`. The URI is the same one already minted in `glyph_render`'s `DataHandle` — calling publish is the explicit "share this" gesture.

### 10. `glyph_subscribe(uri)` *(Phase 3 GDF)*

Resolve a `gdf://` URI back to its full `DataHandle` — id, viewName, schema, **lineage** (sql + parents + producer), **provenance** (freshness, sampleRows, confidence), **binding** (kind: `duckdb-view` in Tier A), and `version`. After subscribing you can pass the handle's `id` to `glyph_query`, `glyph_drill`, or use it as `data.source: "gdf://..."` in `glyph_render` (Phase 3).

### 11. `glyph_lineage(uri, depth?)` *(Phase 3 GDF)*

Walk a handle's lineage tree. Returns `{ uri, sql, producer, at, children: [...] }` recursively up to `depth` levels (default 8). Each node carries the SQL that produced it and the producer record (`agent`, `tool`, `sessionId`, `at`). Useful for trust + audit ("where did this number come from?").

### 12. `glyph_handles()` *(Phase 3 GDF)*

List every `DataHandle` in the current MCP session. Returns `{ sessionId, count, handles: [{ id, uri, version, columns, producer, confidence, viewName }] }`. Use it to discover what's already queryable without re-rendering — typically after a context handoff.

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

### Recipe — interactive preview + click → next-step

```
1. glyph_render(spec) → { handle_id, svg, png }
2. glyph_preview(handle_id, open: true) → opens browser at http://127.0.0.1:NNNN/?t=…
3. (user clicks a bar)
4. glyph_await_interaction(handle_id, timeout_ms: 30000)
     → { kind: "click", binding: { row: 7, attrs: { x: "2024-03-12" } },
         whereSql: "WHERE \"day\" = '2024-03-12'" }
5. glyph_query(handle_id, whereSql) → rows for the selected slice
6. (optional) glyph_close_preview()
```

Use this whenever the user wants to **drive the analysis with the chart** instead of with words. The `whereSql` field is ready to pass to `glyph_query` or `glyph_drill` for the follow-up.

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
