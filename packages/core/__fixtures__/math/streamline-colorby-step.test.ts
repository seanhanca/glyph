/**
 * RFC #2 v2 end-to-end fixture for `streamline.colorBy: "step"`.
 *
 * A 4×4 grid of seeds on the rotation field dx/dt = -y, dy/dt = x.
 * The "step" mode emits ONE `<path>` per consecutive point pair
 * along each polyline, with the stroke hue rotating from 0° (red,
 * start of the polyline) to ~270° (purple, end). The eye reads
 * each streamline as a rainbow trail showing arc-length progression.
 *
 * The 4×4 grid (vs the 6×6 used by the angle/speed fixtures) keeps
 * the locked SVG smaller — each polyline becomes ~200 path elements
 * instead of one, so the total mark count is ~5000 even at this
 * modest seed count. Smaller fixtures keep snapshot diffs readable.
 *
 * Determinism gate: byte-identical SVG across two renders. Hue is
 * computed via `(i / (N-1) * 270).toFixed(1)` so the SVG bytes don't
 * drift across the libm boundary.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type CompileFieldInfo, compileSpec } from "../../src/compiler/compile.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseSpec } from "../../src/spec/parse.js";

const fixtureUrl = new URL("./streamline-colorby-step.json", import.meta.url);
const fixturePath = fileURLToPath(fixtureUrl);

const schema: CompileFieldInfo[] = [
  { name: "x", type: "DOUBLE" },
  { name: "y", type: "DOUBLE" },
];

function buildDomainAnchorRows(): ReadonlyArray<ReadonlyArray<number>> {
  return [
    [-2, -2],
    [2, 2],
  ];
}

describe("math examples — streamline with colorBy: 'step' (RFC #2 v2)", () => {
  it("renders the rotation field with rainbow-trail strokes deterministically", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseSpec(raw);
    const rows = buildDomainAnchorRows();
    const svg = renderSvg(compileSpec({ spec, rows, schema }));
    const svg2 = renderSvg(compileSpec({ spec, rows, schema }));
    expect(svg2).toBe(svg);
    // Step mode emits one path per segment. A 4×4 seed grid with
    // maxSteps=120 should produce well over 100 distinct path
    // elements — far more than the back-compat single-color mode.
    const pathCount = (svg.match(/<path /g) ?? []).length;
    expect(pathCount).toBeGreaterThan(100);
    // Many distinct hsl() strokes along the rainbow trail.
    const hslMatches = svg.match(/stroke="hsl\([^"]+\)"/g) ?? [];
    const uniqueHues = new Set(hslMatches);
    expect(uniqueHues.size).toBeGreaterThanOrEqual(20);
    await expect(svg).toMatchFileSnapshot("./streamline-colorby-step.svg");
  });
});
