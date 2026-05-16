# Glyph — Roadmap

> Single source of truth: where Glyph is, where it's going, and the gap-closing additions made after a Phase 1/2/3 review.

For execution detail, follow the per-phase docs:
- **Phase 0** — `mvp.md` (shipped)
- **Phase 1 & 2** — `post-mvp.md` (+ §A below)
- **Phase 3** — `phase-3-agent-graph.md` (+ §B below)

This document captures the **review-and-improve pass** that closed gaps found in those docs.

---

## Current state (post-PR11)

| Layer | What ships today |
|---|---|
| Spec | Zod-validated layered grammar; 9.2 KB JSON schema; 6 examples |
| Marks | `bar`, `point` |
| Scales | linear, band, niceTicks |
| Themes | light, dark |
| Compute | DuckDB Node engine + `materializeSpec` + `QueryHandle` |
| Render | SVG (pure, deterministic); data-bound when `spec.interactive` is set; native `<title>` tooltips |
| Interactivity | `@glyph/live` — `onClick / onHover / onBrush` + `whereFor / whereForExtent / whereForZoom` |
| Distribution | `@glyph/cli`, `@glyph/mcp` (4 tools), Claude Code skill, plugin manifest |
| Determinism | Snapshot byte-identity on Linux/macOS/Windows × Node 20/22 |
| Tests | 100/100 passing |

---

## §A — Gaps closed in Phase 1 / 2

The eight items below were missing from `post-mvp.md`. They're **added**, ordered by leverage. Each is acceptance-criteria-shaped so it can be picked up as a PR.

### A1 — Vega-Lite compatibility shim *(moved from Phase 2 to early Phase 1)*

**Why move it up.** LLMs have seven years of Vega-Lite training data. Without a shim, every prompt costs tokens correcting reflexive VL output into Glyph. With a shim, Glyph piggybacks on the world's most-trained chart grammar.

**Acceptance.**
- `glyph_render({ vegaLite: {...} })` accepts a VL spec and translates it.
- 50 VL examples reproduce byte-identical (with VL → Glyph translation snapshot tests).
- Translator is a pure function in `@glyph/core` with its own test suite.

### A2 — Legends, grid lines, annotation marks

**Why.** Without these, charts look amateur — fatal for the "showcase moment" that drives stars.

**Acceptance.**
- New `Scene.legends[]`: color / size / opacity legends with auto-placement.
- New `SceneAxis.gridLines: AxisTick[]` — light major + minor lines behind marks.
- New mark types: `rule` (vertical or horizontal reference line) and `text` (annotation already exists; spec exposes it).
- Compiler emits these from `spec.legend?` (bool or detailed config), `spec.gridLines?`, and a new `annotations[]` array.

### A3 — Accessibility (ARIA + keyboard navigation)

**Why.** Required for any chart that ends up in a business-user-facing product. Also: a high-signal credibility win for the launch post.

**Acceptance.**
- SVG root carries `role="img"` + `aria-label="<chart title>"` + `aria-describedby` pointing at an embedded `<desc>` with the `glyph_explain` headline.
- Each interactive mark gets `role="button"`, `tabindex="0"`, and an `aria-label` derived from the tooltip.
- `@glyph/live` adds keyboard handlers: `Enter` / `Space` fire `onClick`; arrow keys move focus through marks.
- WCAG 2.2 AA contrast checked for the default palettes (light + dark).

### A4 — Locale-aware formatting (i18n)

**Why.** A number formatted `1,234.56` in EN is `1.234,56` in DE. Date formatting matters even more. Without this, Glyph feels US-only.

**Acceptance.**
- `spec.locale?: string` (BCP-47). Defaults to `Intl.NumberFormat().resolvedOptions().locale`.
- Tick labels and tooltip values go through `Intl.NumberFormat` / `Intl.DateTimeFormat`.
- A `formatTick` registry lets users override per-channel (e.g. `encoding.y.format: "currency:USD"`).
- Determinism caveat: tick text varies by locale; snapshot tests pin to `en-US`.

