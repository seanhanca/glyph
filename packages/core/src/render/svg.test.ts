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

describe("renderSvg — output shape", () => {
  it("emits a valid SVG header with the right viewBox", () => {
    const out = renderSvg(baseScene);
    expect(out).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(out).toMatch(/viewBox="0 0 100 80"/);
    expect(out).toMatch(/<\/svg>\n$/);
  });

  it("emits a background rect", () => {
    expect(renderSvg(baseScene)).toContain(
      '<rect x="0" y="0" width="100" height="80" fill="#fff"/>',
    );
  });

  it("renders rect, circle, line, text marks", () => {
    const scene: Scene = {
      ...baseScene,
      marks: [
        { type: "rect", x: 1, y: 2, width: 3, height: 4, fill: "#abc" },
        { type: "circle", cx: 5, cy: 6, r: 7, fill: "#def" },
        { type: "line", x1: 0, y1: 0, x2: 10, y2: 10, stroke: "#000", strokeWidth: 1 },
        {
          type: "text",
          x: 1,
          y: 2,
          text: "hi",
          fontSize: 12,
          fill: "#111",
          anchor: "middle",
          baseline: "middle",
        },
      ],
    };
    const out = renderSvg(scene);
    expect(out).toContain('<rect x="1" y="2" width="3" height="4" fill="#abc"/>');
    expect(out).toContain('<circle cx="5" cy="6" r="7" fill="#def"/>');
    expect(out).toContain('<line x1="0" y1="0" x2="10" y2="10"');
    expect(out).toContain(">hi</text>");
  });

  it("escapes special characters in text", () => {
    const scene: Scene = {
      ...baseScene,
      title: 'A&B<C>"D"',
    };
    const out = renderSvg(scene);
    expect(out).toContain("A&amp;B&lt;C&gt;&quot;D&quot;");
  });
});

describe("renderSvg — determinism", () => {
  it("byte-identical output for identical input", () => {
    const a = renderSvg(baseScene);
    const b = renderSvg(baseScene);
    expect(a).toBe(b);
  });
});
