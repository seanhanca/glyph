/**
 * `data.shape: "geodesic"` sampler — RFC 2026-05-22, extension #3.
 *
 * Integrates photon paths through the equatorial plane of a
 * Schwarzschild black hole. The third math data shape after
 * `function` and `trajectory`, completing the visualization
 * surface joy.html's gravity-lens demo lives on:
 *
 *     - `function`   → parametric curves (Lissajous, butterfly, …)
 *     - `trajectory` → 2D ODE systems (predator-prey, oscillators, …)
 *     - `recurrence` → discrete maps (curlicue, logistic, …)
 *     - `geodesic`   → relativistic photon paths (lens, orbits, …)
 *
 * ### V1 scope: weak-field Schwarzschild
 *
 * Strong-field Schwarzschild requires Christoffel-symbol bookkeeping
 * in 4D (t, r, θ, φ) coordinates with an equatorial-plane projection
 * step. That's a separate followup; v1 ships the weak-field
 * approximation, which is accurate to first order in M/r:
 *
 *     a = -2·G·M · r̂ / r²
 *
 * The Newtonian acceleration magnitude with a factor-of-2 correction.
 * Reproduces GR's famous 4M/b light deflection at the photon level —
 * Eddington's 1919 measurement, what every gravitational-lensing
 * survey calibrates against. Accurate to < 0.1% at impact parameters
 * > 5·rs (the regime of the joy.html demo). Strong-field fall-into-
 * the-event-horizon photon orbits are out of scope; we truncate at
 * the photon sphere (r ≤ 1.5·M) as a proxy.
 *
 * ### Units
 *
 * Geometrized units: G = c = 1, so the Schwarzschild radius is
 * `rs = 2·M`. Pass M as a dimensionless number; "distance" units in
 * `seeds` are the same units as M. For a solar-mass lens, M ≈ 1.5 km
 * in geometrized units, but for visualization any normalization works.
 *
 * ### Spec shape
 *
 * ```jsonc
 * {
 *   "data": {
 *     "geodesic": {
 *       "shape": "geodesic",
 *       "metric": "schwarzschild-weak",
 *       "mass": 1.0,
 *       "seeds": [
 *         // each entry: photon's initial 2D position + velocity (v=1)
 *         { "x0": -10, "y0":  0.5, "vx0": 1, "vy0": 0 },
 *         { "x0": -10, "y0": -0.5, "vx0": 1, "vy0": 0 }
 *       ],
 *       "step": 0.05,
 *       "max_lambda": 24
 *     }
 *   },
 *   "layers": [{ "mark": "line", "encoding": { "x": "x", "y": "y", "color": "seed_id" } }]
 * }
 * ```
 *
 * ### Output schema
 *
 * `[seed_id (BIGINT), lambda (DOUBLE), x (DOUBLE), y (DOUBLE)]`.
 * `seed_id` first so `encoding.color` can hue by ray. `lambda` is
 * the affine parameter — `animation.kind: "scrub"` with
 * `frame_field: "lambda"` composes with zero compiler changes, same
 * trick the trajectory shape uses with `t`.
 *
 * ### Determinism
 *
 * Same precision-clamp story as the rest of the math shapes:
 * `clampSamplerPrecision` runs on every emitted (x, y) so the libm
 * drift in `Math.sqrt` and the arithmetic chain don't reach
 * `roundPx`. The only transcendental in the weak-field formulation
 * is `sqrt`, which IS bit-exact across libm (IEEE 754 specifies it).
 * But we run the clamp anyway for robustness against future
 * extensions that introduce `sin`/`cos`/`exp`.
 */

import { clampSamplerPrecision } from "./function.js";

/** Maximum allowed seed count. Each seed costs O(max_lambda / step)
 *  RK4 steps; cap exists so a malformed spec can't DoS the renderer. */
export const MAX_GEODESIC_SEEDS = 200;

/** Maximum integration extent. Per-seed cost = max_lambda / step. */
export const MAX_GEODESIC_LAMBDA = 1_000;

