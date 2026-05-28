# Changelog

All notable changes to Glyph are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] — 2026-05-28

The "best-in-class" release. Closes five sharp gaps that separated Glyph
from "another chart library" — five new audit rules, a standalone
provenance-seal verb, canonical Whyboard + Story templates wired straight
into the playground, and an audit-aware patch gate that stops agents from
silently regressing chart trustworthiness.

Counts after this release: **53 MCP verbs**, **24 mark types**, **16 audit
rules**, **4 data shapes**, **1022 tests** passing on Ubuntu × macOS ×
Windows × Node 20 / 22.

### Added

#### Five new audit rules

Fills practical gaps in the misleading-chart linter that v0.2.0 left open.
All deterministic, pure-fn — same input always returns the same finding
set in the same order.

- **AUDIT-05** (medium) — line / area mark on a CATEGORICAL x-encoding.
  The connecting stroke implies an ordered progression that nominal
  categories don't carry; viewers read a fake trend.
- **AUDIT-12** (medium) — pie / donut / arc with more than 7 slices. Angle
  comparison breaks down past ~5 slices (Cleveland-McGill); past 7 is
  essentially unreadable.
- **AUDIT-13** (low) — bar chart on a quantitative x. Bars on a continuous
  axis usually want `mark: "rect"` or histogram semantics; otherwise the
  chart conflates ordinal grouping with continuous space.
- **AUDIT-14** (low) — more than 4 overlay layers on one chart. Visual
  overload past 4 series makes individual lines hard to follow; suggest
  small multiples or faceting.
- **AUDIT-15** (low) — multi-layer chart with no title. A bare multi-
  series chart is unreadable without context; title anchors what the
  reader is comparing.

#### `glyph_seal` — standalone provenance seal

New MCP verb that emits the cryptographic provenance seal (format,
specHash, dataHash, libraryVersion, rowCount, scaleDigest) WITHOUT
rendering an SVG. Companion to `glyph_verify`: callers who already have
the SVG and just need the seal (e.g. for a downstream attestation pipeline
or a content-addressable cache lookup) no longer have to pay the full
render cost. SHA-256 over canonical-JSON-stringified inputs; same inputs
always produce the same seal across platforms and Node versions.

#### Four canonical Whyboard templates

Playground-ready compose scenes that mirror what `glyph_whyboard` returns
for the four most common diagnostic shapes. Each template is a 1200×760
scene with a root question + three branches (anomaly / decompose /
forecast). Wired into the playground as a new **Whyboard** category.

- `template-revenue-miss` — "Why did Q3 miss target?"
- `template-conversion-drop` — "Why did the funnel collapse?"
- `template-latency-spike` — "Why is API latency spiking?"
- `template-churn-spike` — "Why did churn spike this month?"

#### Three canonical Story templates

Playground-ready compose scenes that mirror what `glyph_story` returns as
a 4-panel narrative. 1200×760 scene with a 2×2 grid of 520×290 panels;
each panel is a step badge + caption + subcaption + chart slot. Wired in
as a new **Stories** category.

- `template-quarterly-review` — revenue trend → segment mix → cohort
  retention → growth forecast
- `template-incident-retro` — latency spike → error budget burn →
  root-cause attribution → recovery curve
- `template-ab-test-readout` — traffic split → primary metric lift →
  secondary metrics → decision matrix

#### `glyph_spec_patch` — audit-regression gate

The verb now re-runs `auditSpec` on the patched spec and diffs against
the original's findings (keyed by `rule_id` + `path`). If the patch
INTRODUCES any new HIGH-severity findings, the verb refuses with
`error: "audit_regression"` and a `regressions: [...]` list of the new
findings. Pass `acknowledged: true` to override the gate.

This closes the loop on agentic chart refinement: an agent iteratively
patching a chart can no longer silently introduce a truncated bar y-axis,
an undisclosed log scale, or any other high-severity audit pattern that
slipped past the original render. Pre-existing findings are NOT flagged
— only new ones the patch introduced.

### Compatibility

Backward-compatible. All v0.2.0 verbs work unchanged. New behavior only
appears when callers opt in: `glyph_seal` is a brand-new verb, the new
audit rules fire only on specs that trigger them, the patch gate only
blocks patches that introduce HIGH-severity regressions.

## [0.2.0] — 2026-05-22

The "agent-driven game changer" release. Adds the entire **Joy of Math** track
(kid-persona animated math viz), the **Tactical Math** mark library, all five
**competitive moats**, and the GitHub-native demo surface (animated SVGs
inline in the README + a kid-facing landing page on GitHub Pages).

A single MCP call now turns one English sentence into a self-contained,
deterministic, byte-stable animated SVG — the artifact IS the demo.

### Added

#### Joy of Math (kid-persona track E)

- **E1 `mark: "annotation"`** — pin a chart fact with a labeled arrow + bubble,
  auto-anchored to the nearest data point. Used by `glyph_story` to land
  "this is the peak!" callouts in kid-mode renders.
