/**
 * `data.shape: "trajectory"` sampler — Math Phase 2 Track A PR A1.
 *
 * Integrates a 2D autonomous (or time-dependent) ODE system
 *
 *     dx/dt = f(x, y, t)
 *     dy/dt = g(x, y, t)
 *
 * from `time.min` to `time.max` in `time.samples - 1` evenly-spaced
 * RK4 steps and emits `{t, x, y}` rows. The existing `mark: "line"`
 * consumes the rows; the same insertion-order sentinel from Math PR5
 * keeps closed orbits (e.g. predator-prey limit cycles) from being
 * x-sorted into zigzags.
 *
 * Determinism: identical to `sampleFunction`. The same `expr-eval`
 * evaluator (with its disabled `random`/`fac`/... bag) backs every
 * derivative evaluation; RK4 step size is anchored from the spec
 * endpoints (`(time.max - time.min) / (time.samples - 1)`); the last
 * row's `t` is anchored to `time.max` exactly so floating drift
 * cannot accumulate across the loop. Same spec → byte-identical
 * rows across runs and platforms.
 *
 * Composition contract: rows are emitted in insertion (time) order
 * with `t` as the leading column. That ordering — plus the fact that
 * `t` is a real schema column — is what lets `animation.kind:
 * "scrub"` with `frame_field: "t"` step through the trajectory with
 * zero compiler changes (the same orthogonality test PR2 nailed for
 * parametric data).
 *
 * Non-finite derivatives currently throw — RK4 can't keep going past
 * a NaN — so spec authors get an immediate, actionable error rather
 * than silent corruption. (If a use case ever needs path-break
 * semantics like `sampleFunction`, we can revisit; for the canonical
 * physical systems this PR targets, blowing up is the right signal.)
 */

import { EvaluationError, type Evaluator } from "../../eval/evaluator.js";
import { defaultEvaluator } from "../../eval/expr-eval-adapter.js";
import { MAX_SAMPLES, clampSamplerPrecision } from "./function.js";

/**
 * Inline ODE system. Expressions reference `x`, `y`, and `t`; the
 * standard math operators / functions exposed by the evaluator are
 * available.
 *
 * `time.samples` is the number of *output rows* (== number of RK4
 * grid points), so the step `h = (time.max - time.min) / (samples - 1)`.
 * A 250-sample spec runs 249 RK4 steps; the first row holds the
 * initial condition verbatim.
 */
export interface TrajectoryDataSpec {
  shape: "trajectory";
  /** Expression for dx/dt; identifiers `x`, `y`, `t` plus the standard math fns. */
  dxdt: string;
  /** Expression for dy/dt; identifiers `x`, `y`, `t` plus the standard math fns. */
  dydt: string;
  /** Initial condition at `t = time.min`. */
  initial: { x: number; y: number };
  /**
   * Time grid. `samples` is the output row count (>= 2); step size is
   * derived from `(max - min) / (samples - 1)`. Same MAX_SAMPLES cap
   * as `sampleFunction` so a malformed spec can't DoS the renderer.
   */
  time: { min: number; max: number; samples: number };
}

/** One materialized trajectory row. Time-ordered (insertion order). */
export interface TrajectoryRow {
  /** Time at this step; anchored to `time.min` at index 0 and `time.max` at the last index. */
  t: number;
  /** State component x integrated up to time t. */
  x: number;
  /** State component y integrated up to time t. */
  y: number;
}

/**
 * Integrate the spec via classical Runge–Kutta 4th order ("RK4").
 *
 * RK4 per step (from state (x, y) at time t with step h):
 *   k1x = f(x,           y,           t        ), k1y = g(x,           y,           t        )
 *   k2x = f(x + h/2·k1x, y + h/2·k1y, t + h/2  ), k2y = g(...,         ...,         ...      )
 *   k3x = f(x + h/2·k2x, y + h/2·k2y, t + h/2  ), k3y = g(...,         ...,         ...      )
 *   k4x = f(x + h·k3x,   y + h·k3y,   t + h    ), k4y = g(...,         ...,         ...      )
 *   x' = x + h/6·(k1x + 2·k2x + 2·k3x + k4x)
 *   y' = y + h/6·(k1y + 2·k2y + 2·k3y + k4y)
 *
 * Validation: same shape as `sampleFunction.validateRange` — finite
 * endpoints, min < max, integer samples >= 2, samples <= MAX_SAMPLES.
 * Initial coordinates must also be finite (otherwise k1 is already
 * NaN and the spec author needs to know up-front).
 */