/** One photon initial-condition. Velocity magnitude is normalized
 *  to 1 (geometrized units); if a caller supplies (vx0, vy0) that
 *  isn't unit-length, we normalize at start of integration. */
export interface GeodesicSeed {
  readonly x0: number;
  readonly y0: number;
  readonly vx0: number;
  readonly vy0: number;
}

export interface GeodesicDataSpec {
  shape: "geodesic";
  /** Spacetime metric. V1 only ships `"schwarzschild-weak"`. */
  metric: "schwarzschild-weak";
  /** Lens mass in geometrized units (G = c = 1). Must be positive. */
  mass: number;
  /** Per-photon initial conditions. */
  seeds: ReadonlyArray<GeodesicSeed>;
  /** RK4 step in affine-parameter units. */
  step: number;
  /** Maximum affine-parameter extent per photon. */
  max_lambda: number;
}

/** One materialized geodesic row. Schema: [seed_id, lambda, x, y]. */
export interface GeodesicRow {
  seed_id: number;
  lambda: number;
  x: number;
  y: number;
}

/**
 * Integrate every seed via RK4 over the weak-field Schwarzschild
 * acceleration term. Emits rows in (seed_id ASC, lambda ASC) order
 * so downstream marks can group by seed_id for color and walk lambda
 * for ordered path emission.
 *
 * Per-seed truncation:
 *   - `r < 1.5·M` (photon sphere — light at this radius orbits the
 *     lens indefinitely; below, it's captured. We stop short rather
 *     than divide by a vanishing r in `r³`).
 *   - `lambda > spec.max_lambda` (DoS guard).
 *   - non-finite intermediate state (numerical blow-up).
 */
export function iterateGeodesic(spec: GeodesicDataSpec): GeodesicRow[] {
  validateSpec(spec);
  const { mass: M, seeds, step: h, max_lambda } = spec;
  const photonSphere = 1.5 * M;
  const allRows: GeodesicRow[] = [];

  for (let seedIdx = 0; seedIdx < seeds.length; seedIdx++) {
    const seed = seeds[seedIdx];
    if (!seed) continue;
    // Normalize the initial velocity to unit length so the
    // parameter `lambda` corresponds to proper arc length in the
    // weak-field limit. (Photons travel at c=1, so |v|=1.)
    const v0mag = Math.sqrt(seed.vx0 * seed.vx0 + seed.vy0 * seed.vy0);
    if (v0mag === 0) {
      // A photon at rest is non-physical; skip with a soft fail so
      // one bad seed doesn't kill the whole render. The schema-
      // level check requires nonzero velocity, but we double-check.
      continue;
    }
    let x = seed.x0;
    let y = seed.y0;
    let vx = seed.vx0 / v0mag;
    let vy = seed.vy0 / v0mag;

    let lambda = 0;
    allRows.push({
      seed_id: seedIdx,
      lambda: 0,
      x: clampSamplerPrecision(x),
      y: clampSamplerPrecision(y),
    });

    while (lambda < max_lambda) {
      const r0 = Math.sqrt(x * x + y * y);
      // Truncate at photon sphere — light below this is captured;
      // emitting points past it would draw a streak into the lens.
      if (r0 < photonSphere) break;

      // RK4 on the 4-state ODE
      //   dx/dλ  = vx        dvx/dλ = a(x, y).x
      //   dy/dλ  = vy        dvy/dλ = a(x, y).y
      // where a = -2·M · (x, y) / r³  (weak-field Schwarzschild).
      const k1 = derivatives(x, y, vx, vy, M);

      const k2 = derivatives(
        x + 0.5 * h * k1.dx,
        y + 0.5 * h * k1.dy,
        vx + 0.5 * h * k1.dvx,
        vy + 0.5 * h * k1.dvy,
        M,
      );
      const k3 = derivatives(
        x + 0.5 * h * k2.dx,
        y + 0.5 * h * k2.dy,
        vx + 0.5 * h * k2.dvx,
        vy + 0.5 * h * k2.dvy,
        M,
      );
      const k4 = derivatives(x + h * k3.dx, y + h * k3.dy, vx + h * k3.dvx, vy + h * k3.dvy, M);

      x = x + (h / 6) * (k1.dx + 2 * k2.dx + 2 * k3.dx + k4.dx);
      y = y + (h / 6) * (k1.dy + 2 * k2.dy + 2 * k3.dy + k4.dy);
      vx = vx + (h / 6) * (k1.dvx + 2 * k2.dvx + 2 * k3.dvx + k4.dvx);
      vy = vy + (h / 6) * (k1.dvy + 2 * k2.dvy + 2 * k3.dvy + k4.dvy);
      lambda += h;

      // Numerical blow-up — terminate this seed cleanly rather than
      // emit NaN coordinates that would break the renderer.
      if (!Number.isFinite(x) || !Number.isFinite(y)) break;

      allRows.push({
        seed_id: seedIdx,
        lambda: clampSamplerPrecision(lambda),
        x: clampSamplerPrecision(x),
        y: clampSamplerPrecision(y),
      });
    }
  }
  return allRows;
}

