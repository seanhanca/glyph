/**
 * Glyph spec for a resting heartbeat — FitzHugh-Nagumo relaxation
 * oscillator (Richard FitzHugh, 1961). Powers the "Life in Glyph"
 * gallery's `draw-me-heartbeat.html` showcase.
 *
 * The 2D ODE:
 *   dV/dt = V - V³/3 - W + I    (membrane potential, fast variable)
 *   dW/dt = ε(V + a - bW)        (recovery variable, slow)
 *
 * with I=0.5, a=0.7, b=0.8, ε=0.08 — the classic FHN parameters
 * that produce the spike-and-recover pattern. We map V → trajectory.x
 * and W → trajectory.y. The plot shows V(t), the membrane potential,
 * which traces an ECG-like rhythm.
 *
 * Determinism gate: byte-identical SVG. RK4 + clampSamplerPrecision
 * keep the cross-platform libm drift below the SVG layer.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type CompileFieldInfo, compileSpec } from "../../src/compiler/compile.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseSpec } from "../../src/spec/parse.js";

const fixtureUrl = new URL("./heartbeat.json", import.meta.url);
const fixturePath = fileURLToPath(fixtureUrl);

const schema: CompileFieldInfo[] = [
  { name: "x", type: "DOUBLE" },
  { name: "y", type: "DOUBLE" },
];

function buildAnchorRows(): ReadonlyArray<ReadonlyArray<number>> {
  return [
    [0, -2.5],
    [200, 2.5],
  ];
}

describe("math examples — heartbeat (life-in-glyph)", () => {
  it("renders the FitzHugh-Nagumo membrane-potential trace deterministically", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseSpec(raw);
    const rows = buildAnchorRows();
    const svg = renderSvg(compileSpec({ spec, rows, schema }));
    const svg2 = renderSvg(compileSpec({ spec, rows, schema }));
    expect(svg2).toBe(svg);
    const pathCount = (svg.match(/<path /g) ?? []).length;
    expect(pathCount).toBeGreaterThanOrEqual(1);
    await expect(svg).toMatchFileSnapshot("./heartbeat.svg");
  });
});
