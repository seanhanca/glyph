# Glyph

> **Deterministic charts for AI agents.** Same JSON spec → same SVG bytes, every platform, every run. Built so an LLM can author, diff, and patch charts the way a developer authors code.

[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](./LICENSE)
[![Release](https://img.shields.io/badge/release-v0.2.0-blue.svg)](./CHANGELOG.md)
[![Tests](https://img.shields.io/badge/tests-819%20passing-brightgreen.svg)](#status)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](#requirements)
[![CI](https://img.shields.io/badge/CI-Ubuntu%20%2B%20macOS%20%2B%20Windows-brightgreen.svg)](.github/workflows/ci.yml)
[![No telemetry](https://img.shields.io/badge/telemetry-none-brightgreen.svg)](#license)
[![AI-built · AI-maintained](https://img.shields.io/badge/AI--built%20%C2%B7%20AI--maintained-by%20Cowork-a78bfa.svg)](./CONTRIBUTING.md#ai-maintained)

> **Built by AI. Maintained by AI.** This repo is triaged, reviewed, and merged by [Cowork](./CONTRIBUTING.md#ai-maintained) (an instance of Claude). See the [live maintenance dashboard](https://seanhanca.github.io/glyph/maintenance.html), the [agent-facing docs (`AGENTS.md`)](./AGENTS.md), or the canonical [two-agents-on-a-chart demo](https://seanhanca.github.io/glyph/math/two-agents.html).

<p align="center">
<img alt="Sine wave story composed by glyph_story — animated SVG, same bytes Claude returns" src="https://raw.githubusercontent.com/seanhanca/glyph/main/packages/core/__fixtures__/story/sine-wave-for-an-8yo.svg" width="640">
</p>

<p align="center">
<em>One sentence to Claude → <code>glyph_story</code> MCP call → this animated SVG.<br>
No JS, no CDN. Deterministic. Same bytes a year from now.</em>
</p>

<p align="center">
<a href="https://seanhanca.github.io/glyph/play/">🎨 Try the playground</a> ·
<a href="./docs/LEARN.md">📚 Learn in 30 minutes</a> ·
<a href="#use-it-from-an-llm-agent">🤖 Use with Claude</a> ·
<a href="https://github.com/seanhanca/glyph/discussions">💬 Discussions</a>
</p>

<p align="center">
<a href="https://seanhanca.github.io/glyph/math/life-in-glyph.html">🖼️ Gallery</a> ·
<a href="https://seanhanca.github.io/glyph/math/strengths.html">📝 What it's for (essay)</a> ·
<a href="https://seanhanca.github.io/glyph/math/two-agents.html">🤝 Two-agents demo</a> ·
<a href="https://seanhanca.github.io/glyph/math/extendedcases.html">🔭 Extended cases</a> ·
<a href="https://seanhanca.github.io/glyph/math/particles.html">✨ Particles tutorial</a>
</p>

---

## What Glyph is best for

- **LLM agents that draw charts.** Claude, ChatGPT, Gemini and any MCP client can call 52 verbs (`glyph_render`, `glyph_describe`, `glyph_audit_spec`, `glyph_story`, …) — no JS code generation, no client-side library to ship.
- **CI-stable visual regression tests.** Snapshot a chart's bytes; assert on them. Glyph is byte-identical across Ubuntu / macOS / Windows × Node 20 / 22.
- **Provenance-auditable analytics.** Every rendered SVG embeds a SHA-256 seal over (spec, rows, schema). Anyone can recompute and verify.
- **Charts that explain themselves.** The structured `Explanation` envelope (M2) lets an agent chain follow-up MCP calls without re-parsing prose.
- **Kid-persona math viz.** `glyph_story({intent:"sine wave", audience:"kid"})` composes a multi-scene animated SVG with bouncing dots and captions. See [`docs/LEARN.md`](./docs/LEARN.md#1-make-an-agent-draw-you-a-story).
- **Embedded analytics that need SQL.** DuckDB lives inside the renderer; transforms live in the spec.

## What Glyph is **not** for

- **High-frequency interactive dashboards with millions of points.** Glyph's renderer rounds to fixed SVG precision; for hardware-accelerated WebGL paths use Three.js / Plotly.
- **Drop-in Plotly / Vega-Lite replacement.** The grammar is similar but the spec format isn't compatible. You can translate Vega-Lite → Glyph via `vegaLiteToGlyph`, but it's not a 1:1 swap.
- **Print-quality typography.** Headless SVG with system fonts. If you need kerning-perfect typesetting, render Glyph SVGs and post-process with a PDF tool.

---

## Get started

### Use it from an LLM agent

```bash
claude mcp add glyph -- npx -y @glyph/mcp
```

Works identically with Cursor, Codex CLI, Copilot CLI, Gemini CLI, or any MCP client. Then ask:

> Use `glyph_story` to show me a sine wave for an 8-year-old. Save the SVG to `./sine.svg`.

Open `sine.svg` in any browser. Curve draws, dot bounces, peak annotation lands — one MCP call, deterministic, self-contained. Same artifact as the hero above.

### Use it as a TypeScript library

```bash
npm install @glyph/core @glyph/duckdb
```

```ts
import { compileSpec, renderSvg } from "@glyph/core";
import { createDuckDBEngine, materializeSpec } from "@glyph/duckdb";

const engine = await createDuckDBEngine();
const m = await materializeSpec(engine, {
  data: { source: "rides.csv", format: "csv" },
  layers: [{ mark: "bar", encoding: { x: "hour", y: "rides" } }],
});

const scene = compileSpec({
  spec: m.effectiveSpec,
  rows: m.result.rows,
  schema: m.handle.schema,
});

const svg = renderSvg(scene); // byte-identical across platforms
```

### Try it without installing

- **🎨 [Playground](https://seanhanca.github.io/glyph/play/)** — paste a CSV, edit a spec, share via URL. Browser-only.
- **🧒 [Kid landing page](https://seanhanca.github.io/glyph/forkids.html)** — see Joy of Math demos including two interactive three.js wow demos.
- **✨ [Joy of Math wow page](https://seanhanca.github.io/glyph/math/joy.html)** — nine interactive demos: six parametric curves (Lissajous, hypotrochoid, curlicue, Archimedean spiral, butterfly, gravity-lensing) plus three fluid + PDE simulations (particle flow field, 2D wave-equation ripples, Gray-Scott reaction-diffusion / Turing patterns). Drag sliders, click the wave-equation canvas to drop ripples.
- **📚 [30-minute learn guide](./docs/LEARN.md)** — 7 hands-on sections, three of them no-install.

---

## See it in action

Every image below is a real fixture in this repo, locked at byte-identity in CI. Click for the raw animated SVG.

<table>
<tr>
<td width="33%" valign="top" align="center">
  <a href="https://raw.githubusercontent.com/seanhanca/glyph/main/packages/core/__fixtures__/timeline/circle-circumference.svg">
    <img alt="Circle → 2πr unwrap (multi-scene timeline)" src="https://raw.githubusercontent.com/seanhanca/glyph/main/packages/core/__fixtures__/timeline/circle-circumference.svg" width="100%">
  </a>
  <br><sub><b>Multi-scene timeline</b><br>Circle → radius → 2πr unwrap</sub>
</td>
<td width="33%" valign="top" align="center">
  <a href="https://raw.githubusercontent.com/seanhanca/glyph/main/packages/core/__fixtures__/traveler/sine-traveler.svg">
    <img alt="Sine wave with traveling dot (SMIL animateMotion)" src="https://raw.githubusercontent.com/seanhanca/glyph/main/packages/core/__fixtures__/traveler/sine-traveler.svg" width="100%">
  </a>
  <br><sub><b>Traveler mark</b><br>SMIL <code>animateMotion</code> + comet trail</sub>
</td>
<td width="33%" valign="top" align="center">
  <a href="https://raw.githubusercontent.com/seanhanca/glyph/main/packages/core/__fixtures__/math/draw-in-spiral.svg">
    <img alt="Archimedean spiral drawing itself" src="https://raw.githubusercontent.com/seanhanca/glyph/main/packages/core/__fixtures__/math/draw-in-spiral.svg" width="100%">
  </a>
  <br><sub><b>Pen-draw animation</b><br>Archimedean spiral, dash-offset trick</sub>
</td>
</tr>
<tr>
<td width="33%" valign="top" align="center">
  <a href="https://raw.githubusercontent.com/seanhanca/glyph/main/packages/core/__fixtures__/math/streamline-rotation.svg">
    <img alt="Vector field streamlines via RK4" src="https://raw.githubusercontent.com/seanhanca/glyph/main/packages/core/__fixtures__/math/streamline-rotation.svg" width="100%">
  </a>
  <br><sub><b>Streamlines</b><br>RK4-integrated vector field</sub>
</td>
<td width="33%" valign="top" align="center">
  <a href="https://raw.githubusercontent.com/seanhanca/glyph/main/packages/core/__fixtures__/math/bezier-cubic.svg">
    <img alt="Cubic Bezier with de Casteljau construction" src="https://raw.githubusercontent.com/seanhanca/glyph/main/packages/core/__fixtures__/math/bezier-cubic.svg" width="100%">
  </a>
  <br><sub><b>Bezier construction</b><br>de Casteljau overlay at <code>t=0.5</code></sub>
</td>
<td width="33%" valign="top" align="center">
  <a href="https://raw.githubusercontent.com/seanhanca/glyph/main/packages/core/__fixtures__/math/lissajous.svg">
    <img alt="Lissajous curve" src="https://raw.githubusercontent.com/seanhanca/glyph/main/packages/core/__fixtures__/math/lissajous.svg" width="100%">
  </a>
  <br><sub><b>Parametric curve</b><br>Lissajous: <code>sin(3t), cos(2t)</code></sub>
</td>
</tr>
<tr>
<td width="33%" valign="top" align="center">
  <a href="https://raw.githubusercontent.com/seanhanca/glyph/main/packages/core/__fixtures__/annotation/peak-callout.svg">
    <img alt="Peak callout annotation" src="https://raw.githubusercontent.com/seanhanca/glyph/main/packages/core/__fixtures__/annotation/peak-callout.svg" width="100%">
  </a>
  <br><sub><b>Annotation mark</b><br>Labeled arrow with auto-anchor</sub>
</td>
<td width="33%" valign="top" align="center">
  <a href="https://raw.githubusercontent.com/seanhanca/glyph/main/packages/core/__fixtures__/brand/threeblueone-brown.svg">
    <img alt="3Blue1Brown chalkboard theme" src="https://raw.githubusercontent.com/seanhanca/glyph/main/packages/core/__fixtures__/brand/threeblueone-brown.svg" width="100%">
  </a>
  <br><sub><b>BrandKit preset</b><br><code>theme: "3b1b"</code> chalkboard</sub>
</td>
<td width="33%" valign="top" align="center">
  <a href="https://raw.githubusercontent.com/seanhanca/glyph/main/packages/core/__fixtures__/brand/playground-preset.svg">
    <img alt="Playground kid theme" src="https://raw.githubusercontent.com/seanhanca/glyph/main/packages/core/__fixtures__/brand/playground-preset.svg" width="100%">
  </a>
  <br><sub><b>BrandKit preset</b><br><code>theme: "playground"</code> kid-bright</sub>
</td>
</tr>
</table>

> For 15 more demos — streamgraph morph, racing bars, choropleth, force graph, treemap, sunburst, contour, geo overlay — see [`site/index.html`](./site/index.html) (single static HTML file, no build).

---

## Life in Glyph

**Eight** hand-crafted showcases of what one English prompt + an AI agent + Glyph produce together. Each page picks a subject anyone can recognize, walks the reader through **prompt → JSON spec → byte-locked SVG → animated page**, and ends with prompt templates you can adapt for your own ideas.

**Gallery:** [`seanhanca.github.io/glyph/math/life-in-glyph.html`](https://seanhanca.github.io/glyph/math/life-in-glyph.html)

### Life — biology, physics, the cosmos

<table>
<tr>
<td width="50%" valign="top">
  <a href="https://seanhanca.github.io/glyph/math/draw-me.html">
    <img alt="Orion's journey — Earth, Moon, spacecraft path" src="https://raw.githubusercontent.com/seanhanca/glyph/main/packages/core/__fixtures__/math/orion-journey.svg" width="100%">
  </a>
  <h4>🚀 <a href="https://seanhanca.github.io/glyph/math/draw-me.html">Orion's journey to the Moon</a></h4>
  <sub><code>data.shape: "function"</code> · NASA Artemis I, 25 days, three phases</sub><br><br>
  <sub><b>Prompt:</b> "Draw me NASA's Artemis I Orion spacecraft journey to the Moon and back. Show the outbound transit, a wide retrograde orbit, and the return arc. Beautiful for a 5-year-old, meaningful for a 70-year-old."</sub>
</td>
<td width="50%" valign="top">
  <a href="https://seanhanca.github.io/glyph/math/draw-me-heartbeat.html">
    <img alt="Heartbeat — FitzHugh-Nagumo trace" src="https://raw.githubusercontent.com/seanhanca/glyph/main/packages/core/__fixtures__/math/heartbeat.svg" width="100%">
  </a>
  <h4>❤️ <a href="https://seanhanca.github.io/glyph/math/draw-me-heartbeat.html">A heartbeat at rest</a></h4>
  <sub><code>data.shape: "trajectory"</code> · FitzHugh-Nagumo relaxation oscillator (1961)</sub><br><br>
  <sub><b>Prompt:</b> "Draw me a heartbeat — a resting human heart at 60 BPM. Use FitzHugh-Nagumo so the trace has the real spike-and-recover rhythm. Beautiful for a child, meaningful for a grandparent."</sub>
</td>
</tr>
<tr>
<td width="50%" valign="top">
  <a href="https://seanhanca.github.io/glyph/math/draw-me-leopard.html">
    <img alt="Leopard's spots — Gray-Scott reaction-diffusion" src="https://raw.githubusercontent.com/seanhanca/glyph/main/packages/core/__fixtures__/math/leopard-spots.svg" width="100%">
  </a>
  <h4>🐆 <a href="https://seanhanca.github.io/glyph/math/draw-me-leopard.html">How the leopard got his spots</a></h4>
  <sub><code>data.shape: "pde-solve"</code> · Gray-Scott reaction-diffusion · Turing 1952, Kipling 1902</sub><br><br>
  <sub><b>Prompt:</b> "Draw me how the leopard got his spots. Use Gray-Scott reaction-diffusion at F = k = 0.062. Start from a single seed, run 400 steps, let the pattern emerge."</sub>
</td>
<td width="50%" valign="top">
  <a href="https://seanhanca.github.io/glyph/math/draw-me-sunflower.html">
    <img alt="Sunflower seeds — golden-angle phyllotaxis" src="https://raw.githubusercontent.com/seanhanca/glyph/main/packages/core/__fixtures__/math/sunflower-seeds.svg" width="100%">
  </a>
  <h4>🌻 <a href="https://seanhanca.github.io/glyph/math/draw-me-sunflower.html">A sunflower's secret math</a></h4>
  <sub><code>data.shape: "recurrence"</code> · Vogel's golden-angle phyllotaxis (1979)</sub><br><br>
  <sub><b>Prompt:</b> "Draw me how a sunflower packs its seeds. Each seed n at radius √n, angle n × 137.5° (the golden angle). 200 seeds. Show why this angle and only this angle works."</sub>
</td>
</tr>
</table>

### Machines of Wonder — what humans built

<table>
<tr>
<td width="50%" valign="top">
  <a href="https://seanhanca.github.io/glyph/math/draw-me-piston.html">
    <img alt="Slider-crank piston-position curve" src="https://raw.githubusercontent.com/seanhanca/glyph/main/packages/core/__fixtures__/math/slider-crank.svg" width="100%">
  </a>
  <h4>🔧 <a href="https://seanhanca.github.io/glyph/math/draw-me-piston.html">Watt's steam engine</a></h4>
  <sub><code>data.shape: "function"</code> · slider-crank kinematics (1769) · pencil/parchment style</sub><br><br>
  <sub><b>Prompt:</b> "Draw me James Watt's steam engine — the slider-crank mechanism that converts piston motion into rotation. Pencil-sketch style. Beautiful enough for a child to follow the crank; technical enough for a mechanical engineer to recognize the asymmetric power stroke."</sub>
</td>
<td width="50%" valign="top">
  <a href="https://seanhanca.github.io/glyph/math/draw-me-pendulum-clock.html">
    <img alt="Damped pendulum oscillation" src="https://raw.githubusercontent.com/seanhanca/glyph/main/packages/core/__fixtures__/math/pendulum-clock.svg" width="100%">
  </a>
  <h4>⏰ <a href="https://seanhanca.github.io/glyph/math/draw-me-pendulum-clock.html">Huygens' pendulum clock</a></h4>
  <sub><code>data.shape: "trajectory"</code> · damped harmonic oscillator (1656)</sub><br><br>
  <sub><b>Prompt:</b> "Draw me Christiaan Huygens' pendulum clock. 2D trajectory ODE: dθ/dt = ω, dω/dt = −(g/L)·θ − γ·ω, with γ = 0.02. Pencil-sketch style. Beautiful enough for a child to count the swings; deep enough that a horologist recognizes the decay envelope."</sub>
</td>
</tr>
<tr>
<td width="50%" valign="top">
  <a href="https://seanhanca.github.io/glyph/math/draw-me-rotor.html">
    <img alt="Wankel epitrochoid housing curve" src="https://raw.githubusercontent.com/seanhanca/glyph/main/packages/core/__fixtures__/math/wankel-rotor.svg" width="100%">
  </a>
  <h4>🌀 <a href="https://seanhanca.github.io/glyph/math/draw-me-rotor.html">Wankel rotary engine</a></h4>
  <sub><code>data.shape: "function"</code> · epitrochoidal housing (Felix Wankel, 1957)</sub><br><br>
  <sub><b>Prompt:</b> "Draw me a Wankel rotary engine housing. Parametric function with a 1:3 frequency ratio: x(t) = R·cos(t) + e·cos(3t), y(t) = R·sin(t) + e·sin(3t). Pencil-sketch style. A child should see the three lobes; an engineer should recognize why a triangular rotor exactly fits."</sub>
</td>
<td width="50%" valign="top">
  <a href="https://seanhanca.github.io/glyph/math/draw-me-antikythera.html">
    <img alt="Antikythera compound-epicycle Moon trace" src="https://raw.githubusercontent.com/seanhanca/glyph/main/packages/core/__fixtures__/math/antikythera-moon.svg" width="100%">
  </a>
  <h4>⚙️ <a href="https://seanhanca.github.io/glyph/math/draw-me-antikythera.html">The Antikythera Mechanism</a></h4>
  <sub><code>data.shape: "function"</code> · compound epicycle (~150 BCE)</sub><br><br>
  <sub><b>Prompt:</b> "Draw me the Antikythera Mechanism's Moon-pointer output. Compound epicycle: x(t) = R₁·cos(t) + R₂·cos(13t), with R₁ = 5 deferent + R₂ = 1.2 epicycle. Pencil-sketch style. A child should see the flower-pattern; a historian should recognize the Saros 223:235 ratio."</sub>
</td>
</tr>
</table>

> Each page ends with four prompt templates ("your turn — prompts to try") across different domains, so you can adapt the pattern to your own subject — a zebra's stripes, a pine cone's spirals, a different mission, a different oscillator, a Stirling engine, a tide-predicting machine, a robot arm.

---

## How it works

```
              ┌─────────────────┐
              │   JSON spec     │  ← agent or developer writes this
              └────────┬────────┘
                       │
       ┌───────────────┼───────────────┐
       ▼               ▼               ▼
  materializer    compiler         auditor
   (DuckDB)      (pure fn)        (11 rules)
       │               │               │
       └───────────────┼───────────────┘
                       ▼
              ┌─────────────────┐
              │   scene graph   │  ← immutable IR
              └────────┬────────┘
                       │
              ┌────────┴────────┐
              ▼                 ▼
          SVG (server)      Canvas (browser)
              │
              └─→ + SHA-256 provenance seal
                  + structured Explanation envelope
                  + 8 audit findings (when applicable)
```

Every box is a pure function: same input, same output, no global state. The MCP server wraps the pipeline in an addressable handle protocol (`gdf://`) so handles flow between processes with full lineage. `canonicalStringify` clamps floating-point numbers to 14 significant digits before hashing, so `Math.sin` libm drift across platforms doesn't break determinism.

---

## Documentation

| Read this | If you want to |
|-----------|----------------|
| **[`docs/LEARN.md`](./docs/LEARN.md)** | Learn Glyph hands-on in 30 minutes (recommended starting point) |
| **[`docs/MATH.md`](./docs/MATH.md)** | Build math + physics visualizations |
| **[`CHANGELOG.md`](./CHANGELOG.md)** | See what's in the latest release |
| **[`CONTRIBUTING.md`](./CONTRIBUTING.md)** | Send your first PR (four difficulty-ranked paths) |
| **[`packages/core/src/spec/types.ts`](./packages/core/src/spec/types.ts)** | Read the canonical spec format (TypeScript) |
| **[`packages/core/dist/spec.schema.json`](./packages/core/dist/spec.schema.json)** | JSON Schema for editor autocomplete |
| **[`site/index.html`](./site/index.html)** | The full interactive site — playground, 8 demos, 16-row comparison, capability matrix |
| **[`INNOVATION.md`](./INNOVATION.md)** · **[`D3-COMPARISON.md`](./D3-COMPARISON.md)** · **[`AUDIT.md`](./AUDIT.md)** · **[`ROADMAP.md`](./ROADMAP.md)** | Deep reference docs |

---

## Comparison

| | D3 | Vega-Lite | Plotly | Tableau | Power BI | **Glyph** |
|---|---|---|---|---|---|---|
| Deterministic byte-stable output | no | partial | no | no | no | **yes** |
| Embedded SQL engine | no | no | no | proprietary | proprietary | **DuckDB** |
| MCP server (agent-native) | no | no | no | no | no | **52 verbs** |
| Built-in chart auditor | no | no | no | no | no | **11 rules** |
| Cryptographic provenance seal | no | no | no | no | no | **SHA-256** |
| Spec diff / patch (RFC 6902) | no | no | no | no | no | **yes** |
| Animation as a declarative spec | no | no | partial | partial | partial | **5 kinds** |
| License | BSD-3 | BSD-3 | MIT | Proprietary | Proprietary | **Apache 2.0** |

Full 16-row matrix at [`site/index.html#compare`](./site/index.html).

---

## Packages

| Package | What it does | Install |
|---------|--------------|---------|
| `@glyph/core` | Compiler, scene graph, SVG renderer | `npm i @glyph/core` |
| `@glyph/duckdb` | DuckDB-backed materializer | `npm i @glyph/duckdb` |
| `@glyph/mcp` | MCP server, 52 verbs | `npx -y @glyph/mcp` |
| `@glyph/live` | Browser hydration: sliders, hover, brush, zoom | `npm i @glyph/live` |
| `@glyph/preview-server` | Local preview for Cursor / Jupyter | `npm i @glyph/preview-server` |
| `@glyph/cli` | `glyph render` / `check` / `diff` | `npm i -g @glyph/cli` _(private — not yet released)_ |
| `@glyph/canvas` | Canvas renderer (same scene graph as SVG) | _(private — not yet released)_ |

---

## Status

- **v0.2.0** on `main` ([`CHANGELOG.md`](./CHANGELOG.md))
- **819 tests** passing on Ubuntu / macOS / Windows × Node 20 / 22
- **52 MCP verbs**, **21 mark types**, **11 audit rules**, **4 data shapes**
- **4 brand presets** (`light`, `dark`, `playground`, `3b1b`), **5 animation kinds**
- **0 telemetry**, **0 phone-home**, runs entirely on your machine

## Requirements

- Node ≥ 20
- For the DuckDB engine: macOS (Apple Silicon or Intel), Linux x64, or Windows x64

---

## Community

- **[Discussions](https://github.com/seanhanca/glyph/discussions)** — Q&A, recipe ideas, gallery
- **[Issues](https://github.com/seanhanca/glyph/issues/new/choose)** — four structured templates (bug, feature, MCP verb idea, recipe idea)
- **[CONTRIBUTING.md](./CONTRIBUTING.md)** — four contributor paths, sorted by difficulty
- **[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)** — Contributor Covenant v2.1
- **[SECURITY.md](./SECURITY.md)** — vulnerability disclosure policy

If the demos above made you smile, **⭐ star the repo** — it's how new contributors find us.

---

## License

[Apache 2.0](./LICENSE). No telemetry. No phone-home. Self-hostable. Audit-safe by default.
