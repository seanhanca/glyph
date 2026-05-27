# Glyph primitives reference

Glyph ships two layers of building blocks:

1. **Chart marks** — the high-level `mark: "bar"`, `mark: "line"`, etc., that consume tabular rows + a schema and resolve to scaled scene marks. Use these when your viz is data-driven and follows a recognizable chart pattern.

2. **Compose primitives** — lower-level shape and structural marks used inside a `compose` scene. Use these when you need pixel-precise control, custom annotations, or chart types not yet in the mark catalogue.

This document is the canonical reference for layer 2.

---

## Why use primitives?

The compose grammar isn't just an escape hatch. Roughly half the polished business examples in the playground (`ridgeline`, `parallel-coordinates`, `streamgraph`, `circle-packing`, animated `bar-race`, animated `wealth-health`, choropleths with real geometry) are compose-built, because:

- **Custom geometry**: each band of a streamgraph is a polygon; no built-in mark does this directly.
- **Per-element color/animation**: SMIL `<animate>` tags need to live inside specific elements with specific begin times. Compose lets you wrap each in `raw-svg` while everything else stays declarative.
- **Hand-crafted illustrations**: cathedrals, skyscrapers, the Glyph-in-Life library — none of these are chart marks, but they share the same deterministic SVG pipeline.

The primitives below all participate in the same `compileCompose` → byte-stable SVG path that the chart marks use.

---

## The primitives, grouped

### Shape primitives

| Primitive | Schema fields | What it draws |
|---|---|---|
| `circle` | `radius`, `fill`, `stroke?`, `strokeWidth?` | One circle at the child's `at: { x, y }`. |
| `ellipse` | `rx`, `ry`, `fill`, `stroke?`, `strokeWidth?`, `opacity?`, `rotateDeg?` | One ellipse, optionally rotated. |
| `polygon` | `points: [[x, y], ...]` (3–200), `fill`, `stroke?`, `strokeWidth?` | Closed shape from explicit points. |
| `polyline` | `points`, `stroke?`, `strokeWidth?`, `fill?` | Open shape — line that doesn't auto-close. |
| `silhouette-path` | `d` (sanitized SVG path string), `fill`, `stroke?`, `strokeWidth?`, `strokeDasharray?`, `strokeLinecap?`, `strokeLinejoin?`, `opacity?` | Arbitrary `M…L…A…Z` paths. The most powerful and most common primitive — it's how the playground builds calendar heatmaps, sunburst arcs, custom legends, and stacked-area polygons. |

### Text + label primitives

| Primitive | Schema fields | What it draws |
|---|---|---|
| `text` | `text`, `fontSize?`, `fill?`, `italic?`, `anchor?: start\|middle\|end` | A single text label at the child's anchor point. |
| `annotation-leader` | `annotation: { … }` | A leader line + label, with anchor + endpoint. |

### Structural / decorative

| Primitive | Notes |
|---|---|
| `frame` | A bordered panel with optional title. Useful for grouping. |
| `gradients` (defs) | Linear / radial gradients reusable by `fill="url(#id)"` across siblings. |
| `patterns` (defs) | Tileable pattern fills. |
| `glow` | Drop-shadow-style glow on top of a child. |
| `starfield` | Deterministic randomly-positioned dots; used in the DNA, jellyfish, orrery scenes. |
| `silhouette-path` (again) | Doubles as a way to fill background ground/sky shapes. |
| `gear`, `pendulum`, `slider-crank`, `wankel-rotor` | Schematic-machine primitives. Mostly used by the `draw-me-…` showcases. |
| `heart-icon`, `icon` | Stylized icon shapes. |

### Composition + escape hatch

| Primitive | Notes |
|---|---|
| `chart` + `size` | Nest a full chart spec inside compose, scaled to the requested `size`. One-level-deep recursion (a chart can't itself contain another compose). |
| `raw-svg` | A 4-KB sanitized XML escape hatch. No `<script>`, no `<foreignObject>`, no event handlers. This is how the playground gets per-bubble SMIL animations on Gapminder + the bar-chart race. |

---

## Authoring patterns

### "Just give me a labeled shape"
```json
{ "at": { "x": 200, "y": 100 }, "mark": "circle",
  "circle": { "radius": 16, "fill": "#4c78a8" } }
```
Plus a sibling text element at the same `at` with appropriate offset.

### "Many same-color shapes" (stay under the 64-child cap)
Concatenate `M…L…Z` subpaths into ONE `silhouette-path`:
```js
let d = "";
for (const cell of cells) d += ` ${rectPath(cell.x, cell.y, w, h)}`;
// One child, hundreds of rectangles, one fill color.
```
This is how the year-calendar heatmap fits its 371 cells into 6 path children (one per color tier).

### "Composite chart with a real data layer"
Use a `chart` child:
```json
{
  "at": { "x": 100, "y": 100 },
  "mark": "chart",
  "size": { "w": 400, "h": 300 },
  "chart": { "layers": [{ "mark": "bar", "encoding": { … } }] }
}
```

### "Per-element SMIL animation"
Use `raw-svg` and embed the `<animate>` directly:
```xml
<rect x="10" y="20" width="0" height="40" fill="#4c78a8">
  <animate attributeName="width" from="0" to="120"
           dur="0.7s" fill="freeze" begin="0.2s"/>
</rect>
```

---

## Limits + caveats

- **64 children per compose scene.** Pre-group same-color shapes into one `silhouette-path` (see pattern above) when you'd otherwise exceed this.
- **4 KB per `raw-svg` `xml` field.** Use multiple `raw-svg` children for larger animated blocks.
- **Sanitized SVG**: `<script>`, `<foreignObject>`, `<image>`, and `on*=` event handlers are stripped. There's no JS in compose output by design.
- **Deterministic by construction.** Every primitive emits stable, sorted attribute output. Same inputs always produce byte-identical SVG.

---

## Encoder gaps (Tier 1 — recently fixed)

Three improvements to encoding handling that benefit both chart marks AND `chart`-nested-in-compose:

1. **`size` channel now drives point radius.** Previously hardcoded to `r=3`; now scales the size field across `[3, 24]` px (override with `scale.range`). Uses sqrt mapping so visual *area* tracks value (Tufte's rule).

2. **`color: { value: "…" }` literal channel.** Skip the data-driven palette and apply a constant. Useful when each chart layer needs its own fill but you don't want to invent a placeholder field.

3. **Multi-series line by categorical `color` field** (already worked — confirmed by test): the line mark groups rows by the color field and emits one `<path>` per series.

---

## Mark catalog (chart layer 1, for reference)

15 data marks: `bar`, `line`, `point`, `area`, `rect`, `rule`, `geo-point`, `geo-region`, `heatmap`, `boxplot`, `text`, `treemap`, `sunburst`, `force`, `contour`, plus `arrow` (vector field).

Plus the math layer: `math-text`.

Plus a `line` config flag: `interpolate: "linear" | "step" | "step-before"` — for staircase plots without writing a custom polyline.
