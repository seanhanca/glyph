import { describe, expect, it } from "vitest";
import type { Layer } from "../spec/types.js";
import { applyStat, isStatError } from "./stats.js";

function layer(mark: "bar" | "line", encoding: Layer["encoding"], stat?: Layer["stat"]): Layer {
  const out: Layer = { mark, encoding };
  if (stat) (out as { stat: Layer["stat"] }).stat = stat;
  return out;
}

describe("applyStat — passthrough", () => {
  it("returns the base SELECT and the encoded y when no stat is set", () => {
    const r = applyStat(layer("bar", { x: "hour", y: "rides" }), "SELECT * FROM t");
    expect(isStatError(r)).toBe(false);
    if (!isStatError(r)) {
      expect(r.sql).toBe("SELECT * FROM t");
      expect(r.outputYField).toBe("rides");
    }
  });
});

describe("applyStat — count", () => {
  it("aggregates with COUNT(*) and groups by x", () => {
    const r = applyStat(layer("bar", { x: "hour" }, { type: "count" }), "SELECT * FROM events");
    expect(isStatError(r)).toBe(false);
    if (isStatError(r)) return;
    expect(r.sql).toContain('SELECT "hour", COUNT(*) AS "_count"');
    expect(r.sql).toContain("FROM (SELECT * FROM events)");
    expect(r.sql).toContain('GROUP BY "hour"');
    expect(r.outputYField).toBe("_count");
  });

  it("honors an explicit y encoding (counts assigned to that column)", () => {
    const r = applyStat(
      layer("bar", { x: "hour", y: "rides" }, { type: "count" }),
      "SELECT * FROM events",
    );
    if (isStatError(r)) throw new Error(r.message);
    expect(r.sql).toContain('COUNT(*) AS "rides"');
    expect(r.outputYField).toBe("rides");
  });

  it("includes color in the GROUP BY when encoded", () => {
    const r = applyStat(
      layer("bar", { x: "hour", color: "weekday" }, { type: "count" }),
      "SELECT * FROM events",
    );
    if (isStatError(r)) throw new Error(r.message);
    expect(r.sql).toContain('SELECT "hour", "weekday"');
    expect(r.sql).toContain('GROUP BY "hour", "weekday"');
  });
});

describe("applyStat — sum / mean", () => {
  it("sum rewrites y to SUM(y) and keeps the column name stable", () => {
    const r = applyStat(
      layer("bar", { x: "month", y: "revenue" }, { type: "sum" }),
      "SELECT * FROM sales",
    );
    if (isStatError(r)) throw new Error(r.message);
    expect(r.sql).toContain('SUM("revenue") AS "revenue"');
    expect(r.outputYField).toBe("revenue");
  });

  it("mean rewrites y to AVG(y)", () => {
    const r = applyStat(
      layer("line", { x: "month", y: "fare" }, { type: "mean" }),
      "SELECT * FROM taxi",
    );
    if (isStatError(r)) throw new Error(r.message);
    expect(r.sql).toContain('AVG("fare") AS "fare"');
  });

  it("sum/mean error when y is missing", () => {
    const r = applyStat(layer("bar", { x: "month" }, { type: "sum" }), "SELECT * FROM sales");
    expect(isStatError(r)).toBe(true);
    if (isStatError(r)) expect(r.message).toMatch(/sum.*requires.*y/);
  });
});

describe("applyStat — error paths", () => {
  it("errors on a stat type not yet implemented (bin/median/quantile)", () => {
    const r = applyStat(
      layer("bar", { x: "hour", y: "rides" }, { type: "bin" }),
      "SELECT * FROM events",
    );
    expect(isStatError(r)).toBe(true);
    if (isStatError(r)) expect(r.message).toMatch(/not yet implemented/);
  });

  it("errors when x encoding is missing (no GROUP BY key)", () => {
    const r = applyStat(layer("bar", { y: "rides" }, { type: "count" }), "SELECT * FROM events");
    expect(isStatError(r)).toBe(true);
  });
});

describe("applyStat — SQL safety", () => {
  it("double-quotes identifiers with embedded quotes", () => {
    // Pathological field name; we don't accept it through the spec (Zod
    // would reject it) but the helper should still escape safely.
    const r = applyStat(
      layer("bar", { x: 'weird"name', y: "rides" }, { type: "sum" }),
      "SELECT * FROM t",
    );
    if (isStatError(r)) throw new Error(r.message);
    expect(r.sql).toContain('"weird""name"');
  });
});
