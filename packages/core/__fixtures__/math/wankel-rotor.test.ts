/**
 * Glyph spec for the Wankel rotary engine housing (Felix Wankel,
 * 1957) — the only mass-produced rotary internal-combustion engine.
 * Powers the "Life in Glyph" gallery's `draw-me-rotor.html` page.
 *
 * The chamber wall is an epitrochoid traced by an apex of the
 * triangular rotor as it orbits inside the housing:
 *
 *   x(t) = R·cos(t) + e·cos(3t)
 *   y(t) = R·sin(t) + e·sin(3t)
 *
 * with R = 4 (generating radius) and e = 1 (eccentricity). The 1:3
 * frequency ratio is what gives the housing its distinctive three-
 * lobed shape — and what makes the rotor sweep three working
 * chambers per revolution.
 *
 * Determinism gate: byte-identical SVG. cos/sin precision-clamped.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type CompileFieldInfo, compileSpec } from "../../src/compiler/compile.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseSpec } from "../../src/spec/parse.js";

const fixtureUrl = new URL("./wankel-rotor.json", import.meta.url);
const fixturePath = fileURLToPath(fixtureUrl);

const schema: CompileFieldInfo[] = [
  { name: "x", type: "DOUBLE" },
  { name: "y", type: "DOUBLE" },
];

function buildAnchorRows(): ReadonlyArray<ReadonlyArray<number>> {
  return [
    [-5.5, -5.5],
    [5.5, 5.5],
  ];
}

describe("math examples — wankel-rotor (Machines of Wonder)", () => {
  it("renders the Wankel epitrochoidal housing curve deterministically", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseSpec(raw);
    const rows = buildAnchorRows();
    const svg = renderSvg(compileSpec({ spec, rows, schema }));
    const svg2 = renderSvg(compileSpec({ spec, rows, schema }));
    expect(svg2).toBe(svg);
    const pathCount = (svg.match(/<path /g) ?? []).length;
    expect(pathCount).toBeGreaterThanOrEqual(1);
    await expect(svg).toMatchFileSnapshot("./wankel-rotor.svg");
  });
});
