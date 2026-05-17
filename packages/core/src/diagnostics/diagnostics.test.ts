/**
 * Tests for the four diagnostic primitives (PR36 — Phase 3 §3).
 *
 * Each diagnostic is a pure deterministic function — these tests pin the
 * contract: same input → same JSON, sensible scores, sensible explanations.
 */
import { describe, expect, it } from "vitest";
import {
  attributeDrift,
  decomposeVariance,
  detectAnomalies,
  seasonalNaiveForecast,
} from "./index.js";

describe("detectAnomalies", () => {
  it("flags the single value > 2σ from the global mean", () => {
    const schema = [
      { name: "day", type: "INTEGER", suggested: "ordinal" as const },
      { name: "rides", type: "INTEGER", suggested: "quantitative" as const },
    ];
    // 11 normal values + 1 wild outlier on day 6.
    const rides = [50, 52, 48, 51, 49, 240, 47, 50, 52, 49, 51, 48];
    const rows = rides.map((v, i) => [i + 1, v]);
    const r = detectAnomalies({ schema, rows, valueField: "rides", labelField: "day" });
    expect(r.rows.length).toBeGreaterThanOrEqual(1);
    // biome-ignore lint/style/noNonNullAssertion: length checked.
    const top = r.rows[0]!;
    expect(Math.abs(top.z)).toBeGreaterThan(2);
    expect(top.row[1]).toBe(240);
    expect(r.explanation.headline).toMatch(/outlier/i);
    expect(r.explanation.questions.length).toBeGreaterThan(0);
  });

  it("buckets by groupField so per-segment thresholds apply", () => {
    const schema = [
      { name: "region", type: "VARCHAR", suggested: "nominal" as const },
      { name: "rides", type: "INTEGER", suggested: "quantitative" as const },
    ];
    // Two regions with very different baselines. A 110 in `eu` (mean 50)
    // is wild; a 110 in `us` (mean 100) is normal.
    const rows: ReadonlyArray<ReadonlyArray<unknown>> = [
      ["us", 95],
      ["us", 105],
      ["us", 100],
      ["us", 102],
      ["us", 98],
      ["us", 110],
      ["eu", 48],
      ["eu", 52],
      ["eu", 50],
      ["eu", 49],
      ["eu", 51],
      ["eu", 110],
    ];
    const r = detectAnomalies({
      schema,
      rows,
      valueField: "rides",
      groupField: "region",
    });
    // Only the eu=110 should be flagged.
    expect(r.rows.length).toBe(1);
    // biome-ignore lint/style/noNonNullAssertion: length checked.
    expect(r.rows[0]!.segment).toBe("eu");
    // biome-ignore lint/style/noNonNullAssertion: length checked.
    expect(r.rows[0]!.value).toBe(110);
  });

  it("returns an empty result with a clear headline when std is zero", () => {
    const schema = [
      { name: "day", type: "INTEGER", suggested: "ordinal" as const },
      { name: "rides", type: "INTEGER", suggested: "quantitative" as const },
    ];
    const rows = Array.from({ length: 8 }, (_, i) => [i, 50]);
    const r = detectAnomalies({ schema, rows, valueField: "rides" });
    expect(r.rows).toEqual([]);
    expect(r.explanation.headline).toMatch(/no outliers/i);
  });

  it("is deterministic — identical input → identical output", () => {
    const schema = [
      { name: "day", type: "INTEGER", suggested: "ordinal" as const },
      { name: "rides", type: "INTEGER", suggested: "quantitative" as const },
    ];
    const rows: ReadonlyArray<ReadonlyArray<unknown>> = [
      [1, 50],
      [2, 52],
      [3, 240],
      [4, 49],
      [5, 51],
      [6, 50],
    ];
    const a = detectAnomalies({ schema, rows, valueField: "rides" });
    const b = detectAnomalies({ schema, rows, valueField: "rides" });
    expect(a).toEqual(b);
  });

  it("returns top-N when more than `limit` outliers exist", () => {
    const schema = [
      { name: "k", type: "INTEGER", suggested: "ordinal" as const },
      { name: "v", type: "DOUBLE", suggested: "quantitative" as const },
    ];
    // 30 baseline values around 50 + 4 strong outliers near 500. Many
    // baseline rows are needed so the outliers don't swamp the global std.
    const baseline = Array.from({ length: 30 }, () => 50);
    const outliers = [500, 480, 460, 440];
    const all = [...baseline, ...outliers].map((v, i) => [i, v]);
    const r = detectAnomalies({ schema, rows: all, valueField: "v", limit: 3 });
    expect(r.rows.length).toBe(3);
    // The strongest |z| should come first.
    expect(r.rows.map((row) => row.value)).toEqual([500, 480, 460]);
  });
});

