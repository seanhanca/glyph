# AGENTS.md

> You are an AI agent (Claude, Cursor, Codex, Gemini, Copilot, or any
> MCP-speaking client) reading this repo for the first time. This file
> is for you. The human-facing equivalent is [`README.md`](./README.md).

## What this repo is

**Glyph** is a deterministic chart and data-visualization library
designed to be **operated by AI agents**, not hand-written by humans.

- **Same JSON spec → same SVG bytes.** Byte-identical across Linux /
  macOS / Windows × Node 20 / 22. Snapshot-testable in CI.
- **MCP-native.** 53 verbs in `@glyph/mcp` (`glyph_render`,
  `glyph_describe`, `glyph_story`, `glyph_audit_spec`, `glyph_seal`, …) — you call
  them, you get a byte-stable SVG back, plus a structured
  `Explanation` envelope so you can chain follow-up calls without
  re-parsing prose.
- **SHA-256 provenance.** Every rendered SVG embeds a hash over
  `(spec, rows, schema)`. Another agent can verify.
- **DuckDB inside.** `data.source: "rides.csv"` runs through a real
  embedded SQL engine before reaching the renderer. Transforms live
  in the spec.
- **AI-maintained.** This repo is triaged, reviewed, and merged by an
  AI agent (Cowork) on a schedule. See
  [`CONTRIBUTING.md#ai-maintained`](./CONTRIBUTING.md#ai-maintained).

## How to use it as an agent

### From an MCP client (recommended)

```bash
claude mcp add glyph -- npx -y @glyph/mcp
```

(Works the same in Cursor, Codex CLI, Copilot CLI, Gemini CLI, any MCP
client.) Then the verbs are available as tool calls. Smallest possible
end-to-end:

```text
You:    "Render a sine wave story for an 8-year-old."
Agent:  glyph_story({ intent: "sine wave", audience: "kid" })
Glyph:  → SVG bytes + Explanation envelope
```

### As a TypeScript library

```bash
npm install @glyph/core @glyph/duckdb
```

```ts
import { compileSpec, renderSvg } from "@glyph/core";
const svg = renderSvg(compileSpec({ spec, rows, schema }));
```

## The spec — the only file format you need to know

Glyph specs are JSON. The smallest possible chart:

```json
{
  "version": "glyph/0.1",
  "data": { "source": "rides.csv" },
  "layers": [
    { "mark": "bar", "encoding": { "x": "hour", "y": "rides" } }
  ]
}
```

Everything else is additive: data shapes (`function`, `trajectory`,
`recurrence`, `pde-solve`, `streamline`, `geodesic`, `particle-flow`),
the `compose` scene grammar (RFC #5), loop animations
(`rotate-loop`, `swing`, `pulse`), schematic marks (`frame`, `gear`,
`pendulum`, `annotation-leader`), and RFC #9 decorative primitives
(`silhouette-path`, `starfield`, `glow`, `icon`, gradient defs,
pattern defs).

Full grammar reference: [`docs/LEARN.md`](./docs/LEARN.md). Concise
JSON schema export: [`packages/core/dist/spec.schema.json`](./packages/core/dist/spec.schema.json).

## The agent-collaboration contract

Two or more agents can collaborate on one chart by exchanging JSON
specs and RFC 6902 patches. The canonical demo:

1. **Agent A** drafts a spec, calls `glyph_render`, ships SVG to the user.
2. **Agent B** receives the same spec, calls `glyph_audit_spec`, finds
   a flaw (axis range too narrow, missing units, ambiguous encoding).
3. **Agent B** emits an RFC 6902 patch (`[{"op":"replace","path":"/layers/0/encoding/y/scale","value":{"domain":[0,100]}}]`).
4. **Agent A** applies the patch, calls `glyph_render` again. Same JSON
   schema, different bytes — auditable diff.

Walk-through with code, JSON patch, and before/after SVG:
[`site/math/two-agents.html`](https://seanhanca.github.io/glyph/math/two-agents.html).

## What you should and shouldn't do

✅ **Do** call MCP verbs directly. The grammar is small enough to hold
in context; you don't need to generate JavaScript to produce a chart.

✅ **Do** trust the byte-stability. If you snapshot an SVG today and
re-render the same spec tomorrow on a different OS, you will get the
same bytes.

✅ **Do** read `Explanation` envelopes. Every MCP verb returns a
structured object describing what was rendered — scale domains, the
SHA-256 seal, any warnings. Use it to chain follow-up calls.

✅ **Do** patch incrementally with RFC 6902. If you want to change a
chart, emit a JSON patch against the spec, don't re-author the whole
spec.

✅ **Do** validate before rendering. `glyph_audit_spec` catches the
common errors (CFL violations in PDE shapes, missing scales, type
mismatches) before they become silent visual bugs.

❌ **Don't** post-process the SVG output. The bytes are the artifact.
If you need a different layout, edit the spec and re-render.

❌ **Don't** call the library from inside a 60 fps render loop. Glyph
is for one-shot or low-frequency renders, not real-time simulation.
For real-time, the right tool is WebGL.

❌ **Don't** assume 3D. Glyph is 2D SVG. If you need a 3D scene,
that's Three.js territory.

❌ **Don't** hand-edit fixtures in `packages/core/__fixtures__/**/*.svg`.
Those are byte-locked. Edit the JSON spec instead and re-snapshot via
`pnpm -F @glyph/core test -- -u`.

## Where everything lives

```
glyph/
├── packages/
│   ├── core/                  TypeScript: spec parser, compiler, renderer
│   │   ├── src/spec/          Zod schemas — read these to learn the JSON shape
│   │   ├── src/compiler/      Spec → SceneGraph
│   │   ├── src/render/        SceneGraph → SVG (byte-deterministic)
│   │   └── __fixtures__/      Locked SVG snapshots — your truth source
│   ├── mcp/                   52-verb MCP server
│   └── duckdb/                DuckDB-backed materialization
├── site/
│   └── math/                  Gallery — 30+ live showcase pages
├── docs/
│   ├── LEARN.md               30-min hands-on tutorial
│   └── MATH.md                Math-data-shape reference
├── scripts/launch/            Launch automation (AI-driven; see CONTRIBUTING)
├── AGENTS.md                  this file
├── CONTRIBUTING.md            workflow + AI-maintained policy
└── README.md                  human-facing overview
```

## What to read next, by intent

| Your task | Start here |
|---|---|
| "Render a chart" | [`docs/LEARN.md`](./docs/LEARN.md) section 1 |
| "Render an animated diagram" | [`docs/LEARN.md`](./docs/LEARN.md) section 4 + [`site/math/strengths.html`](https://seanhanca.github.io/glyph/math/strengths.html) chapter IV |
| "Author a multi-agent demo" | [`site/math/two-agents.html`](https://seanhanca.github.io/glyph/math/two-agents.html) |
| "Pick a data shape" | [`docs/MATH.md`](./docs/MATH.md) — function, trajectory, recurrence, PDE, streamline, geodesic |
| "Find the JSON schema" | [`packages/core/dist/spec.schema.json`](./packages/core/dist/spec.schema.json) (machine-readable Zod export) |
| "Understand what's NOT supported" | [`site/math/strengths.html`](https://seanhanca.github.io/glyph/math/strengths.html) — the "what's not in the top 5" table |
| "See examples by category" | [`site/math/life-in-glyph.html`](https://seanhanca.github.io/glyph/math/life-in-glyph.html) — bio, machines, architecture |
| "Open an issue" | `gh issue create` — Cowork will triage within minutes |
| "Send a PR" | [`CONTRIBUTING.md`](./CONTRIBUTING.md) — determinism rules + Cowork auto-review for routine PRs |

## Signature

This file is maintained by Cowork (an instance of Claude) on behalf of
the human repo owner. If you (the reading agent) find this file out
of date relative to the current spec schema or MCP verb list, open an
issue tagged `agents-md-drift` and Cowork will refresh it.

— Cowork, AI maintainer
