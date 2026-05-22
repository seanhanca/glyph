/**
 * `data.shape: "recurrence"` sampler — iterative function visualization.
 *
 * The first new data shape since trajectory (PR A1). Walks a
 * discrete map of the form
 *
 *     state_{n+1} = f(state_n, n, ...params)
 *
 * for N steps, emitting one row per step. Where `function` samples a
 * curve and `trajectory` integrates an ODE, `recurrence` iterates a
 * difference equation — the natural fit for curlicue curves, the
 * logistic map, IFS attractors, and any system whose forward
 * evolution is "compute next from previous" rather than continuous.
 *
 * Spec shape:
 *
 *   {
 *     "data": {
 *       "function": {
 *         "shape": "recurrence",
 *         "state": ["x", "y"],
 *         "initial": { "x": 0, "y": 0 },
 *         "step": {
 *           // One expression per state variable. The RHS sees:
 *           //   - every state variable's current value
 *           //   - `n` (step index, integer)
 *           //   - every key in `params`
 *           "x": "x + cos(theta * n * n)",
 *           "y": "y + sin(theta * n * n)"
 *         },
 *         "params": { "theta": 1.5708 },
 *         "steps": 8000
 *       }
 *     },
 *     ...
 *   }
 *
 * Output: one `RecurrenceRow` per step, with `n` plus a numeric
 * column per state variable. The step at index 0 holds the initial
 * condition verbatim (the `initial` map); steps 1..N are computed.
 *
 * Determinism: all `expr-eval` evaluations of the step expressions
 * go through the same evaluator interface used by `function` and
 * `trajectory`. Same spec → byte-identical rows on every platform,
 * inheriting the `canonicalStringify` precision clamp that's already
 * shipped for cross-platform hash stability.
 *
 * Composition contract: the synthesized schema's columns are
 * `[n, ...state]` (n first). This mirrors the `t` ordering trick in
 * `trajectory`, so `animation.kind: "scrub"` with `frame_field: "n"`
 * can step through the recurrence one iteration at a time without
 * any compile-time changes.
 */

import { EvaluationError, type Evaluator } from "../../eval/evaluator.js";
import { defaultEvaluator } from "../../eval/expr-eval-adapter.js";
import { MAX_SAMPLES, clampSamplerPrecision } from "./function.js";

/**
 * Maximum allowed `steps`. Higher than `MAX_SAMPLES` (the cap for
 * function / trajectory) because a recurrence's per-step cost is
 * lower than RK4 (one expression eval per state var vs four).
 * The cap exists purely to keep a malformed spec from hanging the
 * compiler.
 */
export const MAX_RECURRENCE_STEPS = 200_000;

/**
 * Discrete recurrence specification. All keys in `state` must
 * appear in both `initial` and `step` (and vice-versa).
 *
 * `step.<var>` expressions reference any current state variable by
 * name, plus `n` (the integer step index, available from step 1
 * onward), plus every key in `params`.
 */
export interface RecurrenceDataSpec {
  shape: "recurrence";
  /**
   * Ordered list of state-variable names. The schema column order
   * after `n` follows this list — sensitive to order, so `["x",
   * "y"]` and `["y", "x"]` produce different positional rows.
   */
  state: readonly string[];
  /** Initial values for each state variable. Keys must match `state` exactly. */
  initial: Readonly<Record<string, number>>;
  /** Per-state-variable next-step expression. Keys must match `state` exactly. */
  step: Readonly<Record<string, string>>;
  /**
   * Optional structural constants. Each key becomes a free
   * identifier in the step expressions with the constant value.
   * Useful for things like `theta` or `r` in `logistic_x → r*x*(1−x)`.
   * Defaults to empty.
   */
  params?: Readonly<Record<string, number>>;
  /**
   * Number of OUTPUT rows. The recurrence walks `steps - 1` updates
   * from the initial condition. Must be an integer >= 2 and <=
   * MAX_RECURRENCE_STEPS.
   */
  steps: number;
}

/** One materialized recurrence row. `n` is always present; the
 * remaining keys are the recurrence's state variables. */
export interface RecurrenceRow {
  /** Step index. 0 = initial condition, 1..N-1 = iterated. */
  n: number;
  /** Each state variable from the spec, keyed by name. */
  [key: string]: number;
}

/**
 * Walk the recurrence forward `spec.steps - 1` times and emit one
 * row per step (including the initial condition at n=0).
 *
 * Validation: state/initial/step key sets must match exactly,
 * `steps` must be int in [2, MAX_RECURRENCE_STEPS], every initial
 * value finite. Any non-finite intermediate state throws — the
 * recurrence "blew up" and the user needs to know.
 */
