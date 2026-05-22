/**
 * Math Phase 2 Track A PR A3 — `mark: "streamline"`.
 *
 * The vector-field mark (Math PR3) renders discrete arrows at every grid
 * point. A streamline mark INTEGRATES that field into continuous flow
 * lines — the global structure becomes visible at a glance (rotation
 * fields show concentric circles, saddle fields show hyperbolic flow,
 * sources / sinks show radial spokes). It is the visual counterpart of
 * a phase portrait in dynamical systems.
 *
 * --- Compile pipeline ---
 *   1. Read `layer.streamline.{dxdt, dydt}` and compile them via the
 *      shared `expr-eval` evaluator (same backend the function and
 *      trajectory shapes use; same byte-determinism guarantees).
 *   2. Generate seed points — either an evenly-spaced `rows × cols`
 *      grid across the integration domain (`kind: "grid"`) or a
 *      caller-pinned list (`kind: "array"`).
 *   3. For each seed, integrate BOTH FORWARD AND BACKWARD via RK4.
 *      Streamlines are bidirectional curves through the seed; forward
 *      shows where a particle would go, backward shows where it came
 *      from. Termination conditions per direction:
 *        - step budget exhausted (`maxSteps` cap; DoS guard)
 *        - integration left the domain
 *        - derivative evaluated to a non-finite (NaN / +/-Infinity)
 *        - loop detected (the trajectory re-entered a visited cell on
 *          the seed-side cell grid)
 *   4. Each integrated polyline becomes ONE `<path>` SceneMark
 *      (`M x0 y0 L x1 y1 L ... L xN yN`). All coordinates run through
 *      `roundPx`, mirroring the `function` / `trajectory` mark
 *      determinism contract.
 *
 * --- Determinism gates ---
 *   - Same evaluator + same scope → same RK4 step (IEEE-754 stable).
 *   - Seed iteration order is the row-major grid order (or the user's
 *     array order); SceneMarks are emitted in that order so the SVG's
 *     `<path>` tag sequence is byte-identical across runs.
 *   - Loop detection uses an INTEGER cell hash on a `(domain_w / step,
 *     domain_h / step)` grid; pure integer math, no floating drift.
 *
 * --- RK4 step ---
 * Duplicated from `data/shapes/trajectory.ts` rather than refactored
 * into a shared helper — the trajectory snapshot tests are byte-locked
 * to the inlined form, and the integration logic is small enough that
 * a copy is cheaper than risking a cross-file refactor breaking those
 * tests. The autonomous-system path is also slightly different here
 * (no `t`-dependent right-hand-side; pure (x, y) scope), so a unified
 * helper would still need branching.
 */
import { EvaluationError, type Evaluator } from "../../eval/evaluator.js";
import { defaultEvaluator } from "../../eval/expr-eval-adapter.js";
import type { SceneMark } from "../../scenegraph/types.js";
import { type MarkCompileArgs, type MarkCompiler, registerMark } from "../mark-registry.js";
import { roundPx } from "../scales.js";

/** Default RK4 step (data units). Matches the schema default. */
const DEFAULT_STEP = 0.05;
/** Default per-direction iteration cap. Matches the schema default. */
const DEFAULT_MAX_STEPS = 500;
/** Default seed-grid resolution. Matches the schema default. */
const DEFAULT_SEED_ROWS = 5;
const DEFAULT_SEED_COLS = 5;
/**
 * Loop-detection grid resolution in `step` units. A revisited cell
 * within `step * 0.5` distance terminates that direction. We bucket
 * into integer cells of size `step` and stop when a cell is hit twice
 * — the threshold-of-half-a-step ensures a streamline that barely
 * grazes the cell border doesn't trigger a false positive on the
 * first iteration.
 */
const LOOP_CELL_SCALE = 1;

/** Internal RK4 state. */
interface State {
  readonly x: number;
  readonly y: number;
}

/**
 * One RK4 step on an autonomous 2D system (no `t` dependence).
 *
 *   k1 = f(x,           y          )
 *   k2 = f(x + h/2·k1x, y + h/2·k1y)
 *   k3 = f(x + h/2·k2x, y + h/2·k2y)
 *   k4 = f(x + h·k3x,   y + h·k3y  )
 *   x' = x + h/6·(k1x + 2·k2x + 2·k3x + k4x)
 *   y' = y + h/6·(k1y + 2·k2y + 2·k3y + k4y)
 *
 * Returns the new state; non-finite derivatives propagate via NaN so
 * the caller can terminate the streamline.
 */
