/**
 * Tests for the heatmap mark (PR49 — Grammar polish).
 */
import { describe, expect, it } from "vitest";
import { compileSpec, renderSvg, safeParseSpec } from "../index.js";

const heatmapSchema = [
  { name: "day", type: "VARCHAR", nullable: false },
  { name: "hour", type: "VARCHAR", nullable: false },
  { name: "rides", type: "INTEGER", nullable: false },
];

const heatmapRows: ReadonlyArray<ReadonlyArray<unknown>> = [
  ["mon", "morning", 10],
  ["mon", "afternoon", 30],
  ["mon", "evening", 50],
  ["tue", "morning", 12],
  ["tue", "afternoon", 28],
  ["tue", "evening", 52],
  ["wed", "morning", 11],
  ["wed", "afternoon", 33],
  ["wed", "evening", 60], // max
];

describe("heatmap mark (PR49)", () => {
  it("compiles into a grid of rects with interpolated fills", () => {
    const parsed = safeParseSpec({
      data: { source: "x.csv" },
      layers: [
        {
          mark: "heatmap",
          encoding: { x: "day", y: "hour", color: "rides" },
        },
      ],
    });
    if (!parsed.ok) throw new Error(parsed.error.message);
    const scene = compileSpec({ spec: parsed.spec, rows: heatmapRows, schema: heatmapSchema });
    // 3 days × 3 hours = 9 cells, all rects.
    expect(scene.marks.length).toBe(9);
    for (const m of scene.marks) {
      expect(m.type).toBe("rect");
    }
    // The 60-ride cell should have a different fill than the 10-ride cell
    // (proves interpolation worked).
    const fills = scene.marks.map((m) => (m.type === "rect" ? m.fill : ""));
    const unique = new Set(fills);
    expect(unique.size).toBeGreaterThan(1);
  });

  it("rejects when the color encoding is missing", () => {
    const parsed = safeParseSpec({
      data: { source: "x.csv" },
      layers: [{ mark: "heatmap", encoding: { x: "day", y: "hour" } }],
    });
    if (!parsed.ok) throw new Error(parsed.error.message);
    expect(() =>
      compileSpec({ spec: parsed.spec, rows: heatmapRows, schema: heatmapSchema }),
    ).toThrow(/heatmap.*color/i);
  });

  it("renders without throwing through the SVG renderer", () => {
    const parsed = safeParseSpec({
      data: { source: "x.csv" },
      layers: [{ mark: "heatmap", encoding: { x: "day", y: "hour", color: "rides" } }],
    });
    if (!parsed.ok) throw new Error(parsed.error.message);
    const scene = compileSpec({ spec: parsed.spec, rows: heatmapRows, schema: heatmapSchema });
    const svg = renderSvg(scene);
    expect(svg.startsWith("<svg")).toBe(true);
    // 9 cells → 9 <rect> elements (plus the background rect).
    const rectMatches = svg.match(/<rect\s/g) ?? [];
    expect(rectMatches.length).toBeGreaterThanOrEqual(10);
  });
});
