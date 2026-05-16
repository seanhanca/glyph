import { describe, expect, it } from "vitest";
import type { Scene } from "../scenegraph/types.js";
import { renderSvg } from "./svg.js";

const baseScene: Scene = {
  width: 100,
  height: 80,
  background: "#fff",
  plotArea: { x: 10, y: 10, width: 80, height: 60 },
  axes: [],
  marks: [],
};

describe("renderSvg — interactive opt-in", () => {
  it("non-interactive scenes do not emit data-* attrs", () => {
    const out = renderSvg({
      ...baseScene,
      marks: [
        {
          type: "rect",
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          fill: "#000",
          key: "ignored",
          dataAttrs: { x: "7", y: "10" },
        },
      ],
    });
    expect(out).not.toContain("data-key");
    expect(out).not.toContain("data-x");
    expect(out).not.toContain("glyph-marks");
    expect(out).not.toContain("<style");
  });

  it("interactive scenes wrap marks in glyph-marks group + emit data-* attrs", () => {
    const out = renderSvg({
      ...baseScene,
      schema: { fields: { x: "hour", y: "rides" } },
      marks: [
        {
          type: "rect",
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          fill: "#000",
          key: "k7",
          dataAttrs: { row: "0", x: "7", y: "210" },
        },
      ],
    });
    expect(out).toContain('class="glyph-marks"');
    expect(out).toContain('data-key="k7"');
    expect(out).toContain('data-x="7"');
    expect(out).toContain('data-y="210"');
    expect(out).toContain("<style>");
  });

  it("interactive scenes carry channel→field map on the SVG root", () => {
    const out = renderSvg({
      ...baseScene,
      schema: { fields: { x: "hour", y: "rides", color: "weekday" } },
      marks: [],
    });
    expect(out).toContain('data-x-field="hour"');
    expect(out).toContain('data-y-field="rides"');
    expect(out).toContain('data-color-field="weekday"');
  });

  it("includes a handle id when provided", () => {
    const out = renderSvg({
      ...baseScene,
      schema: { fields: { x: "a", y: "b" }, handleId: "abc123" },
      marks: [],
    });
    expect(out).toContain('data-handle="abc123"');
  });

  it("data-* attribute ordering is deterministic (sorted)", () => {
    const a = renderSvg({
      ...baseScene,
      schema: { fields: { y: "b", x: "a", color: "c" } },
      marks: [],
    });
    const b = renderSvg({
      ...baseScene,
      schema: { fields: { color: "c", x: "a", y: "b" } },
      marks: [],
    });
    expect(a).toBe(b);
  });

  it("escapes data-* attribute values", () => {
    const out = renderSvg({
      ...baseScene,
      schema: { fields: { x: 'a"b' } },
      marks: [
        {
          type: "circle",
          cx: 1,
          cy: 1,
          r: 1,
          fill: "#000",
          dataAttrs: { x: '<&"' },
        },
      ],
    });
    expect(out).toContain('data-x-field="a&quot;b"');
    expect(out).toContain('data-x="&lt;&amp;&quot;"');
  });
});