function rk4Step(evaluator: Evaluator, dxdt: string, dydt: string, state: State, h: number): State {
  const { x, y } = state;
  const k1x = safeEval(evaluator, dxdt, { x, y });
  const k1y = safeEval(evaluator, dydt, { x, y });

  const x2 = x + h * 0.5 * k1x;
  const y2 = y + h * 0.5 * k1y;
  const k2x = safeEval(evaluator, dxdt, { x: x2, y: y2 });
  const k2y = safeEval(evaluator, dydt, { x: x2, y: y2 });

  const x3 = x + h * 0.5 * k2x;
  const y3 = y + h * 0.5 * k2y;
  const k3x = safeEval(evaluator, dxdt, { x: x3, y: y3 });
  const k3y = safeEval(evaluator, dydt, { x: x3, y: y3 });

  const x4 = x + h * k3x;
  const y4 = y + h * k3y;
  const k4x = safeEval(evaluator, dxdt, { x: x4, y: y4 });
  const k4y = safeEval(evaluator, dydt, { x: x4, y: y4 });

  return {
    x: x + (h / 6) * (k1x + 2 * k2x + 2 * k3x + k4x),
    y: y + (h / 6) * (k1y + 2 * k2y + 2 * k3y + k4y),
  };
}

/**
 * Evaluate a derivative expression; on undefined identifier OR
 * non-finite output, return NaN so the integrator terminates cleanly.
 * (Contrast with trajectory.ts which throws — there the spec author
 * gets a hard error because integration is the whole point; here a
 * NaN simply truncates one streamline and we keep going on the others.)
 */
function safeEval(evaluator: Evaluator, expr: string, scope: Record<string, number>): number {
  try {
    return evaluator(expr, scope);
  } catch (e) {
    if (e instanceof EvaluationError) return Number.NaN;
    throw e;
  }
}

/** Read + lightly validate the layer's `streamline` config. */
interface StreamlineConfig {
  readonly dxdt: string;
  readonly dydt: string;
  readonly seeds:
    | { readonly kind: "grid"; readonly rows: number; readonly cols: number }
    | {
        readonly kind: "array";
        readonly points: ReadonlyArray<{ readonly x: number; readonly y: number }>;
      };
  readonly step: number;
  readonly maxSteps: number;
  readonly domain:
    | { readonly x: readonly [number, number]; readonly y: readonly [number, number] }
    | undefined;
  /**
   * RFC 2026-05-23 — per-polyline color mode. `undefined` (the
   * back-compat default) renders every streamline in `theme.fg`;
   * `"angle"` hues each polyline by velocity direction at the seed;
   * `"speed"` varies lightness by velocity magnitude. See schema
   * JSDoc for the full contract. Read defensively in `readConfig`
   * so an unrecognized value (a schema migration that loosened the
   * enum, or a deliberately malformed spec) silently falls back to
   * the default rather than throwing.
   */
  readonly colorBy: "angle" | "speed" | undefined;
}

