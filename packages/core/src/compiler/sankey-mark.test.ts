// Tier-2 — `mark: "sankey"` flow diagram.
import { describe, expect, it } from "vitest";
import { renderSvg } from "../render/svg.js";
import type { GlyphSpec } from "../spec/types.js";
import { compileSpec } from "./compile.js";

// Minimal 5-node, 3-layer DAG:
//   A ──▶ M ──▶ Z
//   B ──▶ M
//   B ──▶ N ──▶ Z
const baseSpec: GlyphSpec = {
  width: 600,
  height: 360,
  data: {
    flow: {
      nodes: [
        { id: "A", name: "Source A" },
        { id: "B", name: "Source B" },
        { id: "M", name: "Mid M" },
        { id: "N", name: "Mid N" },
        { id: "Z", name: "Sink Z" },
      ],
      links: [
        { source: "A", target: "M", value: 10 },
        { source: "B", target: "M", value: 5 },
        { source: "B", target: "N", value: 8 },
        { source: "M", target: "Z", value: 15 },
        { source: "N", target: "Z", value: 8 },
      ],
    },
  },
  layers: [{ mark: "sankey", encoding: {} }],
};

describe('Tier-2 — `mark: "sankey"`', () => {
  it("emits node rects and link paths", () => {
    const scene = compileSpec({ spec: baseSpec, rows: [], schema: [] });
    const rects = scene.marks.filter((m) => m.type === "rect");
    const paths = scene.marks.filter((m) => m.type === "path");
    // Each node emits TWO rects (drawn under links + drawn over them) so
    // the link ends visually tuck behind the node faces. 5 nodes × 2 = 10.
    expect(rects.length).toBe(10);
    // 5 links → 5 bezier paths.
    expect(paths.length).toBe(5);
  });

  it("each node carries a label text mark", () => {
    const scene = compileSpec({ spec: baseSpec, rows: [], schema: [] });
    const texts = scene.marks.filter(
      (m): m is Extract<typeof m, { type: "text" }> => m.type === "text",
    );
    const labels = texts.map((t) => t.text);
    expect(labels).toContain("Source A");
    expect(labels).toContain("Source B");
    expect(labels).toContain("Mid M");
    expect(labels).toContain("Mid N");
    expect(labels).toContain("Sink Z");
  });

  it("places nodes left-to-right by longest-path layer", () => {
    const scene = compileSpec({ spec: baseSpec, rows: [], schema: [] });
    // Sources A, B should share an x; Mids M, N share another; Sink Z
    // is rightmost. We can read that off the first 5 unique rect x's.
    const rects = scene.marks.filter(
      (m): m is Extract<typeof m, { type: "rect" }> => m.type === "rect",
    );
    const xByLabel = new Map<string, number>();
    const texts = scene.marks.filter(
      (m): m is Extract<typeof m, { type: "text" }> => m.type === "text",
    );
    // Pair each rect to the closest text by y to identify which node it
    // belongs to. (Both rects per node share the same x as the label.)
    for (const t of texts) {
      // Find a rect that's vertically close to this label.
      const r = rects.find((rect) => Math.abs(rect.y + rect.height / 2 - t.y) < 1);
      if (r && !xByLabel.has(t.text)) xByLabel.set(t.text, r.x);
    }
    const xA = xByLabel.get("Source A")!;
    const xB = xByLabel.get("Source B")!;
    const xM = xByLabel.get("Mid M")!;
    const xN = xByLabel.get("Mid N")!;
    const xZ = xByLabel.get("Sink Z")!;
    expect(xA).toBe(xB);
    expect(xM).toBe(xN);
    expect(xA).toBeLessThan(xM);
    expect(xM).toBeLessThan(xZ);
  });

  it("is deterministic — same flow → byte-identical SVG", () => {
    const a = renderSvg(compileSpec({ spec: baseSpec, rows: [], schema: [] }));
    const b = renderSvg(compileSpec({ spec: baseSpec, rows: [], schema: [] }));
    expect(a).toBe(b);
  });

  it("rejects flows containing a cycle (DAG required)", () => {
    const cyclicSpec: GlyphSpec = {
      data: {
        flow: {
          nodes: [
            { id: "A", name: "A" },
            { id: "B", name: "B" },
            { id: "C", name: "C" },
          ],
          links: [
            { source: "A", target: "B", value: 1 },
            { source: "B", target: "C", value: 1 },
            { source: "C", target: "A", value: 1 },
          ],
        },
      },
      layers: [{ mark: "sankey", encoding: {} }],
    };
    expect(() => compileSpec({ spec: cyclicSpec, rows: [], schema: [] })).toThrow(/cycle/i);
  });

  it("rejects links that reference unknown node ids", () => {
    const badSpec: GlyphSpec = {
      data: {
        flow: {
          nodes: [{ id: "A", name: "A" }],
          links: [{ source: "A", target: "ghost", value: 1 }],
        },
      },
      layers: [{ mark: "sankey", encoding: {} }],
    };
    expect(() => compileSpec({ spec: badSpec, rows: [], schema: [] })).toThrow(
      /unknown target node/,
    );
  });

  it("renders to a non-empty SVG with rects + paths", () => {
    const scene = compileSpec({ spec: baseSpec, rows: [], schema: [] });
    const svg = renderSvg(scene);
    expect(svg.startsWith("<svg")).toBe(true);
    expect((svg.match(/<rect /g) ?? []).length).toBeGreaterThan(0);
    expect((svg.match(/<path /g) ?? []).length).toBeGreaterThan(0);
  });
});
