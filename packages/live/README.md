# @glyph/live

Browser hydration for Glyph SVGs. Reads the `data-*` attrs a `spec.interactive` render emits, wires `click` / `hover` / `brush` handlers, and exposes a tiny imperative API.

```ts
import { glyphLive } from "@glyph/live";

const live = glyphLive(svgElement);

live.onClick((binding) => {
  const where = live.whereFor(binding);          // 'WHERE "pickup_hour" = 7'
  // call your glyph_query / @glyph/cli / fetch with this predicate
});

live.onBrush("x", (extent, marks) => {
  // extent is { kind: "numeric", min, max } or { kind: "discrete", values }
});
```

Zero runtime deps. Works on plain SVG elements (Observable, Marimo, Jupyter, vanilla HTML).

Apache 2.0. Pre-alpha — see the [MVP plan](../../mvp.md).