### A5 — Theme extensibility

**Why.** Brand colors are non-negotiable for SaaS deployments. Two themes is a toy.

**Acceptance.**
- `spec.theme` accepts `"light" | "dark" | ThemeConfig`.
- `ThemeConfig = { palette: string[], background, fg, axis, grid, font?, fontSize? }`.
- A `defineTheme(config)` helper exports a `Theme` for reuse.
- Theme tokens flow through scenegraph + SVG renderer unchanged.

### A6 — Performance budget + benchmarks

**Why.** "Fast" is not a number. Without a budget, perf regresses silently.

**Acceptance.**
- `@glyph/bench` package: hard-pinned datasets (100 / 10k / 100k / 1M rows).
- Targets: SVG @ 10k marks < 100 ms; Canvas @ 100k marks < 200 ms; WebGL @ 1M marks < 1 s.
- CI fails on > 20% regression vs main baseline.
- README displays the current numbers from a recent CI run.

### A7 — Spec-driven tooltip overrides

**Why.** Auto-tooltips (`x: 7 · y: 210`) are right ~70% of the time. The other 30% need a per-spec override.

**Acceptance.**
- `encoding.tooltip` already exists in the spec; activate it.
- Single field: `tooltip: "customer_name"` → tooltip is just that field.
- Array: `tooltip: ["customer_name", "mrr"]` → comma-joined.
- Object: `tooltip: { format: "{customer_name} — ${mrr}" }` → templated.

### A8 — Docs site + example gallery (Phase 1, not Phase 2)

**Why.** A landing page with a paste-CSV-render-chart demo is the single biggest star driver. HyperFrames proved this. Their landing site is 80% of why they hit 15k.

**Acceptance.**
- Astro-based docs at `docs/` (or `apps/site/`) with auto-generated API from `@glyph/core`.
- Example gallery: ≥25 specs by Phase 1 end, each rendered live + spec shown.
- Interactive playground page: paste a CSV, write a spec, render in-browser via `@duckdb/duckdb-wasm`.
- Deployed to `glyph.dev` (or wherever) via Vercel preview on every PR.

### A9 — Python: skip pyodide, go napi-rs

**Why.** Pyodide bundle is ~15 MB and slow for compute. For analyst Python (where Glyph wants to win), users will pip-install once and expect native perf.

**Revised Phase 2 plan.**
- Rewrite the *compiler + renderer* in Rust as `@glyph/core-rs` (DuckDB stays embedded — already native).
- napi-rs → npm; pyo3 → PyPI; wasm-bindgen → browser.
- Existing TS surface continues to work; the Rust binding is opt-in for perf-sensitive paths.
- Net: PyPI `glyph` ~5 MB instead of 15 MB; 5–10× faster compile.

### A10 — MCP tool versioning

**Why.** When `glyph_act` / `glyph_explain` / `glyph_drill` arrive, older agents must still work.

**Acceptance.**
- Every tool description includes `"since": "0.x"`.
- `glyph_capabilities()` MCP verb returns the version + tool list — agents detect feature availability.
- Removing or breaking a tool is a major-version bump and a written migration note.

### A11 — Eval pack — concrete tasks + leaderboard

**Why.** Vague "we have an eval" doesn't move the needle. Specific, public benchmarks do (HumanEval, MMLU, MTEB all proved this).

**Acceptance.**
- 50 fixed tasks: dataset + natural-language question + reference spec.
- 5 model adapters: Sonnet / Opus / GPT-4 / Gemini / Mistral.
- Scoring: (1) parses, (2) renders without error, (3) Tanimoto similarity to reference rows.
- Public leaderboard at `glyph.dev/eval` updated quarterly.

### A12 — Telemetry policy

**Why.** "No telemetry" is the right default but ignores teams that *want* to share usage to improve the product.

**Acceptance.**
- Default: off, no calls.
- Opt-in: `glyph telemetry enable` writes `~/.glyph/telemetry.enabled`.
- Payload: anonymized counts of MCP verbs + spec mark types per day. **No data, no SQL, no schema, no user-derived strings.**
- Self-hosted endpoint option for enterprises.

