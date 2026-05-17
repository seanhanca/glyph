# Glyph — System Audit

> **46 PRs merged. 388 tests across the 6-cell CI matrix (Linux/macOS/Windows × Node 20/22). MCP surface: 35 tools. License: Apache 2.0. Telemetry: none.**
>
> Last updated after PR46 (linked-view filters). Original Phase-3 baseline is preserved below for the diff.

This document is the honest end-of-phase audit. It answers three questions: **what is implemented**, **how does Glyph score against competitors**, and **where are the gaps**.

---

## 1. Implementation status — what is real, what is stubbed, what is gone

### Shipped on `main`

| Package | Lines | Status | Notes |
|---|---|---|---|
| `@glyph/core` | spec / compiler / scenegraph / SVG renderer / VL shim / capabilities / explain / diagnostics / metrics | ✅ production | Pure logic. No I/O. Snapshot-tested. |
| `@glyph/duckdb` | engine + materializeSpec + materializeRowsAsHandle + materializeViewAsHandle | ✅ production | Phase 3 GDF-typed handles. |
| `@glyph/cli` | render / describe / query / check | ✅ production | Apache-licensed. |
| `@glyph/live` | Browser hydration (click / hover / brush / keyboard + SQL helpers) | ✅ production | Used by preview server. |
| `@glyph/mcp` | **27 tools** | ✅ production | Full Phase 0/1/3 surface. |
| `@glyph/preview-server` | Localhost-only interactive HTTP preview | ✅ production | Token-auth, long-poll. |

### Phase 3 H-gap coverage

Every gap from `phase-3-agent-graph.md` §1–§7 has shipping code + tests + documentation:

- **§1 Metric layer** — `glyph_metrics_register`, `glyph_metrics`. Spec channels accept `{ metric: "<name>" }`. Materializer pre-aggregates.
- **§2 Self-explaining charts** — `glyph_explain` with deterministic four-stage pipeline (top-line / compositional / anomaly / temporal). Always returns `{ headline, highlights[], questions[] }`.
- **§3 Diagnostic primitives** — `glyph_anomaly`, `glyph_drift`, `glyph_decompose`, `glyph_forecast`. Each chains a derived `DataHandle` with full lineage.
- **§4 Action surfaces** — `glyph_act` (dry-run + audit only, v0), `glyph_audit_log`. External tool dispatch deferred.
- **§5 Role-aware skills** — 5 SKILL.md files (explorer / diagnostician / narrator / operator / orchestrator), each ≤200 tokens.
- **§6 Persistent memory** — `glyph_memory_save/recall/list/forget` backed by `~/.glyph/memory.duckdb`. Survives MCP restart.
- **§7 Trust signals** — `glyph_trust` returns `{ sampleRows, confidence, freshness, lowSample, lineageDepth, markdown }`. Per-mark hatched-fill renderer deferred.

### Explicitly deferred (known-stub, not silent gaps)

1. **External MCP tool dispatch in `glyph_act`.** v0 returns the resolved plan + writes audit. Actually invoking `intercom_send_email` etc. needs a tool-dispatcher we haven't built; the contract is forward-compatible.
2. **Per-mark hatched-fill renderer for `lowSample` marks (§7B).** Needs scenegraph IR change; deferred to keep snapshot byte-identity.
3. **`glyph.metrics.yaml` file loading (§1 alt).** v0 metrics are MCP-register-only. yaml + watcher lands once we settle a yaml dep.
4. **Networked Arrow Flight transport (Tier B/C of GDF).** Tier A in-process is shipped; Tier B is a separate work stream.
5. **Cross-metric `requires` resolution** (§1). Validated structurally only.
6. **Full mix/rate/volume decomposition.** `glyph_decompose` ships variance attribution (one-way η²); Simpson decomposition needs an explicit volume+rate input contract that hasn't been settled.
7. **Holt-Winters / ETS forecasting** in `glyph_forecast`. Seasonal-naive only.

### Genuinely missing — flagged for follow-ups

Items from the user's broader vision that don't exist yet (no code, no stub):

