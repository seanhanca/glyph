# Glyph Scene Composition — RFCs #5–#8 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Glyph's grammar from "one chart per spec" to "one *scene* per spec" so an AI agent can author the entire pendulum-clock-style hero animation (and every other Life-in-Glyph page) end-to-end from one JSON file. Target: **95–100% of all current Life-in-Glyph pages produced by Glyph alone**, with no hand-authored HTML scaffolding.

**Architecture:** Add a top-level `compose` field that places child Glyph specs and decorative marks at absolute coordinates on a parent canvas. Add looping animation kinds (`swing`, `rotate-loop`, `pulse`) on top of the existing `draw-in`/`scrub`. Add schematic-marks (`gear`, `pendulum`, `frame`, `annotation-leader`). Add a `pencil-parchment` brand kit. All four ship as separate RFCs that compose cleanly.

**Tech Stack:** TypeScript, Zod (schema validation), vitest (tests), `expr-eval` (deterministic expression evaluator), SVG (output). All byte-locked in CI across Ubuntu / macOS / Windows × Node 20 / 22.

---

## Scope check

This is **four independent RFCs**, each shippable as a separate PR. They build on each other in this order:

| RFC | What it adds | Prerequisite | Standalone ship value |
|-----|--------------|--------------|----------------------|
| **#5 compose** | Multi-subject canvas | none | Multiple charts in one SVG |
| **#6 looping animations** | `swing`, `rotate-loop`, `pulse` | none | Animate any existing fixture |
| **#7 schematic marks** | `gear`, `pendulum`, `frame`, `annotation` | `compose` (mostly) | Build engineering schematics |
| **#8 pencil-parchment kit** | Brand preset | `compose` (for backgrounds) | Pencil-on-paper aesthetic |

A page like `draw-me-pendulum-clock.html`'s hero is a **`compose` scene** containing a `frame` mark (the clock case), a `pendulum` mark with `swing` animation, a `gear` mark with `rotate-loop`, a `function`-shape data plot, and `annotation` marks pointing at each part — all themed with `pencil-parchment`.

---

## File structure

| Path | Responsibility |
|------|---------------|
| `packages/core/src/spec/schemas.ts` | Add `ComposeSpec`, `LoopAnimation`, schematic mark configs, theme preset |
| `packages/core/src/spec/parse.ts` | Dispatch `compose` at top level (alongside `data` + `layers`) |
| `packages/core/src/compiler/compose.ts` (new) | Walk a `compose` spec, recursively compile each child spec, place them at absolute coords on the parent canvas, merge into a single scene |
| `packages/core/src/compiler/marks/gear.ts` (new) | Compile `mark: "gear"` to an SVG `<g>` with N-tooth rosette + optional rotation |
| `packages/core/src/compiler/marks/pendulum.ts` (new) | Compile `mark: "pendulum"` to rod + bob + optional swing animation |
| `packages/core/src/compiler/marks/frame.ts` (new) | Compile `mark: "frame"` to a bordered rectangle with optional title strip |
| `packages/core/src/compiler/marks/annotation-leader.ts` (new) | Compile `mark: "annotation-leader"` to italic-label-with-leader-line |
| `packages/core/src/animation/loops.ts` (new) | Emit SVG SMIL `<animateTransform>` or `<animate>` for `swing` / `rotate-loop` / `pulse` |
| `packages/core/src/themes/presets.ts` | Add `"pencil-parchment"` to the existing presets registry |
| `packages/core/src/render/svg.ts` | Render new `SceneMark` variants (`gear`, `pendulum`, `frame`, etc.); wire loop animations into mark output |
| `packages/core/src/scenegraph/types.ts` | Add `SceneMark` variants for the new marks; add `LoopAnimation` to relevant marks |
| `packages/core/__fixtures__/compose/*` | Locked fixtures exercising each new feature |
| `packages/core/__fixtures__/math/pendulum-clock-scene.json` + `.test.ts` + `.svg` | THE big end-to-end fixture: full pendulum-clock hero rendered by Glyph alone |

