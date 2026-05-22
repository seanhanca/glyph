/**
 * RFC #3 v2 end-to-end fixture — strong-field Schwarzschild photon
 * orbits demo as a Glyph spec.
 *
 * Four rays around a unit-mass black hole illustrate three distinct
 * strong-field regimes:
 *
 *   - b = 6.0  (above b_crit ≈ 5.196 — scatters with a large
 *               deflection that exceeds the 4M/b weak-field formula)
 *   - b = 5.4  (just above b_crit — orbits the photon sphere once
 *               before scattering; this is the "Einstein ring"
 *               geometry)
 *   - b = 4.0  (below b_crit — captured at the event horizon, the
 *               trajectory truncates at r ≈ 2M)
 *   - b = -5.4 (mirror of the orbiting ray, below the lens)
 *
 * Determinism gate: byte-identical SVG across runs and platforms,
 * protected by `clampSamplerPrecision` on every RK4 step.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type CompileFieldInfo, compileSpec } from "../../src/compiler/compile.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseSpec } from "../../src/spec/parse.js";

const fixtureUrl = new URL("./black-hole-orbits.json", import.meta.url);
const fixturePath = fileURLToPath(fixtureUrl);

const schema: CompileFieldInfo[] = [
  { name: "x", type: "DOUBLE" },
  { name: "y", type: "DOUBLE" },
];

function buildAnchorRows(): ReadonlyArray<ReadonlyArray<number>> {
  return [
    [-32, -16],
    [32, 16],
  ];
}

describe("math examples — black-hole-orbits (RFC #3 v2 — geodesic strong-field)", () => {
  it("renders the 4-ray strong-field Schwarzschild geometry deterministically", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseSpec(raw);
    const rows = buildAnchorRows();
    const svg = renderSvg(compileSpec({ spec, rows, schema }));
    const svg2 = renderSvg(compileSpec({ spec, rows, schema }));
    expect(svg2).toBe(svg);
    // 4 seeds → 4 distinct polylines.
    const moveToCount = (svg.match(/d="M /g) ?? []).length;
    expect(moveToCount).toBe(4);
    await expect(svg).toMatchFileSnapshot("./black-hole-orbits.svg");
  });
});
