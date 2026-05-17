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

## The twenty-seven tools

Glyph's MCP surface (9 Phase 0/1 + 4 Phase 3 Tier A GDF verbs + 1 explain verb + 4 diagnostic verbs + 2 metric-layer verbs + 4 persistent-memory verbs + 2 action verbs + 1 trust verb):

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
13. `glyph_explain` — deterministic plain-English chart explanation
14. `glyph_anomaly` — rows beyond Nσ from segment mean (+ derived handle)
15. `glyph_drift` — per-group contribution to a period-over-period delta
16. `glyph_decompose` — rank factors by variance explained (one-way η²)
17. `glyph_forecast` — seasonal-naive baseline + 2σ confidence bands
18. `glyph_metrics_register` — register named aggregates (the metric layer)
19. `glyph_metrics` — list registered metrics (optionally filtered)
20. `glyph_memory_save` — persist a handle to `~/.glyph/memory.duckdb`
21. `glyph_memory_recall` — restore a saved handle as a fresh DataHandle
22. `glyph_memory_list` — list saved entries
23. `glyph_memory_forget` — drop a saved entry
24. `glyph_act` — resolve + dry-run a declarative `spec.actions[]` entry
25. `glyph_audit_log` — read recent `glyph_act` invocations
26. `glyph_trust` — freshness + confidence summary for a handle
0. `glyph_capabilities` — feature detection

### Actions + trust (verbs 24–26) — Phase 3 §4 + §7

A spec can carry `actions: [{ name, label, tool?, argMap? }]`. `glyph_act(handle_id, action_name, selection?)` resolves placeholders (`$selection.keys`, `$selection.count`, `$selection.summary`), persists an audit row to `~/.glyph/memory.duckdb`, and returns the resolved plan. v0 is **dry-run only** — actual external-tool dispatch lands in a follow-up. Use `glyph_audit_log(handle_id?)` to inspect history.

`glyph_trust(handle_id)` returns `{ sampleRows, confidence, freshness, lowSample, lineageDepth, markdown }`. Embed the markdown in any narrator output — answers "is this fresh?" and "how was it computed?" without rendering anything new.

### Persistent memory (verbs 20–23) — Phase 3 §6

`glyph_memory_save("daily_baseline", handle_id)` writes the rows backing the handle into `~/.glyph/memory.duckdb`. Across an MCP restart, `glyph_memory_recall("daily_baseline")` returns a fresh DataHandle pointing at the same rows. Use it for: dashboards that span multiple sessions, baselines an anomaly detector should compare against, "what was the answer yesterday?" recall.

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

### 13. `glyph_explain(handle_id, hints?)` *(Phase 3 §2 — self-explaining charts)*

Run a **deterministic four-stage pipeline** against a rendered chart and return plain-English observations the user can read at a glance. Don't ask an LLM to read the SVG — call this instead.

```json
{
  "headline": "rides peaked at 8 (260), 6.5× the 3 low (40).",
  "highlights": [
    "Hour=17 is an outlier: 240 rides (+2.4σ vs the mean).",
    "Trend is upward (r=0.71) over 12 periods."
  ],
  "questions": [
    "What drives the 6.5× spread between 8 and 3?",
    "Why is hour=17 anomalous?",
    "Is the upward trend in rides sustainable?"
  ]
}
```

The four stages:

| Stage | What it computes |
|---|---|
| 1. Top-line | extent, peak label + value, trough label + value, ratio |
| 2. Compositional | dominant or top-3 contributing group(s) by share |
| 3. Anomaly | values > 2σ from segment mean — surface inline |
| 4. Temporal | period-over-period delta + trend strength (only if x is temporal) |

Same chart + same Glyph version always yields the same explanation — useful for audit trails and snapshot-style eval pipelines. The `questions` array is the secret weapon for agent graphs: each entry is a ready-to-execute follow-up prompt for a diagnostician agent.

Optional `hints` override the heuristic role inference (`{ xField, yField, groupField }`). Without hints, Glyph picks `y` = first quantitative column, `x` = first temporal-or-categorical column, `group` = the next categorical column.

### Diagnostic primitives (verbs 14–17) — Phase 3 §3

When the user asks **"why did this change?"** instead of **"what does this look like?"**, reach for these. Each diagnostic verb returns:

- `rows` — the diagnostic rows (top-N or full)
- `handle_id` + `uri` — a **derived DataHandle** with chained lineage. The result is queryable via `glyph_query` / `glyph_drill`, addressable via `gdf://`, and walkable via `glyph_lineage` back to the upstream chart.
- `explanation` — the same `{ headline, highlights, questions }` shape as `glyph_explain`

All four are deterministic: same rows + same Glyph version → same JSON.

#### 14. `glyph_anomaly(handle_id, valueField, groupField?, threshold?, ...)`

