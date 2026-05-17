/**
 * Accessibility tests for the SVG renderer (PR23).
 *
 * Verifies the SVG root + interactive marks carry the ARIA attributes a
 * screen reader needs to announce a chart, and that focusable marks get
 * tabindex so keyboard users can navigate.
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

describe("renderSvg — ARIA root attributes", () => {
  it('emits role="img" + aria-label + aria-describedby on the SVG root', () => {
    const out = renderSvg({ ...base, title: "Rides per hour" });
    expect(out).toContain('role="img"');
    expect(out).toContain('aria-label="Rides per hour"');
    expect(out).toContain('aria-describedby="glyph-desc"');
    expect(out).toContain('<desc id="glyph-desc">Rides per hour</desc>');
  });

  it("falls back to a generic label when no title is set", () => {
    const out = renderSvg(base);
    expect(out).toContain('aria-label="Glyph chart"');
    expect(out).toContain('<desc id="glyph-desc">Glyph chart</desc>');
  });
});

describe("renderSvg — ARIA on interactive marks", () => {
  it("interactive rect marks get role=button + tabindex=0 + aria-label from tooltip", () => {
    const out = renderSvg({
      ...base,
      schema: { fields: { x: "hour", y: "rides" } },
      marks: [
        {
          type: "rect",
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          fill: "#000",
          tooltip: "hour: 7 · rides: 210",
          dataAttrs: { row: "0", x: "7" },
        },
      ],
    });
    expect(out).toContain('role="button"');
    expect(out).toContain('tabindex="0"');
    expect(out).toContain('aria-label="hour: 7 · rides: 210"');
  });

  it("non-interactive marks do not get role=button / tabindex=0", () => {
    const out = renderSvg({
      ...base,
      marks: [{ type: "rect", x: 0, y: 0, width: 10, height: 10, fill: "#000" }],
    });
    // The SVG root still has role="img" — interactive-only attrs are absent.
    expect(out).not.toContain('role="button"');
    expect(out).not.toContain('tabindex="0"');
  });
});
