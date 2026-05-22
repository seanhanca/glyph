/**
 * Wave-equation ripples — joy.html demo as a Glyph spec.
 *
 * A Gaussian impulse at the origin propagates outward via the
 * leapfrog wave-equation solver. Light damping (γ=0.01) so the
 * fronts soften over the integration. CFL: c·dt/dx = 0.6·0.05/(2/24)
 * = 0.36 ≤ 1 ✓.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type CompileFieldInfo, compileSpec } from "../../src/compiler/compile.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseSpec } from "../../src/spec/parse.js";

const fixtureUrl = new URL("./wave-ripples.json", import.meta.url);
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

describe("math examples — wave-ripples (RFC #4 v2 — pde-solve, kind=wave)", () => {
  it("renders the wave-equation snapshot deterministically", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseSpec(raw);
    const rows = buildAnchorRows();
    const svg = renderSvg(compileSpec({ spec, rows, schema }));
    const svg2 = renderSvg(compileSpec({ spec, rows, schema }));
    expect(svg2).toBe(svg);
    // 24×24 = 576 cells.
    const rectCount = (svg.match(/<rect /g) ?? []).length;
    expect(rectCount).toBeGreaterThanOrEqual(576);
    expect(rectCount).toBeLessThanOrEqual(600);
    await expect(svg).toMatchFileSnapshot("./wave-ripples.svg");
  });
});
