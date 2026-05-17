# Next sessions — starter pack

> One doc you (or whoever picks this up) can read to start a fresh Claude Code session and land each remaining major unit cleanly. The whole repo state is preserved on `main`; this just gives the next session a focused entry point.

## Current state

30 PRs merged. 254 tests across Linux/macOS/Windows × Node 20/22.

Six packages on `main`:

| Package | What it does | Status |
|---|---|---|
| `@glyph/core` | spec AST, compiler, scenegraph, SVG renderer, VL shim, capabilities | ✅ |
| `@glyph/duckdb` | Node DuckDB compute engine + materializeSpec | ✅ |
| `@glyph/cli` | render / describe / query / check | ✅ |
| `@glyph/live` | browser hydration: click / hover / brush / keyboard + SQL helpers | ✅ |
| `@glyph/mcp` | 9-tool MCP server (capabilities, describe, render, query, drill, import, preview, await_interaction, close_preview) | ✅ |
| `@glyph/preview-server` | localhost-only interactive HTTP preview | ✅ |

Phase 1 grammar complete: `bar` / `point` / `line` / `area` / `rule` marks + `count` / `sum` / `mean` stats + multi-layer + dual y-axis + faceting + legends + grid lines + ARIA + keyboard nav + tooltip overrides + theme extensibility + locale formatting + cross-MCP `glyph_import` + PNG content blocks + Vega-Lite shim + multi-IDE plugin manifests (Claude Code / Cursor / Codex / Gemini CLI).

## How to start a session

```bash
cd ~/Documents/glyph
git pull
claude
```

Then paste **one** of the prompts below. Each is self-contained and gives the next session enough context to work in isolation.

---

## Session A — Phase 3 GDF foundation *(recommended first)*

Highest-leverage remaining work. Unblocks every Phase 3 §1–§7 innovation gap.

```
Implement Phase 3 Tier A from phase-3-agent-graph.md §8 + §10. Three PRs:

1. Promote QueryHandle to DataHandle in @glyph/core/spec/types.ts —
   add URI (gdf://session/<id>), version (monotonic int), lineage
   { parents, sql, producer }, provenance { freshness, sampleRows,
   filteredOut, confidence }, binding { kind, location } fields.
   Keep the old QueryHandle shape working (non-breaking).

2. Add four MCP verbs in @glyph/mcp:
     glyph_publish(handle_id, scope?)        → { url, version }
     glyph_subscribe(uri)                    → DataHandle
     glyph_lineage(uri, depth?)              → tree
     glyph_handles()                         → list all session handles
   In-process transport only; networked Arrow Flight defers.

3. Spec.data.source accepts a "gdf://..." URI; compiler resolves it
   via the session's handle registry instead of registering a new
   source from a file path.

Acceptance: phase-3-agent-graph.md §13 Tier A gating criteria.
- Two-process demo: agent A publishes handle, agent B subscribes + renders
- glyph_lineage walks back to a source file
- Snapshot byte-identity still holds for non-interactive specs
- MCP surface stays under 1000 tokens of definitions

Read these first:
- phase-3-agent-graph.md (the spec)
- packages/core/src/spec/types.ts (where QueryHandle lives)
- packages/mcp/src/server.ts (where the 9 existing tools are registered)
- packages/mcp/src/state.ts (engine + handle store)
```

---

## Session B — Docs site + interactive playground

Biggest 10k-star lever once shipped. Drives all the demo content for Show HN.

```
Build the docs site at apps/site/ using Astro. Pull from existing
materials in this repo. Scope: ROADMAP §C PR28 + PR29.

Required:
1. Astro scaffold with light + dark themes matching @glyph/core's themes
2. Auto-generated API docs from @glyph/core via TypeDoc
3. Live example gallery — for every spec in examples/ (currently 9),
   render the SVG inline + show the spec source side-by-side
4. Interactive playground page: paste a CSV, write a spec, render in
   the browser via @duckdb/duckdb-wasm. Use @glyph/core for compile + render.
5. Comparison table from ROADMAP §2 (Glyph vs Vega-Lite, ggplot2,
   Observable Plot, Data Formulator, ECharts, D3)
6. Show the cross-MCP scenario from ROADMAP §G as a hero animation
7. Deploy via Vercel preview on every PR

Acceptance:
- ≥25 working examples in the gallery (grow examples/ to match)
- Lighthouse scores ≥ 90 for performance / a11y / SEO
- Mobile-responsive
- Dark/light toggle preserves theme on reload
- Playground works offline once the page loads (DuckDB-WASM bundle)

The hero animation should reproduce demo-multi from the Phase 1 demo:
bar + line on dual y-axis, then a click → drill-in → narrative.
```

