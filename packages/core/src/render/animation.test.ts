/**
 * Tests for data-driven animations (PR43, v0).
 *
 * Pins the contract: when `spec.animation = { kind: "stage" }` is set,
 * the rendered SVG carries a <style> block with @keyframes + a
 * `glyph-stage` class on the marks group. When unset, the SVG is
 * byte-identical to its pre-PR43 output (no snapshot regression).
 */
import { describe, expect, it } from "vitest";
import { compileSpec, renderFrames, renderSvg, safeParseSpec } from "../index.js";

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
    expect(svg).toContain('class="glyph-marks glyph-stage"');
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

describe("renderSvg — stage-stagger (PR45)", () => {
  it("emits per-mark animation-delay based on row index", () => {
    const parsed = safeParseSpec({
      data: { source: "in-memory.csv" },
      layers: [{ mark: "bar", encoding: { x: "x", y: "y" } }],
      animation: { kind: "stage-stagger", duration_ms: 400, stagger_ms: 50 },
    });
    if (!parsed.ok) throw new Error(parsed.error.message);
    const scene = compileSpec({ spec: parsed.spec, rows: baseRows, schema: baseSchema });
    const svg = renderSvg(scene);
    expect(svg).toContain("glyph-stage-stagger");
    // 3 rows → expect animation-delay 0ms, 50ms, 100ms.
    expect(svg).toContain("animation-delay:0ms");
    expect(svg).toContain("animation-delay:50ms");
    expect(svg).toContain("animation-delay:100ms");
  });
});

describe("renderSvg — race / scrub (PR45)", () => {
  const yearRows: ReadonlyArray<ReadonlyArray<unknown>> = [
    ["A", 2020, 10],
    ["A", 2021, 20],
    ["A", 2022, 30],
  ];
  const yearSchema = [
    { name: "name", type: "VARCHAR", nullable: false },
    { name: "year", type: "INTEGER", nullable: false },
    { name: "value", type: "INTEGER", nullable: false },
  ];

  it("race emits inline <animate> on bar widths with the frame values", () => {
    const parsed = safeParseSpec({
      data: { source: "in-memory.csv" },
      layers: [{ mark: "bar", encoding: { x: "name", y: "value" } }],
      animation: { kind: "race", frame_field: "year", duration_ms: 6000 },
    });
    if (!parsed.ok) throw new Error(parsed.error.message);
    const scene = compileSpec({ spec: parsed.spec, rows: yearRows, schema: yearSchema });
    const svg = renderSvg(scene);
    expect(svg).toContain('<animate attributeName="width"');
    expect(svg).toContain('dur="6000ms"');
    expect(svg).toContain("glyph-race");
  });

  it("scrub accepts the spec contract and uses the same frame plumbing", () => {
    const parsed = safeParseSpec({
      data: { source: "in-memory.csv" },
      layers: [{ mark: "bar", encoding: { x: "name", y: "value" } }],
      animation: { kind: "scrub", frame_field: "year" },
    });
    if (!parsed.ok) throw new Error(parsed.error.message);
    const scene = compileSpec({ spec: parsed.spec, rows: yearRows, schema: yearSchema });
    expect(scene.animation?.kind).toBe("scrub");
    // scrub uses the same SMIL animate emission as race in v0 — the
    // <input type=range> UI lives in @glyph/live in a follow-up.
    expect(renderSvg(scene)).toContain("glyph-race");
  });

  it("throws when frame_field is not in the schema", () => {
    const parsed = safeParseSpec({
      data: { source: "in-memory.csv" },
      layers: [{ mark: "bar", encoding: { x: "name", y: "value" } }],
      animation: { kind: "race", frame_field: "nonexistent" },
    });
    if (!parsed.ok) throw new Error(parsed.error.message);
    expect(() => compileSpec({ spec: parsed.spec, rows: yearRows, schema: yearSchema })).toThrow(
      /frame_field "nonexistent" not found/,
    );
  });
});

describe("renderFrames — frame export (PR45)", () => {
  const yearRows: ReadonlyArray<ReadonlyArray<unknown>> = [
    ["A", 2020, 10],
    ["A", 2021, 20],
    ["A", 2022, 30],
  ];
  const yearSchema = [
    { name: "name", type: "VARCHAR", nullable: false },
    { name: "year", type: "INTEGER", nullable: false },
    { name: "value", type: "INTEGER", nullable: false },
  ];

  it("returns one SVG per frame for race animations", () => {
    const parsed = safeParseSpec({
      data: { source: "in-memory.csv" },
      layers: [{ mark: "bar", encoding: { x: "name", y: "value" } }],
      animation: { kind: "race", frame_field: "year" },
    });
    if (!parsed.ok) throw new Error(parsed.error.message);
    const scene = compileSpec({ spec: parsed.spec, rows: yearRows, schema: yearSchema });
    const frames = renderFrames(scene);
    expect(frames.length).toBe(3);
    for (const f of frames) {
      // Frame SVGs are static — no <animate> tags.
      expect(f.includes("<animate")).toBe(false);
      expect(f.startsWith("<svg")).toBe(true);
    }
    // Each frame's title is annotated with the frame label.
    expect(frames[0]).toContain("year=2020");
    expect(frames[1]).toContain("year=2021");
    expect(frames[2]).toContain("year=2022");
  });

  it("returns a single-element array for static scenes", () => {
    const parsed = safeParseSpec({
      data: { source: "in-memory.csv" },
      layers: [{ mark: "bar", encoding: { x: "x", y: "y" } }],
    });
    if (!parsed.ok) throw new Error(parsed.error.message);
    const scene = compileSpec({ spec: parsed.spec, rows: baseRows, schema: baseSchema });
    expect(renderFrames(scene).length).toBe(1);
  });
});
