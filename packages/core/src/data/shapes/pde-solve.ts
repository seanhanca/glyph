/**
 * `data.shape: "pde-solve"` sampler — RFC 2026-05-22, extension #4.
 *
 * Solves a 2D partial differential equation on a fixed grid via
 * finite-difference integration and emits one row per cell. The
 * v1 scope is **`kind: "heat"`** — the simplest, most numerically
 * stable PDE in the joy.html demo set. Wave + reaction-diffusion
 * follow in v2 (their stability characteristics are trickier and
 * justify their own PR).
 *
 * ### The heat equation
 *
 *     ∂u/∂t = D · ∇²u
 *
 * Models diffusion: temperature on a metal plate, ink spreading in
 * water, smoke in air. Numerically integrated via explicit forward
 * Euler with a 5-point Laplacian stencil:
 *
 *     u_new[i,j] = u[i,j] + D·dt · (u[i+1,j] + u[i-1,j]
 *                                  + u[i,j+1] + u[i,j-1] − 4·u[i,j]) / dx²
 *
 * **CFL stability:** explicit Euler is unconditionally stable IFF
 * `D·dt / dx² ≤ 0.25`. The schema validates this; an unstable spec
 * is rejected up front with an actionable error.
 *
 * ### Spec shape
 *
 * ```jsonc
 * {
 *   "data": {
 *     "pde_solve": {
 *       "shape": "pde-solve",
 *       "kind": "heat",
 *       "domain": { "x": [-1, 1], "y": [-1, 1] },
 *       "grid": { "rows": 64, "cols": 64 },
 *       "initial": "exp(-50*(x*x + y*y))",
 *       "params": { "D": 0.1 },
 *       "boundary": "clamp",
 *       "steps": 200,
 *       "dt": 0.001
 *     }
 *   },
 *   "layers": [{ "mark": "heatmap",
 *                "encoding": { "x": "x", "y": "y", "color": "u" } }]
 * }
 * ```
 *
 * ### Output schema
 *
 * `[x (DOUBLE), y (DOUBLE), u (DOUBLE)]` — exactly `rows × cols`
 * rows after running the PDE forward `steps` time-steps. Cell
 * centers are at `(xMin + (i + 0.5)·dx, yMin + (j + 0.5)·dy)`.
 *
 * ### Determinism
 *
 * `clampSamplerPrecision` is applied per cell on each emitted row.
 * The interior of the solver runs on `Float64Array` ping-pong
 * buffers without allocation per step; explicit Euler is purely
 * arithmetic (no transcendentals beyond `exp`/`sin`/etc. in the
 * initial-condition expression, which goes through the standard
 * `expr-eval` evaluator with its own precision contract). Same
 * spec → byte-identical rows on every platform.
 */

import type { Evaluator } from "../../eval/evaluator.js";
import { defaultEvaluator } from "../../eval/expr-eval-adapter.js";
import { clampSamplerPrecision } from "./function.js";

/** Maximum grid resolution. Cost is rows · cols · steps; cap exists
 *  so a malformed spec can't DoS the renderer. 256·256·1000 = 65 M
 *  cell-updates ≈ a few seconds in JS. */
export const MAX_PDE_GRID = 256;
/** Maximum integration extent. Per-cell cost = steps. */
export const MAX_PDE_STEPS = 1_000;
/** CFL stability ceiling for the explicit-Euler heat scheme. */
export const PDE_CFL_LIMIT = 0.25;

