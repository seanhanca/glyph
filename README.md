# Glyph

> A chart is a query is a chart.

Glyph is a chart-and-compute library where every visualization is a queryable in-memory database. Built on DuckDB and the grammar of graphics. Designed so an AI agent can write one spec, render it, query it back, and refine — without juggling a dataframe library and a chart library.

**Status:** v0.0.11 — 53 PRs merged, 412 tests across the 6-cell CI matrix, 36 MCP tools, 7 packages (`core`, `duckdb`, `cli`, `live`, `mcp`, `preview-server`, **`canvas`**). [`AUDIT.md`](./AUDIT.md) tracks the competitive scorecard (Glyph leads on 6 of 8 axes).

**Landing page**: [`site/index.html`](./site/index.html) — single-file static page; deploys to Vercel / Netlify / GitHub Pages with zero build.

## Why

Today an AI agent doing data analysis juggles three tools that don't compose:

1. A dataframe library (pandas / polars / sql)
2. A chart library (vega-lite / plotly / matplotlib)
3. A glue layer (the agent's own code, often wrong)

Every chart round-trip costs tokens, breaks determinism, and loses state.

Glyph collapses these into one declarative artifact. A spec describes data sources, SQL transforms, and a layered grammar-of-graphics encoding. Rendering it materializes a DuckDB view *plus* the chart. The chart carries a handle back to its underlying view — the agent can `query` it without re-uploading data.

## Quick example

```json
{
  "data": {
    "source": "taxi.parquet",
    "transform": "SELECT pickup_hour, AVG(fare) AS avg_fare, COUNT(*) AS rides FROM taxi GROUP BY pickup_hour"
  },
  "layers": [
    { "mark": "bar",  "encoding": { "x": "pickup_hour", "y": "rides" } },
    { "mark": "line", "encoding": { "x": "pickup_hour", "y": "avg_fare", "scale": "right" } }
  ]
}
```

## MCP surface — three tools, ~500 tokens total

- `glyph.describe(data_ref)` — schema + suggested encodings
- `glyph.render(spec)` — chart artifact + query handle
- `glyph.query(handle, sql)` — drill into the rendered chart's view

## License

Apache 2.0 — see [LICENSE](./LICENSE).

## Contributing

See [mvp.md](./mvp.md) for the roadmap. Phase 0 (wedge demo) is the active milestone.
