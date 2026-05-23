/**
 * Glyph spec for the slider-crank mechanism in James Watt's 1769
 * steam engine — the kinematic heart of every reciprocating engine
 * from the Industrial Revolution onward. Powers the "Life in Glyph"
 * gallery's `draw-me-piston.html` (Machines of Wonder) page.
 *
 * Piston extension as a function of crank angle θ:
 *
 *   x_piston(θ) = r·cos(θ) + √(l² − r²·sin²(θ))
 *
 * with crank radius r = 1 and connecting-rod length l = 3 (typical
 * 1:3 ratio for early stationary steam engines). The non-sinusoidal
 * shape — most visible in the asymmetry between the "power stroke"
 * (θ ≈ π) and the "compression stroke" (θ ≈ 0) — is what makes a
 * piston engine deliver useful torque rather than zero net work.
 *
 * Determinism gate: byte-identical SVG across runs and platforms.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type CompileFieldInfo, compileSpec } from "../../src/compiler/compile.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseSpec } from "../../src/spec/parse.js";

const fixtureUrl = new URL("./slider-crank.json", import.meta.url);
const fixturePath = fileURLToPath(fixtureUrl);

const schema: CompileFieldInfo[] = [
  { name: "x", type: "DOUBLE" },
  { name: "y", type: "DOUBLE" },
];

function buildAnchorRows(): ReadonlyArray<ReadonlyArray<number>> {
  return [
    [0, 1],
    [6.283185307179586, 4.2],
  ];
}

describe("math examples — slider-crank (Machines of Wonder)", () => {
  it("renders Watt's slider-crank piston-position curve deterministically", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseSpec(raw);
    const rows = buildAnchorRows();
    const svg = renderSvg(compileSpec({ spec, rows, schema }));
    const svg2 = renderSvg(compileSpec({ spec, rows, schema }));
    expect(svg2).toBe(svg);
    const pathCount = (svg.match(/<path /g) ?? []).length;
    expect(pathCount).toBeGreaterThanOrEqual(1);
    await expect(svg).toMatchFileSnapshot("./slider-crank.svg");
  });
});