export interface PdeSolveDataSpec {
  shape: "pde-solve";
  /**
   * PDE family. v1 shipped `"heat"`; v2 adds `"wave"` (2nd-order in
   * time, leapfrog scheme, CFL `c·dt/dx ≤ 1`) and
   * `"reaction-diffusion"` (Gray-Scott two-species coupled system,
   * `max(Du,Dv)·dt/dx² ≤ 0.25`).
   */
  kind: "heat" | "wave" | "reaction-diffusion";
  /** 2D rectangular domain. */
  domain: { readonly x: readonly [number, number]; readonly y: readonly [number, number] };
  /** Grid resolution. Both rows and cols in [4, MAX_PDE_GRID]. */
  grid: { readonly rows: number; readonly cols: number };
  /**
   * Initial condition u(x, y, 0). Expression in `x`, `y`.
   * For `kind: "heat"` and `kind: "wave"`: u at t=0.
   * For `kind: "reaction-diffusion"`: ignored; use `initial_U` /
   * `initial_V` instead. (Kept on the spec so heat / wave / RD
   * share one parse path; an empty string is rejected by validation.)
   */
  initial: string;
  /**
   * Wave-only: initial ∂u/∂t(x, y, 0). Optional; defaults to "0" —
   * "stone dropped into still water" mental model. Used to synthesize
   * `u_prev = u_initial - dt · velocity` for the first leapfrog step.
   */
  initial_velocity?: string;
  /**
   * RD-only: initial U(x, y, 0). Optional; defaults to "1" — full
   * fuel tank everywhere.
   */
  initial_U?: string;
  /**
   * RD-only: initial V(x, y, 0). Optional; defaults to a small
   * Gaussian seed at the center: `exp(-30*(x*x + y*y)) * 0.25`.
   * Pattern requires at least some V > 0 to bootstrap; an
   * all-zero V stays uniformly empty.
   */
  initial_V?: string;
  /**
   * PDE-specific parameters.
   *   - `kind: "heat"`: `{ D: number }` (diffusion).
   *   - `kind: "wave"`: `{ c: number, gamma?: number }` (wave speed,
   *     optional damping).
   *   - `kind: "reaction-diffusion"`: `{ Du, Dv, F, k: number }`
   *     (diffusion coefficients + feed + kill rates).
   */
  params: Readonly<Record<string, number>>;
  /** Boundary condition. `"clamp"` fixes edge values to the initial
   *  condition; `"periodic"` wraps opposite edges. */
  boundary: "clamp" | "periodic";
  /** Number of integration steps. */
  steps: number;
  /** Time step. CFL constraint depends on `kind` — see schema. */
  dt: number;
}

/** One materialized PDE row. Schema: [x, y, u]. */
export interface PdeRow {
  readonly x: number;
  readonly y: number;
  readonly u: number;
}

/**
 * Solve the PDE forward `spec.steps` time-steps and emit one row
 * per grid cell at the final time. Dispatches to a per-kind solver
 * (heat / wave / reaction-diffusion). All variants share the grid
 * setup, the 4-neighbor lookup helper, and the final row-emission
 * code so the per-kind code is just the update math.
 */
export function solvePde(
  spec: PdeSolveDataSpec,
  evaluator: Evaluator = defaultEvaluator,
): PdeRow[] {
  validateSpec(spec);
  const { domain, grid, boundary } = spec;
  const { rows: R, cols: C } = grid;
  const [xMin, xMax] = domain.x;
  const [yMin, yMax] = domain.y;
  const dx = (xMax - xMin) / C;
  const dy = (yMax - yMin) / R;
  // We use dx for the Laplacian step; for a square cell (dx == dy)
  // this is exact. For non-square cells the user is expected to
  // pick a domain + grid that match the physics.

  // Evaluate a (x, y) → number expression over every cell center,
  // returning a Float64Array indexed row-major.
  function gridFromExpression(expr: string): Float64Array {
    const buf = new Float64Array(R * C);
    for (let r = 0; r < R; r++) {
      const yMid = yMin + (r + 0.5) * dy;
      for (let c = 0; c < C; c++) {
        const xMid = xMin + (c + 0.5) * dx;
        buf[r * C + c] = clampSamplerPrecision(evaluator(expr, { x: xMid, y: yMid }));
      }
    }
    return buf;
  }

  // Final grid for the row-emission pass. Set by whichever per-kind
  // solver runs below. Wave + heat populate `final`; RD populates it
  // from the V species (the visually-striking one).
  let final: Float64Array;
  if (spec.kind === "heat") {
    final = solveHeat(spec, gridFromExpression, R, C, dx, boundary);
  } else if (spec.kind === "wave") {
    final = solveWave(spec, gridFromExpression, R, C, dx, boundary);
  } else {
    // reaction-diffusion
    final = solveReactionDiffusion(spec, gridFromExpression, R, C, dx, boundary);
  }
  const u = final;

  // Emit rows in (r, c) order — row-major. Mark compilers (heatmap)
  // consume each row independently so order doesn't affect output,
  // but a stable order is documented for any future visualization
  // that cares.
  const out: PdeRow[] = new Array(R * C);
  for (let r = 0; r < R; r++) {
    const yMid = yMin + (r + 0.5) * dy;
    for (let c = 0; c < C; c++) {
      const xMid = xMin + (c + 0.5) * dx;
      out[r * C + c] = {
        x: clampSamplerPrecision(xMid),
        y: clampSamplerPrecision(yMid),
        u: u[r * C + c] as number,
      };
    }
  }
  return out;
}

