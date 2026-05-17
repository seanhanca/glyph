/**
 * Tests for spec-driven tooltip overrides (PR24).
 *
 * `encoding.tooltip` already exists in the schema; this PR activates it
 * in the compiler so authors can replace the default "x: v · y: v · color: v"
 * with their own per-channel layout.
 */
import { describe, expect, it } from "vitest";
import type { GlyphSpec } from "../spec/types.js";
import { type CompileFieldInfo, compileSpec } from "./compile.js";

const schema: CompileFieldInfo[] = [
  { name: "hour", type: "INTEGER" },
  { name: "rides", type: "INTEGER" },
  { name: "name", type: "VARCHAR" },
];

const rows: Array<Array<number | string>> = [
  [7, 210, "Alice"],
  [8, 260, "Bob"],
];

describe("encoding.tooltip — overrides", () => {
  it("default tooltip (no override) is 'x: v · y: v'", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "bar", encoding: { x: "hour", y: "rides" } }],
      interactive: {},
    };
    const scene = compileSpec({ spec, rows, schema });
    const rect = scene.marks.find((m) => m.type === "rect");
    expect(rect?.tooltip).toBe("hour: 7 · rides: 210");
  });

  it("string tooltip emits the raw field value (no label prefix)", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [
        {
          mark: "bar",
          encoding: { x: "hour", y: "rides", tooltip: "name" },
        },
      ],
      interactive: {},
    };
    const scene = compileSpec({ spec, rows, schema });
    const rects = scene.marks.filter((m) => m.type === "rect");
    expect(rects[0]?.tooltip).toBe("Alice");
    expect(rects[1]?.tooltip).toBe("Bob");
  });

  it("array tooltip emits 'field: value' for each, joined by ·", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [
        {
          mark: "bar",
          encoding: { x: "hour", y: "rides", tooltip: ["name", "rides"] },
        },
      ],
      interactive: {},
    };
    const scene = compileSpec({ spec, rows, schema });
    const rect = scene.marks.find((m) => m.type === "rect");
    expect(rect?.tooltip).toBe("name: Alice · rides: 210");
  });

  it("object tooltip with title= overrides the label", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [
        {
          mark: "bar",
          encoding: {
            x: "hour",
            y: "rides",
            tooltip: { field: "rides", title: "Total rides" },
          },
        },
      ],
      interactive: {},
    };
    const scene = compileSpec({ spec, rows, schema });
    const rect = scene.marks.find((m) => m.type === "rect");
    expect(rect?.tooltip).toBe("Total rides: 210");
  });

  it("array of channel objects with titles", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [
        {
          mark: "bar",
          encoding: {
            x: "hour",
            y: "rides",
            tooltip: [
              { field: "name", title: "Customer" },
              { field: "rides", title: "Rides" },
            ],
          },
        },
      ],
      interactive: {},
    };
    const scene = compileSpec({ spec, rows, schema });
    const rect = scene.marks.find((m) => m.type === "rect");
    expect(rect?.tooltip).toBe("Customer: Alice · Rides: 210");
  });

  it("non-interactive scenes still ignore tooltip (no <title> emitted)", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [
        {
          mark: "bar",
          encoding: { x: "hour", y: "rides", tooltip: "name" },
        },
      ],
      // no `interactive` — tooltip is never read
    };
    const scene = compileSpec({ spec, rows, schema });
    const rect = scene.marks.find((m) => m.type === "rect");
    expect(rect?.tooltip).toBeUndefined();
  });
});
