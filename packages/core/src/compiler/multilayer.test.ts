/**
 * Multi-layer compilation tests (PR14).
 *
 * Verifies the compiler folds over layers[] (not just layers[0]), composes
 * marks of different types into one scenegraph, and emits a right-side y-axis
 * when any layer requests it.
 */
import { describe, expect, it } from "vitest";
import type { GlyphSpec } from "../spec/types.js";
import { type CompileFieldInfo, compileSpec } from "./compile.js";

const schema: CompileFieldInfo[] = [
  { name: "hour", type: "INTEGER" },
  { name: "rides", type: "INTEGER" },
  { name: "avg_fare", type: "DOUBLE" },
];

const rows: number[][] = [
  [0, 10, 12.5],
  [1, 20, 11.2],
  [2, 30, 10.1],
];

describe("compileSpec — multi-layer (PR14)", () => {
  it("renders bar + point in one scene with shared x scale and one left axis", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [
        { mark: "bar", encoding: { x: "hour", y: "rides" } },
        { mark: "point", encoding: { x: "hour", y: "rides" } },
      ],
    };
    const scene = compileSpec({ spec, rows, schema });
    const rects = scene.marks.filter((m) => m.type === "rect");
    const circles = scene.marks.filter((m) => m.type === "circle");
    expect(rects).toHaveLength(3);
    expect(circles).toHaveLength(3);
    expect(scene.axes).toHaveLength(2); // one bottom, one left
    expect(scene.axes.filter((a) => a.orientation === "right")).toHaveLength(0);
  });

  it("emits a right-side y-axis when a layer requests scale.side='right'", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [
        { mark: "bar", encoding: { x: "hour", y: "rides" } },
        {
          mark: "point",
          encoding: {
            x: "hour",
            y: { field: "avg_fare", type: "quantitative", scale: { side: "right" } },
          },
        },
      ],
    };
    const scene = compileSpec({ spec, rows, schema });
    const rightAxes = scene.axes.filter((a) => a.orientation === "right");
    expect(rightAxes).toHaveLength(1);
    expect(rightAxes[0]?.label).toBe("avg_fare");
    // Left axis is also present
    expect(scene.axes.some((a) => a.orientation === "left" && a.label === "rides")).toBe(true);
    // Both layers' marks are in the scene
    expect(scene.marks.filter((m) => m.type === "rect")).toHaveLength(3);
    expect(scene.marks.filter((m) => m.type === "circle")).toHaveLength(3);
  });

  it("right-axis layer uses a y scale distinct from the left", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [
        { mark: "bar", encoding: { x: "hour", y: "rides" } },
        {
          mark: "point",
          encoding: {
            x: "hour",
            y: { field: "avg_fare", scale: { side: "right" } },
          },
        },
      ],
    };
    const scene = compileSpec({ spec, rows, schema });
    const leftAxis = scene.axes.find((a) => a.orientation === "left");
    const rightAxis = scene.axes.find((a) => a.orientation === "right");
    // Distinct labels, distinct tick label sets — proves the scales differ.
    expect(leftAxis?.label).toBe("rides");
    expect(rightAxis?.label).toBe("avg_fare");
    const leftLabels = leftAxis?.ticks.map((t) => t.label).join(",");
    const rightLabels = rightAxis?.ticks.map((t) => t.label).join(",");
    expect(leftLabels).not.toBe(rightLabels);
  });

  it("rejects a layer with a mark not yet supported in Phase 1 (area/rect)", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "area", encoding: { x: "hour", y: "rides" } }],
    };
    expect(() => compileSpec({ spec, rows, schema })).toThrow(/Phase 1 supports marks/);
  });

  it("rejects per-layer data overrides for now", () => {
    const spec: GlyphSpec = {
      layers: [
        {
          data: { source: "a.csv" },
          mark: "bar",
          encoding: { x: "hour", y: "rides" },
        },
        {
          data: { source: "b.csv" },
          mark: "bar",
          encoding: { x: "hour", y: "rides" },
        },
      ],
    };
    expect(() => compileSpec({ spec, rows, schema })).toThrow(/per-layer 'data' overrides/);
  });

  it("determinism: identical input → identical scene", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [
        { mark: "bar", encoding: { x: "hour", y: "rides" } },
        {
          mark: "point",
          encoding: { x: "hour", y: { field: "avg_fare", scale: { side: "right" } } },
        },
      ],
    };
    const a = compileSpec({ spec, rows, schema });
    const b = compileSpec({ spec, rows, schema });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
