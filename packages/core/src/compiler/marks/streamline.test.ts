/**
 * RFC 2026-05-23 — unit tests for `streamline.colorBy`.
 *
 * Covers the new per-polyline color modes added in this PR:
 *   - colorBy omitted: every streamline strokes in `theme.fg`
 *     (back-compat — preserves the original byte snapshot).
 *   - colorBy "angle": stroke hue = atan2(vy, vx) at the seed,
 *     so paths going in different directions get different colors.
 *   - colorBy "speed": stroke lightness varies with |v| at the seed.
 *   - byte-stability of the new emission across two compiles.
 *   - graceful fallback when an unrecognized colorBy value reaches
 *     the compiler (Zod normally rejects this at parseSpec; the
 *     compiler-internal fallback is defense-in-depth).
 *
 * Every test uses `compileSpec` end-to-end against a tiny synthetic
 * rotation flow so the streamline integrator + scale resolver +
 * mark compiler all participate. Skipping the full SVG render keeps
 * the test focused on `out.marks` shape.
 */
import { describe, expect, it } from "vitest";
import { parseSpec } from "../../spec/parse.js";
import type { GlyphSpec } from "../../spec/types.js";
import { type CompileFieldInfo, compileSpec } from "../compile.js";

/** Minimal scale-anchor rows so the linear scale resolves to [-2, 2]. */
const ROWS: ReadonlyArray<ReadonlyArray<number>> = [
  [-2, -2],
  [2, 2],
];
const SCHEMA: CompileFieldInfo[] = [
  { name: "x", type: "DOUBLE" },
  { name: "y", type: "DOUBLE" },
];

/** Build a streamline spec on a rotation field, varying just the
 *  fields the test cares about. */
function buildSpec(opts: {
  colorBy?: "angle" | "speed";
  dxdt?: string;
  dydt?: string;
}): GlyphSpec {
  const raw: Record<string, unknown> = {
    version: "glyph/0.1",
    data: { source: "<inline:streamline-colorby-test>" },
    layers: [
      {
        mark: "streamline",
        encoding: {
          x: { field: "x", type: "quantitative", scale: { domain: [-2, 2] } },
          y: { field: "y", type: "quantitative", scale: { domain: [-2, 2] } },
        },
        streamline: {
          dxdt: opts.dxdt ?? "-y",
          dydt: opts.dydt ?? "x",
          seeds: { kind: "grid", rows: 4, cols: 4 },
          step: 0.05,
          maxSteps: 200,
          domain: { x: [-2, 2], y: [-2, 2] },
          ...(opts.colorBy !== undefined ? { colorBy: opts.colorBy } : {}),
        },
      },
    ],
  };
  return parseSpec(raw);
}

/** Same shape as `buildSpec` but skips parseSpec — used to exercise
 *  the compiler-internal fallback path when a `colorBy` value would
 *  have been rejected by Zod. The unknown→GlyphSpec double-cast is
 *  intentional; we're constructing a spec the schema would refuse,
 *  to verify the compiler still copes. */
function buildRawSpec(colorBy: unknown): GlyphSpec {
  const streamline: Record<string, unknown> = {
    dxdt: "-y",
    dydt: "x",
    seeds: { kind: "grid", rows: 4, cols: 4 },
    step: 0.05,
    maxSteps: 200,
    domain: { x: [-2, 2], y: [-2, 2] },
    colorBy,
  };
  return {
    layers: [
      {
        mark: "streamline",
        encoding: {
          x: { field: "x", type: "quantitative" },
          y: { field: "y", type: "quantitative" },
        },
        streamline,
      },
    ],
  } as unknown as GlyphSpec;
}

describe("streamline.colorBy", () => {
  it("emits a single stroke color when colorBy is unset (back-compat)", () => {
    const scene = compileSpec({ spec: buildSpec({}), rows: ROWS, schema: SCHEMA });
    const paths = scene.marks.filter((m) => m.type === "path");
    expect(paths.length).toBeGreaterThan(0);
    const strokes = new Set(paths.map((p) => (p as { stroke?: string }).stroke));
    // Exactly one color for all polylines — the theme foreground.
    expect(strokes.size).toBe(1);
  });

  it("emits distinct hsl() stroke colors when colorBy is 'angle'", () => {
    const scene = compileSpec({
      spec: buildSpec({ colorBy: "angle" }),
      rows: ROWS,
      schema: SCHEMA,
    });
    const paths = scene.marks.filter((m) => m.type === "path");
    expect(paths.length).toBeGreaterThan(2);
    const strokes = new Set(paths.map((p) => (p as { stroke?: string }).stroke));
    // Multiple distinct directions in a rotation field → many colors.
    expect(strokes.size).toBeGreaterThan(1);
    // Each stroke is an hsl(...) string per the design.
    for (const s of strokes) {
      expect(s).toMatch(/^hsl\(/);
    }
  });

  it("varies stroke lightness when colorBy is 'speed' on a non-uniform field", () => {
    // Radial outflow: speed at (x, y) = sqrt(x² + y²) → varies by seed.
    const scene = compileSpec({
      spec: buildSpec({ colorBy: "speed", dxdt: "x", dydt: "y" }),
      rows: ROWS,
      schema: SCHEMA,
    });
    const paths = scene.marks.filter((m) => m.type === "path");
    const strokes = new Set(paths.map((p) => (p as { stroke?: string }).stroke));
    expect(strokes.size).toBeGreaterThan(1);
  });

  it("is byte-stable across two compiles with the same colorBy spec", () => {
    const a = compileSpec({
      spec: buildSpec({ colorBy: "angle" }),
      rows: ROWS,
      schema: SCHEMA,
    });
    const b = compileSpec({
      spec: buildSpec({ colorBy: "angle" }),
      rows: ROWS,
      schema: SCHEMA,
    });
    expect(JSON.stringify(a.marks)).toBe(JSON.stringify(b.marks));
  });

  it("falls back to a single stroke color when colorBy is an unrecognized value", () => {
    // parseSpec would normally reject this at the schema layer; we
    // bypass it to exercise the compiler-internal `readConfig`
    // fallback. A future Zod schema migration that loosens the enum
    // shouldn't surprise the compiler.
    const scene = compileSpec({
      spec: buildRawSpec("bogus"),
      rows: ROWS,
      schema: SCHEMA,
    });
    const paths = scene.marks.filter((m) => m.type === "path");
    const strokes = new Set(paths.map((p) => (p as { stroke?: string }).stroke));
    expect(strokes.size).toBe(1);
  });
});