describe("attributeDrift", () => {
  it("ranks groups by contribution to the period delta", () => {
    const schema = [
      { name: "region", type: "VARCHAR", suggested: "nominal" as const },
      { name: "period", type: "VARCHAR", suggested: "nominal" as const },
      { name: "revenue", type: "DOUBLE", suggested: "quantitative" as const },
    ];
    const rows: ReadonlyArray<ReadonlyArray<unknown>> = [
      // Period A
      ["us", "A", 100],
      ["eu", "A", 60],
      ["asia", "A", 40],
      // Period B
      ["us", "B", 80], // -20
      ["eu", "B", 65], // +5
      ["asia", "B", 35], // -5
    ];
    const r = attributeDrift({
      schema,
      rows,
      valueField: "revenue",
      groupField: "region",
      periodField: "period",
      periodA: (v) => v === "A",
      periodB: (v) => v === "B",
    });
    expect(r.totalA).toBe(200);
    expect(r.totalB).toBe(180);
    expect(r.totalDelta).toBe(-20);
    expect(r.rows[0]?.group).toBe("us");
    expect(r.rows[0]?.delta).toBe(-20);
    expect(r.rows[0]?.share).toBe(1); // us drove 100% of the (negative) drift
    expect(r.explanation.headline).toMatch(/down/i);
    expect(r.explanation.headline).toContain("us");
  });

  it("returns shares that sum to ±1 when totalDelta is non-zero", () => {
    const schema = [
      { name: "g", type: "VARCHAR", suggested: "nominal" as const },
      { name: "p", type: "VARCHAR", suggested: "nominal" as const },
      { name: "v", type: "DOUBLE", suggested: "quantitative" as const },
    ];
    const rows: ReadonlyArray<ReadonlyArray<unknown>> = [
      ["a", "A", 10],
      ["b", "A", 10],
      ["a", "B", 30],
      ["b", "B", 5],
    ];
    // totalA=20, totalB=35, totalDelta=15. a: +20 → share 20/15=1.33; b: -5 → -5/15=-0.33. Sum=1.
    const r = attributeDrift({
      schema,
      rows,
      valueField: "v",
      groupField: "g",
      periodField: "p",
      periodA: (v) => v === "A",
      periodB: (v) => v === "B",
    });
    const shareSum = r.rows.reduce((s, row) => s + row.share, 0);
    expect(shareSum).toBeCloseTo(1, 6);
  });

  it("handles a fully flat case with a no-change headline", () => {
    const schema = [
      { name: "g", type: "VARCHAR", suggested: "nominal" as const },
      { name: "p", type: "VARCHAR", suggested: "nominal" as const },
      { name: "v", type: "DOUBLE", suggested: "quantitative" as const },
    ];
    const r = attributeDrift({
      schema,
      rows: [],
      valueField: "v",
      groupField: "g",
      periodField: "p",
      periodA: () => true,
      periodB: () => false,
    });
    expect(r.totalA).toBe(0);
    expect(r.totalB).toBe(0);
    expect(r.totalDelta).toBe(0);
    expect(r.explanation.headline).toMatch(/unchanged/i);
  });
});

