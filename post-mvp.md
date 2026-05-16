# Glyph — Post-MVP Plan

> **What ships after Phase 0.** Detailed product design (user stories) + architecture upgrade plan, written after PR1–9 closed Phase 0.

Phase 0 (PR1–9) shipped the wedge: spec → DuckDB compute → SVG render → CLI + MCP + Claude Code skill, with data-bound interactive SVG, browser hydration, and chart-to-SQL drill-in.

This document covers **Phase 1 (grammar fill-in)** and **Phase 2 (reach)** in the detail that lets a small team execute against it.

---

## 0. Where Phase 0 left off — the honest baseline

**Shipped:**
- 5 npm packages: `@glyph/core`, `@glyph/duckdb`, `@glyph/cli`, `@glyph/mcp`, `@glyph/live`
- Spec: Wickham-style layered grammar, 9 KB JSON schema, 6 example specs
- Marks: `bar`, `point`
- Scales: linear, band, niceTicks
- Themes: light + dark
- Determinism: snapshot tests byte-identical across Linux/macOS/Windows × Node 20/22
- Interactivity: data-bound static SVG (`data-*` attrs, `<title>` tooltips), browser hydration with `onClick` / `onHover` / `onBrush` and `whereFor` / `whereForExtent` / `whereForZoom`
- MCP: four tools (`describe`, `render`, `query`, `drill`) — ~700 tokens of definitions
- 100/100 tests on 6-cell CI matrix

**Not shipped (acknowledged gaps):**
- Marks: `line`, `area`, `rect`, `text` are scenegraph-only — no compiler path
- Stats: `bin`, `count`, `sum`, `mean`, `median`, `quantile` are spec-validated but not compiled
- Facets / `row` / `col` / `wrap` — spec only allows what the compiler implements (no facet today)
- Multi-layer specs: compiler uses only `layers[0]`
- Python / Jupyter bindings
- WebGL / Canvas renderers
- Live-streaming charts, animations, transitions

These gaps are deliberate. Phase 0's job was to prove the wedge, not the breadth.

---

## 1. Phase 1 — Grammar fill-in (weeks 4–6)

### 1.1 User stories

#### **S5 — The notebook user who hits a Phase 0 mark gap**

> *"I want a line chart of revenue over time with a 7-day rolling mean. Glyph currently only does bar/point. I shouldn't have to leave Glyph for this."*

**Acceptance:** `mark: "line"`, `mark: "area"`, `mark: "rect"` all render correctly. Stats `bin`, `mean`, `count`, `sum` compile inline (no SQL transform required).

#### **S6 — The small-multiples enthusiast**

> *"Show me hourly rides one panel per day-of-week. I shouldn't have to write seven separate specs."*

**Acceptance:** Spec supports `facet: { row?: field, col?: field, wrap?: { field, columns } }`. Renderer emits a deterministic grid of small charts sharing axes.

#### **S7 — The composer who wants overlays**

> *"Bars for ride count and a line for average fare, on the same chart, dual y-axes. One spec."*

**Acceptance:** Compiler iterates over `layers[]`, not just `layers[0]`. Each layer composes its own marks into the scenegraph; per-layer `data` and `scale.side: "right"` resolve.

#### **S8 — The Cursor / Codex / Gemini-CLI user**

> *"I'd like the same `@glyph/skills` install I see for Claude Code, but for my editor."*

**Acceptance:** Day-one skills for Cursor (`.cursor-plugin/`), Codex (`.codex-plugin/`), Gemini CLI (matching manifest). Each invokes the same `@glyph/mcp` server; only the wrapper changes.

#### **S9 — The eval engineer scaling the corpus**

> *"I need ≥25 snapshot specs to feel confident the renderer is stable. Five isn't enough."*

**Acceptance:** Snapshot corpus grows to 25 (10 bar/point, 5 line/area, 5 multi-layer, 5 faceted). All byte-identical on the CI matrix.

### 1.2 Architecture upgrades

#### Grammar — D3-shape generators

