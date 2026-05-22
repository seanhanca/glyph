import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
/**
 * RFC #3 end-to-end fixture — joy.html gravity-lens demo as a Glyph spec.
 *
 * Four photons with symmetric impact parameters {-4, -2.5, +2.5, +4}
 * pass a unit-mass lens at the origin. The Schwarzschild weak-field
 * geodesic equation deflects each by ≈ 4M/b, so the outer rays bend
 * less than the inner ones — the classic light-bending fan.
 *
 * Determinism gate: byte-identical SVG across runs and platforms,
 * protected by `clampSamplerPrecision` on every RK4 step.
 */
import { describe, expect, it } from "vitest";
import { type CompileFieldInfo, compileSpec } from "../../src/compiler/compile.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseSpec } from "../../src/spec/parse.js";

const fixtureUrl = new URL("./gravity-lens.json", import.meta.url);
const fixturePath = fileURLToPath(fixtureUrl);

const schema: CompileFieldInfo[] = [
  { name: "x", type: "DOUBLE" },
  { name: "y", type: "DOUBLE" },
];

/** Sentinel corner rows so the linear scale resolves to the fixture's
 *  declared scale.domain. (The geodesic data shape synthesizes rows
 *  from the spec; the compiler's linear-scale resolver still needs
 *  positional anchors for the empty top-level `rows` array.) */
function buildAnchorRows(): ReadonlyArray<ReadonlyArray<number>> {
  return [
    [-22, -10],
    [32, 10],
  ];
}

describe("math examples — gravity lens (RFC #3 — geodesic shape)", () => {
  it("renders the 4-ray Schwarzschild weak-field deflection deterministically", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseSpec(raw);
    const rows = buildAnchorRows();
    const svg = renderSvg(compileSpec({ spec, rows, schema }));
    const svg2 = renderSvg(compileSpec({ spec, rows, schema }));
    expect(svg2).toBe(svg);
    // Sanity: 4 seeds → 4 distinct polylines. Each polyline can
    // have hundreds of LineTo segments; we just verify the count
    // of MoveTo (`M `) commands matches the seed count.
    const moveToCount = (svg.match(/d="M /g) ?? []).length;
    expect(moveToCount).toBe(4);
    await expect(svg).toMatchFileSnapshot("./gravity-lens.svg");
  });
});
