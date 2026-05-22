/**
 * Gray-Scott reaction-diffusion — joy.html "leopard spots" preset as
 * a Glyph spec. F=0.062, k=0.062 lives in the spot-pattern region
 * of (F, k) phase space; with a small central V seed and 80 steps,
 * the seed begins to nucleate into the characteristic mitosis-like
 * pattern. (The full leopard pattern needs ~1000+ steps to develop;
 * we lock the early dynamics for a fast, byte-stable snapshot.)
 *
 * CFL: max(Du, Dv)·dt/dx² = 1.0·0.01/(2/24)² = 1.44 — wait, that's
 * above 0.25. We need a smaller dt. Recomputed for the actual
 * fixture: dt=0.01 with dx=2/24=0.0833 gives 1.0·0.01/0.00694 = 1.44.
 * That fails CFL. Fixture must use a smaller dt — see the JSON.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type CompileFieldInfo, compileSpec } from "../../src/compiler/compile.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseSpec } from "../../src/spec/parse.js";

const fixtureUrl = new URL("./rd-spots.json", import.meta.url);
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

describe("math examples — rd-spots (RFC #4 v2 — pde-solve, kind=reaction-diffusion)", () => {
  it("renders the Gray-Scott seed evolution deterministically", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseSpec(raw);
    const rows = buildAnchorRows();
    const svg = renderSvg(compileSpec({ spec, rows, schema }));
    const svg2 = renderSvg(compileSpec({ spec, rows, schema }));
    expect(svg2).toBe(svg);
    const rectCount = (svg.match(/<rect /g) ?? []).length;
    expect(rectCount).toBeGreaterThanOrEqual(576);
    expect(rectCount).toBeLessThanOrEqual(600);
    await expect(svg).toMatchFileSnapshot("./rd-spots.svg");
  });
});
