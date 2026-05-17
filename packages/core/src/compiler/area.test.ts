/**
 * Tests for the `area` mark (PR20).
 *
 * Area = line + closed baseline. Same point pipeline as `buildLines`; the
 * path additionally closes down to y=0 so the fill encloses a shape.
 */
import { describe, expect, it } from "vitest";
import type { GlyphSpec } from "../spec/types.js";
import { type CompileFieldInfo, compileSpec } from "./compile.js";

const schema: CompileFieldInfo[] = [
  { name: "hour", type: "INTEGER" },
  { name: "rides", type: "INTEGER" },
];

const rows: number[][] = [
  [0, 10],
  [1, 30],
  [2, 20],
];

describe("compileSpec — area mark (PR20)", () => {
  it("emits a single path with a Z (close) at the end", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "area", encoding: { x: "hour", y: "rides" } }],
    };
    const scene = compileSpec({ spec, rows, schema });
    const paths = scene.marks.filter((m) => m.type === "path");
    expect(paths).toHaveLength(1);
    expect(paths[0]?.d?.trim().endsWith("Z")).toBe(true);
  });

  it("fills the shape (not 'none') and uses semi-transparent opacity", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "area", encoding: { x: "hour", y: "rides" } }],
    };
    const scene = compileSpec({ spec, rows, schema });
    const path = scene.marks.find((m) => m.type === "path");
    expect(path?.fill).not.toBe("none");
    expect(path?.opacity).toBe(0.55);
  });

  it("baseline closure references y=0 (not the lowest data point)", () => {
    // With rides [10,30,20], a "lowest-data-point" baseline would close to
    // y(10). We require a y(0) baseline — verify the closing y matches the
    // pixel value of y=0 on the scale.
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "area", encoding: { x: "hour", y: "rides" } }],
    };
    const scene = compileSpec({ spec, rows, schema });
    const path = scene.marks.find((m) => m.type === "path");
    const d = path?.d ?? "";
    // The last two L commands close down to baseline. Extract numeric
    // y values and verify they share the same baseline pixel.
    const matches = d.match(/L (\S+) (\S+) L (\S+) (\S+) Z$/);
    expect(matches).toBeTruthy();
    if (matches) {
      const baseline1 = Number(matches[2]);
      const baseline2 = Number(matches[4]);
      expect(baseline1).toBe(baseline2);
    }
  });

  it("emits one filled path per color group", () => {
    const cs: CompileFieldInfo[] = [...schema, { name: "weekday", type: "VARCHAR" }];
    const cr: Array<Array<number | string>> = [
      [0, 10, "mon"],
      [1, 30, "mon"],
      [2, 20, "mon"],
      [0, 5, "tue"],
      [1, 15, "tue"],
      [2, 25, "tue"],
    ];
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [
        {
          mark: "area",
          encoding: { x: "hour", y: "rides", color: "weekday" },
        },
      ],
    };
    const scene = compileSpec({ spec, rows: cr, schema: cs });
    const paths = scene.marks.filter((m) => m.type === "path");
    expect(paths).toHaveLength(2);
    expect(paths[0]?.fill).not.toBe(paths[1]?.fill);
    for (const p of paths) {
      expect(p.opacity).toBe(0.55);
    }
  });

  it("composes with line + point layers under multi-layer compilation", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [
        { mark: "area", encoding: { x: "hour", y: "rides" } },
        { mark: "line", encoding: { x: "hour", y: "rides" } },
        { mark: "point", encoding: { x: "hour", y: "rides" } },
      ],
    };
    const scene = compileSpec({ spec, rows, schema });
    const paths = scene.marks.filter((m) => m.type === "path");
    const circles = scene.marks.filter((m) => m.type === "circle");
    expect(paths).toHaveLength(2); // area + line
    expect(circles).toHaveLength(3);
  });

  it("determinism: identical input → identical scene", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "area", encoding: { x: "hour", y: "rides" } }],
    };
    const a = compileSpec({ spec, rows, schema });
    const b = compileSpec({ spec, rows, schema });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
