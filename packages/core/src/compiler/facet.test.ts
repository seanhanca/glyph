/**
 * Tests for the facet compiler (PR28).
 *
 * Phase 1.0 supports `col` faceting only: distinct values of the facet
 * field partition rows into side-by-side panels. Each panel has its own
 * x and y scales (independent — shared scales land in a follow-up).
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
  [1, 20, "mon"],
  [2, 30, "mon"],
  [0, 5, "tue"],
  [1, 15, "tue"],
  [2, 25, "tue"],
  [0, 8, "wed"],
  [1, 12, "wed"],
  [2, 18, "wed"],
];

describe("compileSpec — facet.col (PR28)", () => {
  it("produces one panel per distinct facet value, in first-seen order", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "bar", encoding: { x: "hour", y: "rides" } }],
      facet: { col: "weekday" },
    };
    const scene = compileSpec({ spec, rows, schema });
    expect(scene.panels).toBeDefined();
    expect(scene.panels?.length).toBe(3);
    expect(scene.panels?.map((p) => p.title)).toEqual(["mon", "tue", "wed"]);
  });

  it("each panel contains rects only for that facet group", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "bar", encoding: { x: "hour", y: "rides" } }],
      facet: { col: "weekday" },
    };
    const scene = compileSpec({ spec, rows, schema });
    // Each panel has 3 hours of data → 3 rects.
    for (const p of scene.panels ?? []) {
      expect(p.marks.filter((m) => m.type === "rect")).toHaveLength(3);
    }
  });

  it("each panel has its own bottom + left axis", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "bar", encoding: { x: "hour", y: "rides" } }],
      facet: { col: "weekday" },
    };
    const scene = compileSpec({ spec, rows, schema });
    for (const p of scene.panels ?? []) {
      expect(p.axes.some((a) => a.orientation === "bottom")).toBe(true);
      expect(p.axes.some((a) => a.orientation === "left")).toBe(true);
    }
  });

  it("panels are laid out side-by-side with a non-zero gap", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "bar", encoding: { x: "hour", y: "rides" } }],
      facet: { col: "weekday" },
    };
    const scene = compileSpec({ spec, rows, schema });
    const panels = scene.panels ?? [];
    // Panel offsets should monotonically increase along x.
    for (let i = 1; i < panels.length; i++) {
      const a = panels[i - 1];
      const b = panels[i];
      if (!a || !b) continue;
      expect(b.plotArea.x).toBeGreaterThan(a.plotArea.x);
    }
  });

  it("top-level marks + axes are empty for a faceted scene", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "bar", encoding: { x: "hour", y: "rides" } }],
      facet: { col: "weekday" },
    };
    const scene = compileSpec({ spec, rows, schema });
    expect(scene.marks).toHaveLength(0);
    expect(scene.axes).toHaveLength(0);
  });

  it("respects spec.title (rendered once at the top of the SVG)", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "bar", encoding: { x: "hour", y: "rides" } }],
      facet: { col: "weekday" },
      title: "Rides by hour, per weekday",
    };
    const scene = compileSpec({ spec, rows, schema });
    expect(scene.title).toBe("Rides by hour, per weekday");
  });

  it("works with line and point marks too", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [
        { mark: "line", encoding: { x: "hour", y: "rides" } },
        { mark: "point", encoding: { x: "hour", y: "rides" } },
      ],
      facet: { col: "weekday" },
    };
    const scene = compileSpec({ spec, rows, schema });
    for (const p of scene.panels ?? []) {
      expect(p.marks.some((m) => m.type === "path")).toBe(true);
      expect(p.marks.some((m) => m.type === "circle")).toBe(true);
    }
  });

  it("empty input produces a faceted scene with zero panels", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "bar", encoding: { x: "hour", y: "rides" } }],
      facet: { col: "weekday" },
    };
    const scene = compileSpec({ spec, rows: [], schema });
    expect(scene.panels).toHaveLength(0);
  });

  it("determinism: identical input → identical scene", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "bar", encoding: { x: "hour", y: "rides" } }],
      facet: { col: "weekday" },
    };
    const a = compileSpec({ spec, rows, schema });
    const b = compileSpec({ spec, rows, schema });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