- **E2 `mark: "traveler"`** — a moving dot that traces a path via SMIL
  `<animateMotion>`, with optional fading comet trail. The dot now **bounces**
  along open paths instead of teleporting from end to start (see Fixed below).
- **E3 `animation.kind: "timeline"`** — multi-scene sequenced animation. Each
  scene fades in over a configurable duration with optional fade-out cross-
  fades and synchronized captions. Powers the "circle → 2πr unwrap" demo.
- **E4 BrandKit presets `"playground"` + `"3b1b"`** — kid-bright preset
  (warm cream bg, playground blue + yellow) and a 3Blue1Brown-style chalkboard
  preset (dark slate bg, signature blue, warm yellow accent, Cardo serif).
  Both preset palettes pass the AUDIT-11 deuteranopia + WCAG contrast gates.
- **E5 `glyph_story` MCP verb** — the bar-raiser endpoint. Takes natural-
  language intent (`"show me a sine wave for an 8-year-old"`) + an audience
  (`kid` | `high-school` | `adult`) and returns a multi-scene Glyph spec
  ready to render, plus an M2 structured Explanation envelope, plus a flat
  caption sequence the UI can subscribe to. Recipe-driven (no LLM call), 5
  recipes today: `sine`, `cosine`, `circle`, `parabola`, `vector field`.

#### Tactical Math (track A)

- **A1 `data: { shape: "trajectory" }`** — RK4 ODE integration that turns
  `dx/dt = …, dy/dt = …` into a deterministic point sequence. Closed-form
  agreement to RK4 precision verified per-row.
- **A2 `animation.kind: "draw-in"`** — pen-draw animation via the
  `stroke-dasharray` / `stroke-dashoffset` trick. Lines, areas, and the
  Bezier mark all participate. Same input → same SVG bytes.
- **A3 `mark: "streamline"`** — vector-field flow lines via RK4 integration
  of a 2D field at grid seeds. Reveals global flow structure that discrete
  arrow marks only hint at.
- **A4 `interactive.sliders[]` + `@glyph/live` `attachSlider()`** — declarative
  interactive sliders the static SVG renderer ignores (byte-stable snapshots)
  and `@glyph/live` reads to attach `<input type="range">` controls. Wires
  through a 16ms debounce so dragging keeps the chart in sync without
  flooding the re-render path.
- **A5 `mark: "bezier"`** — N-degree Bezier curve from control points, with
  optional control polygon + per-level de Casteljau construction overlay at
  parameter `t`. The "show me how the curve is built" picture from every
  graphics textbook, now declarative.

#### Five competitive moats

- **Moat 1 — cryptographic provenance seal.** Every rendered SVG embeds a
  `<metadata>` block with a SHA-256 spec hash, data hash, scale digest, library
  version, and row count. The new `glyph_verify` MCP verb closes the loop by
  recomputing the seal against a (spec, rows, schema) tuple. (PR1.)
- **Moat 2 — structured Explanation envelope.** `glyph_explain({format:
  "structured"})` returns a typed `Explanation/1` object with `keyInsights`,
  `potentialMisreadings`, `dataSources`, `chartTypeRationale`, and
  `suggestedFollowups[].suggestedVerb/suggestedArgs` — an agent can chain to
  a follow-up MCP call without re-parsing prose. (PR2.)
- **Moat 3 — failure-aware rendering.** `data.onMissing` policy declares how
  missing-rows and missing-cells should render: `skip`, `interpolate`, or
  `callout` (with a dashed visible bubble). AUDIT-10 surfaces the same
  findings in `glyph_audit_spec`. (PR3.)
- **Moat 4 — BrandKit compositional theming.** A theme is a typed
  `BrandKit` document (palette, surface, typography, spacing, accessibility)
  composable as `{ ...preset, palette: { categorical: ["#brand1", ...] } }`.
  AUDIT-11 enforces WCAG contrast + Machado-2009 deuteranopia distance
  every render. (PR4.)
- **Moat 5 — declarative crossfilter.** `interactive.crossfilter: { group,
  key?, mode }` emits `data-crossfilter-{group,key}` attributes on every
  mark plus a zero-JS focus+dim CSS rule. `@glyph/live` reads the same
  attributes and broadcasts hover/click events across charts sharing a
  group. (PR5.)

#### Math text rendering (Phase 1 finisher)

- **`mark: "math-text"` via KaTeX** — full LaTeX math in any chart annotation:
  `\sqrt`, accents (`\hat`, `\bar`, `\vec`), stacked limits (`\sum_{i=1}^n`),
  matrices (`\begin{pmatrix}…\end{pmatrix}`). 4 dedicated fixtures lock byte
  identity. (Math PR4-6.)

#### GitHub-native demo surface

- **README "Joy of Math demo wall"** — nine inline animated SVGs pulled from
  `__fixtures__/` via raw GitHub URLs. GitHub's image renderer plays SMIL
  animations inline, so anyone landing on the repo sees the demos animating
  in their browser within seconds — no JS, no CDN, no embed code.
