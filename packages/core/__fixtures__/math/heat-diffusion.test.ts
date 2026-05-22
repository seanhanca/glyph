/**
 * RFC #4 end-to-end fixture — Gaussian pulse diffusing on a heat-
 * equation grid. The joy.html wave-equation demo's static cousin
 * (waves oscillate; heat just smooths). 24×24 grid × 80 steps
 * × dt = 0.005 → CFL = 0.05·0.005/(2/24)² ≈ 0.036, well within
 * the stability boundary.
 *
 * Determinism gate: byte-identical SVG across runs. Heat is the
 * EASIEST PDE to lock — no oscillation, no bifurcation, just
 * monotone smoothing.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type CompileFieldInfo, compileSpec } from "../../src/compiler/compile.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseSpec } from "../../src/spec/parse.js";

const fixtureUrl = new URL("./heat-diffusion.json", import.meta.url);
const fixturePath = fileURLToPath(fixtureUrl);

const schema: CompileFieldInfo[] = [
  { name: "x", type: "DOUBLE" },
  { name: "y", type: "DOUBLE" },
];

function buildAnchorRows(): ReadonlyArray<ReadonlyArray<number>> {
  return [
    [-1, -1],
    [1, 1],
  ];
}

describe("math examples — heat-diffusion (RFC #4 — pde-solve, kind=heat)", () => {
  it("renders the diffused Gaussian deterministically and locks the bytes", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseSpec(raw);
    const rows = buildAnchorRows();
    const svg = renderSvg(compileSpec({ spec, rows, schema }));
    const svg2 = renderSvg(compileSpec({ spec, rows, schema }));
    expect(svg2).toBe(svg);
    // 24×24 = 576 grid cells. Plus a page-background rect, a
    // continuous-legend swatch column (heatmap auto-emits one for
    // the color encoding), and a few framing rects — exact extra
    // count depends on the legend implementation. Bound generously
    // around 576 to confirm every grid cell emitted without
    // hard-coding the legend size.
    const rectCount = (svg.match(/<rect /g) ?? []).length;
    expect(rectCount).toBeGreaterThanOrEqual(576);
    expect(rectCount).toBeLessThanOrEqual(600);
    await expect(svg).toMatchFileSnapshot("./heat-diffusion.svg");
  });
});
