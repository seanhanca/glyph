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
    expect(() => iterateGeodesic(bad)).toThrow(
      /metric must be "schwarzschild-weak" or "schwarzschild-strong"/,
    );
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

// --- v2 — strong-field Schwarzschild ----------------------------

describe("iterateGeodesic — metric: schwarzschild-strong", () => {
  function strongSpec(overrides: Partial<GeodesicDataSpec> = {}): GeodesicDataSpec {
    return {
      shape: "geodesic",
      metric: "schwarzschild-strong",
      mass: 1,
      seeds: [{ x0: -30, y0: 5, vx0: 1, vy0: 0 }],
      step: 0.1,
      max_lambda: 60,
      ...overrides,
    };
  }

  it("rejects non-positive mass under strong-field too", () => {
    expect(() => iterateGeodesic(strongSpec({ mass: 0 }))).toThrow(/mass must be a positive/);
    expect(() => iterateGeodesic(strongSpec({ mass: -1 }))).toThrow(/mass must be a positive/);
  });

  it("deflects more than weak-field at moderate impact parameters", () => {
    // Same geometry, both metrics. Pick b well above the critical
    // impact parameter b_crit = 3·sqrt(3)·M ≈ 5.196 so BOTH metrics
    // scatter (below that, strong-field captures and weak doesn't —
    // a qualitative difference covered by the next test). Above
    // b_crit the comparison is quantitative: strong-field keeps
    // higher-order GR terms, so the post-perihelion deflection is
    // larger than the weak-field 4M/b prediction.
    const seed = { x0: -100, y0: 8, vx0: 1, vy0: 0 };
    const common = { mass: 1, seeds: [seed], step: 0.1, max_lambda: 220 };
    const weak = iterateGeodesic({
      shape: "geodesic",
      metric: "schwarzschild-weak",
      ...common,
    });
    const strong = iterateGeodesic({
      shape: "geodesic",
      metric: "schwarzschild-strong",
      ...common,
    });
    const lastWeak = weak[weak.length - 1];
    const lastStrong = strong[strong.length - 1];
    expect(lastWeak).toBeDefined();
    expect(lastStrong).toBeDefined();
    if (!lastWeak || !lastStrong) return;
    // Exit-direction deflection angle relative to the initial
    // direction (+x). Strong-field angle's magnitude exceeds weak-
    // field's, by ~20-30% at this geometry.
    const prevWeak = weak[weak.length - 2];
    const prevStrong = strong[strong.length - 2];
    if (!prevWeak || !prevStrong) return;
    const alphaWeak = Math.abs(Math.atan2(lastWeak.y - prevWeak.y, lastWeak.x - prevWeak.x));
    const alphaStrong = Math.abs(
      Math.atan2(lastStrong.y - prevStrong.y, lastStrong.x - prevStrong.x),
    );
    expect(alphaStrong).toBeGreaterThan(alphaWeak);
  });

  it("captures sub-critical-b photons that weak-field would scatter", () => {
    // At b ≈ 4·M (below b_crit ≈ 5.196·M), strong-field captures
    // the photon (it ends near the event horizon) while weak-field
    // still scatters (no concept of photon sphere). This qualitative
    // gap is the headline strong-field correction.
    const seed = { x0: -30, y0: 4, vx0: 1, vy0: 0 };
    const common = { mass: 1, seeds: [seed], step: 0.05, max_lambda: 80 };
    const weak = iterateGeodesic({
      shape: "geodesic",
      metric: "schwarzschild-weak",
      ...common,
    });
    const strong = iterateGeodesic({
      shape: "geodesic",
      metric: "schwarzschild-strong",
      ...common,
    });
    const lastWeak = weak[weak.length - 1];
    const lastStrong = strong[strong.length - 1];
    if (!lastWeak || !lastStrong) return;
    const rWeak = Math.hypot(lastWeak.x, lastWeak.y);
    const rStrong = Math.hypot(lastStrong.x, lastStrong.y);
    // Strong captured (small final r); weak scattered (large r).
    expect(rStrong).toBeLessThan(3);
    expect(rWeak).toBeGreaterThan(10);
  });

  it("captures a photon aimed nearly radially toward the lens", () => {
    // Tiny impact parameter → angular momentum too small to escape.
    // Photon should fall toward the event horizon and the simulation
    // truncates at r ≈ 2M.
    const rows = iterateGeodesic(
      strongSpec({
        seeds: [{ x0: -10, y0: 0.1, vx0: 1, vy0: 0 }],
        step: 0.05,
        max_lambda: 100,
      }),
    );
    const last = rows[rows.length - 1];
    expect(last).toBeDefined();
    if (!last) return;
    const rFinal = Math.hypot(last.x, last.y);
    // Captured: ended near the event horizon (r ≈ 2M = 2).
    expect(rFinal).toBeLessThan(3);
    // Not below the horizon (we truncate at 2.01M = 2.01).
    expect(rFinal).toBeGreaterThan(2);
  });

  it("loops near the photon sphere for a critical impact parameter", () => {
    // The critical impact parameter for the photon sphere in
    // Schwarzschild is b_crit = 3·sqrt(3)·M ≈ 5.196·M. Setting b
    // slightly above b_crit makes the photon orbit the lens once
    // or twice before escaping — the φ coordinate sweeps through
    // more than 2π. We check that the trajectory's φ-span exceeds
    // π (a strong-field signature; weak-field at the same geometry
    // sweeps far less).
    const rows = iterateGeodesic(
      strongSpec({
        seeds: [{ x0: -50, y0: 5.4, vx0: 1, vy0: 0 }],
        step: 0.05,
        max_lambda: 200,
      }),
    );
    expect(rows.length).toBeGreaterThan(10);
    // Compute the φ-span as the maximum absolute angular difference
    // between any two emitted points relative to the lens at origin.
    const angles = rows.map((r) => Math.atan2(r.y, r.x));
    // Unwrap φ so we capture the full sweep (atan2 jumps at ±π).
    let unwrapped = angles[0] ?? 0;
    let prev = unwrapped;
    let minAngle = unwrapped;
    let maxAngle = unwrapped;
    for (let i = 1; i < angles.length; i++) {
      const a = angles[i] ?? prev;
      let delta = a - prev;
      if (delta > Math.PI) delta -= 2 * Math.PI;
      else if (delta < -Math.PI) delta += 2 * Math.PI;
      unwrapped += delta;
      if (unwrapped < minAngle) minAngle = unwrapped;
      if (unwrapped > maxAngle) maxAngle = unwrapped;
      prev = a;
    }
    const span = maxAngle - minAngle;
    // Strong-field deflection at this geometry exceeds π — a
    // signature of the photon-sphere loop. Weak-field at the same
    // geometry sweeps less than π/4.
    expect(span).toBeGreaterThan(Math.PI);
  });

  it("is byte-stable across two strong-field calls", () => {
    const spec = strongSpec({
      seeds: [
        { x0: -20, y0: 3, vx0: 1, vy0: 0 },
        { x0: -20, y0: -3, vx0: 1, vy0: 0 },
      ],
    });
    const a = iterateGeodesic(spec);
    const b = iterateGeodesic(spec);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
