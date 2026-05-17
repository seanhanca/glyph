/**
 * Tests for the `line` mark (PR19).
 *
 * Covers single-line and multi-line (color-grouped), linear + band x scales,
 * point sorting, and the SVG path-d output shape.
 */
import { describe, expect, it } from "vitest";
import type { GlyphSpec } from "../spec/types.js";
import { type CompileFieldInfo, compileSpec } from "./compile.js";

const schema: CompileFieldInfo[] = [
  { name: "hour", type: "INTEGER" },
  { name: "rides", type: "INTEGER" },
];

const rows: number[][] = [
  [0, 10],
  [1, 30],
  [2, 20],
];

describe("compileSpec — line mark (PR19)", () => {
  it("emits a single path mark with one M + (N-1) L commands", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "line", encoding: { x: "hour", y: "rides" } }],
    };
    const scene = compileSpec({ spec, rows, schema });
    const paths = scene.marks.filter((m) => m.type === "path");
    expect(paths).toHaveLength(1);
    const d = paths[0]?.d ?? "";
    expect(d.startsWith("M ")).toBe(true);
    const lCount = (d.match(/ L /g) ?? []).length;
    expect(lCount).toBe(rows.length - 1);
  });

  it("uses linear x scale for quantitative x (no band gaps)", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "line", encoding: { x: "hour", y: "rides" } }],
    };
    const scene = compileSpec({ spec, rows, schema });
    // Bottom axis should have linear ticks rather than category ticks.
    const bottom = scene.axes.find((a) => a.orientation === "bottom");
    expect(bottom?.ticks.length).toBeGreaterThan(0);
    expect(bottom?.label).toBe("hour");
  });

  it("sorts points by x ascending even if the source rows are unordered", () => {
    const unordered: number[][] = [
      [2, 20],
      [0, 10],
      [1, 30],
    ];
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "line", encoding: { x: "hour", y: "rides" } }],
    };
    const scene = compileSpec({ spec, rows: unordered, schema });
    const d = scene.marks.find((m) => m.type === "path")?.d ?? "";
    // First point should correspond to hour=0 — its x px should be the smallest.
    const tokens = d.split(/\s+/);
    const x0 = Number(tokens[1]);
    const x1 = Number(tokens[4]);
    const x2 = Number(tokens[7]);
    expect(x0).toBeLessThan(x1);
    expect(x1).toBeLessThan(x2);
  });

  it("emits one path per color group when color encoding is set", () => {
    const cs: CompileFieldInfo[] = [...schema, { name: "weekday", type: "VARCHAR" }];
    const cr: Array<Array<number | string>> = [
      [0, 10, "mon"],
      [1, 30, "mon"],
      [2, 20, "mon"],
      [0, 5, "tue"],
      [1, 15, "tue"],
      [2, 25, "tue"],
    ];
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [
        {
          mark: "line",
          encoding: { x: "hour", y: "rides", color: "weekday" },
        },
      ],
    };
    const scene = compileSpec({ spec, rows: cr, schema: cs });
    const paths = scene.marks.filter((m) => m.type === "path");
    expect(paths).toHaveLength(2);
    // Distinct strokes from the palette.
    expect(paths[0]?.stroke).not.toBe(paths[1]?.stroke);
  });

  it("drops groups with < 2 points (a single dot is not a line)", () => {
    const sparse: number[][] = [[0, 10]];
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "line", encoding: { x: "hour", y: "rides" } }],
    };
    const scene = compileSpec({ spec, rows: sparse, schema });
    expect(scene.marks.filter((m) => m.type === "path")).toHaveLength(0);
  });

  it("composes with a bar layer (line on top of bars, single y scale)", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [
        { mark: "bar", encoding: { x: "hour", y: "rides" } },
        { mark: "line", encoding: { x: "hour", y: "rides" } },
      ],
    };
    const scene = compileSpec({ spec, rows, schema });
    expect(scene.marks.filter((m) => m.type === "rect")).toHaveLength(3);
    expect(scene.marks.filter((m) => m.type === "path")).toHaveLength(1);
  });

  it("determinism: identical input → identical scene", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "line", encoding: { x: "hour", y: "rides" } }],
    };
    const a = compileSpec({ spec, rows, schema });
    const b = compileSpec({ spec, rows, schema });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
