/**
 * SVG renderer tests for grid lines + legends (PR22).
 */
import { describe, expect, it } from "vitest";
import type { Scene } from "../scenegraph/types.js";
import { renderSvg } from "./svg.js";

const base: Scene = {
  width: 200,
  height: 120,
  background: "#fff",
  plotArea: { x: 10, y: 10, width: 150, height: 100 },
  axes: [],
  marks: [],
};

describe("renderSvg — grid lines", () => {
  it("emits horizontal grid lines at gridTicks across the plot width", () => {
    const out = renderSvg({
      ...base,
      axes: [
        {
          orientation: "left",
          origin: { x: 10, y: 10 },
          length: 100,
          ticks: [{ position: 30, label: "100" }],
          gridTicks: [
            { position: 30, label: "100" },
            { position: 80, label: "50" },
          ],
        },
      ],
    });
    // Two grid lines plus the axis line; assert at least two stroke=#e6e6e6 lines.
    const matches = out.match(/stroke="#e6e6e6"/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("no grid lines when axis has no gridTicks", () => {
    const out = renderSvg({
      ...base,
      axes: [
        {
          orientation: "left",
          origin: { x: 10, y: 10 },
          length: 100,
          ticks: [{ position: 30, label: "100" }],
        },
      ],
    });
    expect(out).not.toContain('stroke="#e6e6e6"');
  });
});

describe("renderSvg — color legend", () => {
  it("emits the title text + a swatch rect + label per entry", () => {
    const out = renderSvg({
      ...base,
      legends: [
        {
          kind: "color",
          title: "weekday",
          origin: { x: 170, y: 10 },
          entries: [
            { label: "mon", color: "#4c78a8" },
            { label: "tue", color: "#f58518" },
          ],
        },
      ],
    });
    expect(out).toContain(">weekday<");
    expect(out).toContain(">mon<");
    expect(out).toContain(">tue<");
    expect(out).toContain('fill="#4c78a8"');
    expect(out).toContain('fill="#f58518"');
  });
});
