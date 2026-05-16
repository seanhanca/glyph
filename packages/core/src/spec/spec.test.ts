import { describe, expect, it } from "vitest";
import { parseSpec, safeParseSpec, safeParseSpecJson } from "./parse.js";

describe("Glyph spec — minimal valid specs", () => {
  it("accepts a single-layer bar chart with shorthand encodings", () => {
    const spec = parseSpec({
      data: { source: "taxi.parquet" },
      layers: [{ mark: "bar", encoding: { x: "hour", y: "rides" } }],
    });
    expect(spec.layers).toHaveLength(1);
    expect(spec.layers[0]?.mark).toBe("bar");
  });

  it("accepts an inline SQL transform", () => {
    const spec = parseSpec({
      data: {
        source: "taxi.parquet",
        transform: "SELECT hour, COUNT(*) AS rides FROM taxi GROUP BY hour",
      },
      layers: [{ mark: "bar", encoding: { x: "hour", y: "rides" } }],
    });
    expect(spec.data?.transform).toContain("GROUP BY hour");
  });

  it("accepts multi-layer specs (bar + line) with object-form channels", () => {
    const spec = parseSpec({
      data: { source: "taxi.parquet" },
      layers: [
        { mark: "bar", encoding: { x: "hour", y: "rides" } },
        {
          mark: "line",
          encoding: {
            x: "hour",
            y: { field: "avg_fare", type: "quantitative", scale: { side: "right" } },
          },
        },
      ],
    });
    expect(spec.layers).toHaveLength(2);
    const yChannel = spec.layers[1]?.encoding.y;
    expect(typeof yChannel).toBe("object");
  });

  it("accepts per-layer data override (no top-level data)", () => {
    const spec = parseSpec({
      layers: [
        {
          data: { source: "a.parquet" },
          mark: "point",
          encoding: { x: "x", y: "y" },
        },
        {
          data: { source: "b.parquet" },
          mark: "point",
          encoding: { x: "x", y: "y" },
        },
      ],
    });
    expect(spec.layers).toHaveLength(2);
  });
});

describe("Glyph spec — rejection of invalid specs", () => {
  it("rejects an empty layers array", () => {
    const r = safeParseSpec({
      data: { source: "x.parquet" },
      layers: [],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects unknown mark types", () => {
    const r = safeParseSpec({
      data: { source: "x.parquet" },
      layers: [{ mark: "donut", encoding: {} }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).toMatch(/layers\.0\.mark/);
    }
  });

  it("rejects unknown top-level keys (strict mode)", () => {
    const input: unknown = {
      data: { source: "x.parquet" },
      layers: [{ mark: "bar", encoding: { x: "a", y: "b" } }],
      magic: 42, // not part of the schema
    };
    const r = safeParseSpec(input);
    expect(r.ok).toBe(false);
  });

  it("rejects when neither top-level data nor every-layer data is present", () => {
    const r = safeParseSpec({
      layers: [
        { mark: "point", encoding: { x: "x", y: "y" } },
        // second layer has no data override
      ],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects empty source string", () => {
    const r = safeParseSpec({
      data: { source: "" },
      layers: [{ mark: "bar", encoding: { x: "a", y: "b" } }],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects non-positive width/height", () => {
    const r = safeParseSpec({
      data: { source: "x.parquet" },
      layers: [{ mark: "bar", encoding: { x: "a", y: "b" } }],
      width: 0,
    });
    expect(r.ok).toBe(false);
  });
});

describe("Glyph spec — JSON parsing", () => {
  it("safeParseSpecJson surfaces JSON errors clearly", () => {
    const r = safeParseSpecJson("{ not valid json");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).toMatch(/Invalid JSON/);
    }
  });

  it("safeParseSpecJson round-trips a valid spec", () => {
    const original = {
      data: { source: "x.parquet" },
      layers: [{ mark: "bar" as const, encoding: { x: "a", y: "b" } }],
    };
    const r = safeParseSpecJson(JSON.stringify(original));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.spec.layers[0]?.mark).toBe("bar");
    }
  });
});

describe("Glyph spec — round-trip stability", () => {
  it("parses, re-serializes, and parses again without information loss", () => {
    const original = {
      data: { source: "taxi.parquet", format: "parquet" as const },
      layers: [
        { mark: "bar" as const, encoding: { x: "hour", y: "rides" } },
        {
          mark: "line" as const,
          encoding: {
            x: "hour",
            y: { field: "avg_fare", type: "quantitative" as const },
          },
        },
      ],
      width: 800,
      height: 400,
      theme: "dark" as const,
    };
    const first = parseSpec(original);
    const second = parseSpec(JSON.parse(JSON.stringify(first)));
    expect(second).toEqual(first);
  });
});