- **`site/forkids.html`** — kid-facing landing page (7 sections: hero,
  gallery, "how it works", three.js 3D wow break, sliders, three multi-scene
  math stories, prompt portal, parents footer). Auto-deploys to GitHub Pages
  once Pages is enabled in repo settings.
- **`site/forkids-3d.js`** — bundled three.js demos for the §3.5 "Math gets
  weird in 3D" section: a Platonic solids carousel and a rolling-wave sine
  surface (`z = sin(r − t) · e^(−r/10)`). Lazy-loaded via
  `IntersectionObserver` only when the section scrolls into view (508 KB
  minified / 128 KB gzipped over the wire).

#### Tier S (developer + agent surface)

- **Python bindings (PyPI: `glyph-py`)** — trusted-publishing workflow,
  `py.typed` marker, full type stubs. (S1.)
- **MCP servers registry** + dogfooded against this repo via
  `glyph-audit-action@v0.2.0`. (S2 + S4.)
- **Playground** at `site/play/` — paste a CSV, edit a spec, watch the chart
  + audit findings + trust score update live. Shareable via URL or GitHub
  Gist. No install. (S3.)
- **52 MCP verbs** total (was 50): the two new since 0.1.0 are `glyph_story`
  (E5) and `glyph_verify` (M1).

### Fixed

- **Traveler "appear and disappear" teleport** — `<animateMotion>` with
  `repeatCount="indefinite"` was snapping the dot from path-end back to
  path-start every cycle (visible to viewers as the dot vanishing off the
  right edge and re-materializing on the left). Now uses
  `keyTimes="0;0.5;1" keyPoints="0;1;0"` so the dot **bounces** forward and
  back continuously along the path — true "rides the wave" motion. The
  comet trail was also pointing the wrong way (trail dots had negative
  `begin` offsets, putting them ahead of the head along the path); fixed by
  shifting all dot phases so the head leads and the trail lags.
- **Playground bundle build broken since the provenance commit** — the
  workflow had been failing on every push because
  `scripts/build-playground-bundle.mjs` couldn't bundle `node:crypto` (used
  by `render/provenance.ts` for the SHA-256 seal) for the browser target.
  Now uses a vendored pure-JS SHA-256 shim
  (`scripts/playground-crypto-shim.mjs`) aliased into the browser bundle
  only; Node consumers continue to use native `node:crypto`. Output is byte-
  identical between paths (both are FIPS 180-4).
- **E3 timeline caption position** — captions were colliding with the x-axis
  title. Y-offset bumped from `+32` to `+56`.
- **E3 timeline duplicate layer indices** — silently double-rendered marks.
  Now throws with a clear error when the same layer index appears in
  multiple scenes or twice within one scene.
- **3b1b BrandKit deuteranopia margin** — the original `#34d399` (emerald)
  vs `#fb7185` (pink) pair sat only 4 units above the AUDIT-11 threshold.
  Swapped to `#10b981` for ~13 units of headroom.
- **Scene title + axis labels under non-default themes** — the renderer
  hardcoded `#1a1a1a` for the title and `#333333` for labels, which made
  the 3b1b preset (dark bg) render dark-on-dark text. Threaded `theme.fg`
  through `Scene → renderer` so labels follow the active theme.
- **Streamline review BLOCKER** — RK4 step size now respects the integration
  domain bounds; an unparseable derivative expression surfaces as a fatal
  error with location rather than as a silent empty SVG.

### Changed

- **`@glyph/live` API surface grew** — `attachSlider`, `bootSlidersFromSpec`,
  `attachScrub`, plus the existing `hydrate`, `attachClick`, `attachBrush`,
  `attachZoom`, `whereFor`, `whereForExtent`, `whereForZoom`. Browser DOM
  side; static SVG output is unaffected.
- **Scene shape gained two optional fields** — `textPrimary` and `textMuted`
  on `Scene`, populated only when the active theme isn't the default light
  theme. Existing snapshots stay byte-stable.

### Internal

- 819 tests passing across the workspace (599 `@glyph/core` + 186 `@glyph/mcp`
  + 34 `@glyph/live`).
- Biome lint clean (0 errors) after a large cleanup commit; CI lint step
  green from this release forward.
- All fixtures locked at byte-identity in CI — any drift in spec → render
  output surfaces as a snapshot diff before merge.

### Notes for upgraders

- The two new MCP verbs (`glyph_story`, `glyph_verify`) are additive — no
  existing verb's signature changed.
- The scene fields `textPrimary` / `textMuted` are optional; existing
  consumers ignore them. SVG output for the default `"light"` theme is
  byte-identical to 0.1.0.
- The `Scene.animation.kind` enum gained `"timeline"`; existing animation
  kinds (`"stage"`, `"stage-stagger"`, `"race"`, `"scrub"`, `"draw-in"`) are
  unchanged.

---

## [0.1.0] — 2026-05-15

First tagged release. Core grammar of graphics + DuckDB compute engine +
MCP server with 50 verbs. See git history for the full set of features that
shipped pre-0.1.0.