The D3-shape primitive set (#2 from the "what to steal" list) lands here. Concretely:

- `d3-shape.line()` → translated into a `SceneMark` of type `path` with a `d` attribute computed from the scenegraph's point sequence.
- `d3-shape.area()` → `path` mark with the baseline + boundary curve.
- Curves (`curveLinear`, `curveMonotoneX`, `curveStep`) → public on the layer as `layer.interpolate: "linear" | "monotone" | "step"`.

We won't depend on `d3-shape` at runtime (extra ~12 KB); instead we *port the math* — three small generator functions with the same test fixtures as the upstream lib. This keeps the bundle thin and the determinism guarantee intact (no upstream-version drift).

#### New scenegraph mark: `path`

```ts
| {
    readonly type: "path";
    readonly d: string;           // SVG path command string
    readonly stroke: string;
    readonly strokeWidth: number;
    readonly fill?: string;       // for areas
    readonly opacity?: number;
  } & MarkData;
```

Renderer is straightforward: `<path d="..." stroke=...>`. The `d` string is byte-stable because every coordinate goes through `roundPx`.

#### Stats compiler (`bin`, `count`, `mean`, `sum`, `median`, `quantile`)

When a layer carries `stat`, the compiler rewrites the layer's `data.transform` to fold the stat into the SQL itself. So `stat: { type: "bin", params: { maxbins: 30 } }` becomes a `SELECT FLOOR((value - min) / step) * step AS x_bin, COUNT(*) AS y FROM <data>` rewrite before materialization. This keeps the renderer pure (it never sees stats) and pushes all aggregation to DuckDB.

#### Facets

Faceting is a layout transform. The compiler produces N scenegraphs (one per facet cell) and arranges them in a grid Scene with shared axes. The SVG renderer composes them into a single output. Each facet's marks still carry data-attrs scoped by facet value (`data-facet-row="2024-01"`).

#### Multi-layer composition

`compileSpec` becomes a fold over `layers[]`:

```ts
const scene = layers.reduce((accScene, layer) => {
  const layerMarks = compileLayer(layer, sharedScales, accScene);
  return appendMarks(accScene, layerMarks);
}, initialScene(spec));
```

Shared scales are computed by unioning each layer's domain extent for the relevant channel — unless the layer's encoding specifies `scale.side: "right"`, in which case a secondary scale is built and a right-axis emitted.

#### Skills for Cursor / Codex / Gemini

These are mostly packaging:

```
.cursor-plugin/plugin.json      # mcpServers: { glyph: npx @glyph/mcp }
.codex-plugin/plugin.json
skills/glyph-cursor/SKILL.md    # same SKILL content with Cursor-specific examples
```

Same MCP server underneath. The cost is real estate in the four agent ecosystems, not engineering.

### 1.3 Deliverables checklist

- [ ] `mark: line | area | rect` — compiler + renderer
- [ ] `stat: bin | count | sum | mean | median | quantile` — SQL rewrite
- [ ] `facet: { row?, col?, wrap? }` — multi-cell layout
- [ ] Multi-layer composition with shared + dual scales
- [ ] Snapshot corpus ≥ 25 specs
- [ ] Cursor / Codex / Gemini-CLI skill manifests
- [ ] Vega-Lite top-25 examples reproduced (Glyph specs are ≥10× tighter on the median)

---

## 2. Phase 2 — Reach (weeks 7–12)

### 2.1 User stories

#### **S10 — The Python data scientist**

> *"I work in Jupyter / Marimo. I want `pip install glyph`, then `glyph.render(spec, df)` returning an inline chart that I can click into."*

**Acceptance:** `pip install glyph` installs the Python package; `glyph.render()` accepts a pandas / polars DataFrame plus a spec; returns a Jupyter mimebundle (`{ "image/svg+xml": ..., "application/vnd.glyph.handle+json": handle }`); Marimo / Observable extensions hydrate using `@glyph/live` under the hood.

#### **S11 — The dashboard builder embedding charts**

> *"I want to ship a Glyph chart in my SaaS frontend that hits 1M+ marks without choking. SVG is too slow past ~10k."*

**Acceptance:** `@glyph/canvas` renders a Scene to Canvas; `@glyph/webgl` (built on `regl`) renders to WebGL. Same scenegraph, different backends. Renderer selection is per-call (`render(scene, { backend: "webgl" })`).

#### **S12 — The eval team writing a paper**

> *"We want a benchmark: 'can model X correctly translate dataset Y + question Z into a Glyph spec that renders correctly?' Glyph's determinism + spec compactness make it our standard."*

**Acceptance:** `@glyph/eval` package: `runEval({ model, datasets, tasks })` produces a JSON report. CI runs it quarterly against Claude Sonnet / Opus / GPT / Gemini / Mistral. Public leaderboard.

#### **S13 — The agent platform that wants the chart-as-tool**

> *"My agent platform isn't Claude Code or Cursor. I want the three Glyph tools as a library, not just an MCP server."*

**Acceptance:** `@glyph/mcp` already exports `createServer(state)`. Phase 2 also exports the three tools as plain functions (`describe`, `render`, `drill`) so platforms can wire them up however they like.

#### **S14 — The notebook user demanding interactive composition**

> *"Click a bar in chart A, get a filtered chart B in the next cell, automatically."*

**Acceptance:** `@glyph/live` gains a `chain(otherSvg, transform)` helper. The transform is a function that takes the source binding and returns a partial spec; the next chart re-renders with that filter applied via `glyph_query`.

#### **S15 — The eval engineer caring about determinism across spec versions**

> *"When the spec gains a new field, old snapshots break and I can't tell why."*

**Acceptance:** Spec carries a `version` field (`"glyph/0.1"`). Compiler dispatches by version. Snapshot baselines record the version they were generated against. CI fails clearly on mismatch.

### 2.2 Architecture upgrades

#### Canvas + WebGL renderers

Same scenegraph IR. The renderer dispatch is a simple branch:

```ts
function render(scene: Scene, opts: { backend: "svg" | "canvas" | "webgl" }) {
  switch (opts.backend) {
    case "svg":    return renderSvg(scene);
    case "canvas": return renderCanvas(scene, opts.target);
    case "webgl":  return renderWebgl(scene, opts.target);
  }
}
```

Canvas uses the same `roundPx`'d coordinates — but the determinism story changes (browsers' canvas implementations differ at subpixel level). Tier the determinism guarantee:

