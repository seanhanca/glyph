/**
 * `data.shape: "function"` sampler (math PR1/6 + PR2/6).
 *
 * **PR1 — scalar form**: takes a {@link FunctionDataSpec} (free-variable
 * range + single output expression), samples the expression at evenly-
 * spaced points across `[x.min, x.max]`, and returns a row array shaped
 * for Glyph's existing line / area / point machinery.
 *
 * **PR2 — parametric form**: takes a {@link ParametricDataSpec} (single
 * free parameter `t` plus separate `xExpr` / `yExpr` expressions), and
 * traces a curve in the plane. Each row also carries the parameter
 * value (under its declared name) so animation primitives — in
 * particular `animation.kind: "scrub"` with `frame_field: "<param>"` —
 * can step through the curve without any compiler changes.
 *
 * Non-finite outputs (`log(0)`, `log(-1)`, etc.) become `null` in the
 * row, which the line interpolator treats as a path break.
 *
 * Determinism: pure function. Same spec → same rows, byte-stable across
 * runs and platforms. The endpoint anchoring (`i === samples-1` →
 * `spec.max` exactly) prevents accumulated floating drift from shifting
 * snapshot bytes between machines.
 *
 * Evaluation order (parametric): `xExpr` is evaluated before `yExpr`
 * (then `zExpr` if present). Both are pure today, so the order doesn't
 * affect output; a future evaluator with side-effects (e.g. a stateful
 * symbolic backend) would care, hence the explicit contract.
 *
 * The materializer keeps the dispatch (compile.ts → sampleFunction →
 * inline rows) so that all downstream features — facet, polar, animation,
 * audit, MCP — work unchanged.
 */

import { EvaluationError, type Evaluator } from "../../eval/evaluator.js";
import { defaultEvaluator } from "../../eval/expr-eval-adapter.js";

/**
 * Hard cap on samples per axis — protects the compiler from a malformed
 * spec DoS-ing the renderer. 100k is enough for any plot a human can
 * read; AUDIT-10 (math PR5) will additionally warn at 10k+.
 */
export const MAX_SAMPLES = 100_000;

/**
 * Scalar single-variable form: y = f(x). The single-`x` form is the math
 * PR1 baseline; PR2 adds {@link ParametricDataSpec} as a sibling.
 */
export interface FunctionDataSpec {
  shape: "function";
  /** Free variable range. Currently fixed to `x`; PR2 generalizes via parametric. */
  x: { min: number; max: number; samples: number };
  /**
   * Single-output expression. Identifiers allowed: `x`, the constants
   * `pi` and `e`, and the standard math functions (`sin`, `cos`, `exp`,
   * `log`, `sqrt`, `abs`, `pow`, …) exposed by the evaluator.
   */
  expr: string;
  /**
   * Optional 3D z-coordinate expression. Today's renderer ignores it; a
   * future 3D renderer (Option B) reads it without a spec rev. Stays
   * undefined-safe so the 2D snapshot stays byte-identical.
   */
  zExpr?: string;
}

/**
 * Math PR2 — parametric curve. A single free parameter (`t` by default,
 * but any identifier is accepted) drives two/three output expressions
 * that produce `(x, y)` — or `(x, y, z)` — pairs traced across
 * `[parameter.min, parameter.max]`.
 *
 * The row layout intentionally includes the parameter value under its
 * declared name (`row[parameter.name]`) so animation primitives that key
 * off `frame_field` see it as just another column. Lissajous +
 * `animation.kind: "scrub"` with `frame_field: "t"` therefore composes
 * without any compiler changes.
 */
export interface ParametricDataSpec {
  shape: "function";
  /**
   * Free parameter range + identifier. The identifier is also the
   * column name emitted in the materialized rows; `frame_field: "<name>"`
   * on an animation spec keys directly off it.
   */
  parameter: { name: string; min: number; max: number; samples: number };
  /** Expression for the x-coordinate at each parameter step. */
  xExpr: string;
  /** Expression for the y-coordinate at each parameter step. */
  yExpr: string;
  /**
   * Optional z-coordinate expression. Today's 2D renderer ignores it; a
   * future 3D renderer reads it without a spec rev.
   */
  zExpr?: string;
}

