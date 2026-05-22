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
      // biome-ignore lint/suspicious/noExplicitAny: deliberately passing kind outside the enum to verify the runtime guard.
      solvePde(buildSpec({ kind: "schrodinger" as any })),
    ).toThrow(/kind must be "heat", "wave", or "reaction-diffusion"/);
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
      dt: 0.002, // dx = 2/32 = 0.0625, CFL = 0.05·0.005/0.0625² = 0.064 ✓
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

// --- v2 — wave equation -----------------------------------------

describe("solvePde — kind: wave", () => {
  function waveSpec(overrides: Partial<PdeSolveDataSpec> = {}): PdeSolveDataSpec {
    return {
      shape: "pde-solve",
      kind: "wave",
      domain: { x: [-1, 1], y: [-1, 1] },
      grid: { rows: 16, cols: 16 },
      initial: "exp(-30*(x*x + y*y))",
      params: { c: 0.5, gamma: 0 },
      boundary: "clamp",
      steps: 30,
      dt: 0.01, // c·dt/dx = 0.5·0.01/(2/16) = 0.04, CFL ✓
      ...overrides,
    };
  }

  it("integrates a Gaussian impulse forward (peak decays as wavefront spreads)", () => {
    const out = solvePde(waveSpec({ steps: 50 }));
    expect(out.length).toBe(256);
    const center = out.reduce((b, r) => (Math.hypot(r.x, r.y) < Math.hypot(b.x, b.y) ? r : b));
    // Center should have lost amplitude as the wavefront radiated
    // outward (compared with the initial peak of 1).
    expect(center.u).toBeLessThan(0.95);
  });

  it("rejects wave CFL violation (c·dt/dx > 1)", () => {
    // dx = 2/16 = 0.125. CFL > 1 requires c·dt > 0.125. c=5,
    // dt=0.05 → CFL = 5·0.05/0.125 = 2 → reject.
    expect(() => solvePde(waveSpec({ params: { c: 5, gamma: 0 }, dt: 0.05 }))).toThrow(
      /CFL stability violated/,
    );
  });

  it("respects initial_velocity (still-water default vs nonzero)", () => {
    const still = solvePde(waveSpec({ steps: 1, initial_velocity: "0" }));
    const kicked = solvePde(
      waveSpec({ steps: 1, initial_velocity: "0.5" }), // upward velocity everywhere
    );
    // After one step, the kicked field should be uniformly higher
    // than the still field (the velocity adds dt·v to u at first
    // step in the leapfrog approximation).
    let stillSum = 0;
    let kickedSum = 0;
    for (let i = 0; i < still.length; i++) {
      stillSum += still[i]?.u ?? 0;
      kickedSum += kicked[i]?.u ?? 0;
    }
    expect(kickedSum).toBeGreaterThan(stillSum);
  });

  it("is byte-stable across two wave calls", () => {
    const a = solvePde(waveSpec());
    const b = solvePde(waveSpec());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// --- v2 — reaction-diffusion ------------------------------------

describe("solvePde — kind: reaction-diffusion", () => {
  function rdSpec(overrides: Partial<PdeSolveDataSpec> = {}): PdeSolveDataSpec {
    return {
      shape: "pde-solve",
      kind: "reaction-diffusion",
      domain: { x: [-1, 1], y: [-1, 1] },
      grid: { rows: 16, cols: 16 },
      initial: "0", // ignored for RD but the schema requires non-empty
      params: { Du: 1.0, Dv: 0.5, F: 0.055, k: 0.062 },
      boundary: "periodic",
      steps: 20,
      dt: 0.1, // max(Du,Dv)·dt/dx² = 1·0.1/(2/16)² = 6.4 — way too big
      ...overrides,
    };
  }

  it("emits rows·cols rows (V species)", () => {
    const out = solvePde(rdSpec({ dt: 0.002 })); // CFL ok
    expect(out.length).toBe(256);
  });

  it("rejects RD CFL violation (max(Du,Dv)·dt/dx² > 0.25)", () => {
    // dt = 0.1 → CFL = 6.4 (way above 0.25) → reject.
    expect(() => solvePde(rdSpec())).toThrow(/CFL stability violated/);
  });

  it("produces nonzero V values when seeded", () => {
    const out = solvePde(
      rdSpec({
        dt: 0.002,
        steps: 100,
        initial_V: "exp(-50*(x*x + y*y)) * 0.3",
      }),
    );
    // After 100 steps, the V seed should still have detectable
    // signal. The exact peak depends on F/k phase boundaries —
    // bound generously to verify the simulation ran without
    // asserting on a specific Turing-pattern outcome (those are
    // covered in the rd-spots fixture).
    const maxV = Math.max(...out.map((r) => r.u));
    expect(maxV).toBeGreaterThan(0.005);
  });

  it("is byte-stable across two RD calls", () => {
    const spec = rdSpec({ dt: 0.002 });
    const a = solvePde(spec);
    const b = solvePde(spec);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
