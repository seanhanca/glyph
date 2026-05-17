import { describe, expect, it } from "vitest";
import { type MarkBinding, glyphLive } from "./index.js";

function mountSvg(html: string): SVGElement {
  document.body.innerHTML = html;
  const svg = document.querySelector("svg");
  if (!svg) throw new Error("no svg in test fixture");
  return svg as unknown as SVGElement;
}

const SAMPLE_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400" width="600" height="400"
     data-x-field="pickup_hour" data-y-field="rides" data-handle="abc123">
  <rect x="0" y="0" width="600" height="400" fill="#fff"/>
  <g class="glyph-marks">
    <rect x="10" y="200" width="40" height="100" fill="#4c78a8"
          data-key="0" data-row="0" data-x="7" data-y="210"/>
    <rect x="60" y="180" width="40" height="120" fill="#4c78a8"
          data-key="1" data-row="1" data-x="8" data-y="260"/>
    <rect x="110" y="220" width="40" height="80" fill="#4c78a8"
          data-key="2" data-row="2" data-x="9" data-y="180"/>
  </g>
</svg>
`;

describe("@glyph/live — basic hydration", () => {
  it("reads channel→field mapping from the SVG root", () => {
    const live = glyphLive(mountSvg(SAMPLE_SVG));
    expect(live.fields.x).toBe("pickup_hour");
    expect(live.fields.y).toBe("rides");
    expect(live.handleId).toBe("abc123");
  });

  it("returns null/undefined fields for a non-interactive SVG", () => {
    const live = glyphLive(mountSvg("<svg><g/></svg>"));
    expect(live.fields.x).toBeUndefined();
    expect(live.handleId).toBeNull();
  });
});

describe("@glyph/live — click handler", () => {
  it("fires onClick with the bound row data", () => {
    const live = glyphLive(mountSvg(SAMPLE_SVG));
    const seen: MarkBinding[] = [];
    live.onClick((b) => seen.push(b));

    const firstBar = document.querySelector(".glyph-marks > rect:nth-child(1)");
    firstBar?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(seen).toHaveLength(1);
    expect(seen[0]?.key).toBe("0");
    expect(seen[0]?.row).toBe(0);
    expect(seen[0]?.attrs.x).toBe("7");
    expect(seen[0]?.attrs.y).toBe("210");
  });

  it("ignores clicks outside the glyph-marks group", () => {
    const live = glyphLive(mountSvg(SAMPLE_SVG));
    const seen: MarkBinding[] = [];
    live.onClick((b) => seen.push(b));

    // Background rect is outside the marks group.
    const bg = document.querySelector("svg > rect");
    bg?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(seen).toHaveLength(0);
  });

  it("dispose() removes the listener", () => {
    const live = glyphLive(mountSvg(SAMPLE_SVG));
    const seen: MarkBinding[] = [];
    live.onClick((b) => seen.push(b));
    live.dispose();

    document
      .querySelector(".glyph-marks > rect")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(seen).toHaveLength(0);
  });
});

describe("@glyph/live — keyboard navigation (PR23)", () => {
  function svgWithTabindex(): string {
    return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400" width="600" height="400"
     data-x-field="pickup_hour" data-y-field="rides">
  <g class="glyph-marks">
    <rect tabindex="0" role="button" data-key="0" data-row="0" data-x="7" data-y="210"/>
    <rect tabindex="0" role="button" data-key="1" data-row="1" data-x="8" data-y="260"/>
    <rect tabindex="0" role="button" data-key="2" data-row="2" data-x="9" data-y="180"/>
  </g>
</svg>
`;
  }

  it("Enter on a focused mark fires the click handler", () => {
    const live = glyphLive(mountSvg(svgWithTabindex()));
    const seen: MarkBinding[] = [];
    live.onClick((b) => seen.push(b));

    const firstBar = document.querySelector(".glyph-marks > rect:nth-child(1)");
    firstBar?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(seen).toHaveLength(1);
    expect(seen[0]?.row).toBe(0);
  });

  it("Space on a focused mark also fires the click handler", () => {
    const live = glyphLive(mountSvg(svgWithTabindex()));
    const seen: MarkBinding[] = [];
    live.onClick((b) => seen.push(b));

    const secondBar = document.querySelector(".glyph-marks > rect:nth-child(2)");
    secondBar?.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    expect(seen).toHaveLength(1);
    expect(seen[0]?.row).toBe(1);
  });

  it("ignores other keys (no spurious clicks)", () => {
    const live = glyphLive(mountSvg(svgWithTabindex()));
    const seen: MarkBinding[] = [];
    live.onClick((b) => seen.push(b));

    const bar = document.querySelector(".glyph-marks > rect:nth-child(1)");
    bar?.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    bar?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(seen).toHaveLength(0);
  });

  it("dispose() removes the keyboard listener too", () => {
    const live = glyphLive(mountSvg(svgWithTabindex()));
    const seen: MarkBinding[] = [];
    live.onClick((b) => seen.push(b));
    live.dispose();

    document
      .querySelector(".glyph-marks > rect")
      ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(seen).toHaveLength(0);
  });
});

