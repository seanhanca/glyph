// Tier-1 encoder gaps + Tier-2 mark extensions, regression-tested:
//   - encoding.size → point radius
//   - color: { value: "..." } literal channel
//   - line `interpolate: "step"` / `"step-before"`
//
// Each test is a minimal spec + the assertion that the emitted scene
// reflects the new behavior (not the pre-fix default).
import { describe, expect, it } from "vitest";
import { renderSvg } from "../render/svg.js";
import type { GlyphSpec } from "../spec/types.js";
import { compileSpec } from "./compile.js";

const fieldSchema = (...names: string[]) =>
  names.map((name, i) => ({
    name,
    type: i === 0 ? "VARCHAR" : "DOUBLE",
    nullable: false,
  }));

describe("Tier-1 — `encoding.size` drives point radius", () => {
  const schema = fieldSchema("country", "x", "y", "pop");
  const rows: ReadonlyArray<ReadonlyArray<unknown>> = [
    ["A", 10, 20, 1],
    ["B", 20, 30, 50],
    ["C", 30, 40, 100],
  ];

  it("returns uniform r=3 when no size encoding is set (byte-equivalent to pre-fix)", () => {
    const spec: GlyphSpec = {
      layers: [{ mark: "point", encoding: { x: "x", y: "y" } }],
    };
    const scene = compileSpec({ spec, rows, schema });
    const radii = scene.marks
      .filter((m) => m.type === "circle")
      .map((m) => (m.type === "circle" ? m.r : -1));
    expect(radii).toEqual([3, 3, 3]);
  });

  it("maps a quantitative size field to a sqrt-scaled radius range", () => {
    const spec: GlyphSpec = {
      layers: [
        {
          mark: "point",
          encoding: {
            x: "x",
            y: "y",
            size: { field: "pop", type: "quantitative" },
          },
        },
      ],
    };
    const scene = compileSpec({ spec, rows, schema });
    const radii = scene.marks
      .filter((m) => m.type === "circle")
      .map((m) => (m.type === "circle" ? m.r : -1));
    // Smallest pop → 3 (min), largest pop → 24 (max), middle → ≈ 18
    // (sqrt scaling of t = 50/99 ≈ 0.505).
    expect(radii[0]).toBeCloseTo(3, 0);
    expect(radii[2]).toBeCloseTo(24, 0);
    expect(radii[1]).toBeGreaterThan(radii[0]!);
    expect(radii[1]).toBeLessThan(radii[2]!);
  });

  it("honors `scale.range` on the size channel", () => {
    const spec: GlyphSpec = {
      layers: [
        {
          mark: "point",
          encoding: {
            x: "x",
            y: "y",
            size: {
              field: "pop",
              type: "quantitative",
              scale: { range: [8, 40] },
            },
          },
        },
      ],
    };
    const scene = compileSpec({ spec, rows, schema });
    const radii = scene.marks
      .filter((m) => m.type === "circle")
      .map((m) => (m.type === "circle" ? m.r : -1));
    expect(radii[0]).toBeCloseTo(8, 0);
    expect(radii[2]).toBeCloseTo(40, 0);
  });

  it("treats `size: { value: 12 }` as a constant radius for every row", () => {
    const spec: GlyphSpec = {
      layers: [
        {
          mark: "point",
          encoding: { x: "x", y: "y", size: { value: 12 } },
        },
      ],
    };
    const scene = compileSpec({ spec, rows, schema });
    const radii = scene.marks
      .filter((m) => m.type === "circle")
      .map((m) => (m.type === "circle" ? m.r : -1));
    expect(radii).toEqual([12, 12, 12]);
  });
});

describe("Tier-1 — `color: { value }` literal channel", () => {
  const schema = fieldSchema("category", "v");
  const rows: ReadonlyArray<ReadonlyArray<unknown>> = [
    ["A", 5],
    ["B", 8],
    ["C", 12],
  ];

  it("applies the literal fill to every bar (no palette indexing)", () => {
    const spec: GlyphSpec = {
      layers: [
        {
          mark: "bar",
          encoding: { x: "category", y: "v", color: { value: "#ff7f0e" } },
        },
      ],
    };
    const scene = compileSpec({ spec, rows, schema });
    const fills = scene.marks
      .filter((m) => m.type === "rect")
      .map((m) => (m.type === "rect" ? m.fill : ""));
    // 3 bars + (potentially) background rect → only the data rects use
    // the literal fill. Verify ALL of them do.
    const dataBarFills = fills.filter((f) => f === "#ff7f0e");
    expect(dataBarFills.length).toBeGreaterThanOrEqual(3);
  });

  it("survives renderSvg without errors", () => {
    const spec: GlyphSpec = {
      layers: [
        {
          mark: "point",
          encoding: { x: "v", y: "v", color: { value: "#1f7a39" } },
        },
      ],
    };
    const scene = compileSpec({ spec, rows, schema });
    const svg = renderSvg(scene);
    expect(svg).toContain('fill="#1f7a39"');
  });
});

describe('Tier-2 — `interpolate: "step"` line mark', () => {
  const schema = fieldSchema("group", "x", "y");
  const rows: ReadonlyArray<ReadonlyArray<unknown>> = [
    ["A", 1, 10],
    ["A", 2, 20],
    ["A", 3, 30],
  ];

  it('default `interpolate: "linear"` is byte-equivalent to the pre-fix output', () => {
    const spec: GlyphSpec = {
      layers: [{ mark: "line", encoding: { x: "x", y: "y" } }],
    };
    const scene = compileSpec({ spec, rows, schema });
    const paths = scene.marks.filter((m) => m.type === "path");
    expect(paths.length).toBe(1);
    // Linear d should have 2 "L" segments (3 points: M + L + L)
    const d = paths[0]?.type === "path" ? paths[0].d : "";
    expect((d.match(/ L /g) ?? []).length).toBe(2);
  });

  it('`interpolate: "step"` emits 2x the L-segments (horizontal then vertical per gap)', () => {
    const spec: GlyphSpec = {
      layers: [
        {
          mark: "line",
          encoding: { x: "x", y: "y" },
          interpolate: "step",
        },
      ],
    };
    const scene = compileSpec({ spec, rows, schema });
    const paths = scene.marks.filter((m) => m.type === "path");
    const d = paths[0]?.type === "path" ? paths[0].d : "";
    // 3 points means 2 gaps; each step gap = 2 L segments. Total 4.
    expect((d.match(/ L /g) ?? []).length).toBe(4);
  });

  it('`interpolate: "step-before"` also emits 4 L-segments for 3 points', () => {
    const spec: GlyphSpec = {
      layers: [
        {
          mark: "line",
          encoding: { x: "x", y: "y" },
          interpolate: "step-before",
        },
      ],
    };
    const scene = compileSpec({ spec, rows, schema });
    const paths = scene.marks.filter((m) => m.type === "path");
    const d = paths[0]?.type === "path" ? paths[0].d : "";
    expect((d.match(/ L /g) ?? []).length).toBe(4);
  });
});
