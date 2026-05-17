/**
 * Tests for the Vega-Lite → Glyph translator (PR30, ROADMAP §A1).
 *
 * Covers happy-path translation of common VL patterns plus clear rejection
 * of the multi-view shapes the v0 translator doesn't handle.
 */
import { describe, expect, it } from "vitest";
import { isTranslateError, vegaLiteToGlyph } from "./translate.js";

describe("vegaLiteToGlyph — bar with url data", () => {
  it("translates a bar chart with URL data + x/y encoding", () => {
    const r = vegaLiteToGlyph({
      data: { url: "taxi.csv", format: { type: "csv" } },
      mark: "bar",
      encoding: {
        x: { field: "hour", type: "ordinal" },
        y: { field: "rides", type: "quantitative" },
      },
      title: "Rides per hour",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spec.data?.source).toBe("taxi.csv");
    expect(r.spec.data?.format).toBe("csv");
    expect(r.spec.layers[0]?.mark).toBe("bar");
    expect(r.spec.title).toBe("Rides per hour");
  });
});

describe("vegaLiteToGlyph — mark variants", () => {
  it("accepts a string mark", () => {
    const r = vegaLiteToGlyph({
      data: { url: "x.csv" },
      mark: "line",
      encoding: { x: { field: "a" }, y: { field: "b" } },
    });
    expect(r.ok && r.spec.layers[0]?.mark).toBe("line");
  });

  it("accepts the { type } object mark form", () => {
    const r = vegaLiteToGlyph({
      data: { url: "x.csv" },
      mark: { type: "area", opacity: 0.5 },
      encoding: { x: { field: "a" }, y: { field: "b" } },
    });
    expect(r.ok && r.spec.layers[0]?.mark).toBe("area");
  });

  it("aliases circle/square/tick to point", () => {
    for (const alias of ["circle", "square", "tick"]) {
      const r = vegaLiteToGlyph({
        data: { url: "x.csv" },
        mark: alias,
        encoding: { x: { field: "a" }, y: { field: "b" } },
      });
      expect(r.ok && r.spec.layers[0]?.mark).toBe("point");
    }
  });

  it("rejects unsupported marks (rect / rule / text / boxplot)", () => {
    const r = vegaLiteToGlyph({
      data: { url: "x.csv" },
      mark: "boxplot",
      encoding: { x: { field: "a" }, y: { field: "b" } },
    });
    expect(isTranslateError(r)).toBe(true);
  });
});

describe("vegaLiteToGlyph — encoding channels", () => {
  it("translates color + tooltip channels", () => {
    const r = vegaLiteToGlyph({
      data: { url: "x.csv" },
      mark: "point",
      encoding: {
        x: { field: "x", type: "quantitative" },
        y: { field: "y", type: "quantitative" },
        color: { field: "k", type: "nominal" },
        tooltip: [
          { field: "name", type: "nominal" },
          { field: "y", title: "Value" },
        ],
      },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spec.layers[0]?.encoding.color).toBeDefined();
    expect(Array.isArray(r.spec.layers[0]?.encoding.tooltip)).toBe(true);
  });

  it("drops unsupported channels with a warning", () => {
    const r = vegaLiteToGlyph({
      data: { url: "x.csv" },
      mark: "point",
      encoding: {
        x: { field: "x" },
        y: { field: "y" },
        strokeDash: { field: "k" }, // unsupported
      },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings.join("\n")).toMatch(/strokeDash/);
  });
});

describe("vegaLiteToGlyph — transforms", () => {
  it("translates a VL filter into a SQL WHERE", () => {
    const r = vegaLiteToGlyph({
      data: { url: "taxi.csv" },
      transform: [{ filter: "datum.rides > 100" }],
      mark: "bar",
      encoding: { x: { field: "pickup_hour" }, y: { field: "rides" } },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spec.data?.transform).toContain('WHERE "rides" > 100');
  });

  it("translates a VL calculate into a projection", () => {
    const r = vegaLiteToGlyph({
      data: { url: "taxi.csv" },
      transform: [{ calculate: "datum.fare * 0.85", as: "fare_after_fee" }],
      mark: "line",
      encoding: { x: { field: "pickup_hour" }, y: { field: "fare_after_fee" } },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spec.data?.transform).toContain('AS "fare_after_fee"');
  });
});

describe("vegaLiteToGlyph — rejection paths", () => {
  it("rejects multi-view (layer / hconcat / vconcat / repeat / concat)", () => {
    for (const k of ["layer", "hconcat", "vconcat", "repeat", "concat"]) {
      const r = vegaLiteToGlyph({ [k]: [] });
      expect(isTranslateError(r)).toBe(true);
    }
  });

  it("rejects when data is missing", () => {
    const r = vegaLiteToGlyph({
      mark: "bar",
      encoding: { x: { field: "a" }, y: { field: "b" } },
    });
    expect(isTranslateError(r)).toBe(true);
  });

  it("rejects when encoding is missing both x and y", () => {
    const r = vegaLiteToGlyph({
      data: { url: "x.csv" },
      mark: "bar",
      encoding: { color: { field: "c" } },
    });
    expect(isTranslateError(r)).toBe(true);
  });

  it("rejects a non-object input", () => {
    expect(isTranslateError(vegaLiteToGlyph("not a spec"))).toBe(true);
    expect(isTranslateError(vegaLiteToGlyph(null))).toBe(true);
    expect(isTranslateError(vegaLiteToGlyph(42))).toBe(true);
  });
});

describe("vegaLiteToGlyph — title / width / height passthrough", () => {
  it("forwards width and height numerics", () => {
    const r = vegaLiteToGlyph({
      data: { url: "x.csv" },
      mark: "bar",
      width: 800,
      height: 400,
      encoding: { x: { field: "a" }, y: { field: "b" } },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spec.width).toBe(800);
    expect(r.spec.height).toBe(400);
  });
});

describe("vegaLiteToGlyph — produced Glyph spec parses cleanly", () => {
  it("the output is a valid Glyph spec (parseSpec succeeds)", async () => {
    const r = vegaLiteToGlyph({
      data: { url: "taxi.csv", format: { type: "csv" } },
      mark: "bar",
      encoding: {
        x: { field: "hour", type: "ordinal" },
        y: { field: "rides", type: "quantitative" },
      },
      title: "Rides",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { parseSpec } = await import("../spec/parse.js");
    expect(() => parseSpec(r.spec)).not.toThrow();
  });
});
