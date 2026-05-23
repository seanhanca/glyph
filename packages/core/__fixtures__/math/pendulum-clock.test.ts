/**
 * Glyph spec for Christiaan Huygens' 1656 pendulum clock — the first
 * timepiece accurate enough to navigate by, and the design that made
 * mechanical clocks a household object for the next 300 years. Powers
 * the "Life in Glyph" gallery's `draw-me-pendulum-clock.html` page.
 *
 * The 2D ODE (linearized small-angle pendulum with light damping):
 *
 *   dθ/dt = ω                  (angular velocity)
 *   dω/dt = -(g/L)·θ − γ·ω     (gravity restores, escapement leaks)
 *
 * with g/L = 1 (period ≈ 2π s) and γ = 0.02 (a high-quality clock
 * mainspring loses only ~2 % amplitude per swing). Initial θ = 0.6 rad
 * (about 35°), ω = 0.
 *
 * Determinism gate: byte-identical SVG. RK4 + clampSamplerPrecision.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type CompileFieldInfo, compileSpec } from "../../src/compiler/compile.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseSpec } from "../../src/spec/parse.js";

const fixtureUrl = new URL("./pendulum-clock.json", import.meta.url);
const fixturePath = fileURLToPath(fixtureUrl);

const schema: CompileFieldInfo[] = [
  { name: "x", type: "DOUBLE" },
  { name: "y", type: "DOUBLE" },
];

function buildAnchorRows(): ReadonlyArray<ReadonlyArray<number>> {
  return [
    [0, -0.7],
    [60, 0.7],
  ];
}

describe("math examples — pendulum-clock (Machines of Wonder)", () => {
  it("renders Huygens' damped pendulum trace deterministically", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseSpec(raw);
    const rows = buildAnchorRows();
    const svg = renderSvg(compileSpec({ spec, rows, schema }));
    const svg2 = renderSvg(compileSpec({ spec, rows, schema }));
    expect(svg2).toBe(svg);
    const pathCount = (svg.match(/<path /g) ?? []).length;
    expect(pathCount).toBeGreaterThanOrEqual(1);
    await expect(svg).toMatchFileSnapshot("./pendulum-clock.svg");
  });
});
