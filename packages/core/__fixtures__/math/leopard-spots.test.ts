/**
 * Glyph spec for "How the Leopard Got His Spots" — Gray-Scott
 * reaction-diffusion (Alan Turing, *The Chemical Basis of
 * Morphogenesis*, 1952; Pearson, *Complex patterns in a simple
 * system*, 1993).  Powers the "Life in Glyph" gallery's
 * `draw-me-leopard.html` showcase.
 *
 * The leopard-spots regime sits at F = k = 0.062 in the (F, k)
 * parameter space — small isolated nuclei grow and then divide,
 * locking into a hexagonal spot pattern. Compared with the v2
 * `rd-spots` fixture this uses a 32×32 grid (more spot detail),
 * 400 steps (well into the pattern-locked regime), and a slightly
 * tighter Gaussian seed.
 *
 * Determinism gate: byte-identical SVG. The per-cell precision
 * clamp in pde-solve keeps the libm boundary closed.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type CompileFieldInfo, compileSpec } from "../../src/compiler/compile.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseSpec } from "../../src/spec/parse.js";

const fixtureUrl = new URL("./leopard-spots.json", import.meta.url);
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

describe("math examples — leopard-spots (life-in-glyph)", () => {
  it("renders the Gray-Scott spot pattern deterministically", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseSpec(raw);
    const rows = buildAnchorRows();
    const svg = renderSvg(compileSpec({ spec, rows, schema }));
    const svg2 = renderSvg(compileSpec({ spec, rows, schema }));
    expect(svg2).toBe(svg);
    const rectCount = (svg.match(/<rect /g) ?? []).length;
    // 32×32 grid = 1024 cells. Some may be deduped at the renderer
    // level if they share styles, but we expect close to 1024.
    expect(rectCount).toBeGreaterThanOrEqual(1024);
    expect(rectCount).toBeLessThanOrEqual(1100);
    await expect(svg).toMatchFileSnapshot("./leopard-spots.svg");
  });
});