/**
 * One materialized sample row.
 *
 * Scalar form (PR1): `{ x, y, z? }`.
 *
 * Parametric form (PR2): `{ x, y, z?, [parameter.name]: number }` — the
 * parameter column is added under whatever name the spec declared so
 * `animation.frame_field` can reference it.
 *
 * `y` / `x` are `null` when the expression is non-finite at that step
 * (the renderer's line interpolator breaks the path on null — same
 * convention as missing tabular data).
 */
export interface FunctionRow {
  x: number | null;
  y: number | null;
  z?: number | null;
  /** Free parameter value (parametric form only). Keyed under spec.parameter.name. */
  [paramName: string]: number | null | undefined;
}

/**
 * Sample either a scalar or parametric `data.shape: "function"` spec.
 * Dispatches on the presence of `parameter`: when set, traces a
 * parametric curve; otherwise samples `y = f(x)` over `x`.
 *
 * Throws on structural errors (min >= max, samples < 2, samples beyond
 * the {@link MAX_SAMPLES} cap). Per-point non-finite results surface
 * as `null` rather than throwing, so a single hole in the domain
 * (`log(0)`) does not abort the whole render.
 */
export function sampleFunction(
  spec: FunctionDataSpec | ParametricDataSpec,
  evaluator: Evaluator = defaultEvaluator,
): FunctionRow[] {
  if ("parameter" in spec) {
    return sampleParametric(spec, evaluator);
  }
  return sampleScalar(spec, evaluator);
}

/**
 * Scalar path (PR1): sample `spec.expr` at `spec.x.samples` evenly-
 * spaced points across `[spec.x.min, spec.x.max]`.
 */
function sampleScalar(spec: FunctionDataSpec, evaluator: Evaluator): FunctionRow[] {
  validateRange("x", spec.x);

  const rows: FunctionRow[] = [];
  const step = (spec.x.max - spec.x.min) / (spec.x.samples - 1);
  const hasZ = spec.zExpr !== undefined;
  for (let i = 0; i < spec.x.samples; i++) {
    // Endpoints are anchored exactly to spec.x.min / spec.x.max — guards
    // against floating drift accumulating across the loop and shifting
    // snapshot bytes between platforms.
    const x = i === spec.x.samples - 1 ? spec.x.max : spec.x.min + step * i;
    const yRaw = safeEval(evaluator, spec.expr, { x });
    const y = yRaw === null ? null : clampSamplerPrecision(yRaw);
    if (hasZ) {
      // biome-ignore lint/style/noNonNullAssertion: hasZ guards spec.zExpr presence.
      const zRaw = safeEval(evaluator, spec.zExpr!, { x });
      const z = zRaw === null ? null : clampSamplerPrecision(zRaw);
      rows.push({ x, y, z });
    } else {
      rows.push({ x, y });
    }
  }
  return rows;
}

/**
 * Parametric path (PR2): trace `(xExpr(t), yExpr(t))` — optionally with
 * `zExpr(t)` — for `t` stepping evenly across
 * `[parameter.min, parameter.max]`. Emits the parameter value under its
 * declared name as an additional column so animation `frame_field` can
 * key off it.
 *
 * Evaluation order at each step: `xExpr` → `yExpr` → `zExpr` (when set).
 * Pure expressions today; the order is documented so a future stateful
 * evaluator has a stable contract.
 */
