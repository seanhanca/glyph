/**
 * Tests for the explain pipeline (PR35 — Phase 3 §2).
 *
 * The pipeline is pure: given rows + schema, it must always produce the
 * same explanation. These tests fix the contract for each stage.
 */
import { describe, expect, it } from "vitest";
import { explainHandle } from "./index.js";

describe("explainHandle — top-line stage", () => {
  it("calls out the peak vs trough with labels and ratio", () => {
    const schema = [
      { name: "hour", type: "INTEGER", suggested: "ordinal" as const },
      { name: "rides", type: "INTEGER", suggested: "quantitative" as const },
    ];
    const rows: ReadonlyArray<ReadonlyArray<unknown>> = [
      [3, 40],
      [7, 200],
      [8, 260],
      [9, 220],
      [17, 240],
    ];
    const r = explainHandle({ schema, rows });
    expect(r.headline).toContain("rides peaked at 8");
    expect(r.headline).toContain("260");
    expect(r.headline).toContain("3");
    expect(r.headline).toContain("40");
    expect(r.headline).toContain("6.5×");
  });

  it("falls back to a range headline when no x column is present", () => {
    const schema = [{ name: "fare", type: "DOUBLE", suggested: "quantitative" as const }];
    const rows: ReadonlyArray<ReadonlyArray<unknown>> = [[10], [25], [12]];
    const r = explainHandle({ schema, rows });
    expect(r.headline).toMatch(/fare ranges/i);
    expect(r.headline).toContain("10");
    expect(r.headline).toContain("25");
  });

  it("returns a 'no rows' headline for an empty dataset", () => {
    const schema = [
      { name: "x", type: "VARCHAR", suggested: "nominal" as const },
      { name: "y", type: "INTEGER", suggested: "quantitative" as const },
    ];
    const r = explainHandle({ schema, rows: [] });
    expect(r.headline).toMatch(/no rows/i);
    expect(r.highlights).toEqual([]);
    expect(r.questions).toEqual([]);
  });

  it("returns 'no quantitative column' when y is missing entirely", () => {
    const schema = [{ name: "region", type: "VARCHAR", suggested: "nominal" as const }];
    const r = explainHandle({ schema, rows: [["us"], ["eu"]] });
    expect(r.headline).toMatch(/no quantitative column/i);
  });
});

describe("explainHandle — compositional stage", () => {
  it("surfaces a dominant group when one region holds >=30% share", () => {
    const schema = [
      { name: "region", type: "VARCHAR", suggested: "nominal" as const },
      { name: "revenue", type: "DOUBLE", suggested: "quantitative" as const },
    ];
    const rows: ReadonlyArray<ReadonlyArray<unknown>> = [
      ["us", 60],
      ["eu", 25],
      ["asia", 10],
      ["other", 5],
    ];
    const r = explainHandle({ schema, rows });
    // 60 / 100 = 60% — well above the 30% dominant-share threshold.
    expect(r.highlights.some((h) => h.includes("region=us") && h.includes("60%"))).toBe(true);
    expect(r.questions.some((q) => q.toLowerCase().includes("us"))).toBe(true);
  });

  it("surfaces a top-3 aggregate when no single group dominates", () => {
    const schema = [
      { name: "region", type: "VARCHAR", suggested: "nominal" as const },
      { name: "revenue", type: "DOUBLE", suggested: "quantitative" as const },
    ];
    const rows: ReadonlyArray<ReadonlyArray<unknown>> = [
      ["a", 22],
      ["b", 21],
      ["c", 20],
      ["d", 19],
      ["e", 18],
    ];
    const r = explainHandle({ schema, rows });
    // Total 100; top 3 = a+b+c = 63 → 63% ≥ 60% threshold.
    expect(r.highlights.some((h) => h.includes("Top 3 region"))).toBe(true);
  });
});

describe("explainHandle — anomaly stage", () => {
  it("flags a value > 2σ from its segment mean", () => {
    const schema = [
      { name: "day", type: "INTEGER", suggested: "ordinal" as const },
      { name: "rides", type: "INTEGER", suggested: "quantitative" as const },
    ];
    // 11 normal-ish values plus one wild outlier at day 6.
    const base = [50, 52, 48, 51, 49, 240, 47, 50, 52, 49, 51, 48];
    const rows = base.map((v, i) => [i + 1, v]);
    const r = explainHandle({ schema, rows });
    expect(r.highlights.some((h) => h.includes("outlier") && h.includes("day=6"))).toBe(true);
    expect(r.questions.some((q) => q.toLowerCase().includes("anomalous"))).toBe(true);
  });

  it("does not flag anomalies when std is zero (constant series)", () => {
    const schema = [
      { name: "day", type: "INTEGER", suggested: "ordinal" as const },
      { name: "rides", type: "INTEGER", suggested: "quantitative" as const },
    ];
    const rows = Array.from({ length: 10 }, (_, i) => [i, 50]);
    const r = explainHandle({ schema, rows });
    expect(r.highlights.every((h) => !h.toLowerCase().includes("outlier"))).toBe(true);
  });
});