function readConfig(layer: unknown): StreamlineConfig | undefined {
  if (typeof layer !== "object" || layer === null) return undefined;
  const s = (layer as { streamline?: unknown }).streamline;
  if (typeof s !== "object" || s === null) return undefined;
  const r = s as Record<string, unknown>;
  if (typeof r.dxdt !== "string" || typeof r.dydt !== "string") return undefined;
  if (typeof r.seeds !== "object" || r.seeds === null) return undefined;
  const seedsRaw = r.seeds as Record<string, unknown>;
  let seeds: StreamlineConfig["seeds"];
  if (seedsRaw.kind === "grid") {
    const rows = typeof seedsRaw.rows === "number" ? seedsRaw.rows : DEFAULT_SEED_ROWS;
    const cols = typeof seedsRaw.cols === "number" ? seedsRaw.cols : DEFAULT_SEED_COLS;
    seeds = { kind: "grid", rows, cols };
  } else if (seedsRaw.kind === "array" && Array.isArray(seedsRaw.points)) {
    const points = (seedsRaw.points as ReadonlyArray<{ x: unknown; y: unknown }>)
      .map((p) => ({ x: Number(p.x), y: Number(p.y) }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    if (points.length === 0) return undefined;
    seeds = { kind: "array", points };
  } else {
    return undefined;
  }
  const step = typeof r.step === "number" && r.step > 0 ? r.step : DEFAULT_STEP;
  const maxSteps =
    typeof r.maxSteps === "number" && Number.isInteger(r.maxSteps) && r.maxSteps > 0
      ? r.maxSteps
      : DEFAULT_MAX_STEPS;
  let domain: StreamlineConfig["domain"];
  if (typeof r.domain === "object" && r.domain !== null) {
    const d = r.domain as { x?: unknown; y?: unknown };
    if (Array.isArray(d.x) && Array.isArray(d.y) && d.x.length === 2 && d.y.length === 2) {
      const dx = [Number(d.x[0]), Number(d.x[1])] as const;
      const dy = [Number(d.y[0]), Number(d.y[1])] as const;
      if (
        Number.isFinite(dx[0]) &&
        Number.isFinite(dx[1]) &&
        Number.isFinite(dy[0]) &&
        Number.isFinite(dy[1])
      ) {
        domain = { x: dx, y: dy };
      }
    }
  }
  // RFC 2026-05-23 — only the two recognized enum values pass through;
  // everything else (including undefined, null, or any non-matching
  // string) falls back to the back-compat "no per-polyline coloring"
  // default. Mirrors the defensive readConfig pattern used elsewhere.
  const colorByRaw = r.colorBy;
  const colorBy: StreamlineConfig["colorBy"] =
    colorByRaw === "angle" || colorByRaw === "speed" ? colorByRaw : undefined;
  return { dxdt: r.dxdt, dydt: r.dydt, seeds, step, maxSteps, domain, colorBy };
}

/**
 * Integrate one direction from a seed. `sign` is +1 for forward, -1
 * for backward. Returns the integrated polyline INCLUDING the seed
 * point at index 0. The seed always appears at index 0 so the two
 * directions can be stitched by reversing the backward result and
 * appending the (seedless) forward result.
 */
function integrateDirection(
  evaluator: Evaluator,
  cfg: StreamlineConfig,
  domain: { x: readonly [number, number]; y: readonly [number, number] },
  seed: State,
  sign: 1 | -1,
): State[] {
  const out: State[] = [seed];
  const h = cfg.step * sign;
  // A3 review BLOCKER B1 — loop detection needs to handle slow regions
  // of the field. Previous version used cellSize = step (cellSize 0.05
  // when step=0.05), so for the rotation field's interior where
  // |f| < 1, consecutive states stay in the SAME cell across many
  // steps, and a "revisited cell" check triggers FALSE positives after
  // ~10-20 steps — orbits truncate prematurely.
  //
  // Fix has two parts:
  //   (1) cellSize is sized to a multi-step displacement, not a single
  //       step. We pick `max(step, plotDiagonal × 0.01)` — at least a
  //       small fraction of the integration domain — so a slow-moving
  //       trajectory crosses cell boundaries on the same step count
  //       regardless of field magnitude.
  //   (2) "Loop detected" requires the trajectory to have EXITED the
  //       cell before re-entry. Tracked via `lastCell`. Consecutive
  //       same-cell steps no longer trigger; only a true return to a
  //       cell after a detour does.
  const xSpan = domain.x[1] - domain.x[0];
  const ySpan = domain.y[1] - domain.y[0];
  const domainDiag = Math.sqrt(xSpan * xSpan + ySpan * ySpan);
  const cellSize = Math.max(cfg.step * LOOP_CELL_SCALE, domainDiag * 0.02);
  const cellKey = (s: State): string => {
    const cx = Math.floor((s.x - domain.x[0]) / cellSize);
    const cy = Math.floor((s.y - domain.y[0]) / cellSize);
    return `${cx},${cy}`;
  };
  const visited = new Set<string>();
  let lastCell = cellKey(seed);
  visited.add(lastCell);
  let cur = seed;
  for (let i = 0; i < cfg.maxSteps; i++) {
    const next = rk4Step(evaluator, cfg.dxdt, cfg.dydt, cur, h);
    if (!Number.isFinite(next.x) || !Number.isFinite(next.y)) break;
    if (
      next.x < domain.x[0] ||
      next.x > domain.x[1] ||
      next.y < domain.y[0] ||
      next.y > domain.y[1]
    ) {
      break;
    }
    const key = cellKey(next);
    if (key !== lastCell) {
      // Transitioned to a new cell. If we've been in this cell before,
      // the trajectory is closing back on itself — loop detected.
      if (visited.has(key)) break;
      visited.add(key);
      lastCell = key;
    }
    out.push(next);
    cur = next;
  }
  return out;
}

/** Generate seed points in row-major order. */
function generateSeeds(
  cfg: StreamlineConfig,
  domain: { x: readonly [number, number]; y: readonly [number, number] },
): State[] {
  if (cfg.seeds.kind === "array") {
    return cfg.seeds.points.map((p) => ({ x: p.x, y: p.y }));
  }
  const { rows, cols } = cfg.seeds;
  const [xMin, xMax] = domain.x;
  const [yMin, yMax] = domain.y;
  const seeds: State[] = [];
  // Inset seeds by half a cell on each side so a grid against the
  // exact domain edge isn't immediately clipped on its first step.
  const dx = (xMax - xMin) / (cols + 1);
  const dy = (yMax - yMin) / (rows + 1);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      seeds.push({ x: xMin + dx * (c + 1), y: yMin + dy * (r + 1) });
    }
  }
  return seeds;
}

