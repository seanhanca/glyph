/**
 * Glyph spec for NASA's Artemis I Orion mission profile (Nov-Dec 2022):
 * Earth → outbound transit → Distant Retrograde Orbit (DRO) around the
 * Moon → inbound return → Earth. Used as the showcase visualization on
 * `site/math/draw-me.html` to demonstrate what a single English prompt
 * to an AI agent + Glyph can produce.
 *
 * The path is hand-tuned parametric (not physics-integrated) so the
 * three mission phases land on clean geometric boundaries:
 *
 *   t ∈ [0.0, 0.3]  outbound — Earth (0.6, 0) → Moon near-side (5.5, 0)
 *                   with an upward 1.5-unit arc
 *   t ∈ [0.3, 0.7]  DRO     — 0.75 retrograde revolutions around the
 *                   Moon (centered at (8, 0), radius 2.5), exiting
 *                   below the Moon at (8, -2.5)
 *   t ∈ [0.7, 1.0]  return  — (8, -2.5) → Earth (0.6, 0) with a
 *                   downward 0.5-unit arc
 *
 * Continuity verified algebraically at the two phase boundaries.
 *
 * Determinism gate: byte-identical SVG across runs and platforms.
 * The ternary in xExpr/yExpr only switches on `t < 0.3` and `t < 0.7`
 * — no transcendental drift at the boundaries.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type CompileFieldInfo, compileSpec } from "../../src/compiler/compile.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseSpec } from "../../src/spec/parse.js";

const fixtureUrl = new URL("./orion-journey.json", import.meta.url);
const fixturePath = fileURLToPath(fixtureUrl);

const schema: CompileFieldInfo[] = [
  { name: "x", type: "DOUBLE" },
  { name: "y", type: "DOUBLE" },
];

/** Sentinel anchor rows so the linear scale resolves to the
 *  fixture's declared scale.domain on both axes. */
function buildAnchorRows(): ReadonlyArray<ReadonlyArray<number>> {
  return [
    [-2, -4],
    [12, 4],
  ];
}

describe("math examples — orion-journey (draw-me.html showcase)", () => {
  it("renders the three-phase Orion mission path deterministically", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseSpec(raw);
    const rows = buildAnchorRows();
    const svg = renderSvg(compileSpec({ spec, rows, schema }));
    const svg2 = renderSvg(compileSpec({ spec, rows, schema }));
    expect(svg2).toBe(svg);
    // The line mark emits one `<path>` for the whole trace.
    const pathCount = (svg.match(/<path /g) ?? []).length;
    expect(pathCount).toBeGreaterThanOrEqual(1);
    // Draw-in animation emits an `<animate>` element on the path's
    // stroke-dasharray for the pen-draw effect.
    expect(svg).toMatch(/<animate /);
    await expect(svg).toMatchFileSnapshot("./orion-journey.svg");
  });
});
