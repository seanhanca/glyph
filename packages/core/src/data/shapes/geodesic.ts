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
 * Weak-field Schwarzschild = the post-Newtonian approximation:
 *
 *     a = -2·G·M · r̂ / r²
 *
 * The Newtonian acceleration magnitude with a factor-of-2 correction.
 * Reproduces GR's famous 4M/b light deflection at the photon level —
 * Eddington's 1919 measurement, what every gravitational-lensing
 * survey calibrates against. Accurate to < 0.1% at impact parameters
 * > 5·rs. Strong-field fall-into-the-event-horizon photon orbits are
 * handled by v2 below; v1 truncates at r ≤ 1.5·M as a proxy.
 *
 * ### V2 scope: strong-field Schwarzschild
 *
 * The full equatorial-plane null-geodesic equations. Conservation of
 * energy E and angular momentum L yields a clean 3-state ODE in
 * (r, φ, ṙ):
 *
 *     dr/dλ  = ṙ
 *     dφ/dλ  = L / r²
 *     d²r/dλ² = L² · (r − 3M) / r⁴
 *
 * where L = x0·vy0 − y0·vx0 is conserved and the equation comes
 * from differentiating the null constraint
 *     (dr/dλ)² = E² − L²·(1 − 2M/r)/r²
 * with respect to λ. No turning-point sign-flips, no sqrt
 * singularities — autonomous in λ and RK4-stable.
 *
 * The radial restoring term `(r − 3M)/r⁴` flips sign at the
 * photon sphere `r = 3M`. Photons with sufficient L scatter (with
 * larger deflection than weak-field predicts); photons aimed too
 * close are captured at the event horizon `r = 2M`. The simulation
 * truncates at `r ≤ 2.01·M` to stay above the horizon coordinate
 * singularity.
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
 *       "metric": "schwarzschild-weak",       // or "schwarzschild-strong"
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
 * `clampSamplerPrecision` runs on every emitted (x, y) so libm
 * drift in `Math.sqrt`, `Math.cos`, `Math.sin` (strong-field only)
 * and the arithmetic chain don't reach `roundPx`. The weak-field
 * branch uses only `sqrt` (IEEE-bit-exact); the strong-field branch
 * uses `cos`/`sin` and so leans harder on the clamp.
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
  /** Spacetime metric. v1 ships `"schwarzschild-weak"`; v2 adds
   *  `"schwarzschild-strong"` with the full equatorial-plane
   *  geodesic equations. */
  metric: "schwarzschild-weak" | "schwarzschild-strong";
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
 * Integrate every seed in the spec. Dispatches on `spec.metric`:
 * weak-field (v1) uses post-Newtonian Cartesian acceleration;
 * strong-field (v2) uses the conserved-L formulation in (r, φ, ṙ).
 * Emits rows in (seed_id ASC, lambda ASC) order so downstream marks
 * can group by seed_id for color and walk lambda for ordered path
 * emission.
 */
export function iterateGeodesic(spec: GeodesicDataSpec): GeodesicRow[] {
  validateSpec(spec);
  if (spec.metric === "schwarzschild-strong") return iterateStrongField(spec);
  return iterateWeakField(spec);
}

/**
 * Weak-field Schwarzschild (v1). RK4 over (x, y, vx, vy) with
 *   a = -2M · (x, y) / r³
 * Truncates at r < 1.5·M (proxy for the photon sphere; the weak-
 * field formula breaks down well before the actual r = 3M sphere).
 */
