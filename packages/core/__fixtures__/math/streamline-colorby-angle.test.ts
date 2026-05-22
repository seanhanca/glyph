/**
 * RFC 2026-05-23 — end-to-end fixture for `streamline.colorBy: "angle"`.
 *
 * The joy.html particle-flow demo as a real Glyph spec. A 6×6 grid
 * of seeds on the rotation field dx/dt = -y, dy/dt = x produces
 * concentric flow lines, each hued by its tangent direction at the
 * seed. Streamlines on opposite sides of the field rotate in
 * opposite directions, so each polyline gets a different stroke.
 *
 * Determinism gate: two renders must produce byte-identical SVGs.
 * The new `colorBy: "angle"` code path emits `hsl(deg,70%,55%)`
 * stroke strings where `deg` is `atan2(vy, vx)` clamped to one
 * decimal — the libm-drift concern that motivated the
 * `canonicalStringify` precision clamp is handled the same way
 * here, at the stroke-string layer (toFixed(1) collapses the
 * platform-dependent tail).
 *
 * Sanity: with 36 seeds spread over the rotation field, we expect
 * many distinct stroke colors — far more than the 1 the back-compat
 * streamline-rotation fixture produces. This is by design and the
 * test asserts it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type CompileFieldInfo, compileSpec } from "../../src/compiler/compile.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseSpec } from "../../src/spec/parse.js";

const fixtureUrl = new URL("./streamline-colorby-angle.json", import.meta.url);
const fixturePath = fileURLToPath(fixtureUrl);

const schema: CompileFieldInfo[] = [
  { name: "x", type: "DOUBLE" },
  { name: "y", type: "DOUBLE" },
];

/** Same sentinel-row trick the other streamline fixtures use to pin
 * the linear scale to [-2, 2] without baking domain detection into
 * the compiler. */
function buildDomainAnchorRows(): ReadonlyArray<ReadonlyArray<number>> {
  return [
    [-2, -2],
    [2, 2],
  ];
}

describe("math examples — streamline with colorBy: 'angle' (RFC 2026-05-23)", () => {
  it("renders the rotation field with hue-per-direction strokes deterministically", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseSpec(raw);
    const rows = buildDomainAnchorRows();
    const svg = renderSvg(compileSpec({ spec, rows, schema }));
    const svg2 = renderSvg(compileSpec({ spec, rows, schema }));
    expect(svg2).toBe(svg);
    // Sanity: a 6×6 seed grid produces 36 streamline paths.
    const pathCount = (svg.match(/<path d="M /g) ?? []).length;
    expect(pathCount).toBeGreaterThanOrEqual(28); // some seeds may
    expect(pathCount).toBeLessThanOrEqual(36); // collapse at fixed points
    // The whole point of colorBy: "angle" is that strokes vary by
    // direction. Pull out all distinct hsl() stroke values and
    // confirm we have many — clearly distinct from the back-compat
    // streamline-rotation snapshot (which has exactly one stroke).
    const hslMatches = svg.match(/stroke="hsl\([^"]+\)"/g) ?? [];
    const uniqueHues = new Set(hslMatches);
    expect(uniqueHues.size).toBeGreaterThanOrEqual(10);
    // Lock the bytes.
    await expect(svg).toMatchFileSnapshot("./streamline-colorby-angle.svg");
  });
});