---

## §B — Gaps closed in Phase 3

The eight items below were missing from `phase-3-agent-graph.md`.

### B1 — GDF authentication (Tier C — networked)

**Acceptance.**
- Signed URIs (HMAC-SHA-256 of `session_id + handle_id + expiry`).
- Token issued by the orchestrator at session start; sub-agents present it on every `gdf.subscribe`.
- Per-handle ACL table: `{ uri, allowed_roles: ["analyst", "operator"], expiry }`.

### B2 — Handle GC and TTL

**Acceptance.**
- Each `DataHandle` carries `ttl: ISODuration` (default 1 h).
- Refcount-based release on `gdf.unbind`; expired handles dropped automatically.
- Pressure handling: when memory > 80%, evict by LRU among unsubscribed handles.

### B3 — `glyph_explain` — heuristic-only, by spec

**Acceptance.**
- All four pipeline steps (top-line, compositional, anomaly, temporal) are deterministic SQL — no LLM in the pipeline.
- Output structure is fixed; an *outer* agent may post-process with an LLM, but `glyph_explain` itself is reproducible.

### B4 — Diagnostic math pinned

**Acceptance.**
- `glyph_anomaly`: z-score against group-windowed mean/stddev. Threshold default 2.0.
- `glyph_drift`: contribution = ((B - A) × share_of_A) ranked descending; ties broken alphabetically.
- `glyph_decompose`: Oaxaca-Blinder style mix-shift (volume × rate × interaction).
- `glyph_forecast`: Holt-Winters additive (seasonal period inferred from x-axis granularity); fallback to seasonal naïve when n < 2 × period.
- All four documented with formulas; snapshot tests pin output to numeric precision.

### B5 — Action-surface security

**Acceptance.**
- `glyph_act` defaults to **dry-run**: returns the action it *would* invoke, not the side-effect.
- Requires `"confirmed": true` in args to actually fire.
- The `actions[]` spec field is treated as a *declaration*, not authorization; the host MCP plane must explicitly enable the named tools.
- Audit log: every confirmed action writes to `~/.glyph/audit.duckdb` with timestamp, agent identity, selection, and tool result.

### B6 — Memory semantics in agent graphs

**Acceptance.**
- `~/.glyph/memory.duckdb` is per-user (not per-agent).
- Orchestrator owns write access; sub-agents are read-only.
- A `glyph_memory_propose` verb lets sub-agents suggest new entries; orchestrator approves before write.

### B7 — OpenTelemetry support

**Acceptance.**
- Every MCP verb emits a span via the OpenTelemetry SDK if `OTEL_EXPORTER_OTLP_ENDPOINT` is set.
- Span attributes: `glyph.handle_id`, `glyph.verb`, `glyph.agent_role`, `glyph.session_id`, `glyph.row_count`.
- Lineage DAG can be reconstructed from trace data — no separate observability stack required.

### B8 — Subscribable handles vs no-streaming non-goal

**Acceptance.**
- Subscriptions are *coarse*: notifications fire on `gdf.derive` of a parent or on explicit `gdf.republish`. **Not** on every underlying-row change.
- Documented boundary: ≤ 1 update per second per subscription; bursts coalesce to the latest version.
- Streaming charts (Perspective territory) remain explicitly out of scope.

### B9 — Cross-MCP data exchange (the multi-tool scenario)

**Why.** A realistic Claude Code session combines several MCP servers — e.g. ClickHouse MCP for warehouse data, Publora MCP for social data, a local CSV, plus Glyph. Today data crosses these tools as JSON-stringified text content (token-expensive, schema-lossy, no lineage). The user-flow target: *"render trend + outlier + distribution from these three sources inline, then let me click into the chart to drive next steps."* That flow works end-to-end today only with friction in (a) cross-tool data hand-off, (b) inline rendering, (c) click-back routing.

