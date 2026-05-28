// 5 new audit rules — 0.3.0 release.
// AUDIT-05 (line on nominal x), AUDIT-12 (too many pie slices),
// AUDIT-13 (bar on quantitative x), AUDIT-14 (>4 overlay layers),
// AUDIT-15 (multi-layer/faceted/colored chart without title).
import { describe, expect, it } from "vitest";
import type { GlyphSpec } from "../spec/types.js";
import { auditSpec } from "./index.js";

describe("AUDIT-05 — line / area on nominal x", () => {
  it("fires for line mark with nominal x", () => {
    const spec: GlyphSpec = {
      title: "Sales by department over the line",
      layers: [
        {
          mark: "line",
          encoding: {
            x: { field: "dept", type: "nominal" },
            y: { field: "sales", type: "quantitative" },
          },
        },
      ],
    };
    const findings = auditSpec({ spec });
    expect(findings.some((f) => f.rule_id === "AUDIT-05")).toBe(true);
  });

  it("does NOT fire for line mark with quantitative x", () => {
    const spec: GlyphSpec = {
      title: "DAU over time",
      layers: [
        {
          mark: "line",
          encoding: {
            x: { field: "day", type: "quantitative" },
            y: { field: "dau", type: "quantitative" },
          },
        },
      ],
    };
    const findings = auditSpec({ spec });
    expect(findings.some((f) => f.rule_id === "AUDIT-05")).toBe(false);
  });

  it("does NOT fire for line mark with ordinal x (real ordering)", () => {
    const spec: GlyphSpec = {
      title: "Sales by quarter",
      layers: [
        {
          mark: "line",
          encoding: {
            x: { field: "quarter", type: "ordinal" },
            y: { field: "sales", type: "quantitative" },
          },
        },
      ],
    };
    const findings = auditSpec({ spec });
    expect(findings.some((f) => f.rule_id === "AUDIT-05")).toBe(false);
  });
});

describe("AUDIT-12 — too many pie slices", () => {
  it("fires for arc with rowCount > 7", () => {
    const spec: GlyphSpec = {
      title: "Department revenue",
      layers: [
        {
          mark: "arc",
          encoding: { theta: { field: "share", type: "quantitative" } },
        },
      ],
    };
    const findings = auditSpec({ spec, rowCount: 12 });
    expect(findings.some((f) => f.rule_id === "AUDIT-12")).toBe(true);
  });

  it("does NOT fire for arc with rowCount = 5", () => {
    const spec: GlyphSpec = {
      title: "Five-slice pie",
      layers: [
        {
          mark: "arc",
          encoding: { theta: { field: "share", type: "quantitative" } },
        },
      ],
    };
    const findings = auditSpec({ spec, rowCount: 5 });
    expect(findings.some((f) => f.rule_id === "AUDIT-12")).toBe(false);
  });

  it("does NOT fire on non-arc charts", () => {
    const spec: GlyphSpec = {
      title: "Bar chart with many bars",
      layers: [{ mark: "bar", encoding: { x: "category", y: "value" } }],
    };
    const findings = auditSpec({ spec, rowCount: 50 });
    expect(findings.some((f) => f.rule_id === "AUDIT-12")).toBe(false);
  });
});

describe("AUDIT-13 — bar on quantitative x", () => {
  it("fires for bar with quantitative x", () => {
    const spec: GlyphSpec = {
      title: "Revenue by hour",
      layers: [
        {
          mark: "bar",
          encoding: {
            x: { field: "hour", type: "quantitative" },
            y: { field: "rides", type: "quantitative" },
          },
        },
      ],
    };
    const findings = auditSpec({ spec });
    expect(findings.some((f) => f.rule_id === "AUDIT-13")).toBe(true);
  });

  it("does NOT fire for bar with ordinal x", () => {
    const spec: GlyphSpec = {
      title: "Revenue by quarter",
      layers: [
        {
          mark: "bar",
          encoding: {
            x: { field: "quarter", type: "ordinal" },
            y: { field: "revenue", type: "quantitative" },
          },
        },
      ],
    };
    const findings = auditSpec({ spec });
    expect(findings.some((f) => f.rule_id === "AUDIT-13")).toBe(false);
  });
});

describe("AUDIT-14 — overlay layer count > 4", () => {
  it("fires for 5 layers without faceting", () => {
    const spec: GlyphSpec = {
      title: "Five overlay layers",
      layers: Array.from({ length: 5 }, () => ({
        mark: "line" as const,
        encoding: { x: "t", y: "v" },
      })),
    };
    const findings = auditSpec({ spec });
    expect(findings.some((f) => f.rule_id === "AUDIT-14")).toBe(true);
  });

  it("does NOT fire for 4 layers", () => {
    const spec: GlyphSpec = {
      title: "Four overlay layers",
      layers: Array.from({ length: 4 }, () => ({
        mark: "line" as const,
        encoding: { x: "t", y: "v" },
      })),
    };
    const findings = auditSpec({ spec });
    expect(findings.some((f) => f.rule_id === "AUDIT-14")).toBe(false);
  });
});

describe("AUDIT-15 — multi-layer / faceted / colored chart without title", () => {
  it("fires for 2-layer chart with no title", () => {
    const spec: GlyphSpec = {
      layers: [
        { mark: "line", encoding: { x: "t", y: "v" } },
        { mark: "point", encoding: { x: "t", y: "v" } },
      ],
    };
    const findings = auditSpec({ spec });
    expect(findings.some((f) => f.rule_id === "AUDIT-15")).toBe(true);
  });

  it("fires for color-encoded chart with no title", () => {
    const spec: GlyphSpec = {
      layers: [
        {
          mark: "point",
          encoding: { x: "x", y: "y", color: { field: "g", type: "nominal" } },
        },
      ],
    };
    const findings = auditSpec({ spec });
    expect(findings.some((f) => f.rule_id === "AUDIT-15")).toBe(true);
  });

  it("does NOT fire for single-layer chart without color and without title", () => {
    const spec: GlyphSpec = {
      layers: [{ mark: "bar", encoding: { x: "category", y: "value" } }],
    };
    const findings = auditSpec({ spec });
    expect(findings.some((f) => f.rule_id === "AUDIT-15")).toBe(false);
  });

  it("does NOT fire when a title is set", () => {
    const spec: GlyphSpec = {
      title: "Has a title",
      layers: [
        { mark: "line", encoding: { x: "t", y: "v" } },
        { mark: "point", encoding: { x: "t", y: "v" } },
      ],
    };
    const findings = auditSpec({ spec });
    expect(findings.some((f) => f.rule_id === "AUDIT-15")).toBe(false);
  });
});