describe("explainHandle — temporal stage", () => {
  it("flags an upward trend with high correlation", () => {
    const schema = [
      { name: "day", type: "DATE", suggested: "temporal" as const },
      { name: "value", type: "DOUBLE", suggested: "quantitative" as const },
    ];
    const rows: ReadonlyArray<ReadonlyArray<unknown>> = [
      [new Date("2024-01-01"), 10],
      [new Date("2024-01-02"), 12],
      [new Date("2024-01-03"), 15],
      [new Date("2024-01-04"), 18],
      [new Date("2024-01-05"), 22],
      [new Date("2024-01-06"), 25],
    ];
    const r = explainHandle({ schema, rows });
    expect(r.highlights.some((h) => h.toLowerCase().includes("upward"))).toBe(true);
    expect(r.questions.some((q) => q.toLowerCase().includes("sustainable"))).toBe(true);
  });

  it("calls out period-over-period change when ≥5%", () => {
    const schema = [
      { name: "day", type: "DATE", suggested: "temporal" as const },
      { name: "mrr", type: "DOUBLE", suggested: "quantitative" as const },
    ];
    const rows: ReadonlyArray<ReadonlyArray<unknown>> = [
      [new Date("2024-01-01"), 100],
      [new Date("2024-01-02"), 102],
      [new Date("2024-01-03"), 90], // -12% vs prior
    ];
    const r = explainHandle({ schema, rows });
    expect(r.highlights.some((h) => h.includes("down") && h.includes("12%"))).toBe(true);
  });

  it("skips the temporal stage when x is not temporal", () => {
    const schema = [
      { name: "region", type: "VARCHAR", suggested: "nominal" as const },
      { name: "value", type: "INTEGER", suggested: "quantitative" as const },
    ];
    const rows: ReadonlyArray<ReadonlyArray<unknown>> = [
      ["a", 10],
      ["b", 12],
      ["c", 14],
      ["d", 16],
    ];
    const r = explainHandle({ schema, rows });
    expect(r.highlights.every((h) => !h.toLowerCase().includes("trend"))).toBe(true);
  });
});

describe("explainHandle — determinism + shape", () => {
  it("is deterministic — identical input yields identical output", () => {
    const schema = [
      { name: "hour", type: "INTEGER", suggested: "ordinal" as const },
      { name: "rides", type: "INTEGER", suggested: "quantitative" as const },
    ];
    const rows: ReadonlyArray<ReadonlyArray<unknown>> = [
      [3, 40],
      [7, 200],
      [8, 260],
      [17, 240],
    ];
    const a = explainHandle({ schema, rows });
    const b = explainHandle({ schema, rows });
    expect(a).toEqual(b);
  });

  it("caps each array at 4 entries", () => {
    const schema = [
      { name: "k", type: "VARCHAR", suggested: "nominal" as const },
      { name: "v", type: "DOUBLE", suggested: "quantitative" as const },
    ];
    // Construct a dataset that triggers every stage to maximize array length.
    const rows: ReadonlyArray<ReadonlyArray<unknown>> = [
      ["a", 100], // strong dominator → composition highlight + question
      ["b", 5],
      ["c", 4],
      ["d", 3],
    ];
    const r = explainHandle({ schema, rows });
    expect(r.highlights.length).toBeLessThanOrEqual(4);
    expect(r.questions.length).toBeLessThanOrEqual(4);
  });

  it("honors xField / yField / groupField hints over heuristics", () => {
    const schema = [
      { name: "a", type: "INTEGER", suggested: "quantitative" as const },
      { name: "b", type: "INTEGER", suggested: "quantitative" as const },
      { name: "c", type: "VARCHAR", suggested: "nominal" as const },
    ];
    const rows: ReadonlyArray<ReadonlyArray<unknown>> = [
      [1, 10, "x"],
      [2, 50, "y"],
      [3, 20, "x"],
    ];
    // Without hints, y picks `a` (first quantitative). With hints, y is `b`.
    const r = explainHandle({ schema, rows, hints: { xField: "c", yField: "b" } });
    expect(r.headline).toMatch(/b\s/);
  });

  it("infers types from DuckDB type names when `suggested` is absent", () => {
    const schema = [
      { name: "hour", type: "INTEGER" },
      { name: "rides", type: "INTEGER" },
    ];
    const rows: ReadonlyArray<ReadonlyArray<unknown>> = [
      [3, 40],
      [8, 260],
    ];
    const r = explainHandle({ schema, rows });
    // Headline should still be a valid peak/trough sentence.
    expect(r.headline).toContain("260");
    expect(r.headline).toContain("40");
  });
});