export function iterateRecurrence(
  spec: RecurrenceDataSpec,
  evaluator: Evaluator = defaultEvaluator,
): RecurrenceRow[] {
  validateSpec(spec);

  const stateNames = spec.state;
  const params = spec.params ?? {};
  const steps = spec.steps;

  // Mutable scope object reused across all step evaluations. Each
  // step writes new state values into a fresh scope so we don't
  // surprise the evaluator with mid-step mutations.
  const current: Record<string, number> = {};
  for (const name of stateNames) {
    const v = spec.initial[name];
    if (v === undefined || !Number.isFinite(v)) {
      throw new Error(`recurrence data: initial.${name} must be a finite number (got ${v})`);
    }
    current[name] = v;
  }

  const rows: RecurrenceRow[] = new Array(steps);

  // n = 0: initial condition, no evaluation.
  rows[0] = { n: 0, ...current };

  for (let n = 1; n < steps; n++) {
    // Evaluator sees current state + n + params. Build the scope
    // once per step (cheap; ≤ ~10 keys for typical recurrences).
    const scope: Record<string, number> = { ...current, ...params, n };
    const next: Record<string, number> = {};
    for (const name of stateNames) {
      const expr = spec.step[name];
      if (expr === undefined) {
        // Caught by validateSpec, but defense-in-depth.
        throw new Error(`recurrence data: missing step expression for state "${name}"`);
      }
      let v: number;
      try {
        v = evaluator(expr, scope);
      } catch (e) {
        if (e instanceof EvaluationError) {
          throw new Error(`recurrence data: step.${name} failed at n=${n} — ${e.message}`);
        }
        throw e;
      }
      if (!Number.isFinite(v)) {
        throw new Error(
          `recurrence data: state "${name}" became non-finite at n=${n} (value: ${v}). The recurrence diverged.`,
        );
      }
      // Cross-platform clamp so libm drift in step expressions
      // (`sin`, `cos`, `exp`, …) doesn't accumulate over thousands
      // of iterations into a different rendered curve on Linux vs
      // macOS. Same precision-clamp story as the function shape.
      next[name] = clampSamplerPrecision(v);
    }
    for (const name of stateNames) current[name] = next[name] as number;
    rows[n] = { n, ...current };
  }

  return rows;
}

function validateSpec(spec: RecurrenceDataSpec): void {
  if (!Array.isArray(spec.state) || spec.state.length === 0) {
    throw new Error("recurrence data: state must be a non-empty array of variable names");
  }
  // Reject duplicate state names — would otherwise silently overwrite.
  const seen = new Set<string>();
  for (const name of spec.state) {
    if (typeof name !== "string" || name.length === 0) {
      throw new Error("recurrence data: state names must be non-empty strings");
    }
    if (seen.has(name)) {
      throw new Error(`recurrence data: duplicate state name "${name}"`);
    }
    seen.add(name);
  }
  // Reserved identifier collision — `n` is the step index supplied
  // automatically; can't also be a state variable.
  if (seen.has("n")) {
    throw new Error(`recurrence data: state name "n" is reserved for the step index`);
  }
  // initial / step key sets must exactly match state.
  const initialKeys = Object.keys(spec.initial);
  const stepKeys = Object.keys(spec.step);
  for (const name of spec.state) {
    if (!(name in spec.initial)) {
      throw new Error(`recurrence data: initial.${name} is missing`);
    }
    if (!(name in spec.step)) {
      throw new Error(`recurrence data: step.${name} is missing`);
    }
  }
  for (const k of initialKeys) {
    if (!seen.has(k)) {
      throw new Error(
        `recurrence data: initial.${k} doesn't correspond to any state variable (state: ${Array.from(seen).join(", ")})`,
      );
    }
  }
  for (const k of stepKeys) {
    if (!seen.has(k)) {
      throw new Error(
        `recurrence data: step.${k} doesn't correspond to any state variable (state: ${Array.from(seen).join(", ")})`,
      );
    }
  }
  if (!Number.isInteger(spec.steps) || spec.steps < 2) {
    throw new Error(`recurrence data: steps must be an integer >= 2 (got ${spec.steps})`);
  }
  if (spec.steps > MAX_RECURRENCE_STEPS) {
    throw new Error(
      `recurrence data: steps (${spec.steps}) exceeds MAX_RECURRENCE_STEPS (${MAX_RECURRENCE_STEPS})`,
    );
  }
  // params (if present) must be finite numbers.
  if (spec.params) {
    for (const [k, v] of Object.entries(spec.params)) {
      if (!Number.isFinite(v)) {
        throw new Error(`recurrence data: params.${k} must be finite (got ${v})`);
      }
    }
  }
}