- **SVG**: byte-identical (the current bar).
- **Canvas**: structural-identical via scenegraph hash (pixel comparison only on the snapshot's render pipeline).
- **WebGL**: structural-identical only.

Most evals only need structural identity. Snapshot SVGs remain the reference.

#### Python bindings — two paths, pick one

**Option A — pyodide bridge.** Bundle a small Python wrapper that delegates to the JS package via pyodide / wasmtime. Tradeoff: install size (~15 MB), works everywhere Python runs.

**Option B — Rust core, then bindings via `pyo3`.** Rewrite the compiler + renderer in Rust (still embed DuckDB). Then bindings: `pyo3` → PyPI, `napi-rs` → npm (faster than the TS today), `wasm-bindgen` → browser. This is a 3-month side bet but the multi-language story becomes one codebase.

Recommendation: do Option A in Phase 2 (ship reach fast), evaluate Option B in Phase 3 once the spec is firmly stable.

#### Spec versioning

Add to the schema:

```ts
{
  "$schema": "https://glyph.dev/schemas/glyph/0.1.json",
  "version": "glyph/0.1",         // optional in 0.1; required from 0.2 onward
  ...
}
```

Compiler picks dispatch table by version. Migration codemods (`@glyph/migrate v0_x_to_0_y`) auto-bump existing specs. Snapshot baselines record the version they were generated under.

#### Eval pack

`@glyph/eval` package with three subcommands:

```bash
glyph-eval bench --dataset taxi --task anomaly --model claude-sonnet-4
glyph-eval suite --config eval.yaml         # batched leaderboard run
glyph-eval diff <baseline.json> <run.json>  # see regressions
```

Outputs JSON; CI runs it on PRs that touch the compiler.

#### Routing middleware mark — agent-driven specs

Optional Phase 2: a Vega-Lite → Glyph compatibility shim. `glyph_render` accepts a `vegaLite` field that gets translated. Why: leverage seven years of LLM training data on VL. Cost: one compiler module + a translation snapshot suite (~50 examples).

### 2.3 Deliverables checklist

- [ ] `pip install glyph` works in Jupyter + Marimo + Observable
- [ ] `@glyph/canvas` and `@glyph/webgl` renderers
- [ ] `@glyph/eval` package + public leaderboard
- [ ] Spec versioning + migration codemods
- [ ] Snapshot corpus ≥ 50 specs
- [ ] Optional: Vega-Lite → Glyph compatibility shim

---

## 3. Architectural diagram — where Phase 2 lands

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ Distribution surface                                                          │
│   Skills: Claude Code, Cursor, Codex, Gemini CLI    │  MCP server  │  CLI    │
│   npm (TS) │  PyPI (pyodide bridge)  │  Jupyter widget │ Marimo extension     │
└───────────────────────────────────────────────────────────────────────────────┘
                                       │
┌───────────────────────────────────────────────────────────────────────────────┐
│ Spec — versioned wire format (glyph/0.x)                                     │
│   data: { source, transform? }                                                │
│   layers[]: { data?, mark, encoding, stat?, position?, interpolate? }         │
│   facet?: { row?, col?, wrap? }   │  interactive?: { key?, hover? }           │
│   theme?, width?, height?, title?, version?                                   │
└───────────────────────────────────────────────────────────────────────────────┘
                                       │
                             Spec compiler (TS)
                                       │
            ┌──────────────────────────┴──────────────────────────┐
            │                                                      │
┌───────────────────────┐                              ┌────────────────────────┐
│  Compute pipeline     │   Arrow IPC zero-copy        │  Render pipeline       │
│   DuckDB-WASM /       │ ◀──────────────────────────▶ │   Scenegraph IR        │
│   @duckdb/node-api    │                              │     │                  │
│   + stat SQL rewrite  │                              │     ├─ SVG (canon.)    │
│   + facet partitioner │                              │     ├─ Canvas (10k–500k)│
└───────────────────────┘                              │     └─ WebGL (>500k)   │
                                                       └────────────────────────┘
                                       │
                            Determinism layer
                  (pinned versions, font corpus, snapshot baseline)
                                       │
                            Interactivity layer
        @glyph/live (browser)  │  glyph_drill (MCP)  │  Jupyter widget hooks
        click | hover | brush  │ equals | between | in
                       → all paths emit the same SQL predicates
```

---

## 4. Post-Phase-2 — what's *not* on the roadmap

These would dilute the wedge if shipped reflexively. Each gets a thumbs-up *only if* a specific customer asks:

- Real-time streaming charts (Perspective owns that lane)
- Animations / transitions
- 3-D / WebGPU
- A managed cloud service
- A GUI spec editor
- Custom DSLs in non-JSON (YAML, Python decorators)
- BI dashboard product (auth, scheduled refresh, permissions)
- R / ggplot bidirectional port

If demand emerges, evaluate via the same wedge test: *does this make "a chart is a query is a chart" more true?* If not, it doesn't ship.

---

## 5. Risks specific to post-MVP

| Risk | Why it bites in post-MVP | Mitigation |
|---|---|---|
| Spec breaks between Phase 1 and 2 (multi-layer changes inheritance semantics) | Existing baselines silently drift | Spec versioning lands *before* Phase 1 layer fold-out, even if optional initially |
| Python bridge bundle size kills the install story | pyodide is 15 MB; some teams won't tolerate it | Offer both: a server-side Python package that talks to a local `glyph-mcp` over stdio (no pyodide) for performance-sensitive teams |
| Determinism on Canvas is worse than SVG; surprises users coming from snapshot land | They report "tests fail on Windows" against Canvas pipeline | Document the tier explicitly: SVG = byte-identical, Canvas = structural-identical. Canvas snapshots compare against scenegraph hash, not pixel bytes |
| Vega-Lite shim becomes the de-facto API; native Glyph spec stops getting adoption | Path of least resistance for LLMs | Track usage ratio. If VL-shim > native specs by a wide margin after 6 months, that's signal we picked the wrong wire format — pivot to Vega-Lite-shaped specs |
| Microsoft / Tableau / Perspective ship a similar wedge | Real competitor with bigger distribution | Move first on agent-native; the wedge is the moat for ~12 months, not forever |

---

## 6. North-star metrics — post-MVP targets

| Metric | End of Phase 1 (~week 6) | End of Phase 2 (~week 12) | Stretch (~6 mo) |
|---|---:|---:|---:|
| GitHub stars | 2,500 | 10,000 | 20,000 |
| Weekly npm downloads (\`@glyph/core\`) | 1,500 | 12,000 | 50,000 |
| PyPI downloads (\`glyph\`) | n/a | 3,000 | 25,000 |
| MCP skill installs (Claude / Cursor / Codex / Gemini combined) | 500 | 3,000 | 10,000 |
| Snapshot corpus size | 25 | 50 | 100 |
| Vega-Lite top-25 coverage | 25 / 25 | 25 / 25 + extensions | 50 / 50 |
| Median spec token count vs Vega-Lite equivalent | 10× tighter | 10× tighter | 10× tighter |
| Public eval-pack runs / quarter | 4 | 12 | 50 |

---

## 7. Sequencing — what ships in what order

The order matters because every Phase 1 PR builds on the spec compiler; every Phase 2 PR builds on the interactivity surface from PR7–9.

1. **Spec versioning** (\`version\` field, even if optional) — *must land before anything below*
2. **Multi-layer composition** (compiler fold over \`layers[]\`)
3. **`line` mark** + d3-shape \`line()\` math ported
4. **Stats compiler** (\`bin\`, \`mean\`, \`count\`, \`sum\`)
5. **\`area\` mark** + d3-shape \`area()\` math
6. **Facet layout**
7. **Cursor + Codex + Gemini-CLI skill manifests**
8. **Snapshot corpus growth (5 → 25)**
9. **\`@glyph/canvas\` renderer**
10. **\`pip install glyph\` via pyodide bridge**
11. **Jupyter / Marimo widget**
12. **\`@glyph/eval\` package + public leaderboard**
13. **\`@glyph/webgl\` renderer**
14. **Vega-Lite shim** (optional, demand-gated)
15. **Snapshot corpus 25 → 50**

Each ships as one PR using the same cycle that landed PR1–9: branch off main → implement + tests → \`pnpm lint / build / typecheck / test\` clean locally → push → 6-cell CI green → squash-merge.

---

## 8. Bottom-line gating criteria for Phase 1 / 2

Phase 1 ships if:

1. All 25 Vega-Lite top-25 examples reproduce with ≥10× tighter Glyph specs
2. Snapshot corpus is byte-identical on Linux/macOS/Windows × Node 20/22
3. Multi-layer + facet + stat compilation each have ≥5 dedicated tests
4. Cursor + Codex + Gemini-CLI skills are live on the same launch day
5. License remains Apache 2.0

Phase 2 ships if:

1. \`pip install glyph\` works in a fresh Jupyter on three OSes
2. \`@glyph/canvas\` renders 100k-mark scatter in <1 s in Chrome
3. \`@glyph/webgl\` renders 1M-mark scatter in <1 s in Chrome
4. \`@glyph/eval\` produces a JSON report comparable across model versions
5. Snapshot corpus passes on the SVG path; structural-identity holds for Canvas

These criteria mirror the Phase 0 gates that PR1–9 cleared. The bar doesn't drop after MVP.