**Acceptance — four small additions to Phase 3 Tier A.**

#### B9a — `glyph_import(payload, name)` MCP verb

Accepts:
- `payload.kind: "arrow-ipc" | "json-rows" | "csv" | "url"`
- `payload.data` (string or base64) plus a `payload.schema?` hint

Returns a fresh `DataHandle` (GDF URI) the agent can pass to `glyph_render`. This collapses "ClickHouse returned 5000 rows → I need to chart them" from a multi-step JSON dance to one tool call.

#### B9b — Cross-MCP `data_handle` convention

Glyph's `glyph_render` learns to accept:

```json
{ "data": { "source": { "fromTool": "clickhouse_query.result.data_handle" } } }
```

When the spec's `data.source` is a `{ fromTool }` reference, the MCP server resolves it against the conversation's recent tool results. Any tool that voluntarily returns a `data_handle: { schema, rows | uri | arrow }` block becomes trivially chartable. Zero coordination required with the upstream MCP — it's read-if-present, ignored otherwise. Standard documented in Glyph's docs so other MCP authors can opt in.

#### B9c — Server-side PNG rasterization in `glyph_render`

Today `glyph_render` returns SVG text in a `text` content block. Add a sibling `image/png` content block (rasterized via `resvg-wasm`, deterministic). Hosts that render images inline (current and future Claude Code, Cursor, Codex, etc.) display the chart inline; hosts that don't fall back to the SVG text. Cost: ~50 LOC + one dep.

#### B9d — `@glyph/preview` Claude Code plugin (long-term, host-gated)

Once Claude Code exposes a hotspot-routing primitive for tool results (a feature ask, not currently shipped), a Glyph plugin can open a sidebar pane that hosts an interactive Glyph chart with native click → tool-call routing using `data-key`. Tracked here so we're ready the day the host supports it.

**Net effect.** With B9a–c, the scenario *"ClickHouse + CSV + Publora → trend + outlier + distribution → click-driven next-step"* runs end-to-end without flow breaks and without expensive row stringification.

---

## §C — Execution sequence

Reflecting both `post-mvp.md` + `phase-3-agent-graph.md` plus §A and §B above. **Numbers are PRs.**

### Phase 1 — Grammar fill-in (revised)

| PR | Scope | Source |
|---|---|---|
| 13 | Spec versioning + `glyph_capabilities` verb (foundation; nothing else lands without this) | A10 |
| 14 | Multi-layer composition (compiler fold over `layers[]`) | post-mvp §1 |
| 15 | `line` mark + ported d3-shape `line()` math | post-mvp §1 |
| 16 | `area` mark + ported d3-shape `area()` math | post-mvp §1 |
| 17 | Stats compiler — `bin`, `count`, `sum`, `mean` (SQL rewrite) | post-mvp §1 |
| 18 | Facet layout — `row` / `col` / `wrap` | post-mvp §1 |
| 19 | Legends, grid lines, `rule` annotation mark | A2 |
| 20 | Accessibility — ARIA + keyboard nav in `@glyph/live` | A3 |
| 21 | Locale-aware formatting (`Intl.*`) + `encoding.format` | A4 |
| 22 | Theme extensibility — `defineTheme` + `ThemeConfig` | A5 |
| 23 | Spec-driven tooltip overrides | A7 |
| 24 | Vega-Lite shim (50 example translations) | A1 |
| 25 | `@glyph/bench` package + CI perf gate | A6 |
| 26 | Snapshot corpus growth 5 → 25 | post-mvp §1 |
| 27 | Cursor + Codex + Gemini-CLI skill manifests | post-mvp §1 |

### Phase 2 — Reach (revised)

