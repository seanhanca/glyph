// Tier-2 — `mark: "arc"` as first-class pie/donut.
// The compiler rewrites arc specs into the polar-bar pipeline, so the
// emitted scene should contain `arc` SceneMarks (one per row), with
// donut hole if `innerRadius` is set on the layer.
import { describe, expect, it } from "vitest";
import { renderSvg } from "../render/svg.js";
import type { GlyphSpec } from "../spec/types.js";
import { compileSpec } from "./compile.js";

const schema = [
  { name: "department", type: "VARCHAR", nullable: false },
  { name: "share", type: "DOUBLE", nullable: false },
];
const rows: ReadonlyArray<ReadonlyArray<unknown>> = [
  ["Engineering", 45],
  ["Sales", 30],
  ["Marketing", 25],
];

describe('Tier-2 — `mark: "arc"`', () => {
  it("emits one arc SceneMark per row (pie)", () => {
    const spec: GlyphSpec = {
      layers: [
        {
          mark: "arc",
          encoding: {
            theta: { field: "share", type: "quantitative" },
            color: { field: "department", type: "nominal" },
          },
        },
      ],
    };
    const scene = compileSpec({ spec, rows, schema });
    const arcs = scene.marks.filter((m) => m.type === "arc");
    expect(arcs.length).toBe(3);
    for (const a of arcs) {
      if (a.type !== "arc") continue;
      expect(a.innerRadius).toBe(0);
      expect(a.outerRadius).toBeGreaterThan(0);
    }
  });

  it("`innerRadius: 0.5` produces a donut (non-zero inner radius)", () => {
    const spec: GlyphSpec = {
      layers: [
        {
          mark: "arc",
          innerRadius: 0.5,
          encoding: {
            theta: { field: "share", type: "quantitative" },
            color: { field: "department", type: "nominal" },
          },
        },
      ],
    };
    const scene = compileSpec({ spec, rows, schema });
    const arcs = scene.marks.filter((m) => m.type === "arc");
    expect(arcs.length).toBe(3);
    for (const a of arcs) {
      if (a.type !== "arc") continue;
      expect(a.innerRadius).toBeGreaterThan(0);
      expect(a.innerRadius).toBeLessThan(a.outerRadius);
    }
  });

  it("slice angle is proportional to the theta field value", () => {
    const spec: GlyphSpec = {
      layers: [
        {
          mark: "arc",
          encoding: {
            theta: { field: "share", type: "quantitative" },
            color: { field: "department", type: "nominal" },
          },
        },
      ],
    };
    const scene = compileSpec({ spec, rows, schema });
    const arcs = scene.marks
      .filter((m): m is Extract<typeof m, { type: "arc" }> => m.type === "arc")
      .map((a) => a.endAngle - a.startAngle);
    // 45% slice should be 1.5x the 30% slice, and 1.8x the 25% slice.
    // Allow ~3% tolerance for float math.
    expect(arcs[0] / arcs[1]).toBeCloseTo(45 / 30, 1);
    expect(arcs[0] / arcs[2]).toBeCloseTo(45 / 25, 1);
  });

  it("renders to a non-empty SVG", () => {
    const spec: GlyphSpec = {
      layers: [
        {
          mark: "arc",
          innerRadius: 0.4,
          encoding: {
            theta: { field: "share", type: "quantitative" },
            color: { field: "department", type: "nominal" },
          },
        },
      ],
    };
    const scene = compileSpec({ spec, rows, schema });
    const svg = renderSvg(scene);
    expect(svg.startsWith("<svg")).toBe(true);
    // 3 arc paths in the SVG.
    expect((svg.match(/<path /g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("rejects mixing arc with non-arc marks in the same spec", () => {
    const spec: GlyphSpec = {
      layers: [
        {
          mark: "arc",
          encoding: { theta: { field: "share", type: "quantitative" } },
        },
        {
          mark: "bar",
          encoding: { x: "department", y: "share" },
        },
      ],
    };
    expect(() => compileSpec({ spec, rows, schema })).toThrow(/cannot be mixed with other marks/);
  });
});
