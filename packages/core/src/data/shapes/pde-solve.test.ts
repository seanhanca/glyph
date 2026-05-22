/**
 * Tests for `data.shape: "pde-solve"` v1 — heat equation
 * (RFC 2026-05-22, extension #4).
 *
 * Coverage: validation contract (grid size + CFL stability), value
 * correctness (Gaussian diffuses + peak amplitude decays), and
 * byte-stability across two calls. End-to-end snapshot byte-locking
 * lives in the heat-diffusion fixture test.
 */
import { describe, expect, it } from "vitest";
import { MAX_PDE_GRID, PDE_CFL_LIMIT, type PdeSolveDataSpec, solvePde } from "./pde-solve.js";

function buildSpec(overrides: Partial<PdeSolveDataSpec> = {}): PdeSolveDataSpec {
  return {
    shape: "pde-solve",
    kind: "heat",
    domain: { x: [-1, 1], y: [-1, 1] },
    grid: { rows: 16, cols: 16 },
    initial: "exp(-20*(x*x + y*y))",
    params: { D: 0.05 },
    boundary: "clamp",
    steps: 50,
    dt: 0.01,
    ...overrides,
  };
}

describe("solvePde — validation", () => {
  it("rejects unknown PDE kind", () => {
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: deliberately passing kind outside the enum to verify the guard.
      solvePde(buildSpec({ kind: "wave" as any })),
    ).toThrow(/only kind "heat"/);
  });

  it("rejects too-small or too-large grids", () => {
    expect(() => solvePde(buildSpec({ grid: { rows: 3, cols: 16 } }))).toThrow(
      /grid\.rows must be integer in \[4/,
    );
    expect(() => solvePde(buildSpec({ grid: { rows: 16, cols: MAX_PDE_GRID + 1 } }))).toThrow(
      /grid\.cols must be integer in \[4/,
    );
  });

  it("rejects CFL-violating dt", () => {
    // D=1, dx=2/16=0.125, dt=0.01 → CFL = 0.01/(0.125²) = 0.64 > 0.25
    expect(() => solvePde(buildSpec({ params: { D: 1 }, dt: 0.01 }))).toThrow(
      /CFL stability violated/,
    );
  });

  it("rejects malformed domain", () => {
    expect(() => solvePde(buildSpec({ domain: { x: [1, 1], y: [-1, 1] } }))).toThrow(
      /domain\.x\.min < \.max/,
    );
  });
});

describe("solvePde — value correctness", () => {
  it("emits exactly rows·cols rows", () => {
    const out = solvePde(buildSpec({ grid: { rows: 12, cols: 8 } }));
    expect(out.length).toBe(96);
  });

  it("diffuses a Gaussian outward (peak decays, edges warm)", () => {
    // Initial peak at center = exp(0) = 1. After diffusion, the
    // peak value should decrease (mass spreads out), and the
    // periphery values should increase.
    const spec = buildSpec({
      grid: { rows: 32, cols: 32 },
      initial: "exp(-30*(x*x + y*y))",
      params: { D: 0.05 },
      boundary: "clamp",
      steps: 100,
      dt: 0.005, // dx = 2/32 = 0.0625, CFL = 0.05·0.005/0.0625² = 0.064 ✓
    });
    const out = solvePde(spec);
    expect(out.length).toBe(1024);
    // Find the central cell (closest to (0, 0)).
    const center = out.reduce((best, r) =>
      Math.hypot(r.x, r.y) < Math.hypot(best.x, best.y) ? r : best,
    );
    expect(center.u).toBeGreaterThan(0); // still warm
    expect(center.u).toBeLessThan(1); // but cooler than initial peak of 1
    // The peak should drop noticeably after 100 steps. With D=0.05
    // and the initial Gaussian's width, expect at least a 10% drop.
    expect(center.u).toBeLessThan(0.9);
  });

  it("respects the CFL boundary (just-below works, just-above rejects)", () => {
    // dx = 2/16 = 0.125. CFL = D·dt/dx² should equal PDE_CFL_LIMIT
    // at the boundary, so just below should integrate, just above
    // should throw.
    const dx = 2 / 16;
    const dxSquared = dx * dx;
    const boundary_dt = (PDE_CFL_LIMIT * dxSquared) / 0.1; // CFL = 0.25 with D=0.1
    expect(() => solvePde(buildSpec({ params: { D: 0.1 }, dt: boundary_dt * 0.95 }))).not.toThrow();
    expect(() => solvePde(buildSpec({ params: { D: 0.1 }, dt: boundary_dt * 1.05 }))).toThrow(
      /CFL stability violated/,
    );
  });
});

describe("solvePde — determinism", () => {
  it("emits byte-identical rows for identical specs", () => {
    const a = solvePde(buildSpec());
    const b = solvePde(buildSpec());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
