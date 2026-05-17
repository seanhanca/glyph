/**
 * Tests for locale-aware tick formatting (PR26).
 *
 * Default (no locale set) keeps the locale-agnostic formatter so existing
 * snapshots stay byte-identical. Setting spec.locale routes tick labels
 * through Intl.NumberFormat.
 */
import { describe, expect, it } from "vitest";
import type { GlyphSpec } from "../spec/types.js";
import { type CompileFieldInfo, compileSpec } from "./compile.js";

const schema: CompileFieldInfo[] = [
  { name: "hour", type: "INTEGER" },
  { name: "amount", type: "DOUBLE" },
];

// Large numbers so locale-specific grouping is visible.
const rows: number[][] = [
  [0, 1234.5],
  [1, 12345],
  [2, 123456.78],
];

describe("spec.locale — default behavior", () => {
  it("without a locale, uses the locale-agnostic formatter", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "bar", encoding: { x: "hour", y: "amount" } }],
    };
    const scene = compileSpec({ spec, rows, schema });
    const left = scene.axes.find((a) => a.orientation === "left");
    // Default formatter: integer values rendered as plain strings, no grouping.
    const intLabels = left?.ticks.map((t) => t.label) ?? [];
    expect(intLabels.every((l) => !l.includes(","))).toBe(true);
  });
});

describe("spec.locale — en-US", () => {
  it("formats with comma thousands separator", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "bar", encoding: { x: "hour", y: "amount" } }],
      locale: "en-US",
    };
    const scene = compileSpec({ spec, rows, schema });
    const left = scene.axes.find((a) => a.orientation === "left");
    const labels = left?.ticks.map((t) => t.label) ?? [];
    // Expect at least one label to contain a comma (e.g. "120,000").
    expect(labels.some((l) => l.includes(","))).toBe(true);
  });
});

describe("spec.locale — de-DE", () => {
  it("formats with dot thousands separator + comma decimal", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "bar", encoding: { x: "hour", y: "amount" } }],
      locale: "de-DE",
    };
    const scene = compileSpec({ spec, rows, schema });
    const left = scene.axes.find((a) => a.orientation === "left");
    const labels = (left?.ticks ?? []).map((t) => t.label);
    // German uses dot as thousands separator. At least one label should have
    // a "." but not a "," in that position (well — niceTicks may pick
    // round numbers like 120000 → "120.000" in de-DE).
    expect(labels.some((l) => /\d\.\d{3}/.test(l))).toBe(true);
  });
});

describe("spec.locale — determinism", () => {
  it("identical spec + locale → identical scene", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "bar", encoding: { x: "hour", y: "amount" } }],
      locale: "en-US",
    };
    const a = compileSpec({ spec, rows, schema });
    const b = compileSpec({ spec, rows, schema });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