describe("decomposeVariance", () => {
  it("ranks factors by variance explained — high-signal factor first", () => {
    const schema = [
      { name: "region", type: "VARCHAR", suggested: "nominal" as const },
      { name: "weekday", type: "VARCHAR", suggested: "nominal" as const },
      { name: "value", type: "DOUBLE", suggested: "quantitative" as const },
    ];
    // Region carries all the signal; weekday is random noise w.r.t. value.
    // us: ~100; eu: ~50. Six rows each, two weekdays.
    const rows: ReadonlyArray<ReadonlyArray<unknown>> = [
      ["us", "mon", 98],
      ["us", "tue", 102],
      ["us", "mon", 101],
      ["us", "tue", 99],
      ["us", "mon", 100],
      ["us", "tue", 100],
      ["eu", "mon", 49],
      ["eu", "tue", 51],
      ["eu", "mon", 50],
      ["eu", "tue", 52],
      ["eu", "mon", 48],
      ["eu", "tue", 50],
    ];
    const r = decomposeVariance({
      schema,
      rows,
      metricField: "value",
      factors: ["region", "weekday"],
    });
    // Region should explain almost all the variance; weekday almost none.
    expect(r.rows[0]?.factor).toBe("region");
    expect(r.rows[0]?.varianceExplained).toBeGreaterThan(0.9);
    expect(r.rows[1]?.varianceExplained).toBeLessThan(0.05);
    expect(r.explanation.headline).toContain("region");
  });

  it("returns 0% explained when every group has the same mean", () => {
    const schema = [
      { name: "g", type: "VARCHAR", suggested: "nominal" as const },
      { name: "v", type: "DOUBLE", suggested: "quantitative" as const },
    ];
    const rows: ReadonlyArray<ReadonlyArray<unknown>> = [
      ["a", 10],
      ["b", 10],
      ["c", 10],
      ["a", 10],
      ["b", 10],
      ["c", 10],
    ];
    const r = decomposeVariance({ schema, rows, metricField: "v", factors: ["g"] });
    expect(r.rows[0]?.varianceExplained).toBe(0);
  });
});

describe("seasonalNaiveForecast", () => {
  it("produces forecasts that match the prior seasonal value", () => {
    const schema = [
      { name: "t", type: "INTEGER", suggested: "ordinal" as const },
      { name: "y", type: "DOUBLE", suggested: "quantitative" as const },
    ];
    // A perfectly seasonal series with period 3.
    const series = [10, 20, 30, 10, 20, 30, 10, 20, 30];
    const rows = series.map((v, i) => [i, v]);
    const r = seasonalNaiveForecast({
      schema,
      rows,
      xField: "t",
      yField: "y",
      season: 3,
      horizon: 3,
    });
    expect(r.season).toBe(3);
    // Future horizon should repeat the same seasonal pattern.
    const future = r.rows.filter((row) => row.isHorizon);
    expect(future.map((f) => f.forecast)).toEqual([10, 20, 30]);
  });

  it("residual std is ~0 for a perfectly seasonal series", () => {
    const schema = [
      { name: "t", type: "INTEGER", suggested: "ordinal" as const },
      { name: "y", type: "DOUBLE", suggested: "quantitative" as const },
    ];
    const series = [5, 10, 15, 5, 10, 15, 5, 10, 15];
    const rows = series.map((v, i) => [i, v]);
    const r = seasonalNaiveForecast({ schema, rows, xField: "t", yField: "y", season: 3 });
    expect(r.residualStd).toBeCloseTo(0, 6);
  });

  it("flags breaches outside the 2σ band in the explanation", () => {
    const schema = [
      { name: "t", type: "INTEGER", suggested: "ordinal" as const },
      { name: "y", type: "DOUBLE", suggested: "quantitative" as const },
    ];
    // 25 stable values around 50, with one spike to 200 at t=12. The
    // baseline residuals are zero, so the ±2σ band tightens enough that
    // the spike clearly breaches it.
    const series: number[] = Array.from({ length: 25 }, () => 50);
    series[12] = 200;
    const rows = series.map((v, i) => [i, v]);
    const r = seasonalNaiveForecast({ schema, rows, xField: "t", yField: "y", season: 1 });
    expect(r.residualStd).toBeGreaterThan(0);
    expect(r.explanation.headline).toMatch(/outside|fell outside/i);
  });
});