---

## Session C — `@glyph/canvas` renderer

Unlocks the "100k marks under 200 ms" performance story.

```
Implement @glyph/canvas — a Scene → HTMLCanvasElement renderer that
mirrors @glyph/core's SVG output for the same scenegraph IR.

Scope: ROADMAP §C PR30 (in the original numbering — now PR after this
session's batch).

Read these first:
- packages/core/src/scenegraph/types.ts (the IR contract)
- packages/core/src/render/svg.ts (reference implementation)

Acceptance:
- Same Scene → equivalent visual output (sub-pixel diffs ok)
- Snapshot tests use pixelmatch against PNG baselines
- @glyph/bench (a sibling new package) shows 100k bar marks render
  in <200 ms in Node-canvas
- Faceted scenes render each panel inside its own canvas context
- Determinism floor documented: structural-identical (scenegraph hash
  matches) is the bar, not byte-identical pixels (drivers vary)

Stay narrow — no WebGL, no new interactivity. Browser-side `@glyph/live`
needs to hydrate Canvas via the same data-* attrs the SVG renderer
emits; emit them as a sibling `<map>` element with area hotspots.
```

---

## Session D — `@glyph/webgl` renderer

The biggest perf win. Targets ≥1M marks.

```
Implement @glyph/webgl using regl. Same scenegraph IR as @glyph/core.
Target: 1M marks under 1 s on a typical laptop.

Read packages/core/src/scenegraph/types.ts before you start.

Start with the marks in order of WebGL difficulty:
1. circle — instanced point sprites with shader-based discard for radius
2. rect — instanced quads via gl.TRIANGLE_STRIP
3. path (line) — gl.LINE_STRIP with indexed vertices
4. path (area) — triangulated fill + outline pass

Snapshot tests are structural (scenegraph hash), not pixel — GPU output
isn't byte-deterministic across drivers.

Browser-only. Use happy-dom + @ungap/structured-clone for unit tests;
visual regression tests need a real GPU (skip in CI by default; gate
behind WEBGL_VISUAL_REGRESSION=1 env var).
```

---

## Session E — Rust core `@glyph/core-rs`

Largest single unit; multi-week. Only start if you're committing to
maintain it long-term.

```
Implement @glyph/core-rs as described in post-mvp.md §A9 + ROADMAP §C
PR32. A Rust port of @glyph/core's compiler + SVG renderer, exposed
to Node via napi-rs.

Acceptance: produces byte-identical SVG to the TS reference for every
spec in packages/duckdb/test-fixtures/snapshots/specs/.

Order of work:
1. Cargo workspace + napi-rs scaffolding + prebuilt-binaries CI setup
2. Port packages/core/src/compiler/scales.ts → scales.rs (smallest)
3. Port compile.ts → compile.rs
4. Port render/svg.ts → svg.rs
5. Snapshot equivalence test: each .json spec, compare TS output
   bytes to Rust output bytes
6. Bench: render bar/line/area at 10k / 100k / 1M marks via @glyph/bench
   (sibling new package); Rust should beat TS by ≥3× for compile,
   ≥5× for render

Don't touch DuckDB integration — that stays in TS via @glyph/duckdb.
The Rust crate only does compile + render.
```

---

## Session F — Python `glyph` on PyPI

Depends on Session E (Rust core) being merged.

```
Implement the `glyph` PyPI package per post-mvp.md §A9 + ROADMAP §C PR33.
Depends on @glyph/core-rs (Session E) being merged.

Stack: pyo3 + maturin. Expose:
  glyph.describe(source) → Schema
  glyph.render(spec, df=None) → Artifact
    - df can be a pandas or polars DataFrame
    - Returns a Jupyter mimebundle so notebooks render inline
  glyph.query(handle, sql) → rows

Acceptance:
- pip install glyph works on Linux/macOS/Windows (Python 3.10+)
- Jupyter notebook end-to-end demo
- pandas + polars DataFrame interop
- maturin publish workflow via GitHub Actions on git tag
```