describe("@glyph/live — whereFor()", () => {
  it("builds a single-channel WHERE clause for x by default", () => {
    const live = glyphLive(mountSvg(SAMPLE_SVG));
    const live_binding: MarkBinding = {
      key: "0",
      row: 0,
      attrs: { x: "7", y: "210" },
      element: document.createElement("div"),
    };
    expect(live.whereFor(live_binding)).toBe('WHERE "pickup_hour" = 7');
  });

  it("can include multiple channels", () => {
    const live = glyphLive(mountSvg(SAMPLE_SVG));
    const binding: MarkBinding = {
      key: "0",
      row: 0,
      attrs: { x: "7", y: "210" },
      element: document.createElement("div"),
    };
    expect(live.whereFor(binding, ["x", "y"])).toBe('WHERE "pickup_hour" = 7 AND "rides" = 210');
  });

  it("quotes string values and escapes embedded single quotes", () => {
    const svg = mountSvg(
      `<svg data-x-field="region"><g class="glyph-marks"><rect data-x="O'Brien"/></g></svg>`,
    );
    const live = glyphLive(svg);
    const binding: MarkBinding = {
      key: null,
      row: null,
      attrs: { x: "O'Brien" },
      element: document.createElement("div"),
    };
    expect(live.whereFor(binding)).toBe(`WHERE "region" = 'O''Brien'`);
  });

  it("returns empty string when channel has no matching field or value", () => {
    const live = glyphLive(mountSvg("<svg><g class='glyph-marks'/></svg>"));
    const binding: MarkBinding = {
      key: null,
      row: null,
      attrs: {},
      element: document.createElement("div"),
    };
    expect(live.whereFor(binding)).toBe("");
  });
});

describe("@glyph/live — whereForExtent (brush → SQL)", () => {
  it("numeric extent → BETWEEN", () => {
    const live = glyphLive(mountSvg(SAMPLE_SVG));
    expect(live.whereForExtent("x", { kind: "numeric", min: 7, max: 10 })).toBe(
      'WHERE "pickup_hour" BETWEEN 7 AND 10',
    );
  });

  it("discrete extent → IN list", () => {
    const live = glyphLive(mountSvg(SAMPLE_SVG));
    expect(live.whereForExtent("x", { kind: "discrete", values: ["a", "b"] })).toBe(
      `WHERE "pickup_hour" IN ('a', 'b')`,
    );
  });

  it("empty discrete extent → empty string", () => {
    const live = glyphLive(mountSvg(SAMPLE_SVG));
    expect(live.whereForExtent("x", { kind: "discrete", values: [] })).toBe("");
  });

  it("missing field → empty string", () => {
    const live = glyphLive(mountSvg("<svg><g class='glyph-marks'/></svg>"));
    expect(live.whereForExtent("x", { kind: "numeric", min: 0, max: 1 })).toBe("");
  });
});

describe("@glyph/live — whereForZoom (zoom transform → SQL)", () => {
  it("emits BETWEEN over the zoomed range", () => {
    const live = glyphLive(mountSvg(SAMPLE_SVG));
    expect(live.whereForZoom("x", 7, 10)).toBe('WHERE "pickup_hour" BETWEEN 7 AND 10');
  });

  it("rejects inverted ranges", () => {
    const live = glyphLive(mountSvg(SAMPLE_SVG));
    expect(live.whereForZoom("x", 10, 7)).toBe("");
  });

  it("rejects non-finite bounds", () => {
    const live = glyphLive(mountSvg(SAMPLE_SVG));
    expect(live.whereForZoom("x", Number.NaN, 1)).toBe("");
  });
});
