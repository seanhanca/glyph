import { describe, expect, it } from "vitest";
import type { ColumnInfo } from "../compute/engine.js";
import type { GlyphSpec } from "../spec/types.js";
import { compileSpec } from "./compile.js";

const schema: ColumnInfo[] = [
  { name: "hour", type: "INTEGER", nullable: false },
  { name: "rides", type: "INTEGER", nullable: false },
];

const rows: number[][] = [
  [0, 10],
  [1, 20],
  [2, 30],
];

describe("compileSpec — bar", () => {
  it("produces one rect per row with band x and quantitative y", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "bar", encoding: { x: "hour", y: "rides" } }],
    };
    const scene = compileSpec({ spec, rows, schema });
    const rects = scene.marks.filter((m) => m.type === "rect");
    expect(rects).toHaveLength(3);
    expect(scene.axes).toHaveLength(2);
    expect(scene.axes.some((a) => a.orientation === "bottom")).toBe(true);
    expect(scene.axes.some((a) => a.orientation === "left")).toBe(true);
  });

  it("respects custom width/height", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "bar", encoding: { x: "hour", y: "rides" } }],
      width: 800,
      height: 500,
    };
    const scene = compileSpec({ spec, rows, schema });
    expect(scene.width).toBe(800);
    expect(scene.height).toBe(500);
  });

  it("uses dark theme background when requested", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "bar", encoding: { x: "hour", y: "rides" } }],
      theme: "dark",
    };
    const scene = compileSpec({ spec, rows, schema });
    expect(scene.background).toBe("#0e0e10");
  });

  it("places the title in the scene", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "bar", encoding: { x: "hour", y: "rides" } }],
      title: "Hello",
    };
    const scene = compileSpec({ spec, rows, schema });
    expect(scene.title).toBe("Hello");
  });
});

describe("compileSpec — point", () => {
  it("produces one circle per row with linear x", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "point", encoding: { x: "hour", y: "rides" } }],
    };
    const scene = compileSpec({ spec, rows, schema });
    const circles = scene.marks.filter((m) => m.type === "circle");
    expect(circles).toHaveLength(3);
  });

  it("applies colors from a fixed palette when color channel is set", () => {
    const colorSchema: ColumnInfo[] = [
      ...schema,
      { name: "kind", type: "VARCHAR", nullable: true },
    ];
    const colorRows: Array<Array<number | string>> = [
      [0, 10, "a"],
      [1, 20, "b"],
      [2, 30, "a"],
    ];
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [
        {
          mark: "point",
          encoding: { x: "hour", y: "rides", color: "kind" },
        },
      ],
    };
    const scene = compileSpec({
      spec,
      rows: colorRows,
      schema: colorSchema,
    });
    const circles = scene.marks.filter((m) => m.type === "circle");
    expect(circles[0]?.fill).toBe(circles[2]?.fill);
    expect(circles[0]?.fill).not.toBe(circles[1]?.fill);
  });
});

describe("compileSpec — error cases", () => {
  it("rejects an unsupported mark", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "area", encoding: { x: "hour", y: "rides" } }],
    };
    expect(() => compileSpec({ spec, rows, schema })).toThrow(
      /supports marks bar\|point/,
    );
  });

  it("rejects when x or y is missing", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "bar", encoding: { y: "rides" } }],
    };
    expect(() => compileSpec({ spec, rows, schema })).toThrow();
  });
});

describe("compileSpec — determinism", () => {
  it("produces identical scenes for identical input", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "bar", encoding: { x: "hour", y: "rides" } }],
    };
    const a = compileSpec({ spec, rows, schema });
    const b = compileSpec({ spec, rows, schema });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