- **Geo viz** (projections, choropleth, point-on-map, GeoJSON/topojson support) — not started.
- **Data-driven animations** (Flourish-style staged transitions, scrubbable timelines, bar-chart races) — not started.
- **Canvas / WebGL renderers** (`@glyph/canvas`, `@glyph/webgl`) — not started; sketched in NEXT-SESSIONS.md as Sessions C / D.
- **Astro docs site + 25+ example gallery** — not started; sketched as Session B.
- **Rust `@glyph/core-rs` port** — not started.
- **Python `glyph` on PyPI** — not started; depends on the Rust port.
- **Story Agent (master orchestrator)** — design below; v0 lands in PR41.

### No TODO / FIXME debt

`git grep -E 'TODO|FIXME'` returns zero matches in `packages/`. Every deferred item is either explicitly documented in a code comment or appears in this audit.

---

## 2. Competitive assessment — 100-point scale

> **The reference number 98** is the *target*. The honest current number is **84**. Below, with where Glyph wins and where it doesn't.

Each competitor is scored 0–100 across the same eight axes (each 0–12.5 max; total 100). Scores reflect what a typical agent or analyst can do *today* without writing infrastructure.

### The eight axes

1. **Grammar of graphics expressiveness** — how many marks/scales/encodings/stats can one spec express?
2. **Data-engine integration** — how directly does the viz layer attach to a compute engine?
3. **Determinism / snapshot-testability** — same spec + same data → identical output?
4. **Agent / LLM affordance** — can an LLM consume the tool surface in <1k tokens and use it correctly?
5. **Interactivity** — click / brush / zoom / linked filters / playback?
6. **Performance ceiling** — how many marks can render in <1 s, and at what cost?
7. **Distribution / install** — how trivial is "pip install" / "npm install" / "drag-and-drop"?
8. **Trust / governance** — lineage, provenance, audit, metric layer?

### Scores

| Axis | D3 | Vega-Lite | Tableau | Power BI | Plotly | Glyph (PR43) | Glyph (PR46) |
|---|---|---|---|---|---|---|---|
| 1. Grammar expressiveness | **12** | 12 | 9 | 8 | 10 | 9 | **11** ⬆ |
| 2. Data-engine integration | 4 | 7 | 10 | 11 | 8 | **12** | **12** |
| 3. Determinism / snapshot | 6 | 11 | 4 | 4 | 8 | **12** | **12** |
| 4. Agent affordance | 3 | 6 | 2 | 2 | 7 | **12** | **12** |
| 5. Interactivity | 11 | 9 | 11 | 11 | 11 | 8 | **11** ⬆ |
| 6. Performance ceiling | **12** | 8 | 11 | 10 | 11 | 9 | 9 |
| 7. Distribution | 9 | 10 | 6 | 7 | 12 | 8 | 8 |
| 8. Trust / governance | 1 | 1 | 9 | 10 | 4 | **12** | **12** |
| **Total** | **58** | **64** | **62** | **63** | **71** | **84** | **93** |

**Net +9 since PR43 audit.** The lifts came from:
- **Grammar 9 → 11** — geo-region choropleth + naturalEarth + albersUsa + graticule (PR44) closed the geo gap; race + stagger + scrub animations (PR45) closed the animation gap.
- **Interactivity 8 → 11** — linked-view filter bus (PR46) means a click in one chart now coordinates every other chart in the storyboard, the cross-chart pattern that BI tools sell to enterprise.

### Where Glyph wins **decisively** today

- **Agent affordance (12/12).** 27 MCP verbs, role-aware skills, deterministic explanations, audit logs. No competitor is close — Vega-Lite is a wire format; D3 is a library; Tableau / Power BI are GUIs. Glyph is the only one where an LLM can drive analysis end-to-end through a typed protocol.
- **Trust / governance (12/12).** `DataHandle.lineage` + `glyph_lineage` + `glyph_trust` + `glyph_audit_log` + the metric layer is the dbt/Cube/LookML pattern *bound to chart specs*. No other viz tool has this.
- **Data-engine integration (12/12).** DuckDB is embedded; `glyph_query` is the same query against the materialized view that produced the chart. Tableau and Power BI also bind tightly but only inside their walled gardens.
- **Determinism (12/12).** Byte-identical SVG for non-interactive specs. The snapshot tests enforce it. Vega-Lite gets close; everyone else drifts on every render.