export const streamlineMarkCompiler: MarkCompiler = {
  type: "streamline",
  compile(args: MarkCompileArgs): void {
    const { xScale, yScale, theme, out, layer } = args;
    if (!yScale) return;
    // Streamlines need numeric x/y; band scales (categorical) make
    // no physical sense for a continuous flow field.
    if (xScale.type !== "linear") return;

    const cfg = readConfig(layer);
    if (!cfg) return;

    // Domain resolution: explicit streamline.domain WINS; otherwise
    // fall back to the resolved x/y scale domains. The scale-domain
    // fallback means a fixture that sets `encoding.x.scale.domain`
    // gets exactly the streamline integration extent it asked for
    // (assuming the scale path honors it OR the rows in the test
    // anchor the same range).
    const domain: { x: readonly [number, number]; y: readonly [number, number] } = cfg.domain ?? {
      x: xScale.domain as readonly [number, number],
      y: yScale.domain as readonly [number, number],
    };
    if (
      !Number.isFinite(domain.x[0]) ||
      !Number.isFinite(domain.x[1]) ||
      !Number.isFinite(domain.y[0]) ||
      !Number.isFinite(domain.y[1])
    ) {
      // Degenerate domain (e.g. empty rows + no streamline.domain).
      // Skip silently — the user can either supply rows that anchor
      // the scale OR set streamline.domain explicitly.
      return;
    }

    const defaultStroke = theme.fg;
    const evaluator: Evaluator = defaultEvaluator;
    const seeds = generateSeeds(cfg, domain);

    // RFC 2026-05-23 — bind narrowed locals so the closure below sees
    // a typed value (TS widens captured outer-scope vars back to the
    // declared type, so `cfg.colorBy` inside `strokeFor` would
    // otherwise resolve as `string | undefined` even after the
    // `if (!cfg) return;` guard up above).
    const colorBy = cfg.colorBy;
    const dxdtExpr = cfg.dxdt;
    const dydtExpr = cfg.dydt;

    // `colorBy: "speed"` normalizes each polyline's lightness against
    // the max speed observed across ALL seeds. We pre-pass once so
    // each seed's stroke is computable in isolation (no second pass).
    // Cheap: one evaluator pair per seed at typical 5×5..6×6 grids.
    let maxSpeed = 1; // sentinel — `1` avoids div-by-zero on a still field
    if (colorBy === "speed") {
      let observed = 0;
      for (const s of seeds) {
        const vx = safeEval(evaluator, dxdtExpr, { x: s.x, y: s.y });
        const vy = safeEval(evaluator, dydtExpr, { x: s.x, y: s.y });
        const sp = Math.hypot(vx, vy);
        if (Number.isFinite(sp) && sp > observed) observed = sp;
      }
      if (observed > 0) maxSpeed = observed;
    }

    /**
     * Per-seed stroke selector. `colorBy: undefined` → theme.fg
     * (every polyline same color, back-compat). `"angle"` → hue from
     * atan2(vy, vx) — direction-of-flow visualization. `"speed"` →
     * fixed blue with lightness scaling from |v| / maxSpeed. Both
     * round to one-decimal-place via `.toFixed(1)` so the SVG bytes
     * stay platform-stable (atan2/hypot are libm-dependent past ~14
     * sig figs and `canonicalStringify`'s 14-sig-fig clamp doesn't
     * touch already-emitted SVG strings; the toFixed(1) does).
     */
    function strokeFor(seed: { readonly x: number; readonly y: number }): string {
      if (!colorBy) return defaultStroke;
      const vx = safeEval(evaluator, dxdtExpr, { x: seed.x, y: seed.y });
      const vy = safeEval(evaluator, dydtExpr, { x: seed.x, y: seed.y });
      if (!Number.isFinite(vx) || !Number.isFinite(vy)) return defaultStroke;
      if (colorBy === "angle") {
        const deg = ((Math.atan2(vy, vx) * 180) / Math.PI + 360) % 360;
        return `hsl(${deg.toFixed(1)},70%,55%)`;
      }
      // "speed"
      const sp = Math.min(1, Math.hypot(vx, vy) / maxSpeed);
      const light = (30 + sp * 50).toFixed(1); // 30% .. 80% lightness
      return `hsl(210,70%,${light}%)`;
    }

    // A3 review IMPORTANT-1 — preflight the evaluator on the first
    // seed so an unparseable expression (e.g. dxdt: "xyz(") or an
    // unbound identifier surfaces as a fatal error with location,
    // not as a silent empty-SVG. After this check the integration
    // loop can keep its NaN-on-failure swallowing behavior (which
    // is the right policy mid-trajectory for divergent ODEs).
    if (seeds.length > 0) {
      // The `seeds.length > 0` guard above proves seeds[0] is defined,
      // but biome's `noNonNullAssertion` rule can't see flow-narrowed
      // proofs. Pull the value through a defensive check + bail rather
      // than `seeds[0]!` so the rule stays on globally.
      const probe = seeds[0];
      if (!probe) throw new Error("streamline: internal — seed expected but missing");
      try {
        evaluator(cfg.dxdt, { x: probe.x, y: probe.y });
        evaluator(cfg.dydt, { x: probe.x, y: probe.y });
      } catch (e) {
        if (e instanceof EvaluationError) {
          throw new Error(`streamline data: derivative failed to evaluate — ${e.message}`);
        }
        throw e;
      }
    }

    for (const seed of seeds) {
      // Backward (sign=-1) + forward (sign=+1); reverse the backward
      // result so the path reads from "past" through "seed" to "future".
      const back = integrateDirection(evaluator, cfg, domain, seed, -1);
      const fwd = integrateDirection(evaluator, cfg, domain, seed, 1);
      // back includes seed; drop the seed from fwd (idx 0) so the
      // stitched polyline doesn't duplicate it.
      const polyline = [...back.reverse(), ...fwd.slice(1)];
      if (polyline.length < 2) continue;

      // Build the SVG path's `d` attribute. Each (x, y) maps through
      // the resolved scale then `roundPx` for byte stability.
      let d = "";
      // A3 review BLOCKER B2 — a seed at a fixed point of the field
      // (e.g. (0, 0) for dx/dt=-y, dy/dt=x) produces tiny non-zero
      // RK4 wobble in data space, which roundPx collapses to the
      // SAME pixel. The polyline survives the `length < 2` check
      // because it has many states, but renders zero ink and bloats
      // the SVG with `M 336 192 L 336 192 L 336 192 ...`. Track
      // unique rounded points; skip the path when all rounded coords
      // collapse to a single point.
      const uniquePixels = new Set<string>();
      for (let i = 0; i < polyline.length; i++) {
        const p = polyline[i];
        if (!p) continue;
        const px = roundPx(xScale.apply(p.x));
        const py = roundPx(yScale.apply(p.y));
        if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
        uniquePixels.add(`${px},${py}`);
        d += `${i === 0 ? "M" : "L"} ${px} ${py} `;
      }
      const dTrim = d.trim();
      if (dTrim.length === 0) continue;
      if (uniquePixels.size < 2) continue; // degenerate (fixed-point seed)

      const path: SceneMark = {
        type: "path",
        d: dTrim,
        // RFC 2026-05-23 — `strokeFor(seed)` returns either
        // `theme.fg` (back-compat, single color) or an `hsl(...)`
        // string computed from the velocity at the seed.
        stroke: strokeFor(seed),
        strokeWidth: 1.2,
        fill: "none",
      };
      out.push(path);
    }
  },
};

registerMark(streamlineMarkCompiler);