| PR | Scope | Source |
|---|---|---|
| 28 | Docs site (Astro) + interactive playground at `docs/` | A8 |
| 29 | Example gallery (≥25 specs rendered live) | A8 |
| 30 | `@glyph/canvas` renderer | post-mvp §2 |
| 31 | `@glyph/webgl` renderer (regl) | post-mvp §2 |
| 32 | `@glyph/core-rs` — Rust core + napi-rs binding | A9 |
| 33 | `glyph` PyPI package via pyo3 (consumes core-rs) | A9 |
| 34 | Jupyter widget reference implementation | post-mvp §2 |
| 35 | `@glyph/eval` package + 50-task benchmark + leaderboard scaffolding | A11 |
| 36 | Telemetry opt-in + endpoint | A12 |
| 37 | Snapshot corpus 25 → 50 | post-mvp §2 |

### Phase 3 — Agent Graph

| PR | Scope | Source |
|---|---|---|
| 38 | `DataHandle` type + non-breaking `QueryHandle` promotion | phase-3 §10 PR11 |
| 39 | `glyph_publish` / `glyph_subscribe` / `glyph_lineage` / `glyph_handles` MCP verbs (in-process only) | phase-3 §10 PR12 |
| 40 | `data.source: "gdf://..."` URI resolution | phase-3 §10 PR13 |
| 41 | Local IPC transport (`ATTACH` + UNIX socket) | phase-3 §10 PR14 |
| 41a | `glyph_import(payload, name)` MCP verb (Arrow IPC / JSON-rows / CSV / URL → handle) | **B9a** |
| 41b | Cross-MCP `data_handle` convention; `data.source: { fromTool: "..." }` resolution | **B9b** |
| 41c | Server-side PNG rasterization via `resvg-wasm` in `glyph_render` | **B9c** |
| 41d | `@glyph/preview` Claude Code plugin *(host-gated)* | **B9d** |
| 42 | Handle GC + TTL + refcount | B2 |
| 43 | Semantic / metric layer + `glyph_metrics` MCP verb | phase-3 §1 |
| 44 | `glyph_explain` (deterministic SQL pipelines) | phase-3 §2, B3 |
| 45 | `glyph_anomaly`, `glyph_drift` | phase-3 §3, B4 |
| 46 | `glyph_decompose`, `glyph_forecast` | phase-3 §3, B4 |
| 47 | Spec `actions[]` + `glyph_act` (dry-run by default) | phase-3 §4, B5 |
| 48 | Role-aware skills (explorer / diagnostician / narrator / operator / orchestrator) | phase-3 §5 |
| 49 | Persistent memory layer + `glyph_memory_*` verbs | phase-3 §6, B6 |
| 50 | Per-mark provenance + trust overlays + lineage UI walk-through | phase-3 §7 |
| 51 | OpenTelemetry instrumentation | B7 |
| 52 | Networked transport — Arrow Flight + signed URIs | phase-3 §10 PR23, B1 |

---

## §D — Concurrent workstreams (anyone can grab)

These don't block any specific PR but each is high-leverage:

- **Launch post draft** — *"We collapsed pandas + Vega-Lite into one artifact because agents kept getting confused juggling them"* — needs writing well before PR28 ships
- **Comparison table** in README — Glyph vs Vega-Lite / ggplot2 / Plot / Data Formulator — honest, with cells where competitors win
- **Show HN seed** — three demo videos: agent-driven exploration, drill-in via click, multi-agent diagnosis
- **Issue templates** for "I want to add a mark", "I want to add a stat", "I want to add a renderer" — lowers contributor friction

---

## §E — Non-goals (consolidated)

Things that would dilute the wedge and **will not ship** without an explicit re-evaluation:

| Anti-feature | Why not |
|---|---|
| Managed cloud / SaaS | Local-first is the bargain |
| Streaming sub-second charts | Perspective's lane |
| Animations, transitions | Determinism cost > value |
| 3-D / WebGPU | Not the wedge |
| Federated cross-org joins | Warehouse problem |
| No-code dashboard builder | The agent surface *is* the builder |
| GUI spec editor | Same |
| Vector / embedding-based "semantic search" | Stay declarative |
| Workflow engine (Airflow / Dagster) | Different concern |
| R / ggplot bidirectional port | Maybe; demand-gated only |

---

## §G — Worked scenario — ClickHouse + CSV + Publora + Glyph