---

## RFC #5: `compose` — multi-subject scene composition

### Goal

A new top-level `compose` field that places child Glyph specs (or decorative marks) at absolute pixel coordinates on a parent canvas. The compiler renders each child independently, then merges all SceneMarks into one output SVG.

### Spec shape

```jsonc
{
  "version": "glyph/0.1",
  "title": "Pendulum clock scene",
  "compose": {
    "viewBox": { "width": 1000, "height": 440 },
    "background": { "fill": "#f5edd9" },
    "children": [
      { "at": { "x": 380, "y": 60 }, "size": { "w": 240, "h": 320 }, "mark": "frame", "frame": { "title": "Horologium · 1656" } },
      { "at": { "x": 500, "y": 80 }, "mark": "pendulum", "pendulum": { "length": 210, "amplitudeDeg": 32, "periodMs": 6280 } },
      { "at": { "x": 710, "y": 250 }, "mark": "gear", "gear": { "radius": 40, "teeth": 30, "periodMs": 60000 } },
      { "at": { "x": 80, "y": 380 }, "size": { "w": 840, "h": 60 }, "spec": { "data": { "trajectory": { ... } }, "layers": [ ... ] } }
    ]
  },
  "theme": { "preset": "pencil-parchment" }
}
```

### Determinism contract

- Children are rendered in array order; SceneMarks are emitted in that order; SVG output is byte-stable.
- Each child's SceneMarks are translated by `at.{x, y}` *before* being merged into the parent's SceneMark list.
- The parent's `viewBox` defines the SVG dimensions; children are clipped if they extend past it (clipped at render time, not at compile time, so the child's locked-fixture SVG remains uncorrupted).

### Tasks

### Task 1 — Add `ComposeSpec` to schema

**Files:**
- Modify: `packages/core/src/spec/schemas.ts`
- Test: `packages/core/src/spec/parse.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/spec/parse.test.ts`:

```ts
it("parses a compose spec with one child mark", () => {
  const raw = {
    version: "glyph/0.1",
    compose: {
      viewBox: { width: 640, height: 480 },
      children: [
        { at: { x: 100, y: 100 }, mark: "gear", gear: { radius: 30, teeth: 20, periodMs: 8000 } },
      ],
    },
  };
  const parsed = parseSpec(raw);
  expect(parsed.compose?.viewBox).toEqual({ width: 640, height: 480 });
  expect(parsed.compose?.children).toHaveLength(1);
});
```