/**
 * 5-point Laplacian neighbor lookup with periodic-or-clamp boundary
 * handling. Pure helper shared by all three solvers; inlined manually
 * in hot loops would be faster, but the V8 inliner handles this well
 * enough and the deduplication helps reviewers.
 *
 * Returns the sum of the four neighbors (up + down + left + right);
 * caller subtracts `4 * center` to complete the discrete Laplacian.
 */
function neighborSum(
  u: Float64Array,
  r: number,
  c: number,
  R: number,
  C: number,
  boundary: "clamp" | "periodic",
): number {
  let up: number;
  let down: number;
  let left: number;
  let right: number;
  if (boundary === "periodic") {
    up = u[((r - 1 + R) % R) * C + c] as number;
    down = u[((r + 1) % R) * C + c] as number;
    left = u[r * C + ((c - 1 + C) % C)] as number;
    right = u[r * C + ((c + 1) % C)] as number;
  } else {
    // clamp: edge cells read their own value as the "neighbor"
    // outside the grid, freezing the boundary at its current value.
    up = u[(r === 0 ? r : r - 1) * C + c] as number;
    down = u[(r === R - 1 ? r : r + 1) * C + c] as number;
    left = u[r * C + (c === 0 ? c : c - 1)] as number;
    right = u[r * C + (c === C - 1 ? c : c + 1)] as number;
  }
  return up + down + left + right;
}

/**
 * Heat-equation solver. Explicit forward Euler:
 *     u_new = u + α·(∇²u),   α = D·dt/dx²
 * where ∇²u uses the 5-point stencil. Stable when α ≤ 0.25 (the
 * schema check; if it slips through, the integration diverges
 * gracefully but the snapshot still emits).
 */
function solveHeat(
  spec: PdeSolveDataSpec,
  gridFromExpr: (expr: string) => Float64Array,
  R: number,
  C: number,
  dx: number,
  boundary: "clamp" | "periodic",
): Float64Array {
  // Bind both buffers with the same ArrayBufferLike type parameter
  // so the ping-pong swap below typechecks. (TS 5.x parameterizes
  // Float64Array by buffer kind; new Float64Array(n) gives
  // ArrayBuffer, but gridFromExpr's return is ArrayBufferLike.
  // Declaring both as the wider Float64Array<ArrayBufferLike>
  // unifies them for the swap.)
  let u: Float64Array<ArrayBufferLike> = gridFromExpr(spec.initial);
  let uNext: Float64Array<ArrayBufferLike> = new Float64Array(R * C);
  const D = (spec.params.D ?? 0) as number;
  const alpha = (D * spec.dt) / (dx * dx);
  for (let step = 0; step < spec.steps; step++) {
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        const idx = r * C + c;
        const center = u[idx] as number;
        const sum = neighborSum(u, r, c, R, C, boundary);
        uNext[idx] = clampSamplerPrecision(center + alpha * (sum - 4 * center));
      }
    }
    const tmp = u;
    u = uNext;
    uNext = tmp;
  }
  return u;
}

/**
 * Wave-equation solver via leapfrog scheme.
 *
 *     u_new = 2·u − u_prev + β·∇²u − γ·dt·(u − u_prev)
 *     β = (c·dt/dx)²    (CFL stable when β ≤ 1)
 *
 * Two state buffers (`u` current, `uPrev` previous step). Initial
 * `u_prev` is synthesized from the optional `initial_velocity`
 * expression — defaults to a still field (`u_prev = u`) so a
 * standalone Gaussian initial condition just sits there until the
 * Laplacian kicks it into motion.
 */
