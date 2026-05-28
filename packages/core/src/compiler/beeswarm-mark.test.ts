// Tier-2 — `mark: "beeswarm"` packed strip plot.
import { describe, expect, it } from "vitest";
import { renderSvg } from "../render/svg.js";
import type { GlyphSpec } from "../spec/types.js";
import { compileSpec } from "./compile.js";

const schema = [
  { name: "team", type: "VARCHAR", nullable: false },
  { name: "tenure", type: "DOUBLE", nullable: false },
];

// 3 teams × 8 employees each. tenure is months at the company.
const rows: ReadonlyArray<ReadonlyArray<unknown>> = [
  // Platform team
  ["Platform", 6],
  ["Platform", 12],
  ["Platform", 18],
  ["Platform", 24],
  ["Platform", 30],
  ["Platform", 36],
  ["Platform", 48],
  ["Platform", 60],
  // Product team
  ["Product", 3],
  ["Product", 9],
  ["Product", 15],
  ["Product", 21],
  ["Product", 27],
  ["Product", 33],
  ["Product", 42],
  ["Product", 54],
  // Design team
  ["Design", 8],
  ["Design", 14],
  ["Design", 20],
  ["Design", 26],
  ["Design", 32],
  ["Design", 38],
  ["Design", 50],
  ["Design", 62],
];

describe('Tier-2 — `mark: "beeswarm"`', () => {
  it("emits one circle SceneMark per row", () => {
    const spec: GlyphSpec = {
      layers: [{ mark: "beeswarm", encoding: { x: "team", y: "tenure" } }],
    };
    const scene = compileSpec({ spec, rows, schema });
    const circles = scene.marks.filter((m) => m.type === "circle");
    expect(circles.length).toBe(24);
  });

  it("dots within a band are non-overlapping (2r minimum spacing)", () => {
    const spec: GlyphSpec = {
      layers: [{ mark: "beeswarm", encoding: { x: "team", y: "tenure" } }],
    };
    const scene = compileSpec({ spec, rows, schema });
    const circles = scene.marks.filter(
      (m): m is Extract<typeof m, { type: "circle" }> => m.type === "circle",
    );
    // For every pair of circles, distance ≥ 2r.
    for (let i = 0; i < circles.length; i++) {
      for (let j = i + 1; j < circles.length; j++) {
        const a = circles[i]!;
        const b = circles[j]!;
        const d = Math.hypot(a.cx - b.cx, a.cy - b.cy);
        // Allow a 0.5px slack for round-pixel rounding.
        expect(d).toBeGreaterThanOrEqual(2 * a.r - 0.5);
      }
    }
  });

  it("is deterministic — same rows produce identical SVG", () => {
    const spec: GlyphSpec = {
      layers: [{ mark: "beeswarm", encoding: { x: "team", y: "tenure" } }],
    };
    const a = renderSvg(compileSpec({ spec, rows, schema }));
    const b = renderSvg(compileSpec({ spec, rows, schema }));
    expect(a).toBe(b);
  });

  it("renders to a non-empty SVG with the expected number of circles", () => {
    const spec: GlyphSpec = {
      layers: [{ mark: "beeswarm", encoding: { x: "team", y: "tenure" } }],
    };
    const scene = compileSpec({ spec, rows, schema });
    const svg = renderSvg(scene);
    expect(svg.startsWith("<svg")).toBe(true);
    expect((svg.match(/<circle /g) ?? []).length).toBe(24);
  });
});