A realistic Claude Code session combining multiple MCP servers, validating that B9 closes the cross-MCP gaps. Lines marked **✓** work today; **○** unlock with B9; **□** are existing roadmap items.

```
USER  ▸ "From last month's web sessions in ClickHouse, joined with my
         campaigns.csv, plus Publora's reach numbers — show me the daily
         trend, flag outlier days, and the distribution of session length.
         Let me click bars to dig deeper."

CC    ▸ tool_use: clickhouse_query(SELECT … FROM sessions WHERE …)        ✓
        → result.data_handle = { schema, arrow: <…ipc…> }                  ○ B9b
CC    ▸ tool_use: read_local_file(./campaigns.csv)                         ✓
        → CSV text content
CC    ▸ tool_use: publora_metrics(window=30d)                              ✓
        → result.data_handle = { schema, rows: […] }                       ○ B9b

CC    ▸ tool_use: glyph_import({ kind: "csv", data: "<csv text>" },        ○ B9a
                                "campaigns")
        → gdf://session/campaigns

CC    ▸ tool_use: glyph_render({
          version: "glyph/0.1",
          data: { source: "gdf://session/sessions" },                      □ PR40
          layers: [
            { mark: "line",  encoding: { x: "day", y: "sessions" } },      □ PR15
            { mark: "rule",
              encoding: { y: { metric: "p95_sessions" }, color: "red" } }, □ PR43 (metric layer)
            { mark: "point", encoding: { x: "day", y: "sessions",
                                         color: { stat: "anomaly" } } }    □ PR45
          ],
          interactive: { key: "day" }
        })
        → { svg, png, handle_id, schema, ... }                             ○ B9c (PNG inline)

USER  ▸ [clicks the 2024-03-12 bar]
        (B9d would route this back natively;
         until then, user types: "the 2024-03-12 bar")                     ○ B9d / ✓ via text

CC    ▸ tool_use: glyph_drill(handle_id, field: "day", equals: "2024-03-12") ✓
        → rows: 1, predicate: "\"day\" = '2024-03-12'"
CC    ▸ tool_use: glyph_explain(handle_id)                                  □ PR44
        → "2024-03-12 is +3.1σ above the 30-day mean. Sessions hit 8.4k
           (avg ~ 4.1k). Top contributing campaigns: spring_promo (38%),
           email_resub (17%)."

USER  ▸ "Email the email_resub team about the spike. Render the next
         seven days' forecast against this trend."

CC    ▸ tool_use: glyph_act(handle_id, "email_marketing_team",
                            { team_id: "email_resub", chart_png: ... },
                            confirmed: true)                               □ PR47
CC    ▸ tool_use: glyph_forecast(handle_id, horizon: "7 days")             □ PR46
        → new gdf://session/forecast-xyz
CC    ▸ tool_use: glyph_render({ overlays the original + forecast bands })

USER  ▸ Final answer: chart + narrative + audit trail of action.
```

**What's needed to make this real**: B9a–c (small, three PRs, ~200 LOC each + tests) and the rest of the existing Phase 1/3 plan. **B9d** is host-gated — not blocking; the text-based click handoff works in the interim.

---

## §F — Bottom-line bar

For Glyph to credibly hit 10 k stars in 3 months from launch (HyperFrames' trajectory):

1. **Phase 1 complete** with docs site + 25-example gallery + Vega-Lite shim *before* the launch post.
2. **All public MCP tools versioned**; no breaking changes after 0.1 ships.
3. **Apache 2.0** stays; no license change. Ever.
4. **Determinism floor**: SVG snapshots byte-identical across 6-cell CI; no commit lands that breaks this.
5. **Honest comparison table** in README. Every "we win" cell verifiable. Every "they win" acknowledged.
6. **Day-one skills** for Claude Code + Cursor + Codex + Gemini CLI when the launch post ships.

The plan in `mvp.md` + `post-mvp.md` + `phase-3-agent-graph.md` + this ROADMAP gets us there.