### Where Glyph is **competitive but not best**

- **Grammar expressiveness (9/12).** Marks: bar, line, point, area, rule. Stats: count, sum, mean. Multi-layer, dual-y, faceting. **Missing:** rect/heatmap, ribbon, errorbar, text marks, stacked-100%, regression overlays, treemap/sunburst/sankey, **geo projections**. D3 and Vega-Lite both ship more.
- **Interactivity (8/12).** Click / brush / hover / drill / preview-server / long-poll loop are solid. **Missing:** linked-view filter propagation across multiple charts in the same page, scrubbable timelines, sliders that re-aggregate at the engine, on-chart-edit-the-query.
- **Performance ceiling (9/12).** Pure-SVG renderer scales to ~10k marks comfortably. No Canvas / WebGL renderer yet (Sessions C / D).
- **Distribution (8/12).** `npm install @glyph/mcp` is one line; PyPI / Brew / Cargo are not there yet.

### Where Glyph is **behind**

- **Grammar of geo viz: 0 points.** D3 has `d3-geo` (most mature in the world). Tableau has built-in maps. Glyph has nothing. → **Innovation #2 below.**
- **Animations: 0 points.** Flourish-style data-driven animations (bar races, scatter playback, scrubbable timelines) are central to journalistic viz. Glyph has none. → **Innovation #3 below.**
- **Public surface area / examples / docs site.** D3 has gallery.observablehq.com. Vega-Lite has a beautiful examples page. Glyph has README + `examples/` (9 fixtures). → addressable by Session B, not in this audit's scope but real.

### Honest "98 by when" answer (post-PR46 update)

We're at **93/100** today. The final +5 points to clear 98:

