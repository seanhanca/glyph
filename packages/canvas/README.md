# @glyph/canvas

`HTMLCanvasElement` renderer for Glyph scenegraphs. Same `Scene` IR as `@glyph/core`'s SVG renderer; **~10× the render budget per mark** once mark counts pass ~1k.

```ts
import { compileSpec, safeParseSpec } from "@glyph/core";
import { renderCanvas } from "@glyph/canvas";

const spec = safeParseSpec({
  data: { source: "rides.csv" },
  layers: [{ mark: "bar", encoding: { x: "hour", y: "rides" } }],
});
const scene = compileSpec({ spec: spec.ok ? spec.spec : null, rows, schema });

const canvas = document.querySelector("canvas")!;
canvas.width = scene.width;
canvas.height = scene.height;
renderCanvas(scene, canvas.getContext("2d")!);
```

## Why a separate renderer?

| Mark count | SVG | Canvas |
|---|---|---|
| 100 | great | overkill |
| 1k | fine | great |
| 10k | slow | great |
| 100k | DOM falls over | **<200ms** |
| 1M | unusable | borderline (use `@glyph/webgl`) |

Canvas hits a different ceiling than SVG. SVG retains a DOM node per mark; Canvas paints once. The same `Scene` works on both — the choice is a render-time switch, not a spec-time one.

## Node usage (tests / static export)

The renderer accepts any minimal `CanvasContext2D` implementation. For Node-side rasterization, install [`canvas`](https://www.npmjs.com/package/canvas) as an optional dep:

```ts
import { createCanvas } from "canvas";
import { renderCanvas } from "@glyph/canvas";

const canvas = createCanvas(scene.width, scene.height);
renderCanvas(scene, canvas.getContext("2d") as unknown as CanvasContext2D);
const png = canvas.toBuffer("image/png");
```

## Testing

The package exports a `MockCanvasContext2D` recording context that captures every draw call as a string. Tests assert on the call sequence — no real canvas needed.

```ts
import { MockCanvasContext2D, renderCanvas } from "@glyph/canvas";

const ctx = new MockCanvasContext2D();
renderCanvas(scene, ctx);
console.log(ctx.calls); // ["clearRect(0,0,640,400)", "fillRect(...)", ...]
```

## Determinism

Same `Scene` + same context resolution → same draw-call sequence. The font rasterizer (browser or node-canvas) is outside this contract; structural assertions (mark counts, call sequence) are byte-deterministic across platforms.

## Supported marks

`rect`, `circle`, `line`, `path` (M/L/Z subset matching the SVG renderer), `text`. Axes and legends use the same coordinates as the SVG renderer.

## License

Apache 2.0.