function sampleParametric(spec: ParametricDataSpec, evaluator: Evaluator): FunctionRow[] {
  validateRange("parameter", spec.parameter);
  // Disallow x/y/z as parameter names — they collide with the output
  // columns and would silently overwrite them. Keep the error specific
  // so the agent sees exactly what's wrong.
  const paramName = spec.parameter.name;
  if (paramName === "x" || paramName === "y" || paramName === "z") {
    throw new Error(
      `function data: parameter.name "${paramName}" collides with the output column of the same name`,
    );
  }

  const rows: FunctionRow[] = [];
  const step = (spec.parameter.max - spec.parameter.min) / (spec.parameter.samples - 1);
  const hasZ = spec.zExpr !== undefined;
  for (let i = 0; i < spec.parameter.samples; i++) {
    const t = i === spec.parameter.samples - 1 ? spec.parameter.max : spec.parameter.min + step * i;
    const scope = { [paramName]: t };
    const xRaw = safeEval(evaluator, spec.xExpr, scope);
    const yRaw = safeEval(evaluator, spec.yExpr, scope);
    const x = xRaw === null ? null : clampSamplerPrecision(xRaw);
    const y = yRaw === null ? null : clampSamplerPrecision(yRaw);
    if (hasZ) {
      // biome-ignore lint/style/noNonNullAssertion: hasZ guards spec.zExpr presence.
      const zRaw = safeEval(evaluator, spec.zExpr!, scope);
      const z = zRaw === null ? null : clampSamplerPrecision(zRaw);
      rows.push({ x, y, z, [paramName]: t });
    } else {
      rows.push({ x, y, [paramName]: t });
    }
  }
  return rows;
}

/**
 * Shared structural validation for both scalar and parametric ranges.
 * `label` is the channel name surfaced in the error (`"x"` or
 * `"parameter"`) so the agent sees which field is wrong.
 */
function validateRange(
  label: "x" | "parameter",
  range: { min: number; max: number; samples: number },
): void {
  if (!Number.isFinite(range.min) || !Number.isFinite(range.max)) {
    throw new Error(
      `function data: ${label}.min and ${label}.max must be finite (got ${range.min}, ${range.max})`,
    );
  }
  if (range.min >= range.max) {
    throw new Error(
      `function data: ${label}.min (${range.min}) must be < ${label}.max (${range.max})`,
    );
  }
  if (!Number.isInteger(range.samples) || range.samples < 2) {
    throw new Error(
      `function data: ${label}.samples must be an integer >= 2 (got ${range.samples})`,
    );
  }
  if (range.samples > MAX_SAMPLES) {
    throw new Error(
      `function data: ${label}.samples (${range.samples}) exceeds MAX_SAMPLES (${MAX_SAMPLES})`,
    );
  }
}

/**
 * Evaluate `expr` against `scope`, returning `null` when the result is
 * non-finite. Other evaluator errors (parse, unbound identifier) bubble
 * — those are spec-level mistakes the user needs to see, not per-point
 * holes.
 */
function safeEval(
  evaluator: Evaluator,
  expr: string,
  scope: Record<string, number>,
): number | null {
  try {
    return evaluator(expr, scope);
  } catch (e) {
    if (e instanceof EvaluationError && /non-finite/.test(e.message)) {
      return null;
    }
    throw e;
  }
}

/**
 * Clamp a sampler-emitted floating-point value to 12 significant
 * digits so cross-platform libm drift (the last 2–3 bits of `sin /
 * cos / exp / atan2` differ between macOS libm and glibc) doesn't
 * leak into downstream `roundPx` decisions. The `canonicalStringify`
 * precision clamp shipped earlier protects the provenance hash; this
 * clamp protects the rendered path coordinates the same way.
 *
 * 12 sig figs is well above the 8-decimal precision the SVG actually
 * emits (`roundPx` rounds to 1e-8), so the rendered chart is
 * indistinguishable from the un-clamped version — but the value
 * `roundPx` sees is now identical on every platform.
 *
 * Anchored values (endpoints, integer constants) are untouched
 * because `Number.isFinite(v) && Number.isInteger(v)` short-circuits;
 * the clamp only runs on non-integer finites where drift can occur.
 */
export function clampSamplerPrecision(v: number): number {
  if (!Number.isFinite(v)) return v;
  if (Number.isInteger(v)) return v;
  return Number(v.toPrecision(12));
}