export function integrateTrajectory(
  spec: TrajectoryDataSpec,
  evaluator: Evaluator = defaultEvaluator,
): TrajectoryRow[] {
  validateTime(spec.time);
  if (!Number.isFinite(spec.initial.x) || !Number.isFinite(spec.initial.y)) {
    throw new Error(
      `trajectory data: initial.x and initial.y must be finite (got ${spec.initial.x}, ${spec.initial.y})`,
    );
  }

  const samples = spec.time.samples;
  const h = (spec.time.max - spec.time.min) / (samples - 1);
  const rows: TrajectoryRow[] = new Array(samples);

  let x = spec.initial.x;
  let y = spec.initial.y;
  // First row is the initial condition at t = time.min; anchored
  // exactly so the snapshot bytes don't drift with the step count.
  rows[0] = { t: spec.time.min, x, y };

  for (let i = 1; i < samples; i++) {
    // Anchor the start at spec.time.min and the very last step at
    // spec.time.max — mirrors the endpoint-anchoring trick in
    // sampleFunction so RK4 accumulated drift can't shift the
    // displayed `t` values between platforms. Interior steps walk
    // the uniform grid `time.min + h * i`. The RK4 STAGE SPACING
    // (the offsets between k1/k2/k3/k4 t-evaluations) is uniformly
    // h on every step, including the last; only the absolute
    // `tNext` value gets snapped to time.max. Difference vs
    // `tPrev + h` is at most ~1 ULP and zero for autonomous
    // systems (dx/dt, dy/dt independent of t).
    const tPrev = i === 1 ? spec.time.min : spec.time.min + h * (i - 1);
    const tNext = i === samples - 1 ? spec.time.max : spec.time.min + h * i;
    const tMid = tPrev + h * 0.5;
    const step = h;

    const k1x = evalDeriv(evaluator, spec.dxdt, { x, y, t: tPrev });
    const k1y = evalDeriv(evaluator, spec.dydt, { x, y, t: tPrev });

    const x2 = x + step * 0.5 * k1x;
    const y2 = y + step * 0.5 * k1y;
    const k2x = evalDeriv(evaluator, spec.dxdt, { x: x2, y: y2, t: tMid });
    const k2y = evalDeriv(evaluator, spec.dydt, { x: x2, y: y2, t: tMid });

    const x3 = x + step * 0.5 * k2x;
    const y3 = y + step * 0.5 * k2y;
    const k3x = evalDeriv(evaluator, spec.dxdt, { x: x3, y: y3, t: tMid });
    const k3y = evalDeriv(evaluator, spec.dydt, { x: x3, y: y3, t: tMid });

    const x4 = x + step * k3x;
    const y4 = y + step * k3y;
    const k4x = evalDeriv(evaluator, spec.dxdt, { x: x4, y: y4, t: tNext });
    const k4y = evalDeriv(evaluator, spec.dydt, { x: x4, y: y4, t: tNext });

    // Cross-platform precision clamp on each integration step. RK4
    // accumulates libm drift in `sin`/`cos`/`exp`/etc. over thousands
    // of evaluator calls; without this, a 1000-sample trajectory can
    // diverge in the 10th decimal between macOS and Linux, which then
    // crosses `roundPx`'s 8-decimal boundary and the SVG bytes differ.
    // Same precision-clamp story as `function` and `recurrence`.
    x = clampSamplerPrecision(x + (step / 6) * (k1x + 2 * k2x + 2 * k3x + k4x));
    y = clampSamplerPrecision(y + (step / 6) * (k1y + 2 * k2y + 2 * k3y + k4y));

    rows[i] = { t: tNext, x, y };
  }

  return rows;
}

/**
 * Structural validation for `time` — duplicates `function.ts`'s
 * `validateRange` to keep the error messages addressed to the
 * trajectory shape's field name (`time.*`).
 */
function validateTime(time: { min: number; max: number; samples: number }): void {
  if (!Number.isFinite(time.min) || !Number.isFinite(time.max)) {
    throw new Error(
      `trajectory data: time.min and time.max must be finite (got ${time.min}, ${time.max})`,
    );
  }
  if (time.min >= time.max) {
    throw new Error(`trajectory data: time.min (${time.min}) must be < time.max (${time.max})`);
  }
  if (!Number.isInteger(time.samples) || time.samples < 2) {
    throw new Error(`trajectory data: time.samples must be an integer >= 2 (got ${time.samples})`);
  }
  if (time.samples > MAX_SAMPLES) {
    throw new Error(
      `trajectory data: time.samples (${time.samples}) exceeds MAX_SAMPLES (${MAX_SAMPLES})`,
    );
  }
}

/**
 * Evaluate a derivative expression. Unlike `sampleFunction`'s
 * `safeEval`, non-finite results throw — once an RK4 step produces
 * NaN the integration is unrecoverable, and the spec author needs to
 * see the failure immediately. Parse / unbound-identifier errors
 * also bubble (they were already fatal in `sampleFunction`).
 */
function evalDeriv(evaluator: Evaluator, expr: string, scope: Record<string, number>): number {
  try {
    return evaluator(expr, scope);
  } catch (e) {
    if (e instanceof EvaluationError) {
      throw new Error(
        `trajectory data: derivative '${expr}' failed at (x=${scope.x}, y=${scope.y}, t=${scope.t}): ${e.message}`,
      );
    }
    throw e;
  }
}
