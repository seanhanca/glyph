# D3-COMPARISON.md — what Glyph can do, can't do, vs the D3 gallery

> Honest gap analysis after a deep walk through [observablehq.com/@d3/gallery](https://observablehq.com/@d3/gallery). Glyph's surface today vs every category of D3 chart. **Major architectural gaps** are flagged with 🚨 — those need design work, not just a new mark.

---

## TL;DR

Glyph and D3 solve **different problems** even when the outputs look similar:

| | Glyph | D3 |
|---|---|---|
| **Primitive** | Spec (JSON) → compiler → scenegraph → renderer | Code that emits SVG directly |
| **Scope** | Grammar of graphics (constrained) | Anything you can draw with SVG (unconstrained) |
| **Audience** | LLM agents + production dashboards | Custom one-off visualizations + journalism |
| **Determinism** | Same spec + same data = same SVG (byte-identical) | Whatever you code |
| **Ceiling** | What the spec language allows | Browser graphics ceiling |

**Glyph covers ~40 of D3's ~120 gallery entries today.** What's missing splits into three buckets:

1. **Same architecture, missing marks** — solvable by adding mark types (small).
2. **Same architecture, missing primitives** — solvable by adding layout / stat / scale modules (medium).
3. **🚨 Different architecture** — solvable only by introducing new compiler infrastructure (large). These are the *real* gaps.

---

## What Glyph already does well (mapped to D3 gallery)

| D3 example | Glyph equivalent | Notes |
|---|---|---|
| Bar chart, horizontal bar, stacked bar | `mark: "bar"` + `position: "stack"` | ✅ |
| Line chart, area chart, normalized stacked area | `mark: "line"` / `"area"` | ✅ |
| Scatterplot, scatterplot matrix | `mark: "point"` | ✅ (single panel; SPLOM via facet) |
| Heatmap, day calendar | `mark: "heatmap"` | ✅ (PR49) |
| Boxplot | `mark: "boxplot"` | ✅ (PR50) |
| Choropleth, world map, mercator/equirectangular/albers/natural-earth | `mark: "geo-region"` + 4 projections + graticule | ✅ (PR42 + PR44 + PR57 TopoJSON) |
| Bubble map (lat/lon points) | `mark: "geo-point"` | ✅ |
| Faceted small multiples | `spec.facet.col` | ✅ (col-faceting; row-facet deferred) |
| Bar race, scatter playback | `animation: { kind: "race" / "scrub" }` + `renderFrames` + `attachScrub` | ✅ (PR45 + PR51) |
| Multi-axis dual-y | `encoding.y.scale.side: "right"` per layer | ✅ |
| Forecast + confidence band | `glyph_forecast` (seasonal-naive + Holt-Winters) | ✅ (PR36 + PR56) |
| Diff / drift attribution | `glyph_drift` | ✅ (PR36) |
| Anomaly / outliers highlighted | `glyph_anomaly` | ✅ (PR36) |
| Tooltip / interactive marks | `spec.interactive` + `@glyph/live` | ✅ |

**Roughly: every D3 cartesian chart of <10k marks ports cleanly to Glyph.** The agent affordances (explain, anomaly, lineage, Whyboard, story) are then strict Glyph wins — D3 doesn't have these.

---

## What Glyph can't do today — same architecture, missing marks

These are **small PRs**. The architecture supports them; we just haven't added the mark type.

| D3 example | What's missing | Effort |
|---|---|---|
| **Ribbon plot / band plot** | `mark: "ribbon"` (paired y-low + y-high per x). One new mark builder. | Small |
| **Errorbar / whisker** | `mark: "errorbar"` standalone (today only inside boxplot). | Tiny |
| **Range area** (stocks: open-close shaded) | Variant of ribbon with extra fill rules. | Small |
| **Hexbin** | `stat: "hexbin"` + the rect/hex mark already in scenegraph. | Small |
| **Slope chart** | Line between two paired points; emits today via line mark with stat group. | Tiny |
| **Bump chart / rank-flow** | Line mark with sorted rank encoding. The rank stat needs adding. | Small |
| **Calendar heatmap** | Already possible via `mark: "heatmap"` with day + week-of-year axes; just needs a layout helper. | Tiny |
| **Density (1D KDE)** | `stat: "density"` → outputs ribbon coordinates. | Small |
| **Beeswarm plot** | `stat: "beeswarm"` (deterministic 1D collision-resolved positioning) → points. | Small-medium |
| **Step line / staircase** | Variant of line mark with `interpolate: "step"`. | Tiny |

**Total**: ~10 small additions close all of these. Each is a single PR with new mark/stat type + tests.

---

## What Glyph can't do today — same architecture, missing primitives (medium)

These need **a small new module** but no compiler-architecture rewrite.

### Layout module

D3 has a `d3-hierarchy` and a `d3-force` package. They produce **positions** from data, not aesthetics. Glyph has scales but no layouts. Adding a `@glyph/core/layout` module gives us:

| D3 layout | Output | Glyph need |
|---|---|---|
| `treemap` | rectangles per node | `layout: "treemap"` → rect marks with x/y/w/h per row |
| `partition / icicle / sunburst` | nested rectangles or arcs | Treemap variant + arc support |
| `pack` (circle packing) | circles per node | `layout: "pack"` → circle marks |
| `tree / cluster` | (x, y) per node | `layout: "tree"` → line + point marks |
| `force` (force-directed) | (x, y) per node after simulation | `layout: "force"` (but: not deterministic without seed; see §🚨 below) |
| `chord` | arcs + ribbons | New mark type + layout |
| `sankey` | rectangles + connecting paths | New mark type + layout |

The layout pattern: input is `{ nodes: [...], edges: [...] }` (a graph) or `{ root: {...}, children: [...] }` (a hierarchy). Output is per-node positions (x, y, r, w, h). Then existing mark builders draw them.

**The data model is the wrench.** Today every `compileSpec` consumes flat `rows + schema`. Hierarchies aren't tabular. We'd need a new data shape: `data.hierarchy: { root, accessor }` or `data.graph: { nodes, edges }`. The spec parser, materializer, and compiler all need to grow to accept these — that's the *primitive*-level work.

### Stat module additions

D3 produces statistics inline via `d3.contour`, `d3.bin`, `d3.regression`. Glyph has `stat: count | sum | mean`. We need:

- `stat: "bin"` (1D histogramming → bar mark)
- `stat: "contour"` (2D density → path mark) — see contour below
- `stat: "regression"` (linear / loess → line overlay) → composes with multi-layer
- `stat: "density"` (1D KDE → ribbon)
- `stat: "hexbin"` (2D binning → rect/hex)

Each is a deterministic SQL+JS computation that pre-aggregates rows before mark building.

### Scale module additions

D3's `d3-scale` has scales Glyph doesn't:

- **Diverging scale** — for net-positive / net-negative metrics. Two-stop interpolation around a midpoint.
- **Quantile scale** — bins continuous values into N buckets by rank.
- **Threshold scale** — explicit breakpoints (e.g. `[0, 25, 50, 75, 100] → 4 color classes`).
- **Pow scale** — for area/radius encoding (sqrt is shipped; pow(2) and pow(0.5) are not).

These all fit in `@glyph/core/compiler/scales.ts` — small additive PRs.

---

## 🚨 What Glyph can't do — architectural gaps

These are the **hard** problems. Each requires non-trivial compiler infrastructure beyond a new mark or stat.

### 🚨 Gap 1 — No polar / radial coordinate system

D3 has `d3-shape` arcs + `d3.lineRadial` + `d3.areaRadial`. Glyph assumes **cartesian (x, y) pixel space everywhere**:

- The compiler builds scales over linear x/y ranges.
- SceneMark types (`rect`, `circle`, `line`) carry cartesian `x` / `y`.
- The SVG renderer emits cartesian coordinates directly.

**The four D3 examples the user asked about all need polar:**

- [`@d3/radial-cluster/2`](https://observablehq.com/@d3/radial-cluster/2) — tree laid out in polar coords (angle ∈ [0, 2π], radius ∈ [0, R]).
- [`@d3/tree-of-life`](https://observablehq.com/@d3/tree-of-life) — radial dendrogram + edge bundling.
- Pie / donut / nightingale-rose charts — arc marks.
- Polar grids, clock plots, wind roses.

To add polar:

1. **New spec field**: `coordinates: { type: "polar", origin?, ... }`.
2. **New scale type**: `angle` (maps domain → [0, 2π]) + `radius` (maps domain → [0, R]).
3. **New SceneMark type**: `arc` (cx, cy, innerRadius, outerRadius, startAngle, endAngle).
4. **Compiler awareness**: when `coordinates.type === "polar"`, the scale-building pass uses angle+radius instead of x+y. Mark builders translate to cartesian at render time (the projection is `(angle, radius) → (cx + r·cos(θ), cy + r·sin(θ))`).
5. **Renderer awareness**: the SVG `<path>` for an arc uses the elliptical-arc command (`A`).

**This is its own session.** Touches schemas, types, compiler, renderer, scenegraph. Probably 800 LOC + tests.

**Why it matters**: pie/donut/rose are bread-and-butter dashboard charts. Radial trees / dendrograms are how biology / phylogenetics / org-chart viz are done. No polar = no presence in those domains.

---

### 🚨 Gap 2 — No hierarchy / graph data model

Today: `data: { source: file.csv }` → tabular rows. Hierarchies and networks aren't tabular.

D3 lets you say `d3.hierarchy(jsonTree)` and walk the tree. Glyph has no way to express a tree input. **Every hierarchical viz in the D3 gallery is unreachable today.**

To add:

1. **Schema extension**: `data.shape: "rows" | "hierarchy" | "graph"`. Default stays "rows".
2. **Materializer extension**: when `shape: "hierarchy"`, treat the source as JSON tree, not CSV/Parquet rows. Store `{ root, edges }` in the handle instead of `{ rows, schema }`.
3. **DuckDB integration**: hierarchies *can* be expressed in SQL via recursive CTEs. But the spec ergonomics need a non-SQL path too.
4. **`DataHandle` extension**: add `shape` field; consumers branch on it.
5. **Compiler dispatch**: layouts only fire on `shape: "hierarchy" | "graph"`.

**Why it matters**: the entire family of "what depends on what?" / "what flows where?" charts. Sankey for revenue attribution, dendrograms for clustering, force-directed for social-network analysis, treemap for budget breakdowns.

**Estimated cost**: ~1000 LOC + tests, mostly in `@glyph/core/spec` + `@glyph/duckdb/materialize`.

---

### 🚨 Gap 3 — No transition-between-states ("morph") primitive

[`@d3/streamgraph-transitions`](https://observablehq.com/@d3/streamgraph-transitions) is the canonical example. The user switches between two encodings (`offset: zero` ↔ `offset: wiggle`), and **every mark smoothly interpolates** its path between the two states.

Glyph's animations are kind-based (entrance fade, race, scrub). There's no "given two scenes, smoothly interpolate marks between them" primitive.

To add:

1. **Spec extension**: `animation: { kind: "morph", from: <handle_id_or_spec>, duration_ms }`.
2. **Compiler change**: build both scenes; produce per-mark pairwise interpolation tracks (`width: 50 → 80`; `path-d: "M…" → "M…"`).
3. **SVG path morphing** is hard. SMIL `<animate>` can't interpolate arbitrary path-d strings; it needs the same number of commands in the same order. Implementations like `flubber` solve this with topology-preserving interpolation. We'd need to either include such an algorithm or accept that morph only works on shape-compatible scenes.
4. **Renderer change**: emit per-mark `<animate>` (or use Web Animations API when on browser).

**Why it matters**: morphing is the secret ingredient that makes "data video" (NYT-style scrolly-telling) feel produced rather than scripted.

**Estimated cost**: ~600 LOC. Path-d interpolation is the hard part; Glyph's path marks already use restricted M/L/Z commands which makes this tractable.

---

### 🚨 Gap 4 — No contour / density surface primitive

[`@d3/volcano-contours/2`](https://observablehq.com/@d3/volcano-contours/2) — isolines computed from a 2D scalar field (a grid of values). D3 has `d3-contour` + marching squares.

Glyph has no:

- 2D scalar field data shape (grid of values, not rows).
- Marching-squares / marching-cubes implementation.
- "Contour" mark type that draws closed path lines at specified levels.

To add:

1. **New data shape**: `data.shape: "grid"` — a 2D array of values with explicit `(rows, cols, cellWidth, cellHeight)` metadata.
2. **New stat**: `stat: "contour"` — runs marching-squares to produce contour paths per level.
3. **New mark**: `mark: "contour"` with `levels: [...]` and `interpolate: "linear" | "smooth"`.
4. **Reasonable defaults**: auto-compute levels from data range; choose a color ramp.

**Why it matters**: terrain maps, density plots, heatmap-of-heatmaps, signal-processing viz. Also: gradient maps for AI model interpretability (saliency maps).

**Estimated cost**: ~700 LOC. Marching squares is well-documented; main work is the grid data shape + the new mark.

---

### 🚨 Gap 5 — No force simulation / physics

Force-directed graphs, beeswarm with collision detection, dust simulations, tetris-style packing — they all need iterative physics. D3 has `d3-force`. Glyph has none.

The deeper problem: force simulations are **non-deterministic** unless seeded. Glyph's design contract is byte-identical SVG for same input. A force layout breaks that.

To add:

1. **Seeded RNG** — every force simulation must accept a `seed: number` for reproducibility.
2. **`@glyph/core/physics`** — Verlet integrator + standard forces (link, charge, center, collide).
3. **Layout**: `layout: "force"` runs N iterations, emits final per-node coords.
4. **Determinism**: same seed + same iteration count + same data = same output. Snapshot-testable.

**Why it matters**: network visualization. Beeswarm plots for one-dimensional distributions. Any "let the data find its own shape" layout.

**Estimated cost**: ~800 LOC. The physics math is small; the design challenge is keeping it deterministic and testable.

---

### 🚨 Gap 6 — No "custom mark" escape hatch

D3's superpower is that **anything you can draw with SVG, you can draw with D3**. Glyph has fixed mark types — if you need a chart that doesn't fit one, you're stuck.

The tension: a "custom mark" callback (a JS function that takes a row and emits SceneMarks) would break the spec-is-JSON principle. The spec would have to carry code.

Two workable middle grounds:

1. **A small declarative shape DSL**: `mark: "shape"`, `shape: { type: "path", d: "M${x},${y} L${x+w},${y+h}" }` with template-string substitution from the row. Limited but JSON-serializable.
2. **A `mark: "template"` that references a named JS function registered at runtime** — keeps the JSON spec clean, but couples specs to the host environment. Less portable.

Glyph's design choice (so far): no escape hatch. The cost is *some* visualizations are unreachable. The benefit is determinism, agent affordance, snapshot-testability — which are why anyone picks Glyph over D3.

**Recommendation**: defer until users show up with concrete needs. If we ship, prefer option 1 (declarative DSL).

---

### 🚨 Gap 7 — No 3D / WebGL pipeline

D3 has helpers (`d3-geo-voronoi`, `topojson-server`) and the world ports easily to three.js for 3D. Glyph is SVG + Canvas 2D. 

**No 3D scatter, no 3D globe, no surface plots.**

`@glyph/webgl` (Session D in `NEXT-SESSIONS.md`) is the path. It's not architecturally hard — the Scene IR already separates marks from rendering. A WebGL renderer would accept the same Scene and emit a different output. But it's a session of work + a real GPU dependency for visual regression tests.

**Why it matters**: 1M+ marks (the perf headroom); 3D terrain/globe. Niche but important for some fields.

---

### 🚨 Gap 8 — No interaction primitives beyond click/brush/hover/scrub

D3 has full drag, zoom, pan, selection-brush, lasso, voronoi-hover. Glyph has click + brush (extent) + hover-tooltip + scrub-slider.

Missing:

- **Zoom + pan** on a chart (canvas-style navigation). Useful for time series with millions of points.
- **Lasso selection** — irregular polygon for scatter plots.
- **Voronoi nearest-neighbor hover** — for dense scatter where exact-point hit is unreliable.
- **Drag-to-edit** — move a point in a scatter plot and have the underlying data update. (Edge case but powerful.)

These are all `@glyph/live` extensions, not compiler work. Each is small individually but they add up.

**Estimated cost**: ~600 LOC across 4 PRs.

---

## The four examples the user asked about — concretely

### [`@d3/streamgraph-transitions`](https://observablehq.com/@d3/streamgraph-transitions)
**Can Glyph build this?** 🟡 **Partially.**
- The streamgraph itself: yes, via stacked `mark: "area"` with `position: "stack"` (Glyph has these).
- The smooth transition between offset modes: **no, missing morph primitive (🚨 Gap 3)**. Glyph can re-render the new state, but the transition between them is hard-cut.

### [`@d3/volcano-contours/2`](https://observablehq.com/@d3/volcano-contours/2)
**Can Glyph build this?** ❌ **No.**
- The contour-isoline rendering: missing (🚨 Gap 4 — no contour stat, no grid data shape).
- The volcano dataset itself: would need to import as a grid, not rows.
- Adding contour support is one of the higher-leverage architectural gaps to close — it unlocks density viz, terrain, AI saliency maps.

### [`@d3/radial-cluster/2`](https://observablehq.com/@d3/radial-cluster/2)
**Can Glyph build this?** ❌ **No.**
- The radial layout: missing (🚨 Gap 1 — no polar coordinates).
- The tree data: missing (🚨 Gap 2 — no hierarchy data model).
- Both gaps are independent, both are session-sized, both are foundational.

### [`@d3/tree-of-life`](https://observablehq.com/@d3/tree-of-life)
**Can Glyph build this?** ❌ **No.**
- Same as radial-cluster, **plus** edge bundling (a layout algorithm not in Glyph today, ~200 LOC if we had hierarchies).
- This chart is the canonical "biology dendrogram" example. Unreachable until 🚨 Gaps 1 + 2 land.

---

## Prioritized roadmap: closing the architectural gaps

Ranked by impact-per-effort, what we'd build next if expanding the gallery were the goal:

| Rank | Gap | Effort | Unlocks |
|---|---|---|---|
| 1 | **🚨 Gap 1: Polar coordinates** | Medium-large (~800 LOC) | Pie/donut, radial tree, nightingale, wind rose, clock plot |
| 2 | **🚨 Gap 2: Hierarchy data shape** | Large (~1000 LOC) | Treemap, sunburst, partition, pack, dendrogram, tree |
| 3 | **Layout module** (depends on #2) | Medium (~500 LOC) | Treemap, sunburst, pack, cluster — all become spec primitives |
| 4 | **🚨 Gap 4: Contour + grid data** | Medium (~700 LOC) | Density maps, terrain, saliency, isolines |
| 5 | **🚨 Gap 3: Morph transitions** | Medium (~600 LOC) | Streamgraph transitions, animated stat-switching |
| 6 | **🚨 Gap 5: Force simulation** | Medium (~800 LOC) | Force-directed graphs, beeswarm, collision-resolved layouts |
| 7 | **Stat module** (bin, contour, regression, hexbin, density) | Medium (~500 LOC) | A dozen new chart types compose on top |
| 8 | **🚨 Gap 8: Interaction primitives** | Small-medium (~600 LOC) | Zoom/pan, lasso, voronoi-hover, drag-to-edit |
| 9 | **Scale extensions** (diverging, quantile, threshold, pow) | Small | A dozen color/size encoding improvements |
| 10 | **Network data shape + sankey/chord marks** | Medium (~600 LOC) | Sankey, chord, arc diagram |

Doing 1–4 closes 70% of the missing gallery. Doing 1–6 closes 90%. The remaining 10% is custom/procedural one-offs that Glyph deliberately doesn't compete for (D3 stays the answer there).

---

## What's the *right* call?

Glyph's architectural choices (spec-only, deterministic, agent-driven) are what make it useful to LLMs. **Don't chase D3 gallery coverage at the cost of those choices.** The gaps above are real, but each one needs an honest answer to "does this stay deterministic, snapshot-testable, JSON-spec-only?" before it ships.

The two gaps that pass that test most cleanly: **🚨 polar coordinates** (#1) and **🚨 hierarchy data shape** (#2). Both can be added without sacrificing any of Glyph's invariants. Both unlock disproportionately many gallery entries (radial trees, pies, treemaps, sunbursts, dendrograms).

The two gaps that fail it: **🚨 force simulation** (deterministic only with seeded RNG; not really "spec-only" once you have to tune iteration counts) and **custom marks** (breaks JSON-serializable specs entirely).

So the honest answer: **build polar + hierarchies next.** Build force layouts behind a `seed` parameter if at all. Don't build custom marks — that's D3's lane.

---

*See also: `AUDIT.md` for the 100-point competitive scoreboard, `INNOVATION.md` for the agent-workflow innovations.*
