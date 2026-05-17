/**
 * Tests for theme extensibility (PR25).
 *
 * Verifies spec.theme accepts: undefined, "light", "dark", or a full
 * ThemeConfig. Custom palettes flow through to mark colors + legend colors.
 */
import { describe, expect, it } from "vitest";
import { type GlyphSpec, defineTheme } from "../spec/types.js";
import { type CompileFieldInfo, compileSpec } from "./compile.js";

const schema: CompileFieldInfo[] = [
  { name: "hour", type: "INTEGER" },
  { name: "rides", type: "INTEGER" },
  { name: "weekday", type: "VARCHAR" },
];

const rows: Array<Array<number | string>> = [
  [0, 10, "mon"],
  [1, 20, "tue"],
];

describe("spec.theme — built-ins", () => {
  it("defaults to light when theme is undefined", () => {
    const scene = compileSpec({
      spec: {
        data: { source: "x" },
        layers: [{ mark: "bar", encoding: { x: "hour", y: "rides" } }],
      },
      rows,
      schema,
    });
    expect(scene.background).toBe("#ffffff");
  });

  it("uses dark when theme: 'dark'", () => {
    const scene = compileSpec({
      spec: {
        data: { source: "x" },
        layers: [{ mark: "bar", encoding: { x: "hour", y: "rides" } }],
        theme: "dark",
      },
      rows,
      schema,
    });
    expect(scene.background).toBe("#0e0e10");
  });
});

describe("spec.theme — custom ThemeConfig", () => {
  const brand = defineTheme({
    background: "#0d1b2a",
    fg: "#e0e1dd",
    axis: "#778da9",
    grid: "#1b263b",
    palette: ["#e0aaff", "#c77dff", "#9d4edd"],
  });

  it("custom background flows to the scene", () => {
    const scene = compileSpec({
      spec: {
        data: { source: "x" },
        layers: [{ mark: "bar", encoding: { x: "hour", y: "rides" } }],
        theme: brand,
      },
      rows,
      schema,
    });
    expect(scene.background).toBe("#0d1b2a");
  });

  it("first palette color is used for bars without color encoding", () => {
    const scene = compileSpec({
      spec: {
        data: { source: "x" },
        layers: [{ mark: "bar", encoding: { x: "hour", y: "rides" } }],
        theme: brand,
      },
      rows,
      schema,
    });
    const rect = scene.marks.find((m) => m.type === "rect");
    expect(rect?.fill).toBe("#e0aaff");
  });

  it("color encoding picks palette entries by first-seen domain order", () => {
    const scene = compileSpec({
      spec: {
        data: { source: "x" },
        layers: [
          {
            mark: "point",
            encoding: { x: "hour", y: "rides", color: "weekday" },
          },
        ],
        theme: brand,
      },
      rows,
      schema,
    });
    const circles = scene.marks.filter((m) => m.type === "circle");
    expect(circles[0]?.fill).toBe("#e0aaff");
    expect(circles[1]?.fill).toBe("#c77dff");
  });

  it("legend entries inherit the custom palette", () => {
    const scene = compileSpec({
      spec: {
        data: { source: "x" },
        layers: [
          {
            mark: "point",
            encoding: { x: "hour", y: "rides", color: "weekday" },
          },
        ],
        theme: brand,
      },
      rows,
      schema,
    });
    const legend = scene.legends?.[0];
    expect(legend?.entries[0]?.color).toBe("#e0aaff");
    expect(legend?.entries[1]?.color).toBe("#c77dff");
  });
});

describe("defineTheme — type guard helper", () => {
  it("is the identity function at runtime", () => {
    const cfg = {
      background: "#000",
      fg: "#fff",
      axis: "#888",
      grid: "#222",
      palette: ["#f00", "#0f0"],
    };
    expect(defineTheme(cfg)).toBe(cfg);
  });
});
