/**
 * Tests for data-driven animations (PR43, v0).
 *
 * Pins the contract: when `spec.animation = { kind: "stage" }` is set,
 * the rendered SVG carries a <style> block with @keyframes + a
 * `glyph-stage` class on the marks group. When unset, the SVG is
 * byte-identical to its pre-PR43 output (no snapshot regression).
 */
import { describe, expect, it } from "vitest";
import { compileSpec, renderSvg, safeParseSpec } from "../index.js";

const baseRows: ReadonlyArray<ReadonlyArray<unknown>> = [
  [1, 10],
  [2, 20],
  [3, 30],
];
const baseSchema = [
  { name: "x", type: "INTEGER", nullable: false },
  { name: "y", type: "INTEGER", nullable: false },
];

describe("renderSvg — stage animation (PR43)", () => {
  it("emits @keyframes + glyph-stage class when spec.animation is set", () => {
    const parsed = safeParseSpec({
      data: { source: "in-memory.csv" },
      layers: [{ mark: "bar", encoding: { x: "x", y: "y" } }],
      animation: { kind: "stage", duration_ms: 500 },
    });
    if (!parsed.ok) throw new Error(parsed.error.message);
    const scene = compileSpec({ spec: parsed.spec, rows: baseRows, schema: baseSchema });
    const svg = renderSvg(scene);
    expect(svg).toContain("@keyframes glyph-stage");
    expect(svg).toContain("class=\"glyph-marks glyph-stage\"");
    expect(svg).toContain("500ms");
  });

  it("defaults the duration to 700ms when not provided", () => {
    const parsed = safeParseSpec({
      data: { source: "in-memory.csv" },
      layers: [{ mark: "bar", encoding: { x: "x", y: "y" } }],
      animation: { kind: "stage" },
    });
    if (!parsed.ok) throw new Error(parsed.error.message);
    const scene = compileSpec({ spec: parsed.spec, rows: baseRows, schema: baseSchema });
    const svg = renderSvg(scene);
    expect(svg).toContain("700ms");
  });

  it("omits the style block entirely when animation is unset", () => {
    const parsed = safeParseSpec({
      data: { source: "in-memory.csv" },
      layers: [{ mark: "bar", encoding: { x: "x", y: "y" } }],
    });
    if (!parsed.ok) throw new Error(parsed.error.message);
    const scene = compileSpec({ spec: parsed.spec, rows: baseRows, schema: baseSchema });
    const svg = renderSvg(scene);
    expect(svg).not.toContain("@keyframes glyph-stage");
    expect(svg).not.toContain("glyph-stage");
  });
});