Z-score anomaly detection. Returns rows where `|z| > threshold` (default 2σ) from their segment mean. Pass `groupField` to bucket per-group (region/tier/etc.); without it, the global mean is used. The chained handle includes a `_z` column so downstream filters and renders see the score.

#### 15. `glyph_drift(handle_id, valueField, groupField, periodField, periodA, periodB)`

Per-group attribution of a period-over-period change. Periods are matched by string-comparing `periodField` values to `periodA` / `periodB` (single value or list). Each row carries `{ group, valueA, valueB, delta, share }` — shares sum to 1.0 when total delta ≠ 0.

#### 16. `glyph_decompose(handle_id, metricField, factors[])`

For each candidate factor (a column name), compute the fraction of total variance in `metricField` explained by between-group differences (one-way ANOVA's η²). Ranks factors by signal — a quick scan to point at "which dimension to look at first". Honest about scope: this is variance attribution, not full mix/rate/volume decomposition (that lands in a follow-up once we settle on the volume/rate input contract).

#### 17. `glyph_forecast(handle_id, xField, yField, season?, horizon?)`

Seasonal-naive forecast: `y_hat[t] = y[t-season]`. When `season=1` it's a one-step-back random walk. The ±2σ band is derived from historical residuals. Returns one row per historical point + `horizon` (default 7) trailing forecast-only rows; `isHorizon=true` marks the future. The explanation surfaces actuals that fell outside the band — those are the points to dig into next.

### Semantic / metric layer (verbs 18–19) — Phase 3 §1

A **registry of named aggregates** — MRR, churn rate, active customer, etc. — that every chart in the session shares. Define a metric once with `glyph_metrics_register`; reference it from any spec encoding via `{ metric: "<name>" }`; the materializer wraps the data SQL with the registered aggregate and `GROUP BY`s the other channel fields. Same definitions across every agent turn = **no metric drift**.

Mirrors the dbt / Cube / LookML semantic-layer pattern, but bound to chart specs instead of a separate config product.

#### 18. `glyph_metrics_register(metrics[])`

Register (or replace) one or more named metrics. Each metric is `{ name, sql, description?, grain?, dimensions?, requires? }`. The `sql` field must be a **single aggregate expression** — no `SELECT` / `FROM` / `GROUP BY`. Examples:

```jsonc
[
  { "name": "mrr",
    "sql": "SUM(amount) FILTER (WHERE type = 'subscription')",
    "description": "Monthly recurring revenue, excluding one-time charges.",
    "grain": "monthly" },
  { "name": "churn_rate",
    "sql": "COUNT(*) FILTER (WHERE status = 'cancelled') / NULLIF(COUNT(*), 0)" }
]
```

Returns `{ registered, replaced, total }`. Re-registering an existing name swaps the definition in place and surfaces it under `replaced`.

#### 19. `glyph_metrics(prefix?)`

Returns `{ count, metrics }` — every metric registered in this session, optionally filtered by name prefix. Call this before writing `{ metric: "..." }` in a spec so you don't reference a phantom.

#### Using metrics in a spec

```jsonc
{
  "data": { "source": "warehouse.payments" },
  "layers": [{
    "mark": "line",
    "encoding": { "x": "month", "y": { "metric": "mrr" } }
  }]
}
```

The materializer wraps the source SQL with `SELECT month, (SUM(amount) FILTER (...)) AS _metric_mrr FROM (<source>) GROUP BY month`. The rendered chart's view exposes `_metric_mrr` as a real column — so `glyph_query` / `glyph_drill` work normally against it.

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

- **`data.source`** — one of:
  - a file path (CSV/Parquet/JSON)
  - a URL (http/https/s3)
  - a name from a prior `glyph_import` result
  - **a `gdf://` URI** from `glyph_publish` (Phase 3) — the materializer resolves it against the session's handle registry and runs the transform (if any) against the upstream view. No re-registration. Use this to render a fresh chart from a handle another agent (or an earlier turn) produced.
  - Required unless every layer overrides `data`.
- **`data.transform`** — SQL applied before binding. The result is the materialized view backing the chart. Transforms reference the source as `glyph_src_main`.
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

### Recipe — re-render against a published handle (Phase 3 GDF)

```
Agent A:
  1. glyph_render(spec) → { handle_id }
  2. glyph_publish(handle_id) → { uri, version }
  3. (Pass `uri` to Agent B by any channel.)

Agent B (same MCP session, different turn or different orchestrator):
  4. glyph_subscribe(uri) → DataHandle  (optional — confirms it exists)
  5. glyph_render({
       data: { source: uri, transform: "SELECT ... FROM glyph_src_main WHERE ..." },
       layers: [...]
     })
       → fresh chart whose lineage points back to `uri`
  6. glyph_lineage(<new uri>) → walks back to the source
```

The downstream `glyph_render` resolves the URI against the session registry,
aliases the upstream's materialized view as `glyph_src_main`, and runs the
transform. No file re-read; no row duplication.

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
