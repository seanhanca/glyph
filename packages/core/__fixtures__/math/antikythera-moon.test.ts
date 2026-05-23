/**
 * Glyph spec for the Antikythera Mechanism's Moon-pointer output
 * (~150 BCE) — the world's oldest known analog computer, recovered
 * from a Roman shipwreck in 1901. Powers the "Life in Glyph"
 * gallery's `draw-me-antikythera.html` page.
 *
 * The mechanism's bronze gears compute the Moon's longitude as the
 * sum of two circular motions (deferent + epicycle) — a 2nd-century-
 * BCE implementation of Hipparchus's lunar theory:
 *
 *   x(t) = R₁·cos(t) + R₂·cos(13t)
 *   y(t) = R₁·sin(t) + R₂·sin(13t)
 *
 * with R₁ = 5 (annual solar deferent), R₂ = 1.2 (lunar epicycle).
 * The 1:13 frequency ratio matches the Moon's ~13 sidereal months
 * per tropical year — the same ratio the original mechanism's
 * tooth counts encode (223:235 in the Saros dial).
 *
 * Determinism gate: byte-identical SVG. cos/sin precision-clamped.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type CompileFieldInfo, compileSpec } from "../../src/compiler/compile.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseSpec } from "../../src/spec/parse.js";

const fixtureUrl = new URL("./antikythera-moon.json", import.meta.url);
const fixturePath = fileURLToPath(fixtureUrl);

const schema: CompileFieldInfo[] = [
  { name: "x", type: "DOUBLE" },
  { name: "y", type: "DOUBLE" },
];

function buildAnchorRows(): ReadonlyArray<ReadonlyArray<number>> {
  return [
    [-7, -7],
    [7, 7],
  ];
}

describe("math examples — antikythera-moon (Machines of Wonder)", () => {
  it("renders the compound epicyclic Moon-position curve deterministically", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseSpec(raw);
    const rows = buildAnchorRows();
    const svg = renderSvg(compileSpec({ spec, rows, schema }));
    const svg2 = renderSvg(compileSpec({ spec, rows, schema }));
    expect(svg2).toBe(svg);
    const pathCount = (svg.match(/<path /g) ?? []).length;
    expect(pathCount).toBeGreaterThanOrEqual(1);
    await expect(svg).toMatchFileSnapshot("./antikythera-moon.svg");
  });
});
