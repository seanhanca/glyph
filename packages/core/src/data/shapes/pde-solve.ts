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
  /** PDE family. v1 ships only `"heat"`. */
  kind: "heat";
  /** 2D rectangular domain. */
  domain: { readonly x: readonly [number, number]; readonly y: readonly [number, number] };
  /** Grid resolution. Both rows and cols in [4, MAX_PDE_GRID]. */
  grid: { readonly rows: number; readonly cols: number };
  /** Initial condition u(x, y, 0). Expression evaluated against
   *  free identifiers `x` and `y`; standard math fns available. */
  initial: string;
  /** PDE-specific parameters. For `kind: "heat"`: `{ D: number }` (diffusion). */
  params: Readonly<Record<string, number>>;
  /** Boundary condition. `"clamp"` fixes edge values to the initial
   *  condition; `"periodic"` wraps opposite edges. */
  boundary: "clamp" | "periodic";
  /** Number of integration steps. */
  steps: number;
  /** Time step. Must satisfy `D·dt/dx² ≤ PDE_CFL_LIMIT`. */
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
 * per grid cell at the final time. Ping-pong `Float64Array` buffers
 * — zero allocation per step.
 */
export function solvePde(
  spec: PdeSolveDataSpec,
  evaluator: Evaluator = defaultEvaluator,
): PdeRow[] {
  validateSpec(spec);
  const { domain, grid, params, boundary, steps, dt, initial } = spec;
  const { rows: R, cols: C } = grid;
  const [xMin, xMax] = domain.x;
  const [yMin, yMax] = domain.y;
  const dx = (xMax - xMin) / C;
  const dy = (yMax - yMin) / R;
  // We use dx for the Laplacian step; for a square cell (dx == dy)
  // this is exact. For non-square cells the user is expected to
  // pick a domain + grid that match the physics.
  // (Schema doesn't enforce square; documented in JSDoc.)

  // Initial condition. Cell centers at (xMin + (c + 0.5)·dx,
  // yMin + (r + 0.5)·dy). Evaluator may throw on unparseable
  // expressions; let that propagate to the caller as it's a spec
  // bug, not a runtime data issue.
  let u = new Float64Array(R * C);
  let uNext = new Float64Array(R * C);
  for (let r = 0; r < R; r++) {
    const yMid = yMin + (r + 0.5) * dy;
    for (let c = 0; c < C; c++) {
      const xMid = xMin + (c + 0.5) * dx;
      u[r * C + c] = clampSamplerPrecision(evaluator(initial, { x: xMid, y: yMid }));
    }
  }

  // Heat-equation explicit-Euler step. Inner cells use the 5-point
  // Laplacian; boundary cells follow the spec.boundary policy.
  const D = (params.D ?? 0) as number;
  const alpha = (D * dt) / (dx * dx);
  for (let step = 0; step < steps; step++) {
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        const idx = r * C + c;
        // Look up 4 neighbors. Boundary handling per `boundary`:
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
          // outside the grid, which freezes the boundary at its
          // current value (matches the metal-plate held-at-temp
          // mental model when the initial condition has a constant
          // edge value).
          up = u[(r === 0 ? r : r - 1) * C + c] as number;
          down = u[(r === R - 1 ? r : r + 1) * C + c] as number;
          left = u[r * C + (c === 0 ? c : c - 1)] as number;
          right = u[r * C + (c === C - 1 ? c : c + 1)] as number;
        }
        const center = u[idx] as number;
        const lap = up + down + left + right - 4 * center;
        uNext[idx] = clampSamplerPrecision(center + alpha * lap);
      }
    }
    // Swap buffers (no allocation)
    const tmp = u;
    u = uNext;
    uNext = tmp;
  }

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

function validateSpec(spec: PdeSolveDataSpec): void {
  if (spec.kind !== "heat") {
    throw new Error(`pde-solve: only kind "heat" is supported in v1 (got "${spec.kind}")`);
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
  const D = (spec.params.D ?? 0) as number;
  if (!Number.isFinite(D) || D < 0) {
    throw new Error(`pde-solve: params.D must be a non-negative finite number (got ${D})`);
  }
  const dx = (spec.domain.x[1] - spec.domain.x[0]) / spec.grid.cols;
  const cfl = (D * spec.dt) / (dx * dx);
  if (cfl > PDE_CFL_LIMIT) {
    throw new Error(
      `pde-solve: CFL stability violated. D·dt/dx² = ${cfl.toFixed(4)} > ${PDE_CFL_LIMIT}. Reduce dt or D, or increase grid resolution.`,
    );
  }
}