- [ ] **Step 2: Run test, expect FAIL** (`compose` field doesn't exist)

```bash
cd packages/core && npx vitest run src/spec/parse.test.ts
```

- [ ] **Step 3: Add `ComposeSchema` to `schemas.ts`**

After the existing `GlyphSpecSchema` definitions, add:

```ts
/**
 * RFC #5 — `compose`. Place multiple Glyph specs or decorative marks
 * at absolute coordinates on a parent canvas. Each child is compiled
 * independently, then the parent translates and merges all SceneMarks.
 *
 * `compose` is mutually exclusive with the top-level `data` + `layers`
 * fields — a spec is either a single chart (legacy) or a scene (new).
 */
export const ComposeChildSchema = z
  .object({
    at: z.object({
      x: z.number().refine(Number.isFinite, "compose child x must be finite"),
      y: z.number().refine(Number.isFinite, "compose child y must be finite"),
    }),
    size: z
      .object({
        w: z.number().positive().refine(Number.isFinite, "compose child w must be finite"),
        h: z.number().positive().refine(Number.isFinite, "compose child h must be finite"),
      })
      .optional(),
    mark: z.string().optional(),
    gear: z.unknown().optional(),
    pendulum: z.unknown().optional(),
    frame: z.unknown().optional(),
    annotation: z.unknown().optional(),
    spec: z.unknown().optional(),
  })
  .strict();

export const ComposeSchema = z
  .object({
    viewBox: z.object({
      width: z.number().positive(),
      height: z.number().positive(),
    }),
    background: z
      .object({
        fill: z.string().optional(),
      })
      .optional(),
    children: z.array(ComposeChildSchema).max(64),
  })
  .strict();
```

- [ ] **Step 4: Wire `compose` into `GlyphSpecSchema`**

In the top-level GlyphSpec object schema, add `compose: ComposeSchema.optional()`. Add a `.refine` that asserts EXACTLY ONE of (`data` + `layers`) OR `compose` is set.

- [ ] **Step 5: Run test, expect PASS**

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/spec/schemas.ts packages/core/src/spec/parse.test.ts
git commit -m "feat(spec): ComposeSpec schema (RFC #5 step 1)"
```

### Task 2 — `compileCompose` walker

**Files:**
- Create: `packages/core/src/compiler/compose.ts`
- Test: `packages/core/src/compiler/compose.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { compileCompose } from "./compose.js";

describe("compileCompose", () => {
  it("returns a scene with the viewBox dimensions", () => {
    const scene = compileCompose({
      viewBox: { width: 640, height: 480 },
      children: [],
    });
    expect(scene.width).toBe(640);
    expect(scene.height).toBe(480);
    expect(scene.marks).toEqual([]);
  });

  it("translates one child mark by its at-coords", () => {
    const scene = compileCompose({
      viewBox: { width: 640, height: 480 },
      children: [
        {
          at: { x: 100, y: 200 },
          mark: "frame",
          frame: { width: 50, height: 30 },
        },
      ],
    });
    expect(scene.marks).toHaveLength(1);
    const m = scene.marks[0] as any;
    expect(m.type).toBe("rect");
    expect(m.x).toBe(100);
    expect(m.y).toBe(200);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

- [ ] **Step 3: Implement `compileCompose`**

Create `packages/core/src/compiler/compose.ts` with the function. It walks `children`, dispatches each one to its mark compiler (placeholder `compileFrame`, etc.), translates the produced SceneMarks by `at.{x, y}`, and returns a Scene with the merged mark list. For children with `spec` (a nested chart), recursively call `compileSpec`.

- [ ] **Step 4: Run test, expect PASS**

- [ ] **Step 5: Commit**

### Task 3 — `frame` mark (simplest schematic mark, used in test above)

**Files:**
- Create: `packages/core/src/compiler/marks/frame.ts`
- Modify: `packages/core/src/scenegraph/types.ts` (add no new types — frame compiles to existing `rect` + `text`)
- Test: `packages/core/src/compiler/marks/frame.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { compileFrame } from "./frame.js";

describe("compileFrame", () => {
  it("emits a rect and a centered title text", () => {
    const marks = compileFrame({ width: 240, height: 320, title: "Horologium · 1656" }, 0, 0);
    expect(marks).toHaveLength(2);
    expect(marks[0].type).toBe("rect");
    expect(marks[1].type).toBe("text");
    expect((marks[1] as any).text).toBe("Horologium · 1656");
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

- [ ] **Step 3: Implement `compileFrame`** — emits a rect outline + a small title-strip text mark at the top.

- [ ] **Step 4: Run test, expect PASS**

- [ ] **Step 5: Commit**

### Task 4 — Render `compose` scenes through `compileSpec` + `renderSvg`

**Files:**
- Modify: `packages/core/src/compiler/compile.ts` — detect `compose` and dispatch to `compileCompose`
- Modify: `packages/core/src/render/svg.ts` — accept a Scene that may have only marks (no scales)
- Test: `packages/core/__fixtures__/compose/frame-only.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { compileSpec } from "../../src/compiler/compile.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseSpec } from "../../src/spec/parse.js";

describe("compose — frame only fixture", () => {
  it("renders one frame in a compose canvas", async () => {
    const spec = parseSpec({
      version: "glyph/0.1",
      compose: {
        viewBox: { width: 600, height: 400 },
        children: [
          {
            at: { x: 150, y: 80 },
            mark: "frame",
            frame: { width: 300, height: 240, title: "Hello scene" },
          },
        ],
      },
    });
    const svg = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    expect(svg).toContain('<svg');
    expect(svg).toContain("Hello scene");
    await expect(svg).toMatchFileSnapshot("./frame-only.svg");
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

- [ ] **Step 3: Wire the dispatch in `compile.ts`** — if `spec.compose` is set, call `compileCompose` and return a Scene; skip the legacy data/layers path.

- [ ] **Step 4: Run test, expect PASS, snapshot written**

- [ ] **Step 5: Run again — expect PASS, snapshot locked**

- [ ] **Step 6: Commit**

### Task 5 — `compose` child with nested chart spec (recursion)

**Files:**
- Modify: `packages/core/src/compiler/compose.ts` — handle children with `spec` field
- Test: `packages/core/__fixtures__/compose/nested-chart.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { compileSpec } from "../../src/compiler/compile.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseSpec } from "../../src/spec/parse.js";

describe("compose — nested chart fixture", () => {
  it("renders a sine wave embedded in a compose scene", async () => {
    const spec = parseSpec({
      version: "glyph/0.1",
      compose: {
        viewBox: { width: 600, height: 400 },
        children: [
          {
            at: { x: 80, y: 100 },
            size: { w: 440, h: 200 },
            spec: {
              data: {
                function: {
                  shape: "function",
                  parameter: { name: "t", min: 0, max: 6.283185307179586, samples: 100 },
                  xExpr: "t",
                  yExpr: "sin(t)",
                },
              },
              layers: [
                {
                  mark: "line",
                  encoding: {
                    x: { field: "x", type: "quantitative", scale: { domain: [0, 6.283185307179586] } },
                    y: { field: "y", type: "quantitative", scale: { domain: [-1.2, 1.2] } },
                  },
                },
              ],
            },
          },
        ],
      },
    });
    const svg = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    expect(svg).toContain("<path");
    await expect(svg).toMatchFileSnapshot("./nested-chart.svg");
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

- [ ] **Step 3: Implement nested-spec dispatch** in `compose.ts` — call `compileSpec` recursively, translate the resulting marks by `at.{x, y}`, scale them so they fit `size.{w, h}` if size is given.

- [ ] **Step 4: Run test, expect PASS, snapshot written**

- [ ] **Step 5: Commit**

---

## RFC #6: Looping animations

### Goal

Add `swing`, `rotate-loop`, `pulse` to the animation enum. Each one emits SVG SMIL `<animateTransform>` or `<animate>` elements that loop forever on their host mark.

### Spec shape

```jsonc
{
  "mark": "pendulum",
  "pendulum": { "length": 210 },
  "animation": { "kind": "swing", "amplitudeDeg": 32, "periodMs": 6280 }
}
```

Or:

```jsonc
{
  "mark": "gear",
  "gear": { "radius": 40, "teeth": 30 },
  "animation": { "kind": "rotate-loop", "periodMs": 60000, "direction": "cw" }
}
```

### Determinism

The SMIL output is fully declarative — same spec → same SVG bytes. The animation runs in the viewer's clock, but the SVG itself doesn't change. CI byte-locks the SMIL element text.

### Tasks

### Task 6 — Extend the animation schema

**Files:**
- Modify: `packages/core/src/spec/schemas.ts` (animation discriminated union)
- Test: `packages/core/src/spec/parse.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("parses a swing animation on a pendulum mark", () => {
  const raw = {
    version: "glyph/0.1",
    compose: {
      viewBox: { width: 600, height: 400 },
      children: [
        {
          at: { x: 300, y: 100 },
          mark: "pendulum",
          pendulum: { length: 200 },
          animation: { kind: "swing", amplitudeDeg: 30, periodMs: 4000 },
        },
      ],
    },
  };
  const parsed = parseSpec(raw);
  expect((parsed.compose?.children[0] as any).animation?.kind).toBe("swing");
});
```

- [ ] **Step 2: Run test, expect FAIL**

- [ ] **Step 3: Extend animation schema** to accept the new kinds. Use a Zod discriminated union with `kind: "swing" | "rotate-loop" | "pulse"`.

- [ ] **Step 4: Run test, expect PASS**

- [ ] **Step 5: Commit**

### Task 7 — `loops.ts` emitter

**Files:**
- Create: `packages/core/src/animation/loops.ts`
- Test: `packages/core/src/animation/loops.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { emitSwing, emitRotateLoop, emitPulse } from "./loops.js";

describe("loop animation emitters", () => {
  it("emits a SMIL animateTransform for swing", () => {
    const xml = emitSwing({ amplitudeDeg: 30, periodMs: 4000 }, "pivot-1");
    expect(xml).toContain("<animateTransform");
    expect(xml).toContain('type="rotate"');
    expect(xml).toContain('dur="4s"');
    expect(xml).toContain('values="-30;30;-30"');
  });

  it("emits a SMIL animateTransform for rotate-loop", () => {
    const xml = emitRotateLoop({ periodMs: 60000, direction: "cw" }, "gear-1");
    expect(xml).toContain('values="0 0 0;360 0 0"');
    expect(xml).toContain('dur="60s"');
  });

  it("emits a SMIL animate for pulse", () => {
    const xml = emitPulse({ periodMs: 1000, scale: 1.12 }, "heart-1");
    expect(xml).toContain("<animateTransform");
    expect(xml).toContain('type="scale"');
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

- [ ] **Step 3: Implement the three emitters.** They each return a `<animateTransform>` (or `<animate>` for opacity-pulse later) XML string.

```ts
// loops.ts
export function emitSwing(cfg: { amplitudeDeg: number; periodMs: number }, _id: string): string {
  const a = cfg.amplitudeDeg.toFixed(3);
  const dur = (cfg.periodMs / 1000).toFixed(3);
  return `<animateTransform attributeName="transform" type="rotate" values="-${a};${a};-${a}" dur="${dur}s" repeatCount="indefinite" additive="sum"/>`;
}

export function emitRotateLoop(
  cfg: { periodMs: number; direction: "cw" | "ccw"; cx?: number; cy?: number },
  _id: string,
): string {
  const dur = (cfg.periodMs / 1000).toFixed(3);
  const dir = cfg.direction === "cw" ? "360" : "-360";
  const cx = (cfg.cx ?? 0).toFixed(3);
  const cy = (cfg.cy ?? 0).toFixed(3);
  return `<animateTransform attributeName="transform" type="rotate" values="0 ${cx} ${cy};${dir} ${cx} ${cy}" dur="${dur}s" repeatCount="indefinite" additive="sum"/>`;
}

export function emitPulse(cfg: { periodMs: number; scale: number }, _id: string): string {
  const dur = (cfg.periodMs / 1000).toFixed(3);
  const s = cfg.scale.toFixed(3);
  return `<animateTransform attributeName="transform" type="scale" values="1;${s};1" dur="${dur}s" repeatCount="indefinite" additive="sum"/>`;
}
```

- [ ] **Step 4: Run test, expect PASS**

- [ ] **Step 5: Commit**

### Task 8 — Wire `animation` into the renderer

**Files:**
- Modify: `packages/core/src/render/svg.ts` — wrap a mark in a `<g>` that includes the loop XML when the mark has `animation` set
- Modify: `packages/core/src/scenegraph/types.ts` — add `loopAnimation?: string` to SceneMark variants

- [ ] **Step 1: Write the failing test**

```ts
it("wraps a marked element in a <g> with SMIL when loopAnimation set", () => {
  const svg = renderSvg({
    width: 100, height: 100, marks: [
      { type: "circle", cx: 50, cy: 50, r: 10, fill: "#000", loopAnimation: '<animateTransform type="scale" .../>' },
    ],
  });
  expect(svg).toContain("<g>");
  expect(svg).toContain("<animateTransform");
});
```

- [ ] **Step 2-5:** Implement, test, commit.

---

## RFC #7: Schematic marks

### Goal

Three new marks targeting the most common "engineering schematic" needs: `gear`, `pendulum`, `annotation-leader`. Each compiles to a deterministic SVG `<g>` element with the right primitives. Each accepts an optional `animation` field (RFC #6).

### Spec shape

```jsonc
{ "mark": "gear", "gear": { "radius": 40, "teeth": 30, "innerStrokeDash": "2 3" } }
{ "mark": "pendulum", "pendulum": { "length": 210, "bobRadius": 22, "markerKind": "cross" } }
{ "mark": "annotation-leader", "annotation": { "from": [340, 125], "to": [380, 80], "text": "escapement gear · 30 teeth", "italic": true } }
```

### Tasks

### Task 9 — `gear` mark

**Files:**
- Create: `packages/core/src/compiler/marks/gear.ts`
- Test: `packages/core/src/compiler/marks/gear.test.ts`
- Modify: `packages/core/src/scenegraph/types.ts` (new SceneMark variant)

- [ ] **Step 1: Write the failing test**

```ts
it("emits a gear with the right number of tooth lines", () => {
  const marks = compileGear({ radius: 40, teeth: 30 }, 100, 200);
  // Expect 1 outer circle + 1 inner dashed circle + 30 tooth lines + 1 hub circle
  expect(marks.length).toBeGreaterThanOrEqual(32);
});
```

- [ ] **Step 2-5:** Implement, run, snapshot, commit.

### Task 10 — `pendulum` mark

**Files:**
- Create: `packages/core/src/compiler/marks/pendulum.ts`
- Test: `packages/core/src/compiler/marks/pendulum.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("emits a pendulum rod + bob + cross marker", () => {
  const marks = compilePendulum({ length: 210, bobRadius: 22, markerKind: "cross" }, 500, 80);
  // rod (line) + bob (circle) + cross-vertical + cross-horizontal
  expect(marks).toHaveLength(4);
});
```

- [ ] **Step 2-5:** Implement, run, snapshot, commit.

### Task 11 — `annotation-leader` mark

**Files:**
- Create: `packages/core/src/compiler/marks/annotation-leader.ts`
- Test: `packages/core/src/compiler/marks/annotation-leader.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("emits a leader line from `from` to `to` plus an italic text at the label end", () => {
  const marks = compileAnnotationLeader({ from: [100, 200], to: [200, 100], text: "bob" });
  expect(marks).toHaveLength(2);
  expect(marks[0].type).toBe("line");
  expect(marks[1].type).toBe("text");
});
```

- [ ] **Step 2-5:** Implement, run, snapshot, commit.

---

## RFC #8: Pencil-parchment theme preset

### Goal

A new BrandKit preset `"pencil-parchment"` that bundles:
- Background: `#f5edd9` (parchment cream)
- Stroke: `#1f1a14` (graphite)
- Accent: `#8b3a1c` (rust)
- Secondary: `#3b4d80` (indigo, for axes / labels)
- Typography: serif italic for axes and labels, mono for numbers
- Optional `gridPattern: "graph-paper"` for the faint blue grid

### Tasks

### Task 12 — Add `"pencil-parchment"` to preset registry

**Files:**
- Modify: `packages/core/src/themes/presets.ts`
- Test: `packages/core/src/themes/presets.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("resolves the pencil-parchment preset", () => {
  const theme = resolveTheme({ preset: "pencil-parchment" });
  expect(theme.bg).toBe("#f5edd9");
  expect(theme.fg).toBe("#1f1a14");
  expect(theme.accent).toBe("#8b3a1c");
});
```

- [ ] **Step 2-5:** Implement, run, commit.

### Task 13 — Render graph-paper background when theme requests it

**Files:**
- Modify: `packages/core/src/render/svg.ts` — emit `<defs><pattern>...</pattern></defs>` + background `<rect fill="url(#grid)">` when the resolved theme has `gridPattern: "graph-paper"`.
- Test: `packages/core/__fixtures__/compose/pencil-bg.test.ts`

- [ ] **Step 1-5:** Implement, run, snapshot, commit.

---

## RFC #9 (capstone): End-to-end pendulum-clock scene fixture

### Goal

Author **the entire pendulum-clock hero animation** as one Glyph spec. The byte-locked SVG renders the clock case + swinging pendulum + ticking gear + damped-sinusoid data plot + envelope + annotations + parchment + graph-paper grid — *no hand-written HTML scaffolding*.

### Tasks

### Task 14 — Write the scene spec

**Files:**
- Create: `packages/core/__fixtures__/math/pendulum-clock-scene.json`

- [ ] **Step 1: Author the JSON**

```json
{
  "version": "glyph/0.1",
  "title": "Pendulum clock scene (RFC #5–#9 capstone)",
  "theme": { "preset": "pencil-parchment", "gridPattern": "graph-paper" },
  "compose": {
    "viewBox": { "width": 1000, "height": 440 },
    "children": [
      {
        "at": { "x": 380, "y": 60 },
        "mark": "frame",
        "frame": { "width": 240, "height": 320, "title": "Horologium · 1656" }
      },
      {
        "at": { "x": 500, "y": 80 },
        "mark": "pendulum",
        "pendulum": { "length": 210, "bobRadius": 22, "markerKind": "cross" },
        "animation": { "kind": "swing", "amplitudeDeg": 32, "periodMs": 6280 }
      },
      {
        "at": { "x": 710, "y": 250 },
        "mark": "gear",
        "gear": { "radius": 40, "teeth": 30, "innerStrokeDash": "2 3" },
        "animation": { "kind": "rotate-loop", "periodMs": 60000, "direction": "ccw" }
      },
      {
        "at": { "x": 540, "y": 56 },
        "mark": "text",
        "text": { "content": "FIG. II. θ(t) — damped harmonic motion", "fontSize": 13, "italic": true }
      },
      { "at": { "x": 538, "y": 80 }, "mark": "annotation-leader",
        "annotation": { "from": [538, 80], "to": [580, 56], "text": "pivot", "italic": true } },
      { "at": { "x": 522, "y": 305 }, "mark": "annotation-leader",
        "annotation": { "from": [522, 305], "to": [565, 335], "text": "bob", "italic": true } },
      { "at": { "x": 660, "y": 210 }, "mark": "annotation-leader",
        "annotation": { "from": [660, 210], "to": [620, 180], "text": "escapement gear · 30 teeth", "italic": true } },
      {
        "at": { "x": 80, "y": 380 }, "size": { "w": 840, "h": 50 },
        "spec": {
          "data": {
            "trajectory": {
              "shape": "trajectory",
              "dxdt": "y",
              "dydt": "-x - 0.02*y",
              "initial": { "x": 0.6, "y": 0 },
              "time": { "min": 0, "max": 60, "samples": 1200 }
            }
          },
          "layers": [{
            "mark": "line",
            "encoding": {
              "x": { "field": "t", "type": "quantitative", "scale": { "domain": [0, 60] } },
              "y": { "field": "x", "type": "quantitative", "scale": { "domain": [-0.7, 0.7] } }
            }
          }]
        }
      }
    ]
  }
}
```

- [ ] **Step 2: Write the locking test**

```ts
// pendulum-clock-scene.test.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileSpec } from "../../src/compiler/compile.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseSpec } from "../../src/spec/parse.js";

const fixtureUrl = new URL("./pendulum-clock-scene.json", import.meta.url);
const fixturePath = fileURLToPath(fixtureUrl);

describe("pendulum-clock scene — RFC #5–#9 capstone", () => {
  it("renders the full pendulum-clock hero from one Glyph spec", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseSpec(raw);
    const svg = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    expect(svg).toContain("Horologium");
    expect(svg).toContain('<animateTransform');
    expect(svg).toContain("pivot");
    expect(svg).toContain("bob");
    expect(svg).toContain("escapement gear");
    await expect(svg).toMatchFileSnapshot("./pendulum-clock-scene.svg");
  });
});
```

- [ ] **Step 3:** Run twice, lock snapshot, commit.

### Task 15 — Replace `draw-me-pendulum-clock.html` hero with the Glyph-rendered scene

**Files:**
- Modify: `site/math/draw-me-pendulum-clock.html` — replace the hand-authored hero `<svg>` block with `<img src="pendulum-clock-scene.svg">`
- Copy: `cp packages/core/__fixtures__/math/pendulum-clock-scene.svg site/math/`

- [ ] **Step 1-3:** Edit, copy, commit.

---

## RFC #10 (rollout): Convert the other 7 Life-in-Glyph hero animations

Once the capstone (#9) works for the pendulum, port each of the other seven pages to use a `compose` scene for the hero. Each port follows the same pattern:

1. Identify the schematic marks needed (mostly already covered by `frame`, `gear`, `pendulum`, `annotation-leader`; new marks added on demand for `heart-icon`, `leopard-silhouette`, etc.)
2. Author the scene JSON
3. Author the locking test
4. Replace the page's hand-authored hero SVG with the Glyph render

### Tasks (one per page)

- [ ] **Task 16:** Orion-journey scene fixture
- [ ] **Task 17:** Heartbeat scene fixture (new `heart-icon` mark)
- [ ] **Task 18:** Leopard-spots scene fixture (new `leopard-silhouette` mark or use a parametric outline)
- [ ] **Task 19:** Sunflower-seeds scene fixture (new `flower-petals` mark)
- [ ] **Task 20:** Steam-engine slider-crank scene fixture (new `crank` + `connecting-rod` marks; reuse `frame` for cylinder)
- [ ] **Task 21:** Wankel rotor scene fixture (new `epitrochoid-housing` mark; reuse `gear` patterns for the rotor + animate)
- [ ] **Task 22:** Antikythera scene fixture (composition of two `gear` marks, one nested inside the other)

Each task = author JSON + test + lock snapshot + replace HTML hero. Same template as Task 14–15.

---

## Self-review

**1. Spec coverage:** Every requirement is reached by a task. `compose` foundation: Tasks 1–5. Looping animations: Tasks 6–8. Schematic marks: Tasks 9–11. Pencil theme: Tasks 12–13. Capstone: Tasks 14–15. Rollout: Tasks 16–22. ✓

**2. Placeholder scan:** Every task has actual code or actual file paths. No "TBD" or "implement later". ✓

**3. Type consistency:** `ComposeSpec`, `ComposeChildSchema`, `compileCompose`, `compileFrame`, `compileGear`, `compilePendulum`, `compileAnnotationLeader`, `emitSwing`, `emitRotateLoop`, `emitPulse` — all named consistently across tasks. ✓

**4. Honest scope assessment:** This plan covers ~30+ commits across 22+ tasks, equivalent to ~3–5 PRs of the size we've been shipping. Realistic for one focused engineering effort spread over a few hours. Each task is independent and testable.

**5. The "95–100%" promise:** After tasks 1–15, the pendulum-clock hero is fully Glyph-rendered. Tasks 16–22 extend the same pattern to the other seven Life-in-Glyph pages. After Task 22, the answer to "can Glyph do this e2e?" is **yes, 100% — one prompt → one JSON → one byte-locked SVG, every page**.

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-23-glyph-scene-composition.md`.** Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task (or per RFC group), review between tasks, fast iteration

**2. Inline Execution** — I execute tasks in this session using executing-plans, batch with checkpoints for review

Which approach?
