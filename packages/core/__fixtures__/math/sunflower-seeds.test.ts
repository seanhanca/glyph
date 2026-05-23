/**
 * Glyph spec for sunflower phyllotaxis — Helmut Vogel's 1979 model
 * for the golden-angle seed packing observed in *Helianthus annuus*,
 * pine cones, pineapples, and aloe rosettes. Powers the "Life in
 * Glyph" gallery's `draw-me-sunflower.html` showcase.
 *
 * Each seed n is placed at:
 *   r(n) = sqrt(n)
 *   θ(n) = n · golden_angle    where golden_angle = π · (3 − √5)
 *                                              ≈ 137.50776° ≈ 2.39996 rad
 *
 * This is the angle that maximises packing density — any rational
 * multiple of π gives radial stripes; only the irrational golden
 * angle fills the disc evenly. Expressed as a Glyph `recurrence`
 * with `n` driving each step.
 *
 * Determinism gate: byte-identical SVG. cos/sin precision clamps
 * in the recurrence shape keep cross-platform libm drift below the
 * SVG layer.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type CompileFieldInfo, compileSpec } from "../../src/compiler/compile.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseSpec } from "../../src/spec/parse.js";

const fixtureUrl = new URL("./sunflower-seeds.json", import.meta.url);
const fixturePath = fileURLToPath(fixtureUrl);

const schema: CompileFieldInfo[] = [
  { name: "x", type: "DOUBLE" },
  { name: "y", type: "DOUBLE" },
];

function buildAnchorRows(): ReadonlyArray<ReadonlyArray<number>> {
  return [
    [-32, -32],
    [32, 32],
  ];
}

describe("math examples — sunflower-seeds (life-in-glyph)", () => {
  it("renders the golden-angle phyllotaxis pattern deterministically", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseSpec(raw);
    const rows = buildAnchorRows();
    const svg = renderSvg(compileSpec({ spec, rows, schema }));
    const svg2 = renderSvg(compileSpec({ spec, rows, schema }));
    expect(svg2).toBe(svg);
    // 800 steps + the initial (0,0) seed = 801 rows. The point mark
    // emits one <circle> per row; some at the origin may collapse
    // but the bulk should be unique.
    const circleCount = (svg.match(/<circle /g) ?? []).length;
    expect(circleCount).toBeGreaterThanOrEqual(700);
    await expect(svg).toMatchFileSnapshot("./sunflower-seeds.svg");
  });
});