function solveWave(
  spec: PdeSolveDataSpec,
  gridFromExpr: (expr: string) => Float64Array,
  R: number,
  C: number,
  dx: number,
  boundary: "clamp" | "periodic",
): Float64Array {
  let u: Float64Array<ArrayBufferLike> = gridFromExpr(spec.initial);
  const v0 = gridFromExpr(spec.initial_velocity ?? "0");
  // u_prev = u - dt · velocity (backward-Euler-ish guess for the
  // step before t=0). Synthesized so the leapfrog has both inputs
  // it needs to take its first step.
  let uPrev: Float64Array<ArrayBufferLike> = new Float64Array(R * C);
  for (let i = 0; i < R * C; i++) {
    uPrev[i] = (u[i] as number) - spec.dt * (v0[i] as number);
  }
  let uNext: Float64Array<ArrayBufferLike> = new Float64Array(R * C);
  const c2 = ((spec.params.c ?? 1) as number) ** 2;
  const beta = (c2 * spec.dt * spec.dt) / (dx * dx);
  const gammaDt = ((spec.params.gamma ?? 0) as number) * spec.dt;
  for (let step = 0; step < spec.steps; step++) {
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        const idx = r * C + c;
        const center = u[idx] as number;
        const prev = uPrev[idx] as number;
        const sum = neighborSum(u, r, c, R, C, boundary);
        const lap = sum - 4 * center;
        uNext[idx] = clampSamplerPrecision(
          2 * center - prev + beta * lap - gammaDt * (center - prev),
        );
      }
    }
    // Triple-swap: u_prev ← u, u ← u_next, u_next ← (recycled) u_prev
    const tmp = uPrev;
    uPrev = u;
    u = uNext;
    uNext = tmp;
  }
  return u;
}

/**
 * Gray-Scott reaction-diffusion solver. Two coupled species U and
 * V on the same grid:
 *
 *     ∂U/∂t = Dᵤ·∇²U − UV² + F·(1 − U)
 *     ∂V/∂t = Dᵥ·∇²V + UV² − (F + k)·V
 *
 * `params.{Du, Dv, F, k}` parameterize the system. (`F, k)`
 * combinations produce wildly different patterns: leopard spots,
 * zebra stripes, coral worms. Returns the V grid — V is the
 * species that produces the visually-striking pattern.
 */
function solveReactionDiffusion(
  spec: PdeSolveDataSpec,
  gridFromExpr: (expr: string) => Float64Array,
  R: number,
  C: number,
  dx: number,
  boundary: "clamp" | "periodic",
): Float64Array {
  let U: Float64Array<ArrayBufferLike> = gridFromExpr(spec.initial_U ?? "1");
  let V: Float64Array<ArrayBufferLike> = gridFromExpr(
    spec.initial_V ?? "exp(-30*(x*x + y*y)) * 0.25",
  );
  let Unext: Float64Array<ArrayBufferLike> = new Float64Array(R * C);
  let Vnext: Float64Array<ArrayBufferLike> = new Float64Array(R * C);
  const Du = (spec.params.Du ?? 1.0) as number;
  const Dv = (spec.params.Dv ?? 0.5) as number;
  const F = (spec.params.F ?? 0.055) as number;
  const k = (spec.params.k ?? 0.062) as number;
  const dt = spec.dt;
  const dxSq = dx * dx;
  for (let step = 0; step < spec.steps; step++) {
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        const idx = r * C + c;
        const u = U[idx] as number;
        const v = V[idx] as number;
        const lapU = (neighborSum(U, r, c, R, C, boundary) - 4 * u) / dxSq;
        const lapV = (neighborSum(V, r, c, R, C, boundary) - 4 * v) / dxSq;
        const uvv = u * v * v;
        Unext[idx] = clampSamplerPrecision(u + dt * (Du * lapU - uvv + F * (1 - u)));
        Vnext[idx] = clampSamplerPrecision(v + dt * (Dv * lapV + uvv - (F + k) * v));
      }
    }
    const tU = U;
    U = Unext;
    Unext = tU;
    const tV = V;
    V = Vnext;
    Vnext = tV;
  }
  return V;
}