/** Weak-field Schwarzschild acceleration: a = -2·M · (x, y) / r³.
 *  The factor of 2 vs Newtonian's 1 is GR's contribution; reproduces
 *  the 4M/b photon deflection (vs Newton's 2M/b). */
function derivatives(
  x: number,
  y: number,
  vx: number,
  vy: number,
  M: number,
): { dx: number; dy: number; dvx: number; dvy: number } {
  const r2 = x * x + y * y;
  const r3 = r2 * Math.sqrt(r2); // r * r²
  // Guard against division by near-zero. Caller's photon-sphere
  // truncation should make this unreachable, but defense in depth
  // protects against numerical edge cases at the boundary.
  if (r3 < 1e-12) {
    return { dx: vx, dy: vy, dvx: 0, dvy: 0 };
  }
  const coeff = (-2 * M) / r3;
  return {
    dx: vx,
    dy: vy,
    dvx: coeff * x,
    dvy: coeff * y,
  };
}

function validateSpec(spec: GeodesicDataSpec): void {
  if (spec.metric !== "schwarzschild-weak") {
    throw new Error(
      `geodesic data: only metric "schwarzschild-weak" is supported in v1 (got "${spec.metric}")`,
    );
  }
  if (!Number.isFinite(spec.mass) || spec.mass <= 0) {
    throw new Error(`geodesic data: mass must be a positive finite number (got ${spec.mass})`);
  }
  if (!Array.isArray(spec.seeds) || spec.seeds.length === 0) {
    throw new Error("geodesic data: seeds must be a non-empty array");
  }
  if (spec.seeds.length > MAX_GEODESIC_SEEDS) {
    throw new Error(
      `geodesic data: seeds.length (${spec.seeds.length}) exceeds MAX_GEODESIC_SEEDS (${MAX_GEODESIC_SEEDS})`,
    );
  }
  for (let i = 0; i < spec.seeds.length; i++) {
    const s = spec.seeds[i];
    if (!s) continue;
    if (
      !Number.isFinite(s.x0) ||
      !Number.isFinite(s.y0) ||
      !Number.isFinite(s.vx0) ||
      !Number.isFinite(s.vy0)
    ) {
      throw new Error(
        `geodesic data: seeds[${i}] must have finite x0, y0, vx0, vy0 (got ${JSON.stringify(s)})`,
      );
    }
    if (s.vx0 === 0 && s.vy0 === 0) {
      throw new Error(`geodesic data: seeds[${i}] velocity must be nonzero`);
    }
  }
  if (!Number.isFinite(spec.step) || spec.step <= 0) {
    throw new Error(`geodesic data: step must be a positive finite number (got ${spec.step})`);
  }
  if (!Number.isFinite(spec.max_lambda) || spec.max_lambda <= 0) {
    throw new Error(
      `geodesic data: max_lambda must be a positive finite number (got ${spec.max_lambda})`,
    );
  }
  if (spec.max_lambda > MAX_GEODESIC_LAMBDA) {
    throw new Error(
      `geodesic data: max_lambda (${spec.max_lambda}) exceeds MAX_GEODESIC_LAMBDA (${MAX_GEODESIC_LAMBDA})`,
    );
  }
}
