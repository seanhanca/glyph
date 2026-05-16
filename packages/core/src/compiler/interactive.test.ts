import { describe, expect, it } from "vitest";
import type { GlyphSpec } from "../spec/types.js";
import { type CompileFieldInfo, compileSpec } from "./compile.js";

const schema: CompileFieldInfo[] = [
  { name: "hour", type: "INTEGER" },
  { name: "rides", type: "INTEGER" },
];

const rows: number[][] = [
  [0, 10],
  [1, 20],
  [2, 30],
];

describe("compileSpec — interactive opt-in", () => {
  it("non-interactive scenes leave marks without key or dataAttrs", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "bar", encoding: { x: "hour", y: "rides" } }],
    };
    const scene = compileSpec({ spec, rows, schema });
    expect(scene.schema).toBeUndefined();
    for (const m of scene.marks) {
      if (m.type === "rect" || m.type === "circle") {
        expect("key" in m && m.key !== undefined).toBe(false);
        expect("dataAttrs" in m && m.dataAttrs !== undefined).toBe(false);
      }
    }
  });

  it("interactive scenes attach row-indexed key + x/y data attrs", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "bar", encoding: { x: "hour", y: "rides" } }],
      interactive: {},
    };
    const scene = compileSpec({ spec, rows, schema });
    expect(scene.schema?.fields.x).toBe("hour");
    expect(scene.schema?.fields.y).toBe("rides");

    const rects = scene.marks.filter((m) => m.type === "rect");
    expect(rects).toHaveLength(3);
    expect(rects[0]?.key).toBe("0");
    expect(rects[0]?.dataAttrs?.row).toBe("0");
    expect(rects[0]?.dataAttrs?.x).toBe("0");
    expect(rects[0]?.dataAttrs?.y).toBe("10");
    expect(rects[2]?.dataAttrs?.x).toBe("2");
  });

  it("uses interactive.key for the data-key when provided", () => {
    const idSchema: CompileFieldInfo[] = [
      { name: "id", type: "VARCHAR" },
      { name: "hour", type: "INTEGER" },
      { name: "rides", type: "INTEGER" },
    ];
    const idRows: Array<Array<string | number>> = [
      ["a", 0, 10],
      ["b", 1, 20],
    ];
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "bar", encoding: { x: "hour", y: "rides" } }],
      interactive: { key: "id" },
    };
    const scene = compileSpec({ spec, rows: idRows, schema: idSchema });
    const rects = scene.marks.filter((m) => m.type === "rect");
    expect(rects[0]?.key).toBe("a");
    expect(rects[1]?.key).toBe("b");
  });

  it("emits the color channel→field mapping when color is encoded", () => {
    const cs: CompileFieldInfo[] = [
      { name: "hour", type: "INTEGER" },
      { name: "rides", type: "INTEGER" },
      { name: "weekday", type: "VARCHAR" },
    ];
    const cr: Array<Array<number | string>> = [
      [0, 10, "mon"],
      [1, 20, "tue"],
    ];
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [
        {
          mark: "point",
          encoding: { x: "hour", y: "rides", color: "weekday" },
        },
      ],
      interactive: {},
    };
    const scene = compileSpec({ spec, rows: cr, schema: cs });
    expect(scene.schema?.fields.color).toBe("weekday");
    const circles = scene.marks.filter((m) => m.type === "circle");
    expect(circles[0]?.dataAttrs?.color).toBe("mon");
  });

  it("emits a human-readable tooltip per mark (D3 'tooltips as data')", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "bar", encoding: { x: "hour", y: "rides" } }],
      interactive: {},
    };
    const scene = compileSpec({ spec, rows, schema });
    const rects = scene.marks.filter((m) => m.type === "rect");
    expect(rects[0]?.tooltip).toBe("hour: 0 · rides: 10");
    expect(rects[2]?.tooltip).toBe("hour: 2 · rides: 30");
  });

  it("non-interactive scenes do not set tooltip on marks", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "bar", encoding: { x: "hour", y: "rides" } }],
    };
    const scene = compileSpec({ spec, rows, schema });
    const rects = scene.marks.filter((m) => m.type === "rect");
    expect(rects[0]?.tooltip).toBeUndefined();
  });

  it("interactive determinism: identical input → identical scene", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "bar", encoding: { x: "hour", y: "rides" } }],
      interactive: { key: "hour" },
    };
    const a = compileSpec({ spec, rows, schema });
    const b = compileSpec({ spec, rows, schema });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