function validateSpec(spec: PdeSolveDataSpec): void {
  if (spec.kind !== "heat" && spec.kind !== "wave" && spec.kind !== "reaction-diffusion") {
    throw new Error(
      `pde-solve: kind must be "heat", "wave", or "reaction-diffusion" (got "${spec.kind}")`,
    );
  }
  if (
    !Number.isFinite(spec.domain.x[0]) ||
    !Number.isFinite(spec.domain.x[1]) ||
    !Number.isFinite(spec.domain.y[0]) ||
    !Number.isFinite(spec.domain.y[1])
  ) {
    throw new Error("pde-solve: domain endpoints must be finite");
  }
  if (spec.domain.x[0] >= spec.domain.x[1] || spec.domain.y[0] >= spec.domain.y[1]) {
    throw new Error("pde-solve: domain.x.min < .max and domain.y.min < .max required");
  }
  if (!Number.isInteger(spec.grid.rows) || spec.grid.rows < 4 || spec.grid.rows > MAX_PDE_GRID) {
    throw new Error(`pde-solve: grid.rows must be integer in [4, ${MAX_PDE_GRID}]`);
  }
  if (!Number.isInteger(spec.grid.cols) || spec.grid.cols < 4 || spec.grid.cols > MAX_PDE_GRID) {
    throw new Error(`pde-solve: grid.cols must be integer in [4, ${MAX_PDE_GRID}]`);
  }
  if (typeof spec.initial !== "string" || spec.initial.length === 0) {
    throw new Error("pde-solve: initial must be a non-empty expression string");
  }
  if (spec.boundary !== "clamp" && spec.boundary !== "periodic") {
    throw new Error(`pde-solve: boundary must be "clamp" or "periodic" (got "${spec.boundary}")`);
  }
  if (!Number.isInteger(spec.steps) || spec.steps < 1 || spec.steps > MAX_PDE_STEPS) {
    throw new Error(`pde-solve: steps must be integer in [1, ${MAX_PDE_STEPS}]`);
  }
  if (!Number.isFinite(spec.dt) || spec.dt <= 0) {
    throw new Error(`pde-solve: dt must be a positive finite number (got ${spec.dt})`);
  }
  const dx = (spec.domain.x[1] - spec.domain.x[0]) / spec.grid.cols;

  // Per-kind CFL stability. Heat is the explicit-Euler Laplacian:
  // D·dt/dx² ≤ 0.25. Wave is the leapfrog: c·dt/dx ≤ 1. RD has two
  // diffusion coefficients; bound by max(Du, Dv).
  if (spec.kind === "heat") {
    const D = (spec.params.D ?? 0) as number;
    if (!Number.isFinite(D) || D < 0) {
      throw new Error(`pde-solve: params.D must be a non-negative finite number (got ${D})`);
    }
    const cfl = (D * spec.dt) / (dx * dx);
    if (cfl > PDE_CFL_LIMIT) {
      throw new Error(
        `pde-solve: CFL stability violated (heat). D·dt/dx² = ${cfl.toFixed(4)} > ${PDE_CFL_LIMIT}. Reduce dt or D, or increase grid resolution.`,
      );
    }
  } else if (spec.kind === "wave") {
    const c = (spec.params.c ?? 1) as number;
    if (!Number.isFinite(c) || c <= 0) {
      throw new Error(`pde-solve: params.c must be a positive finite number (got ${c})`);
    }
    const cfl = (c * spec.dt) / dx;
    if (cfl > 1) {
      throw new Error(
        `pde-solve: CFL stability violated (wave). c·dt/dx = ${cfl.toFixed(4)} > 1. Reduce dt or c, or increase grid resolution.`,
      );
    }
    const gamma = (spec.params.gamma ?? 0) as number;
    if (!Number.isFinite(gamma) || gamma < 0) {
      throw new Error(
        `pde-solve: params.gamma must be a non-negative finite number (got ${gamma})`,
      );
    }
  } else {
    // reaction-diffusion
    const Du = (spec.params.Du ?? 1.0) as number;
    const Dv = (spec.params.Dv ?? 0.5) as number;
    const F = (spec.params.F ?? 0.055) as number;
    const k = (spec.params.k ?? 0.062) as number;
    for (const [name, v] of [
      ["Du", Du],
      ["Dv", Dv],
      ["F", F],
      ["k", k],
    ] as const) {
      if (!Number.isFinite(v) || v < 0) {
        throw new Error(
          `pde-solve: params.${name} must be a non-negative finite number (got ${v})`,
        );
      }
    }
    const cfl = (Math.max(Du, Dv) * spec.dt) / (dx * dx);
    if (cfl > PDE_CFL_LIMIT) {
      throw new Error(
        `pde-solve: CFL stability violated (RD). max(Du,Dv)·dt/dx² = ${cfl.toFixed(4)} > ${PDE_CFL_LIMIT}. Reduce dt or diffusion coefficients, or increase grid resolution.`,
      );
    }
  }
}
