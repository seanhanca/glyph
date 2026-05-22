/**
 * Tests for `data.shape: "geodesic"` (RFC 2026-05-22, extension #3).
 *
 * Coverage focus: validation contract, value correctness against
 * known relativity results (the 4M/b deflection formula), photon-
 * sphere capture truncation, multi-seed determinism. End-to-end
 * byte-stability is locked by the gravity-lens fixture test.
 */
import { describe, expect, it } from "vitest";
import {
  type GeodesicDataSpec,
  MAX_GEODESIC_LAMBDA,
  MAX_GEODESIC_SEEDS,
  iterateGeodesic,
} from "./geodesic.js";

function buildSpec(overrides: Partial<GeodesicDataSpec> = {}): GeodesicDataSpec {
  return {
    shape: "geodesic",
    metric: "schwarzschild-weak",
    mass: 1,
    seeds: [{ x0: -20, y0: 5, vx0: 1, vy0: 0 }],
    step: 0.1,
    max_lambda: 50,
    ...overrides,
  };
}

describe("iterateGeodesic — validation", () => {
  it("rejects unknown metric", () => {
    // biome-ignore lint/suspicious/noExplicitAny: deliberately passing a metric outside the schema enum to verify the runtime guard.
    const bad = buildSpec({ metric: "kerr" as any });
    expect(() => iterateGeodesic(bad)).toThrow(/only metric "schwarzschild-weak"/);
  });

  it("rejects non-positive mass", () => {
    expect(() => iterateGeodesic(buildSpec({ mass: 0 }))).toThrow(/mass must be a positive/);
    expect(() => iterateGeodesic(buildSpec({ mass: -1 }))).toThrow(/mass must be a positive/);
  });

  it("rejects empty seeds", () => {
    expect(() => iterateGeodesic(buildSpec({ seeds: [] }))).toThrow(/non-empty array/);
  });

  it("rejects seeds with zero velocity", () => {
    expect(() =>
      iterateGeodesic(buildSpec({ seeds: [{ x0: -10, y0: 0, vx0: 0, vy0: 0 }] })),
    ).toThrow(/velocity must be nonzero/);
  });

  it("rejects oversized seed count + max_lambda", () => {
    const manySeeds = new Array(MAX_GEODESIC_SEEDS + 1).fill({
      x0: -10,
      y0: 0,
      vx0: 1,
      vy0: 0,
    });
    expect(() => iterateGeodesic(buildSpec({ seeds: manySeeds }))).toThrow(
      /exceeds MAX_GEODESIC_SEEDS/,
    );
    expect(() => iterateGeodesic(buildSpec({ max_lambda: MAX_GEODESIC_LAMBDA + 1 }))).toThrow(
      /exceeds MAX_GEODESIC_LAMBDA/,
    );
  });
});

describe("iterateGeodesic — value correctness", () => {
  it("integrates a straight line when M=0 (no deflection)", () => {
    const rows = iterateGeodesic(
      buildSpec({
        // Schema validation rejects mass=0, so the smallest legal
        // mass that still produces visually-zero deflection is fine.
        // Cross-platform deflection at M=1e-6, b=10 over Δλ=20 is
        // ~8e-7 — well within "looks like a straight line."
        mass: 1e-6,
        seeds: [{ x0: -10, y0: 0, vx0: 1, vy0: 0 }],
        step: 0.1,
        max_lambda: 20,
      }),
    );
    expect(rows.length).toBeGreaterThan(150);
    // Every row's y should be very close to 0 (the initial y), all
    // the way through. The ray travels along the x-axis.
    for (const r of rows) {
      expect(Math.abs(r.y)).toBeLessThan(0.001);
    }
  });

  it("deflects a passing ray by ~4M/b in the weak field", () => {
    // Classic Einstein 1919 test: a photon with impact parameter b
    // passing a point mass M is deflected by angle α ≈ 4M/b. Set
    // M=1, b=20 → expected α ≈ 0.2 rad. Run the photon from far
    // left to far right and measure the post-deflection slope.
    const b = 20;
    const M = 1;
    const rows = iterateGeodesic(
      buildSpec({
        mass: M,
        seeds: [{ x0: -100, y0: b, vx0: 1, vy0: 0 }],
        step: 0.2,
        max_lambda: 200,
      }),
    );
    expect(rows.length).toBeGreaterThan(800);
    // Tangent slope from the last two emitted points → empirical
    // deflection angle vs straight-line trajectory.
    const last = rows[rows.length - 1];
    const prev = rows[rows.length - 2];
    expect(last).toBeDefined();
    expect(prev).toBeDefined();
    if (!last || !prev) return;
    const dx = last.x - prev.x;
    const dy = last.y - prev.y;
    const alpha = Math.atan2(dy, dx); // post-deflection angle relative to +x
    const expected = (-4 * M) / b; // negative because lens attracts (b > 0)
    // Tolerance: 10% — RK4 + weak-field approximation, finite
    // integration extent. The point is the order of magnitude +
    // sign agree with the formula.
    expect(alpha).toBeCloseTo(expected, 1);
  });

  it("truncates a photon that falls inside the photon sphere", () => {
    // Aim straight at the lens. Should fall in and truncate well
    // before max_lambda. Specifically: ray at y=0 moving along +x
    // toward a mass-1 lens. Photon sphere is at r = 1.5·M = 1.5.
    const rows = iterateGeodesic(
      buildSpec({
        mass: 1,
        seeds: [{ x0: -10, y0: 0, vx0: 1, vy0: 0 }],
        step: 0.1,
        max_lambda: 100,
      }),
    );
    // The ray doesn't make it all the way to lambda=100; it stops
    // when it crosses the photon sphere. Total emitted points
    // should reflect a path of length ~10 (from x=-10 to x~+1.5).
    expect(rows.length).toBeLessThan(150);
    // No emitted point should have r < 1.5 (the truncation bound).
    for (const r of rows) {
      const radius = Math.sqrt(r.x * r.x + r.y * r.y);
      expect(radius).toBeGreaterThanOrEqual(1.5 - 0.5); // slack for the step crossing
    }
  });
});

describe("iterateGeodesic — multi-seed + determinism", () => {
  it("emits rows grouped by seed_id in caller order", () => {
    const rows = iterateGeodesic(
      buildSpec({
        seeds: [
          { x0: -10, y0: 2, vx0: 1, vy0: 0 },
          { x0: -10, y0: -2, vx0: 1, vy0: 0 },
        ],
        max_lambda: 25,
      }),
    );
    // Find the boundary between seed 0 and seed 1.
    const seed0End = rows.findIndex((r) => r.seed_id === 1);
    expect(seed0End).toBeGreaterThan(0);
    // Everything before that boundary should be seed 0.
    for (let i = 0; i < seed0End; i++) {
      expect(rows[i]?.seed_id).toBe(0);
    }
    // Everything after should be seed 1.
    for (let i = seed0End; i < rows.length; i++) {
      expect(rows[i]?.seed_id).toBe(1);
    }
  });

  it("is byte-stable across two calls with identical specs", () => {
    const spec = buildSpec({
      seeds: [
        { x0: -10, y0: 1, vx0: 1, vy0: 0 },
        { x0: -10, y0: -1, vx0: 1, vy0: 0 },
      ],
    });
    const a = iterateGeodesic(spec);
    const b = iterateGeodesic(spec);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