---

## Session G — `@glyph/bench` + CI perf gate

Smaller; can run in parallel with anything.

```
Implement @glyph/bench package per ROADMAP §A6.

Hard-pinned datasets at 100 / 10k / 100k / 1M rows (synthetic, deterministic).
Bench harness: for each (renderer, mark-type, row-count) tuple, measure
median wall time over 5 runs. Output JSON.

CI gate: a new GitHub Actions job runs the bench on every PR and fails
if any tuple regresses >20% vs main's baseline (stored in
.github/bench-baseline.json).

Targets:
- SVG @ 10k marks < 100 ms
- Canvas @ 100k marks < 200 ms (post-Session C)
- WebGL @ 1M marks < 1 s (post-Session D)

README shows the current numbers from a recent CI run via a workflow
badge or generated table.
```

---

## Session H — Phase 3 §1–§7 innovation gaps

Once Session A (GDF foundation) lands, the seven gaps from
phase-3-agent-graph.md §1–§7 can each be their own session:

| Gap | Session prompt |
|---|---|
| §1 Semantic / metric layer | `Implement the metric layer per phase-3-agent-graph.md §1: glyph.metrics.yaml + glyph_metrics MCP verb + compiler rewrite of { "metric": "mrr" } encoding to the registered SQL.` |
| §2 Self-explaining charts | `Implement glyph_explain per phase-3-agent-graph.md §2 + §B3: deterministic SQL pipelines for top-line / compositional / anomaly / temporal. Returns { headline, highlights[], questions[] } JSON.` |
| §3 Diagnostic primitives | `Implement glyph_anomaly + glyph_drift + glyph_decompose + glyph_forecast per phase-3-agent-graph.md §3 + §B4. Pinned math.` |
| §4 Action surfaces | `Implement spec.actions[] + glyph_act per phase-3-agent-graph.md §4 + §B5. Dry-run by default; audit log to ~/.glyph/audit.duckdb.` |
| §5 Role-aware skills | `Add five new SKILL files: skills/glyph-explorer, skills/glyph-diagnostician, skills/glyph-narrator, skills/glyph-operator, skills/glyph-orchestrator. Each ≤200 tokens.` |
| §6 Persistent memory | `Implement ~/.glyph/memory.duckdb + glyph_memory_save/recall/list/forget per phase-3-agent-graph.md §6 + §B6.` |
| §7 Trust signals | `Per-mark provenance + <glyph-trust> overlay + glyph_lineage UI walk-through per phase-3-agent-graph.md §7.` |

---

## Coordination tips

- **One major unit per session.** Don't try to land Sessions A + B + C in one chat — context fills up, CI cycles accumulate, content-filter risk grows.
- **Each session starts with `git pull`** so you're working off the latest `main`.
- **Each session ends with PRs merged + passing CI**, not "I started but didn't finish." If you can't finish, leave a WIP branch + a follow-up note.
- **The starter prompt is the contract.** Paste it at the top of the new session, then let Claude work. Don't drift into other items mid-session.
- **Tests are non-negotiable.** Every session must keep the cross-platform 6-cell CI matrix green. Snapshot baselines update only when intentional.
- **The launch happens after Sessions A + B at minimum.** Until the docs site exists, the public Show-HN can't tell the wedge story visually.

## What's already on `main` and shouldn't change in these sessions

The Phase 0 + Phase 1 surface is frozen. None of these sessions should:
- Add or remove MCP tools (except where their scope explicitly does — Session A adds GDF verbs; Session H gaps add their own verbs)
- Change the spec wire format (only additive fields allowed via `version` bump)
- Break snapshot byte-identity for non-interactive specs (the determinism floor)
- Touch `@glyph/mcp`'s 9 existing tools' contracts

When in doubt, the contract is whatever `ROADMAP.md` + `phase-3-agent-graph.md` say, and what the 254 tests already enforce.
