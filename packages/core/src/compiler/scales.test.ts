import { describe, expect, it } from "vitest";
import { bandScale, linearScale, niceTicks, roundPx } from "./scales.js";

describe("roundPx", () => {
  it("rounds to 8 decimals to stabilize cross-platform output", () => {
    expect(roundPx(1 / 3)).toBe(0.33333333);
  });
});

describe("linearScale", () => {
  it("maps domain endpoints to range endpoints", () => {
    const s = linearScale([0, 100], [0, 200]);
    expect(s.apply(0)).toBe(0);
    expect(s.apply(100)).toBe(200);
    expect(s.apply(50)).toBe(100);
  });

  it("collapses zero-span domain to range start", () => {
    const s = linearScale([5, 5], [10, 20]);
    expect(s.apply(5)).toBe(10);
  });
});

describe("bandScale", () => {
  it("places equal-width bands across the range", () => {
    const s = bandScale(["a", "b", "c"], [0, 300], 0);
    expect(s.bandwidth).toBe(100);
    expect(s.apply("a")).toBe(0);
    expect(s.apply("b")).toBe(100);
    expect(s.apply("c")).toBe(200);
  });

  it("returns NaN for unknown categories", () => {
    const s = bandScale(["a"], [0, 100]);
    expect(Number.isNaN(s.apply("z"))).toBe(true);
  });

  it("applies padding by shrinking bandwidth", () => {
    const s = bandScale(["a", "b"], [0, 200], 0.5);
    expect(s.bandwidth).toBe(50);
  });
});

describe("niceTicks", () => {
  it("returns rounded ticks bracketing the input domain", () => {
    const { domain, ticks } = niceTicks(0, 100, 5);
    expect(domain[0]).toBeLessThanOrEqual(0);
    expect(domain[1]).toBeGreaterThanOrEqual(100);
    expect(ticks.length).toBeGreaterThan(0);
  });

  it("handles a zero-width domain", () => {
    const { ticks } = niceTicks(5, 5);
    expect(ticks).toEqual([5]);
  });
});