function iterateWeakField(spec: GeodesicDataSpec): GeodesicRow[] {
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
      const k1 = weakDerivatives(x, y, vx, vy, M);

      const k2 = weakDerivatives(
        x + 0.5 * h * k1.dx,
        y + 0.5 * h * k1.dy,
        vx + 0.5 * h * k1.dvx,
        vy + 0.5 * h * k1.dvy,
        M,
      );
      const k3 = weakDerivatives(
        x + 0.5 * h * k2.dx,
        y + 0.5 * h * k2.dy,
        vx + 0.5 * h * k2.dvx,
        vy + 0.5 * h * k2.dvy,
        M,
      );
      const k4 = weakDerivatives(x + h * k3.dx, y + h * k3.dy, vx + h * k3.dvx, vy + h * k3.dvy, M);

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
function weakDerivatives(
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

/**
 * Strong-field Schwarzschild (v2). RK4 over (r, φ, ṙ) with
 *   dr/dλ  = ṙ
 *   dφ/dλ  = L / r²
 *   d²r/dλ² = L² · (r − 3M) / r⁴
 * Truncates at r ≤ 2.01·M (event horizon + 0.01 slack to avoid
 * the metric coordinate singularity).
 */
function iterateStrongField(spec: GeodesicDataSpec): GeodesicRow[] {
  const { mass: M, seeds, step: h, max_lambda } = spec;
  const eventHorizon = 2.01 * M;
  const allRows: GeodesicRow[] = [];

  for (let seedIdx = 0; seedIdx < seeds.length; seedIdx++) {
    const seed = seeds[seedIdx];
    if (!seed) continue;

    // Normalize initial velocity to |v|=1 so lambda matches the
    // weak-field branch's affine-parameter convention.
    const v0mag = Math.sqrt(seed.vx0 * seed.vx0 + seed.vy0 * seed.vy0);
    if (v0mag === 0) continue;
    const vx0 = seed.vx0 / v0mag;
    const vy0 = seed.vy0 / v0mag;

    // Polar initial conditions from the Cartesian seed.
    let r = Math.sqrt(seed.x0 * seed.x0 + seed.y0 * seed.y0);
    let phi = Math.atan2(seed.y0, seed.x0);
    // ṙ = (x·vx + y·vy)/r  (radial velocity from Cartesian).
    let rdot = (seed.x0 * vx0 + seed.y0 * vy0) / r;
    // L = x·vy − y·vx  (angular momentum, conserved). The unit-
    // velocity normalization carries through: |L| = b (impact
    // parameter) for an asymptotically-flat photon.
    const L = seed.x0 * vy0 - seed.y0 * vx0;

    let lambda = 0;
    allRows.push({
      seed_id: seedIdx,
      lambda: 0,
      x: clampSamplerPrecision(seed.x0),
      y: clampSamplerPrecision(seed.y0),
    });

    while (lambda < max_lambda) {
      if (r <= eventHorizon) break;

      // RK4 on the 3-state ODE (r, φ, ṙ). Use a single closure to
      // compute derivatives at each stage.
      const k1 = strongDerivatives(r, rdot, L, M);
      const k2 = strongDerivatives(r + 0.5 * h * k1.dr, rdot + 0.5 * h * k1.drdot, L, M);
      const k3 = strongDerivatives(r + 0.5 * h * k2.dr, rdot + 0.5 * h * k2.drdot, L, M);
      const k4 = strongDerivatives(r + h * k3.dr, rdot + h * k3.drdot, L, M);

      r = r + (h / 6) * (k1.dr + 2 * k2.dr + 2 * k3.dr + k4.dr);
      phi = phi + (h / 6) * (k1.dphi + 2 * k2.dphi + 2 * k3.dphi + k4.dphi);
      rdot = rdot + (h / 6) * (k1.drdot + 2 * k2.drdot + 2 * k3.drdot + k4.drdot);
      lambda += h;

      if (!Number.isFinite(r) || !Number.isFinite(phi) || !Number.isFinite(rdot)) break;
      // Once captured at the event horizon, stop emitting before
      // the (r, φ) → (x, y) projection produces a coordinate
      // singularity artifact.
      if (r <= eventHorizon) break;

      allRows.push({
        seed_id: seedIdx,
        lambda: clampSamplerPrecision(lambda),
        x: clampSamplerPrecision(r * Math.cos(phi)),
        y: clampSamplerPrecision(r * Math.sin(phi)),
      });
    }
  }
  return allRows;
}

/** Strong-field derivatives at (r, ṙ) for the conserved L formulation.
 *  Returns dr/dλ, dφ/dλ, d²r/dλ² in a stage-compatible shape. */
function strongDerivatives(
  r: number,
  rdot: number,
  L: number,
  M: number,
): { dr: number; dphi: number; drdot: number } {
  // Guard against division by near-zero r. The event-horizon
  // truncation in the caller makes this defensive only.
  if (r < 1e-9) {
    return { dr: rdot, dphi: 0, drdot: 0 };
  }
  const r2 = r * r;
  const r4 = r2 * r2;
  return {
    dr: rdot,
    dphi: L / r2,
    drdot: (L * L * (r - 3 * M)) / r4,
  };
}

function validateSpec(spec: GeodesicDataSpec): void {
  if (spec.metric !== "schwarzschild-weak" && spec.metric !== "schwarzschild-strong") {
    throw new Error(
      `geodesic data: metric must be "schwarzschild-weak" or "schwarzschild-strong" (got "${spec.metric}")`,
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
