/**
 * Tests for the boxplot + text annotation marks (PR50).
 */
import { describe, expect, it } from "vitest";
import { compileSpec, renderSvg, safeParseSpec } from "../index.js";

const boxSchema = [
  { name: "group", type: "VARCHAR", nullable: false },
  { name: "value", type: "DOUBLE", nullable: false },
];

const boxRows: ReadonlyArray<ReadonlyArray<unknown>> = [
  // group A — symmetric around 50
  ["A", 40],
  ["A", 45],
  ["A", 50],
  ["A", 55],
  ["A", 60],
  // group B — has an outlier
  ["B", 10],
  ["B", 12],
  ["B", 14],
  ["B", 16],
  ["B", 18],
  ["B", 80], // outlier
];

describe("boxplot mark (PR50)", () => {
  it("emits a box + median line + two whiskers per group + outliers", () => {
    const parsed = safeParseSpec({
      data: { source: "x.csv" },
      layers: [{ mark: "boxplot", encoding: { x: "group", y: "value" } }],
    });
    if (!parsed.ok) throw new Error(parsed.error.message);
    const scene = compileSpec({ spec: parsed.spec, rows: boxRows, schema: boxSchema });
    const rectMarks = scene.marks.filter((m) => m.type === "rect");
    const lineMarks = scene.marks.filter((m) => m.type === "line");
    const circleMarks = scene.marks.filter((m) => m.type === "circle");
    // 2 groups × 1 box rect = 2 rects.
    expect(rectMarks.length).toBe(2);
    // 2 groups × (1 median + 2 whisker lines) = 6 lines.
    expect(lineMarks.length).toBe(6);
    // Group B's 80 is an outlier — 1 circle.
    expect(circleMarks.length).toBe(1);
  });

  it("rejects when y is not quantitative", () => {
    const parsed = safeParseSpec({
      data: { source: "x.csv" },
      layers: [{ mark: "boxplot", encoding: { x: "group", y: "group" } }],
    });
    if (!parsed.ok) throw new Error(parsed.error.message);
    expect(() => compileSpec({ spec: parsed.spec, rows: boxRows, schema: boxSchema })).toThrow(
      /y encoding must be quantitative/,
    );
  });

  it("renders without throwing through the SVG renderer", () => {
    const parsed = safeParseSpec({
      data: { source: "x.csv" },
      layers: [{ mark: "boxplot", encoding: { x: "group", y: "value" } }],
    });
    if (!parsed.ok) throw new Error(parsed.error.message);
    const scene = compileSpec({ spec: parsed.spec, rows: boxRows, schema: boxSchema });
    const svg = renderSvg(scene);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("<rect");
    expect(svg).toContain("<line");
    expect(svg).toContain("<circle");
  });
});

describe("text annotation mark (PR50)", () => {
  const textSchema = [
    { name: "category", type: "VARCHAR", nullable: false },
    { name: "score", type: "INTEGER", nullable: false },
    { name: "label", type: "VARCHAR", nullable: false },
  ];
  const textRows: ReadonlyArray<ReadonlyArray<unknown>> = [
    ["A", 10, "A: 10"],
    ["B", 20, "B: 20"],
    ["C", 30, "C: 30"],
  ];

  it("emits one text SceneMark per row at (x, y) with the encoded label", () => {
    const parsed = safeParseSpec({
      data: { source: "x.csv" },
      layers: [{ mark: "text", encoding: { x: "category", y: "score", text: "label" } }],
    });
    if (!parsed.ok) throw new Error(parsed.error.message);
    const scene = compileSpec({ spec: parsed.spec, rows: textRows, schema: textSchema });
    const textMarks = scene.marks.filter((m) => m.type === "text");
    expect(textMarks.length).toBe(3);
    expect(textMarks.map((m) => (m.type === "text" ? m.text : "")).sort()).toEqual([
      "A: 10",
      "B: 20",
      "C: 30",
    ]);
  });

  it("rejects when encoding.text is missing", () => {
    const parsed = safeParseSpec({
      data: { source: "x.csv" },
      layers: [{ mark: "text", encoding: { x: "category", y: "score" } }],
    });
    if (!parsed.ok) throw new Error(parsed.error.message);
    expect(() => compileSpec({ spec: parsed.spec, rows: textRows, schema: textSchema })).toThrow(
      /text.*encoding\.text/,
    );
  });

  it("composes with bars in a multi-layer spec", () => {
    const parsed = safeParseSpec({
      data: { source: "x.csv" },
      layers: [
        { mark: "bar", encoding: { x: "category", y: "score" } },
        { mark: "text", encoding: { x: "category", y: "score", text: "label" } },
      ],
    });
    if (!parsed.ok) throw new Error(parsed.error.message);
    const scene = compileSpec({ spec: parsed.spec, rows: textRows, schema: textSchema });
    const bars = scene.marks.filter((m) => m.type === "rect");
    const labels = scene.marks.filter((m) => m.type === "text");
    expect(bars.length).toBe(3);
    expect(labels.length).toBe(3);
  });
});
