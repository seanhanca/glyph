/**
 * Tests for legends, grid lines, and the rule annotation mark (PR22).
 *
 * Together these are the "production polish" pass — what makes a chart
 * look professional rather than amateur. Grid + legend tests are
 * compiler-level (assert on the Scene shape); the SVG-side tests live
 * in render/svg.polish.test.ts.
 */
import { describe, expect, it } from "vitest";
import type { GlyphSpec } from "../spec/types.js";
import { type CompileFieldInfo, compileSpec } from "./compile.js";

const schema: CompileFieldInfo[] = [
  { name: "hour", type: "INTEGER" },
  { name: "rides", type: "INTEGER" },
  { name: "weekday", type: "VARCHAR" },
];

const rows: Array<Array<number | string>> = [
  [0, 10, "mon"],
  [1, 20, "tue"],
  [2, 30, "mon"],
];

describe("compileSpec — grid lines", () => {
  it("emits gridTicks on the left axis matching its tick positions", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "bar", encoding: { x: "hour", y: "rides" } }],
    };
    const scene = compileSpec({ spec, rows, schema });
    const left = scene.axes.find((a) => a.orientation === "left");
    expect(left?.gridTicks).toBeDefined();
    expect(left?.gridTicks?.length).toBe(left?.ticks.length);
  });

  it("right axis does not duplicate grid lines", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [
        { mark: "bar", encoding: { x: "hour", y: "rides" } },
        {
          mark: "line",
          encoding: {
            x: "hour",
            y: { field: "rides", scale: { side: "right" } },
          },
        },
      ],
    };
    const scene = compileSpec({ spec, rows, schema });
    const right = scene.axes.find((a) => a.orientation === "right");
    expect(right?.gridTicks).toBeUndefined();
  });
});

describe("compileSpec — legends", () => {
  it("emits a color legend when color is encoded", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [
        {
          mark: "point",
          encoding: { x: "hour", y: "rides", color: "weekday" },
        },
      ],
    };
    const scene = compileSpec({ spec, rows, schema });
    expect(scene.legends).toBeDefined();
    expect(scene.legends?.length).toBe(1);
    const legend = scene.legends?.[0];
    expect(legend?.kind).toBe("color");
    expect(legend?.title).toBe("weekday");
    expect(legend?.entries.length).toBe(2); // mon, tue
    expect(legend?.entries[0]?.label).toBe("mon");
    expect(legend?.entries[1]?.label).toBe("tue");
  });

  it("omits legends when no color encoding is set", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "bar", encoding: { x: "hour", y: "rides" } }],
    };
    const scene = compileSpec({ spec, rows, schema });
    expect(scene.legends).toBeUndefined();
  });

  it("legend entries get palette colors by first-seen domain order", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [
        {
          mark: "point",
          encoding: { x: "hour", y: "rides", color: "weekday" },
        },
      ],
    };
    const scene = compileSpec({ spec, rows, schema });
    const entries = scene.legends?.[0]?.entries ?? [];
    expect(entries[0]?.color).not.toBe(entries[1]?.color);
  });
});

describe("compileSpec — rule annotation mark", () => {
  it("renders one horizontal line per row when only y is encoded", () => {
    const rs: number[][] = [[0, 25]];
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [
        { mark: "bar", encoding: { x: "hour", y: "rides" } },
        { mark: "rule", encoding: { y: "rides" } },
      ],
    };
    const scene = compileSpec({
      spec,
      rows: [...rows, ...rs],
      schema,
    });
    const lineMarks = scene.marks.filter((m) => m.type === "line");
    expect(lineMarks.length).toBeGreaterThan(0);
  });

  it("renders vertical rules when only x is encoded", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [
        { mark: "bar", encoding: { x: "hour", y: "rides" } },
        { mark: "rule", encoding: { x: "hour" } },
      ],
    };
    const scene = compileSpec({ spec, rows, schema });
    expect(scene.marks.filter((m) => m.type === "line").length).toBeGreaterThan(0);
  });

  it("rule errors when neither x nor y is encoded", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "rule", encoding: {} }],
    };
    expect(() => compileSpec({ spec, rows, schema })).toThrow(/rule.*requires/);
  });
});