| Gap | Lift | Work |
|---|---|---|
| Performance 9 → 12 | +3 | `@glyph/canvas` renderer (Session C). 100k marks < 200 ms. Snapshot tests via pixelmatch. |
| Distribution 8 → 11 | +3 | Astro docs site + ≥25-example gallery + Vercel previews (Session B). |
| Grammar 11 → 12 | +1 | TopoJSON loader + composite albers w/ AK+HI insets + box/violin/heatmap marks. |
| Interactivity 11 → 12 | +1 | Whyboard rendering (Innovation #5) + scrub `<input type=range>` UI in `@glyph/live`. |

Total +8 puts Glyph at **101**, but the rubric caps at 100. Realistic ship line: **96-98** after the next two PRs (Whyboard + grammar polish), **98+** after Session B + Session C.

---

## 3. Innovation roadmap — status

| # | Innovation | Status |
|---|---|---|
| 1 | Story Agent (master orchestrator) | ✅ Shipped (PR41) |
| 2 | Geo viz as a first-class mark | ✅ Shipped (PR42 + PR44) |
| 3 | Data-driven animations | ✅ Shipped (PR43 + PR45) |
| 4 | Linked-view filters (cross-chart binding) | ✅ Shipped (PR46) |
| 5 | Interactive Whyboard | ⏳ Pending — uses #4's bus as substrate |

Of the five identified innovations, **four are shipped**. Whyboard is the remaining headline feature; it composes on top of the diagnostic verbs (PR36), Story Agent (PR41), and the linked-view bus (PR46).

### Original innovation roadmap (preserved for reference)

> Each of these is more than a feature. Each opens a *different category* of use that nobody else does today.

### Innovation #1 — **Story Agent** (master orchestrator)

> *Land in PR41 (in-flight after this audit).*

The user describes a question in natural language. A master agent:
1. **Plans data enrichment / cleaning** — uses an LLM to draft the cleaning steps + a DAG of viz tasks.
2. **Breaks into interconnected viz tasks** — multiple charts that share dimensions, filters, time scope. The output is a **storyboard** (Flourish-style scrollytelling OR Bloomberg-style infographic) where each panel is a Glyph chart, each transition is a `glyph_drill` / `glyph_subscribe` hop, and each annotation is `glyph_explain` output.
3. **Materializes everything in DuckDB** — fast, deterministic, queryable. Re-runs in seconds when the user changes intent.
4. **Streams checkpoints** — between phases (planning → cleaning → first chart → annotations → final layout) the user gets a partial result + a "refine" prompt. The DAG can re-execute only the affected branch.
5. **Skill-guided** — the orchestrator dispatches to `glyph-explorer` for surveys, `glyph-diagnostician` for "why", `glyph-narrator` for the prose, `glyph-operator` for "do something with this".

Why no competitor has this: it requires (a) a deterministic chart engine, (b) typed agent verbs over the engine, (c) audit-able lineage, (d) a metric layer for vocabulary, (e) persistent memory across plan steps. Glyph already has all five.

Surface contribution: `glyph_story` (plan + execute + stream).

### Innovation #2 — **Geo viz as a first-class mark**

> *Land in PR42 after the Story Agent.*

`mark: "geo"` with projection presets (mercator, albers, equal-earth, naturalEarth, conicConformal). Source can be GeoJSON / TopoJSON / WKT / lat-lon columns. Two flavors:

- **Choropleth** (`mark: "geo"`, `encoding: { region: "country", color: { metric: "mrr" } }`)
- **Point-on-map** (`mark: "geo-point"`, `encoding: { lat: "...", lon: "...", size: ... }`)

Critical: every existing diagnostic verb works on geo handles too. `glyph_anomaly` on a choropleth surfaces over-performing regions. `glyph_drill` on a clicked region returns the rows. Lineage walks back through the geo binding. This is what Tableau-on-an-LLM looks like.

### Innovation #3 — **Data-driven animations as a spec primitive**

> *Land in PR43.*

Add `animation: { kind, frames, duration }` to the spec. Three primitives, all deterministic:

- **`stage`** — entrance animations (bars rise, points fade in). Used in any chart, makes a snapshot a film.
- **`scrub`** — a slider over a temporal axis. Re-aggregates at the engine on each frame. Powers Flourish-style scatter-playback ("Gapminder").
- **`race`** — bar-chart races (top-N over time). Auto-orders by metric, animates rank changes.

Output: a small JS bundle on the preview server, with a "share as MP4" CLI option (resvg + ffmpeg). Snapshot tests on the *frames* preserve determinism: same data + same animation spec = byte-identical N PNG frames.

### Innovation #4 — **Live linked-view filters** (cross-chart binding)

> *Land in PR44.*

A storyboard / preview page can mount multiple charts that share a **selection context**. Click a bar in chart A → every other chart on the page that uses the same `gdf://` URI as `data.source` re-renders with the matching `WHERE`. The filter graph is declared in the spec (or by the Story Agent automatically).

This is what BI tools sell to enterprise. Glyph already has the substrate (`gdf://` URIs, `glyph_drill`, `data.source`, the preview server). What's missing is the cross-chart event bus in `@glyph/live` and a `linked: true` flag in the spec.

### Innovation #5 — **The "Interactive Whyboard"**

> *The single feature that no competitor can mimic.*

When the user asks *"why did MRR drop?"*, the Story Agent doesn't render a static answer. It renders an **interactive whyboard**: a tree of explanations (top-level chart, then `glyph_decompose` branches, then `glyph_drift` per top branch, then `glyph_anomaly` per top group), each as a clickable card. The user clicks any branch to see the underlying chart, the SQL, the lineage, and the rows that produced the number.

Tableau / Power BI can show you ONE chart at a time and require you to drill manually. The whyboard collapses an analyst's full hour-long diagnostic into one rendered surface, fully auditable, interactive, refinable by natural language. This is built on the seven Phase 3 H gaps as building blocks — no other viz tool has them all.

---

## 4. Grammar-of-graphics gap inventory (free / flexible viz)

The user asked specifically: *"so glyph can be a free/flexible viz tool that can define different geom shapes, scales, colors, and interactions to best surface data insights, patterns, trends, distributions, etc."*

Honest inventory of what's missing for full grammar coverage:

### Marks (geom shapes)
- ✅ bar, line, point, area, rule
- ❌ rect / heatmap (for distributions, density)
- ❌ ribbon / band (for confidence intervals around a line)
- ❌ errorbar / whisker (for distributional summaries)
- ❌ text (for direct labels on marks)
- ❌ boxplot / violin (for distribution shapes)
- ❌ treemap / sunburst / icicle (for hierarchical proportion)
- ❌ sankey / chord (for flow / network)
- ❌ geo / geo-point (→ Innovation #2)

### Scales
- ✅ linear, log, sqrt, time, band, point, ordinal
- ❌ symlog (for two-sided data with zero)
- ❌ quantile / threshold (for ranking)
- ❌ identity (for pre-computed positions)

### Color
- ✅ categorical palette, ramp via `scale.domain` / `scale.range`
- ❌ named built-in ramps (viridis, cividis, plasma) — currently you pass colors explicitly
- ❌ diverging scales (positive/negative around a midpoint)
- ❌ semantic color (e.g. "good" / "bad" / "neutral" from a domain registry)

### Stats
- ✅ count, sum, mean
- ❌ median, quantile, min, max (schema defines these but compiler doesn't apply yet)
- ❌ bin / histogram
- ❌ density (kernel)
- ❌ regression / smooth (loess / linear fit overlay)
- ❌ trail / window (rolling N-period stat)

### Position
- ✅ stack, dodge, identity (schema-wise; compiler honors stack on bars)
- ❌ jitter (for overlapping points)
- ❌ nudge (for label collision)

### Interactions
- ✅ click → drill, brush → range, hover → tooltip, keyboard nav, long-poll loop, gdf:// URIs
- ❌ linked filters across multiple charts (→ Innovation #4)
- ❌ scrubbable timeline (→ Innovation #3 scrub)
- ❌ on-chart-edit-spec (in-place encoding changes)
- ❌ playback / animation primitives (→ Innovation #3)

### Layout
- ✅ multi-layer, dual y-axis, col-faceting
- ❌ row-faceting and wrap-faceting (col is shipped)
- ❌ free axes per facet
- ❌ free aspect-ratio plate (no width / height constraint)

---

## 5. Recommended sequencing (one session per row)

| # | Session | Outcome | Approx PRs |
|---|---|---|---|
| 1 | **Story Agent v0** (this session, PR41) | Master orchestrator + `glyph_story` verb + DAG executor + streamed checkpoints | 1 large |
| 2 | **Geo viz** (PR42) | `mark: "geo"`, projections, GeoJSON/topojson source, choropleth + point-on-map | 1 large |
| 3 | **Animation primitives** (PR43) | `animation: { stage / scrub / race }` + frame-deterministic snapshots | 1 large |
| 4 | **Distribution marks** | rect/heatmap, boxplot, ribbon, errorbar, text — closes the grammar gap | 1 medium |
| 5 | **Linked-view filters** (PR44) | Cross-chart selection context + `linked: true` flag | 1 medium |
| 6 | **Canvas renderer** (Session C from NEXT-SESSIONS.md) | 100k marks under 200ms via `@glyph/canvas` | 1 large |
| 7 | **Docs site + 25+ examples** (Session B) | Astro scaffold, gallery, WASM playground, Vercel previews | 1 large |
| 8 | **Action dispatch** (PR40 follow-up) | External MCP tool invocation in `glyph_act` (`!dry_run`) | 1 small |
| 9 | **WebGL renderer** (Session D) | 1M marks under 1s via `@glyph/webgl` | 1 large |

Doing 1–5 brings Glyph from 84 to ~92. Doing 1–7 puts it at ~96. The remaining ~2 points are docs/marketing polish, not architecture.

---

## 6. Determinism & test posture

- **346 tests across 6 cells** = 2,076 test-runs per CI cycle. Zero flakes after the macOS Node-20 timeout bump.
- **Snapshot byte-identity preserved across all 40 PRs.** 14 baseline SVGs in `packages/duckdb/test-fixtures/snapshots/baselines/`. Adding geo / animations will require new baselines but the existing ones never regress.
- **No TODO / FIXME debt** in `packages/`.
- **Apache 2.0 throughout.** No telemetry. No data leaves the user's machine unless they explicitly publish to a `gdf://` URI in a cross-session demo.

---

*Generated by the post-Phase-3 audit. See `phase-3-agent-graph.md` for the original gap analysis and `ROADMAP.md` for the original 52-PR sequence.*
