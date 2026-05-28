/**
 * Glyph spec — Zod schemas.
 *
 * Source of truth for the wire format. The TypeScript types in `./types.ts`
 * are derived from these schemas via `z.infer`.
 *
 * The schemas are written defensively: every union has clear discriminators,
 * every optional field has a documented default, and unknown keys are
 * rejected (`strict()`) so agents get fast, specific errors instead of
 * silently-ignored typos.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Data source
// ---------------------------------------------------------------------------

export const DataFormatSchema = z.enum(["parquet", "csv", "json", "arrow"]);

/**
 * PR67 — D3 Gap 2: hierarchical data shape. A recursive `{ name, value?,
 * children?[] }` tree. Compiled by the layout module (treemap / sunburst /
 * partition) — not materialized through DuckDB. Inline-only in v0;
 * file-based hierarchical sources can land later via `data.source` +
 * `data.shape: "hierarchy"` if a use-case demands it.
 *
 * `value` is required at the leaves; interior nodes inherit
 * sum-of-children values (D3.hierarchy semantics).
 */
// biome-ignore lint/suspicious/noExplicitAny: zod recursive schemas need 'any'.
export const HierarchyNodeSchema: z.ZodType<any> = z.lazy(() =>
  z
    .object({
      name: z.string().min(1),
      value: z.number().nonnegative().optional(),
      children: z.array(HierarchyNodeSchema).optional(),
    })
    .strict(),
);

/**
 * PR75 — D3 Gap 4: 2D scalar-field grid for contour / density viz.
 * `values` is row-major: cell (r, c) = values[r * cols + c]. Combine
 * with `mark: "contour"` + `thresholds` to render isolines.
 */
export const GridDataSchema = z
  .object({
    rows: z.number().int().min(2),
    cols: z.number().int().min(2),
    // Each value must be finite — NaN sneaks through `z.number()` and
    // would non-deterministically reorder the median sort (PR75 review).
    values: z.array(z.number().refine(Number.isFinite, "grid values must be finite")).min(4),
  })
  .strict()
  .refine(
    (g) => g.values.length === g.rows * g.cols,
    (g) => ({
      message: `grid.values.length must equal rows*cols (${g.rows * g.cols}), got ${g.values.length}`,
    }),
  );

/**
 * PR68 — D3 Gap 5: graph data shape. Inline node/edge list for the
 * force-directed layout. Nodes carry a stable `id`; edges reference
 * those ids. The `seed` field (set on the spec, not here) is what
 * makes the layout deterministic.
 */
export const GraphDataSchema = z
  .object({
    nodes: z
      .array(
        z
          .object({
            id: z.string().min(1),
            /** Optional pre-computed coordinates; defaults to seeded random. */
            x: z.number().optional(),
            y: z.number().optional(),
            r: z.number().positive().optional(),
            /** Optional categorical group used for color encoding. */
            group: z.string().optional(),
          })
          .strict(),
      )
      .min(1),
    edges: z
      .array(
        z
          .object({
            source: z.string().min(1),
            target: z.string().min(1),
            /** Optional per-edge rest length (default 60px). */
            distance: z.number().positive().optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

/**
 * Tier-2 — sankey flow shape. Inline DAG: a list of nodes (each with
 * a unique `id` + optional human-readable `name` + optional `group`
 * for color) and a list of links connecting them by source/target
 * ids, weighted by a numeric `value`. The compiler's `compileSankey`
 * runs longest-path layering + barycenter crossing minimization +
 * rect / bezier-link emission. Cycles are rejected (sankey requires
 * a DAG).
 */
export const FlowDataSchema = z
  .object({
    nodes: z
      .array(
        z
          .object({
            id: z.string().min(1),
            name: z.string().optional(),
            group: z.string().optional(),
          })
          .strict(),
      )
      .min(1),
    links: z
      .array(
        z
          .object({
            source: z.string().min(1),
            target: z.string().min(1),
            value: z.number().nonnegative(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

/**
 * Math PR1 — `data.shape: "function"` (scalar form). Samples a single
 * math expression over an evenly-spaced range to produce y = f(x) rows
 * that flow into the existing line / area / point machinery. The hard
 * upper bound on `samples` matches `MAX_SAMPLES` in
 * `data/shapes/function.ts` and protects against DoS via a malformed
 * spec. AUDIT-10 (math PR5) will additionally warn at sample counts
 * above 10k.
 */
export const ScalarFunctionDataSchema = z
  .object({
    shape: z.literal("function"),
    x: z
      .object({
        min: z.number().refine(Number.isFinite, "x.min must be finite"),
        max: z.number().refine(Number.isFinite, "x.max must be finite"),
        samples: z.number().int().min(2).max(100_000),
      })
      .strict()
      .refine((r) => r.min < r.max, {
        message: "function data: x.min must be < x.max",
      }),
    expr: z.string().min(1),
    /**
     * Optional 3D z-coordinate. Today's 2D renderer ignores it; a future
     * 3D renderer (Option B) reads it without a spec rev.
     */
    zExpr: z.string().min(1).optional(),
  })
  .strict();

/**
 * Math PR2 — `data.shape: "function"` (parametric form). Traces a curve
 * `(xExpr(t), yExpr(t))` for `t` stepping evenly across
 * `[parameter.min, parameter.max]`. The materialized rows carry the
 * parameter value under its declared name so
 * `animation.kind: "scrub" | "race"` with `frame_field: "<param>"`
 * composes without compiler changes.
 *
 * Identifier rules: the parameter name must be a valid JS-style
 * identifier and must not collide with the output column names
 * (`x`, `y`, `z`). Conventional choice: `t`.
 */
export const ParametricDataSchema = z
  .object({
    shape: z.literal("function"),
    parameter: z
      .object({
        name: z
          .string()
          .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "parameter.name must be a valid identifier")
          .refine((n) => n !== "x" && n !== "y" && n !== "z", {
            message: "parameter.name must not collide with output columns 'x', 'y', 'z'",
          }),
        min: z.number().refine(Number.isFinite, "parameter.min must be finite"),
        max: z.number().refine(Number.isFinite, "parameter.max must be finite"),
        samples: z.number().int().min(2).max(100_000),
      })
      .strict()
      .refine((r) => r.min < r.max, {
        message: "function data: parameter.min must be < parameter.max",
      }),
    xExpr: z.string().min(1),
    yExpr: z.string().min(1),
    /**
     * Optional z-coordinate expression. Today's 2D renderer ignores it; a
     * future 3D renderer reads it without a spec rev.
     */
    zExpr: z.string().min(1).optional(),
  })
  .strict();

/**
 * `data.shape: "function"` — scalar (PR1) OR parametric (PR2). Both
 * variants gate on the same `shape: "function"` literal; the discriminator
 * between them is the presence of `parameter` (parametric) vs `x` (scalar).
 *
 * Zod's plain `z.union` is used here rather than a discriminated union
 * because both variants share the same `shape` literal — the meaningful
 * discriminator is the field shape itself, which `.strict()` on each
 * branch already enforces (an extra `parameter` on a scalar spec fails
 * the strict check on the scalar variant; an extra `x` on a parametric
 * spec fails the strict check on the parametric variant).
 */
export const FunctionDataSchema = z.union([ScalarFunctionDataSchema, ParametricDataSchema]);

/**
 * Math Phase 2 Track A PR A1 — `data.shape: "trajectory"`. Describes a
 * 2D ODE system
 *
 *     dx/dt = f(x, y, t)
 *     dy/dt = g(x, y, t)
 *
 * integrated by RK4 (Runge–Kutta 4th order) from `time.min` to
 * `time.max` in `time.samples - 1` evenly-spaced steps. The
 * materialized rows are `{t, x, y}` in insertion order; `mark: "line"`
 * (and `mark: "point"`) consume them like any other tabular data.
 *
 * The same `expr-eval` evaluator backs derivative evaluation as the
 * function shape, so determinism guarantees carry over — same spec →
 * byte-identical rows across runs.
 *
 * `t` first in the row schema is the orthogonality contract with
 * `animation.kind: "scrub"`: scrub keys off `frame_field` by name, so
 * `frame_field: "t"` on a trajectory composes with zero compiler
 * changes (same pattern Math PR2 used for parametric data).
 */
export const TrajectoryDataSchema = z
  .object({
    shape: z.literal("trajectory"),
    dxdt: z.string().min(1),
    dydt: z.string().min(1),
    initial: z
      .object({
        x: z.number().refine(Number.isFinite, "initial.x must be finite"),
        y: z.number().refine(Number.isFinite, "initial.y must be finite"),
      })
      .strict(),
    time: z
      .object({
        min: z.number().refine(Number.isFinite, "time.min must be finite"),
        max: z.number().refine(Number.isFinite, "time.max must be finite"),
        samples: z.number().int().min(2).max(100_000),
      })
      .strict()
      .refine((r) => r.min < r.max, {
        message: "trajectory data: time.min must be < time.max",
      }),
  })
  .strict();

/**
 * RFC 2026-05-22 — `data.shape: "pde-solve"` — 2D partial
 * differential equation solver on a fixed grid. V1 ships only
 * `kind: "heat"`; wave + reaction-diffusion follow as v2.
 *
 * Authors specify a domain, grid resolution, initial condition,
 * boundary policy, and integration step. The schema validates the
 * CFL stability condition (D·dt/dx² ≤ 0.25 for the heat scheme)
 * and rejects unstable specs up front. Output is `rows × cols`
 * rows of `{ x, y, u }`, paired with `mark: "heatmap"` for visual
 * rendering.
 */
export const PdeSolveDataSchema = z
  .object({
    shape: z.literal("pde-solve"),
    kind: z.enum(["heat", "wave", "reaction-diffusion"]),
    domain: z
      .object({
        x: z.tuple([
          z.number().refine(Number.isFinite, "domain.x[0] must be finite"),
          z.number().refine(Number.isFinite, "domain.x[1] must be finite"),
        ]),
        y: z.tuple([
          z.number().refine(Number.isFinite, "domain.y[0] must be finite"),
          z.number().refine(Number.isFinite, "domain.y[1] must be finite"),
        ]),
      })
      .strict()
      .refine((d) => d.x[0] < d.x[1] && d.y[0] < d.y[1], {
        message: "pde-solve: domain.x[0] < .x[1] and domain.y[0] < .y[1] required",
      }),
    grid: z
      .object({
        rows: z.number().int().min(4).max(256),
        cols: z.number().int().min(4).max(256),
      })
      .strict(),
    initial: z.string().min(1),
    /** Wave-only optional: initial ∂u/∂t. Defaults to "0". */
    initial_velocity: z.string().min(1).optional(),
    /** RD-only optional: initial U. Defaults to "1". */
    initial_U: z.string().min(1).optional(),
    /** RD-only optional: initial V. Defaults to a small Gaussian seed. */
    initial_V: z.string().min(1).optional(),
    params: z.record(z.number().refine(Number.isFinite, "params values must be finite")),
    boundary: z.enum(["clamp", "periodic"]),
    steps: z.number().int().min(1).max(1000),
    dt: z.number().positive().refine(Number.isFinite, "dt must be finite"),
  })
  .strict()
  .refine(
    (s) => {
      // Per-kind CFL stability. Heat: D·dt/dx² ≤ 0.25. Wave:
      // c·dt/dx ≤ 1. RD: max(Du,Dv)·dt/dx² ≤ 0.25.
      const dx = (s.domain.x[1] - s.domain.x[0]) / s.grid.cols;
      if (s.kind === "heat") {
        const D = s.params.D ?? 0;
        if (!Number.isFinite(D) || D < 0) return false;
        return (D * s.dt) / (dx * dx) <= 0.25;
      }
      if (s.kind === "wave") {
        const c = s.params.c ?? 1;
        if (!Number.isFinite(c) || c <= 0) return false;
        return (c * s.dt) / dx <= 1;
      }
      // reaction-diffusion
      const Du = s.params.Du ?? 1.0;
      const Dv = s.params.Dv ?? 0.5;
      if (!Number.isFinite(Du) || !Number.isFinite(Dv) || Du < 0 || Dv < 0) return false;
      return (Math.max(Du, Dv) * s.dt) / (dx * dx) <= 0.25;
    },
    {
      message:
        "pde-solve: CFL stability violated. heat: D·dt/dx² ≤ 0.25; wave: c·dt/dx ≤ 1; reaction-diffusion: max(Du,Dv)·dt/dx² ≤ 0.25. Reduce dt or relevant coefficients, or increase grid.cols.",
    },
  );

/**
 * RFC 2026-05-22 — `data.shape: "geodesic"` — relativistic photon
 * paths through the equatorial plane of a Schwarzschild black hole.
 *
 * V1 ships only `metric: "schwarzschild-weak"` (weak-field
 * approximation with the GR factor-of-2 enhancement, reproducing
 * the famous 4M/b photon deflection to first order in M/r).
 * Strong-field Schwarzschild + Kerr + FLRW are queued as follow-ups.
 *
 * Each seed is a photon's initial 2D position + velocity. The
 * integrator emits one row per RK4 step with `[seed_id, lambda, x,
 * y]` columns — `seed_id` first so `encoding.color` can hue per
 * ray, `lambda` next so `animation.kind: "scrub"` works the same
 * way it does for `trajectory`.
 *
 * Determinism contract is identical to function / trajectory /
 * recurrence: same spec → byte-identical rows on every platform,
 * inheriting the `clampSamplerPrecision` per-step clamp.
 */
export const GeodesicDataSchema = z
  .object({
    shape: z.literal("geodesic"),
    metric: z.enum(["schwarzschild-weak", "schwarzschild-strong"]),
    mass: z.number().positive().refine(Number.isFinite, "mass must be finite"),
    seeds: z
      .array(
        z
          .object({
            x0: z.number().refine(Number.isFinite, "x0 must be finite"),
            y0: z.number().refine(Number.isFinite, "y0 must be finite"),
            vx0: z.number().refine(Number.isFinite, "vx0 must be finite"),
            vy0: z.number().refine(Number.isFinite, "vy0 must be finite"),
          })
          .strict()
          .refine((s) => s.vx0 !== 0 || s.vy0 !== 0, {
            message: "geodesic seed velocity must be nonzero",
          }),
      )
      .min(1)
      .max(200),
    step: z.number().positive().max(10).refine(Number.isFinite, "step must be finite"),
    max_lambda: z
      .number()
      .positive()
      .max(1000)
      .refine(Number.isFinite, "max_lambda must be finite"),
  })
  .strict();

/**
 * RFC 2026-05-22 — `data.shape: "recurrence"` — iterative function
 * shape for curlicue curves, the logistic map, IFS attractors, and
 * any system whose forward evolution is "compute next from previous"
 * rather than continuous.
 *
 * Walks `state_{n+1} = f(state_n, n, ...params)` for `steps` steps
 * and emits one row per step. Row n=0 holds the initial condition
 * verbatim; rows 1..N-1 are computed. The schema column order is
 * `[n, ...state]` so `animation.kind: "scrub"` with
 * `frame_field: "n"` steps through the recurrence one iteration at
 * a time — same orthogonality trick `trajectory` uses with `t`.
 *
 * `state` keys, `initial` keys, and `step` keys must form the same
 * set (per-step refine below enforces this). `n` is reserved as the
 * step-index identifier in the step expressions and can't double as
 * a state variable.
 */
export const RecurrenceDataSchema = z
  .object({
    shape: z.literal("recurrence"),
    state: z.array(z.string().min(1)).min(1),
    initial: z.record(z.number().refine(Number.isFinite, "initial values must be finite")),
    step: z.record(z.string().min(1)),
    params: z.record(z.number().refine(Number.isFinite, "params values must be finite")).optional(),
    steps: z.number().int().min(2).max(200_000),
  })
  .strict()
  .refine(
    (r) => {
      const stateSet = new Set(r.state);
      if (stateSet.size !== r.state.length) return false; // duplicates
      if (stateSet.has("n")) return false; // reserved
      const initKeys = Object.keys(r.initial);
      const stepKeys = Object.keys(r.step);
      if (initKeys.length !== r.state.length || stepKeys.length !== r.state.length) return false;
      for (const name of r.state) {
        if (!(name in r.initial)) return false;
        if (!(name in r.step)) return false;
      }
      return true;
    },
    {
      message:
        "recurrence data: state, initial, and step must all reference the same variable names; `n` is reserved",
    },
  );

export const DataSourceSchema = z
  .object({
    /**
     * Path, URL, or named registered table for tabular data. Optional when
     * `hierarchy` is set (PR67), otherwise required at runtime by the
     * materializer.
     */
    source: z.string().min(1).optional(),
    /** File format hint. Inferred from extension when omitted. */
    format: DataFormatSchema.optional(),
    /**
     * SQL transform applied before binding to the visualization. Optional.
     * The result of this query becomes the materialized view backing the chart.
     */
    transform: z.string().optional(),
    /**
     * PR67 (D3 Gap 2) — inline hierarchical data tree. When set, the
     * compiler skips DuckDB and dispatches to `compileHierarchy`, which
     * runs a layout algorithm (treemap, sunburst) and emits rect / arc
     * marks. Mutually exclusive with `source` in practice — when both are
     * set, hierarchy wins.
     */
    hierarchy: HierarchyNodeSchema.optional(),
    /**
     * PR68 (D3 Gap 5) — inline graph data (nodes + edges) for the
     * force-directed layout. When set, the compiler skips DuckDB and
     * dispatches to `compileGraph`. Pair with `mark: "force"`.
     */
    graph: GraphDataSchema.optional(),
    /**
     * Tier-2 — sankey flow diagram. Inline DAG of named nodes + valued
     * links. The compiler skips DuckDB and dispatches to compileSankey,
     * which lays nodes out left-to-right by longest-path layer + runs
     * a barycenter pass to minimize crossings. Pair with `mark: "sankey"`.
     */
    flow: FlowDataSchema.optional(),
    /**
     * PR75 (D3 Gap 4) — inline 2D scalar-field grid for contour / density
     * viz. When set, the compiler skips DuckDB and dispatches to
     * `compileContour`. Pair with `mark: "contour"` and `thresholds`.
     */
    grid: GridDataSchema.optional(),
    /**
     * Math PR1 — inline math expression sampled into rows. When set, the
     * compiler skips DuckDB, samples the expression at evenly-spaced
     * points, and routes the resulting rows through the normal line /
     * area / point pipeline so all downstream features (facet, polar,
     * animation, audit) work unchanged.
     */
    function: FunctionDataSchema.optional(),
    /**
     * Math Phase 2 Track A PR A1 — inline 2D ODE system integrated by
     * RK4. When set, the compiler skips DuckDB, runs the integration
     * in-process, and routes the resulting (t, x, y) rows through the
     * normal line / point pipeline. Like the function shape, the
     * insertion-order sentinel keeps closed orbits from being
     * x-sorted into zigzags.
     */
    trajectory: TrajectoryDataSchema.optional(),
    /**
     * RFC 2026-05-22 — `data.shape: "recurrence"`. Iterative
     * difference equation walked for N integer steps. Different from
     * `trajectory` (continuous ODE via RK4) and `function` (sampled
     * scalar / parametric curve): emits exactly `steps` rows where
     * row n holds the state after n iterations of the user-supplied
     * step function. Use for curlicue curves, logistic-map orbits,
     * IFS attractors — anything where the natural evolution is
     * x_{n+1} = f(x_n, n).
     */
    recurrence: RecurrenceDataSchema.optional(),
    /**
     * RFC 2026-05-22 — `data.shape: "geodesic"`. Photon paths through
     * the equatorial plane of a Schwarzschild black hole. V1 ships
     * weak-field only; full strong-field Binet integration queued
     * for a follow-up. See GeodesicDataSchema docstring for details.
     */
    geodesic: GeodesicDataSchema.optional(),
    /**
     * RFC 2026-05-22 — `data.shape: "pde-solve"`. 2D PDE solver on
     * a fixed grid; v1 supports `kind: "heat"`. Outputs rows · cols
     * rows of `{ x, y, u }` paired with `mark: "heatmap"`.
     */
    pde_solve: PdeSolveDataSchema.optional(),
    /**
     * Moat PR3 — failure-aware rendering policy for rows whose
     * y-encoded value is null / undefined / NaN.
     *
     *   - "skip"        (default; back-compat) drop the row silently
     *                   (the prior behavior). AUDIT-10 flags this at
     *                   render time when the silent dropout exceeds 5%
     *                   of input rows, so the agent learns even on
     *                   the safe default that data is missing.
     *   - "callout"     emit an explicit visual marker at the row's x
     *                   position — a small dashed rect on the baseline
     *                   for bar marks, a "✕" glyph for line / point marks,
     *                   each carrying a `<title>` "Missing value at
     *                   x=<value>" for accessibility.
     *   - "interpolate" linear-interpolate y from the previous valid
     *                   row to the next valid row. Line / area marks
     *                   draw the bridging segment with a dashed stroke
     *                   so it's visually distinct from the solid data.
     *                   Leading / trailing missing values fall through
     *                   to "skip" (no neighbor to interpolate against).
     */
    onMissing: z.enum(["skip", "callout", "interpolate"]).optional(),
  })
  .strict()
  .refine(
    (d) =>
      d.source !== undefined ||
      d.hierarchy !== undefined ||
      d.graph !== undefined ||
      d.grid !== undefined ||
      d.function !== undefined ||
      d.trajectory !== undefined ||
      d.recurrence !== undefined ||
      d.geodesic !== undefined ||
      d.pde_solve !== undefined,
    "data needs a 'source', 'hierarchy', 'graph', 'grid', 'function', 'trajectory', 'recurrence', 'geodesic', or 'pde_solve'",
  );

// ---------------------------------------------------------------------------
// Marks — what gets drawn per row
// ---------------------------------------------------------------------------

export const MarkSchema = z.enum([
  "bar",
  "line",
  "point",
  "area",
  "rect",
  "rule",
  // Tier-2 — first-class pie/donut. `mark: "arc"` is sugar for
  // `mark: "bar" + coordinates: { type: "polar" }`: the compiler
  // auto-injects polar coordinates, treats encoding.theta as the
  // angle field, and routes through the existing polar-bar pipeline.
  // Use `innerRadius: 0.5` on the layer for a donut; leave it
  // unset/0 for a pie.
  "arc",
  // PR42 — geo viz primitives. `geo-point` plots lat/lon points through a
  // projection; the compiler translates to plain points after projection.
  "geo-point",
  // PR44 — `geo-region` renders projected polygons from a GeoJSON feature
  // collection; each region's fill is taken from the encoding (typically
  // `color: { metric: ... }` or `color: "<value-field>"`).
  "geo-region",
  // PR49 — 2D categorical × categorical grid with color from a
  // quantitative field. Both axes use band scales; color interpolated
  // between two stops.
  "heatmap",
  // PR50 — distribution mark. Categorical x, quantitative y; per x-group
  // the compiler computes Q1 / median / Q3 / whiskers (Tukey, 1.5 × IQR)
  // and outliers beyond the whisker bounds.
  "boxplot",
  // Tier-2 — beeswarm packing. Categorical x, quantitative y; per
  // x-group the compiler runs a 1D non-overlap pack that nudges
  // dots horizontally within the band so they don't overlap.
  // Visually halfway between a strip plot and a violin — keeps every
  // individual data point visible while showing distribution shape.
  "beeswarm",
  // Tier-2 — sankey flow diagram. Pair with `data.flow = { nodes,
  // links }`. The compiler lays nodes left-to-right by longest-path
  // layer, sorts within layers via barycenter to minimize link
  // crossings, then emits a rect per node + a bezier path per link
  // sized by `value`. DAG only — cycles reject.
  "sankey",
  // PR50 — direct label annotation. Renders a text mark at each row's
  // (x, y) with the value of encoding.text. Composes with other marks
  // via multi-layer specs (e.g. bars + text labels).
  "text",
  // PR67 (D3 Gap 2) — hierarchical viz marks. `treemap` runs the
  // squarified algorithm and emits one rect per leaf; `sunburst` runs a
  // partition layout and emits one arc per node (root excluded).
  "treemap",
  "sunburst",
  // PR68 (D3 Gap 5) — force-directed graph. Reads spec.data.graph,
  // runs simulateForce, emits one circle per node + one line per edge.
  "force",
  // PR75 (D3 Gap 4) — contour isolines over a 2D scalar field. Reads
  // spec.data.grid + spec.thresholds, runs marching-squares, emits one
  // path mark per threshold.
  "contour",
  // Math PR3 — oriented arrows from a 2D vector field. Rows are
  // `{x, y, dx, dy}` (precomputed by the user or by a future
  // function-data extension). Compiler emits one `arrow` SceneMark per
  // row; SVG renderer emits a `<line>` with `marker-end="url(#glyph-arrow)"`.
  "vector-field",
  // Math PR4 — LaTeX-rendered glyph group positioned at each row's
  // (x, y). The layer's `expr` field carries the LaTeX source; KaTeX
  // parses it to MathML and a deterministic layout pass emits one
  // `<text>` SceneMark per glyph (plus `<path>` rules for fractions).
  "math-text",
  // E1 — annotation mark
  // Joy of Math PR E1 — labeled callout. Anchors to a data row by index
  // OR to a fixed data-space coord, then emits an auto-positioned arrow,
  // text bubble, and optional highlight ring.
  "annotation",
  // E2 — traveler mark. A dot that traces a sibling layer's polyline
  // (or its own) over time via SMIL `<animateMotion>`. Kid-delight
  // unlock — the moving dot is the star, not the curve.
  "traveler",
  // A3 — streamline mark. Renders continuous flow lines of a 2D
  // vector field by integrating the field via RK4 in both directions
  // from each seed point. The vector-field mark shows discrete arrows
  // at grid points; streamlines integrate those arrows into
  // trajectories that reveal the GLOBAL flow structure.
  "streamline",
  // A5 — bezier mark. Renders an N-degree Bezier curve from a list of
  // control points, optionally with the control polygon and the
  // per-level de Casteljau construction lines at a given parameter
  // `t` — the canonical "show how the curve is built" picture.
  "bezier",
]);

/**
 * PR66 — polar coordinates. When `spec.coordinates.type === "polar"`,
 * the compiler reinterprets each layer's encoding:
 *   - `encoding.x` → angle  (band scale around the circle, or linear ∈ [0, 2π])
 *   - `encoding.y` → radius (linear from innerRadius → outerRadius)
 * Marks translate to a cartesian arc / point / path at render time via
 * `(angle, radius) → (cx + r·cos(θ - π/2), cy + r·sin(θ - π/2))` (rotated
 * so angle=0 points up, matching D3.arc's convention).
 *
 * Pie / donut: a `mark: "bar"` with `coordinates.type: "polar"` and an
 * angle encoding from the categorical field produces a ring of arcs.
 * Set `coordinates.innerRadius > 0` for a donut.
 *
 * Radial line: a `mark: "line"` with polar coordinates traces a closed
 * loop in the (angle, radius) plane.
 *
 * Skipping snapshot regressions: when `coordinates` is unset (every
 * existing test path), the compiler takes the cartesian branch — output
 * is byte-identical to prior baselines.
 */
export const CoordinatesSchema = z
  .object({
    type: z.literal("polar"),
    /**
     * Inner radius as a fraction of the smaller plot dimension (0 = pie,
     * 0.5 = donut with 50% hole). Defaults to 0.
     */
    innerRadius: z.number().min(0).max(0.95).optional(),
    /**
     * Outer radius as a fraction of the smaller plot dimension's half
     * (i.e. 1.0 fills the disc that fits inside the plot area). Defaults
     * to 0.9 — leaves a small margin so strokes don't clip the edge.
     */
    outerRadius: z.number().min(0).max(1).optional(),
    /**
     * Starting angle in degrees, measured clockwise from 12-o'clock.
     * Defaults to 0 (top). Useful for pie charts where you want the
     * largest slice to start at the top.
     */
    startAngle: z.number().min(-360).max(360).optional(),
    /**
     * Total sweep in degrees (default 360 for a full circle). Set < 360
     * for a partial arc (e.g. 180 for a semi-circle gauge).
     */
    endAngle: z.number().min(-360).max(360).optional(),
  })
  .strict();

/**
 * Projection for `geo-*` marks. v0 supports the two simplest projections —
 * equirectangular (rectangular lat/lon → screen mapping) and Mercator
 * (conformal, web-map style). Both are pure-math; no external GIS dep.
 * Other projections (albers, naturalEarth, ortho) land once a real GIS
 * library is bundled.
 */
export const ProjectionSchema = z
  .object({
    type: z.enum(["equirectangular", "mercator", "naturalEarth", "albersUsa"]),
    /** [lon, lat] center of the projection. Defaults to [0, 0]. */
    center: z.tuple([z.number(), z.number()]).optional(),
    /** Pixel scale per radian. Defaults to (chart width / (2π)) for equirectangular. */
    scale: z.number().positive().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Channels & encoding
// ---------------------------------------------------------------------------

export const FieldTypeSchema = z.enum(["quantitative", "ordinal", "nominal", "temporal"]);

export const ScaleTypeSchema = z.enum([
  "linear",
  "log",
  "sqrt",
  "time",
  "band",
  "point",
  "ordinal",
]);

export const ScaleSchema = z
  .object({
    type: ScaleTypeSchema.optional(),
    domain: z
      .union([z.tuple([z.number(), z.number()]), z.array(z.string()), z.array(z.number())])
      .optional(),
    range: z.union([z.tuple([z.number(), z.number()]), z.array(z.string())]).optional(),
    /**
     * "left" (default) or "right" — for layered plots that want a secondary
     * y-axis on a per-channel basis.
     */
    side: z.enum(["left", "right"]).optional(),
  })
  .strict();

/**
 * A channel value. Either:
 *   - a string shorthand: the field name; type/scale inferred from data
 *   - an object: { field, type?, scale?, aggregate? }
 *   - an object: { metric, type?, scale?, ... } — Phase 3 §1 (PR37); the
 *     materializer resolves `metric` against a session-scoped registry and
 *     emits a `_metric_<name>` column the encoding then resolves to.
 *   - an object: { value: <literal> } — a constant per-layer encoding. The
 *     compiler skips the data-driven scale and uses the value as-is. Used
 *     when you want, say, four area layers each with its own fill color
 *     without inventing a placeholder field. (Tier-1 encoder gap fix.)
 *
 * The shorthand form is what agents reach for first; the object form is the
 * escape hatch when defaults need to be overridden.
 *
 * Constraint: a channel must carry exactly one of `field`, `metric`, or
 * `value`.
 */
export const ChannelObjectSchema = z
  .object({
    field: z.string().min(1).optional(),
    /**
     * Reference to a named metric registered via `glyph_metrics_register`
     * (or a yaml registry, in a later PR). The materializer rewrites this
     * to a SQL aggregate at compile time.
     */
    metric: z.string().min(1).optional(),
    /**
     * Literal constant — bypasses scales entirely. For color channels:
     * a CSS color string. For size/opacity: a number. The compiler treats
     * `value` as the unconditional output for every row.
     */
    value: z.union([z.string(), z.number()]).optional(),
    type: FieldTypeSchema.optional(),
    scale: ScaleSchema.optional(),
    aggregate: z.enum(["count", "sum", "mean", "median", "min", "max"]).optional(),
    /** Override the axis/legend title. */
    title: z.string().optional(),
  })
  .strict()
  .refine(
    (c) => {
      const n =
        (c.field !== undefined ? 1 : 0) +
        (c.metric !== undefined ? 1 : 0) +
        (c.value !== undefined ? 1 : 0);
      return n === 1;
    },
    { message: "Channel must have exactly one of `field`, `metric`, or `value`." },
  );

export const ChannelSchema = z.union([z.string().min(1), ChannelObjectSchema]);

export const EncodingSchema = z
  .object({
    x: ChannelSchema.optional(),
    y: ChannelSchema.optional(),
    color: ChannelSchema.optional(),
    size: ChannelSchema.optional(),
    opacity: ChannelSchema.optional(),
    /**
     * Tier-2 — angle weight channel for `mark: "arc"`. The compiler
     * rewrites theta → y when routing the arc through the polar-bar
     * pipeline; the resulting slice angle is proportional to this
     * field's value.
     */
    theta: ChannelSchema.optional(),
    tooltip: z.union([ChannelSchema, z.array(ChannelSchema)]).optional(),
    /** Latitude column for `geo-*` marks (PR42). */
    lat: ChannelSchema.optional(),
    /** Longitude column for `geo-*` marks (PR42). */
    lon: ChannelSchema.optional(),
    /**
     * Row field that joins to a GeoJSON feature's `properties[idField]`.
     * Used by `geo-region` marks (PR44).
     */
    region: ChannelSchema.optional(),
    /**
     * Source field whose value is rendered as the label string by the
     * `text` mark (PR50).
     */
    text: ChannelSchema.optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Stat — pre-draw aggregation
// ---------------------------------------------------------------------------

export const StatSchema = z
  .object({
    type: z.enum(["bin", "count", "sum", "mean", "median", "quantile"]),
    /**
     * For `bin`: number of bins or explicit step. For `quantile`: the q in [0,1].
     */
    params: z.record(z.union([z.number(), z.string()])).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

export const PositionSchema = z.enum(["stack", "dodge", "identity"]);

export const LayerSchema = z
  .object({
    /** Per-layer data override; defaults to the top-level data source. */
    data: DataSourceSchema.optional(),
    mark: MarkSchema,
    encoding: EncodingSchema,
    stat: StatSchema.optional(),
    position: PositionSchema.optional(),
    /**
     * For `mark: "line"` and `mark: "area"`. How adjacent points are
     * connected:
     *   - `"linear"` (default): straight line between (xᵢ, yᵢ) and
     *     (xᵢ₊₁, yᵢ₊₁) — the prior behavior, byte-equivalent.
     *   - `"step"`: horizontal segment at yᵢ from xᵢ to xᵢ₊₁, then a
     *     vertical jump to yᵢ₊₁. The classic staircase shape used for
     *     state-over-time and step-function plots.
     *   - `"step-before"`: vertical jump first, then horizontal. Useful
     *     when the value changes AT the timestamp rather than after it.
     * Ignored by other marks. Tier-2 RFC.
     */
    interpolate: z.enum(["linear", "step", "step-before"]).optional(),
    /**
     * Tier-2 — donut hole proportion for `mark: "arc"` (0..1).
     * 0 (default) renders a solid pie; 0.5 renders a donut whose
     * inner radius is half the outer radius. Ignored by other marks.
     */
    innerRadius: z.number().min(0).max(0.95).optional(),
    /**
     * Math PR4 — LaTeX source for `mark: "math-text"`. Required when
     * `mark === "math-text"`; the compiler enforces this via a
     * layer-validation gate so the error fires at compile-time, not at
     * render-time. Other marks ignore this field. Capped to a generous
     * 4 KB to keep KaTeX parse cost predictable.
     */
    expr: z.string().min(1).max(4096).optional(),
    /** Math PR4 — pixel font size for math-text glyphs. Default 14. */
    fontSize: z.number().positive().max(512).optional(),
    /** Math PR4 — fill color override for math-text glyphs (defaults to theme.fg). */
    color: z.string().min(1).optional(),
    /**
     * Math PR4 — horizontal alignment of the math-text bounding box at
     * (x, y). "start" anchors the left edge, "middle" the center,
     * "end" the right edge. Default "middle".
     */
    align: z.enum(["start", "middle", "end"]).optional(),
    /**
     * Math PR4 — explicit data-space anchor `{ x, y }` for math-text.
     * When set, the math-text layer ignores rows and renders the
     * expression at this (x, y) (data coordinates, passed through the
     * chart's shared scales). Use this for titles / fixed annotations
     * that don't correspond to any particular data row. When unset,
     * math-text renders at the first row's (encoding.x, encoding.y).
     */
    at: z
      .object({
        x: z.number().refine(Number.isFinite, "at.x must be finite"),
        y: z.number().refine(Number.isFinite, "at.y must be finite"),
      })
      .strict()
      .optional(),
    // E1 — annotation mark
    /**
     * Joy of Math PR E1 — labeled callout config. Required when
     * `mark === "annotation"`; rejected otherwise. The anchor is a
     * discriminated union: either a row in the chart's data (`kind:
     * "data"`, `rowIndex` selects the row) or a fixed data-space coord
     * (`kind: "coord"`, `x` + `y` projected through the chart scales).
     * The "auto" arrow picks an offset quadrant based on which edge of
     * the plot area the anchor sits closest to; an explicit
     * `{dx, dy}` is interpreted in PIXELS (bubble layout is a pure-
     * pixel concern, so mixing it with data units would surprise the
     * caller).
     *
     * Layout caveats (v0):
     *  - Bubble width estimated as `fontSize * text.length * 0.55` —
     *    underestimates for CJK / wide-unicode glyphs by ~2× (same
     *    caveat math-text documents).
     *  - Keep `text` short enough to fit the plot area; at the default
     *    fontSize=14 a 30-char label is the safe maximum on a 640px
     *    plot. Longer labels render correctly but the bubble may
     *    overflow if anchored near the chart edge. Explicit `{dx, dy}`
     *    is clamped into the plot area to mitigate overflow.
     *  - Requires a linear x-scale today; band-scale (categorical)
     *    annotations throw at compile time. Use `mark: "math-text"`
     *    on a non-band axis if you need to annotate categories.
     */
    annotation: z
      .object({
        anchor: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("data"), rowIndex: z.number().int().nonnegative() }).strict(),
          z
            .object({
              kind: z.literal("coord"),
              x: z.number().refine(Number.isFinite),
              y: z.number().refine(Number.isFinite),
            })
            .strict(),
        ]),
        text: z.string().min(1).max(200),
        arrow: z
          .union([z.literal("auto"), z.object({ dx: z.number(), dy: z.number() }).strict()])
          .default("auto"),
        fontSize: z.number().positive().max(64).default(14),
        color: z.string().min(1).optional(),
        highlight: z.boolean().default(true),
      })
      .strict()
      .optional(),
    /**
     * E2 — optional stable id so other layers (today: `traveler.follow`)
     * can reference this one. When unset, the compiler may generate a
     * synthetic id of the form `layer-N`. Kept short + unconstrained so
     * future layer-cross-reference uses (E3 scene wiring) compose
     * without a schema rev.
     */
    id: z.string().min(1).optional(),
    /**
     * E2 — `mark: "traveler"` configuration. A dot that traces a path
     * mark over time via SMIL `<animateMotion>`. See the field-level
     * docs below. Required when `mark === "traveler"`; rejected on
     * other marks via the refine gate below (mirrors the math-text /
     * annotation pattern).
     */
    traveler: z
      .object({
        /**
         * Which polyline the traveler follows.
         *   - `"self"` — the traveler's own layer data (rare; usually
         *     the traveler reuses a sibling line layer's path).
         *   - `{ layerId }` — refers to a sibling layer by its `id`.
         */
        follow: z.union([z.literal("self"), z.object({ layerId: z.string().min(1) }).strict()]),
        /**
         * Animation duration in milliseconds. Falls back to
         * `spec.animation.duration_ms` when omitted (or 4000 ms when
         * neither is set).
         */
        duration_ms: z.number().int().min(100).max(60_000).optional(),
        /** Optional trailing tail behind the head. */
        trail: z
          .object({
            /** Length as a fraction of the path. Default 0.15. */
            length: z.number().min(0).max(1).default(0.15),
            /** Fade opacity from tail (0.1) → head (0.7). Default true. */
            fade: z.boolean().default(true),
          })
          .strict()
          .optional(),
        /** Head circle radius in pixels. Default 4. */
        radius: z.number().positive().max(64).default(4),
        /**
         * Head color override. Defaults to the first theme palette
         * entry when unset.
         */
        color: z.string().min(1).optional(),
        /**
         * Layer id for the traveler itself. Convenience alias of the
         * top-level `layer.id` for callers who'd rather keep all the
         * traveler config inside the `traveler:` block.
         */
        id: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    // A3 — streamline mark
    /**
     * Math Phase 2 Track A PR A3 — config for `mark: "streamline"`.
     * Required when `mark === "streamline"`; rejected on other marks
     * (mirrors the math-text `expr` pattern).
     *
     *   - `dxdt` / `dydt`: 2D vector field expressions in `(x, y)`.
     *     Evaluated by the same `expr-eval` backend the function and
     *     trajectory shapes use (same determinism / safety contract).
     *   - `seeds`: where streamlines start.
     *       - `kind: "grid"` — evenly-spaced `rows × cols` grid inset
     *         from the integration domain edges.
     *       - `kind: "array"` — caller-pinned list of `{x, y}` seeds.
     *   - `step`: RK4 step size in data units (default 0.05).
     *   - `maxSteps`: per-direction iteration cap (default 500). DoS
     *     guard — the integrator runs forward AND backward from each
     *     seed, so total work is bounded by `2 * seeds * maxSteps`.
     *     Worst-case (50×50 grid × 10_000 maxSteps) is ~80M
     *     evaluator calls and several seconds of CPU; prefer keeping
     *     grid ≤ 20×20 and maxSteps ≤ 2000 unless you've benchmarked
     *     the specific field.
     *   - `domain`: integration bounds. When omitted, the resolved
     *     x/y scale domains are used as a fallback.
     *
     * Domain-fallback caveat (A3 review I3): when `streamline.domain`
     * is omitted, the integrator uses the resolved layer scale's
     * domain. That domain is currently DATA-DERIVED (from the rows
     * fed to the layer) on linear scales — explicit
     * `encoding.x.scale.domain` is NOT honored on the linear path
     * today. To control the integration extent, either set
     * `streamline.domain` explicitly OR provide rows that anchor the
     * desired range. Explicit `streamline.domain` is the
     * unambiguous path.
     */
    streamline: z
      .object({
        dxdt: z.string().min(1),
        dydt: z.string().min(1),
        seeds: z.union([
          z
            .object({
              kind: z.literal("grid"),
              rows: z.number().int().min(2).max(50).default(5),
              cols: z.number().int().min(2).max(50).default(5),
            })
            .strict(),
          z
            .object({
              kind: z.literal("array"),
              points: z
                .array(z.object({ x: z.number(), y: z.number() }).strict())
                .min(1)
                .max(500),
            })
            .strict(),
        ]),
        step: z.number().positive().max(10).default(0.05),
        maxSteps: z.number().int().min(10).max(10_000).default(500),
        domain: z
          .object({
            x: z.tuple([z.number(), z.number()]),
            y: z.tuple([z.number(), z.number()]),
          })
          .strict()
          .optional(),
        /**
         * RFC 2026-05-23 — per-polyline color mode for the streamline
         * mark. Unset (default): every streamline strokes in the
         * theme's foreground color, preserving v0.2.0 byte snapshots.
         *
         *   - `"angle"`: stroke hue = atan2(vy, vx) at the seed point,
         *     so streamlines tracking the same flow direction share a
         *     color. The natural visualization for curl-dominated
         *     fields — eddies in different rotational senses pop out
         *     in different hues.
         *
         *   - `"speed"`: stroke lightness varies with |v| at the seed,
         *     darker = slower, lighter = faster. Useful for showing
         *     where a field accelerates (e.g. fluid through a nozzle).
         *
         *   - `"step"` (RFC #2 v2): hue varies along each polyline by
         *     step index — a 0°→270° rainbow trail from start (red)
         *     to end (purple) showing arc-length progression. Emitted
         *     as one `<path>` per segment instead of one per polyline,
         *     so file size grows linearly with maxSteps × seed count;
         *     stay below ~5000 segments per chart for fast renders.
         *
         * When set, `colorBy` overrides any `encoding.color` for this
         * mark — the streamline mark doesn't bind row data the way
         * bar/line do, so a row-driven color channel doesn't apply.
         *
         * AUDIT note: charts with many distinct seeds + `colorBy` will
         * legitimately have > 8 distinct colors, which trips AUDIT-06.
         * That warning is correct in spirit (the chart is information-
         * dense) but expected for this mark; an audit-rule refinement
         * to gate AUDIT-06 against opt-in many-color marks is tracked
         * separately.
         */
        colorBy: z.enum(["angle", "speed", "step"]).optional(),
      })
      .strict()
      .optional(),
    // A5 — bezier mark
    /**
     * Math Phase 2 Track A PR A5 — config for `mark: "bezier"`. Required
     * when `mark === "bezier"`; rejected on any other mark (mirrors the
     * streamline / annotation / traveler validation pattern).
     *
     *   - `controlPoints`: 2+ `{x, y}` control points in data space.
     *     Degree = N - 1 (3 points → quadratic, 4 → cubic, …).
     *   - `samples`: number of polyline segments used to draw the
     *     curve. Output has `samples + 1` vertices. Default 100.
     *   - `showControls`: when true, overlay the control polygon
     *     (dashed line through the control points) and a small circle
     *     at each control point.
     *   - `showConstruction`: when true (and `t` is set), overlay the
     *     per-level de Casteljau construction polylines at parameter
     *     `t`. Each level reduces the previous by one point; the
     *     final two-point line's midpoint is the curve sample at
     *     `t`. The compiler also drops a filled marker at that
     *     sample. When `t` is unset, this flag is ignored.
     *   - `t`: parameter in [0, 1] for the de Casteljau construction
     *     overlay. Only meaningful when `showConstruction` is true.
     *   - `stroke`, `strokeWidth`, `fill`: standard curve styling.
     *     Default stroke is the first theme palette entry; default
     *     fill is "none" (open curve, not a filled region).
     *
     * Determinism: same control points + same `t` produce
     * byte-identical SVG output. de Casteljau is a pure linear
     * interpolation tree; every projected pixel runs through
     * `roundPx`.
     */
    bezier: z
      .object({
        controlPoints: z
          .array(
            z
              .object({
                x: z.number().refine(Number.isFinite, "controlPoint.x must be finite"),
                y: z.number().refine(Number.isFinite, "controlPoint.y must be finite"),
              })
              .strict(),
          )
          .min(2)
          .max(32),
        samples: z.number().int().min(2).max(2000).default(100),
        showControls: z.boolean().default(false),
        showConstruction: z.boolean().default(false),
        t: z.number().min(0).max(1).optional(),
        stroke: z.string().min(1).optional(),
        strokeWidth: z.number().positive().max(64).optional(),
        fill: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((l) => l.mark !== "math-text" || (typeof l.expr === "string" && l.expr.length > 0), {
    message: "Layer with mark 'math-text' requires a non-empty 'expr' field.",
  })
  // E1 — annotation mark: require `annotation` when mark === "annotation".
  .refine((l) => l.mark !== "annotation" || l.annotation !== undefined, {
    message: "Layer with mark 'annotation' requires an 'annotation' object.",
    path: ["annotation"],
  })
  // E1 — annotation mark: reject `annotation` on non-annotation marks so a
  // misplaced field doesn't silently get dropped by the bar / line / point
  // compilers (same footgun the math-text refine guards against).
  .refine((l) => l.mark === "annotation" || l.annotation === undefined, {
    message: "Field 'annotation' is only valid when mark is 'annotation'.",
    path: ["annotation"],
  })
  // E2 — traveler mark requires the `traveler` config block; rejected
  // when set on other marks. Mirrors the math-text expr gate above so
  // agents see a fast, specific error.
  .refine((l) => l.mark !== "traveler" || l.traveler !== undefined, {
    message: "Layer with mark 'traveler' requires a 'traveler' config block.",
    path: ["traveler"],
  })
  .refine((l) => l.mark === "traveler" || l.traveler === undefined, {
    message: "The 'traveler' config is only valid when mark is 'traveler'.",
    path: ["traveler"],
  })
  // A3 — streamline mark: require config when mark="streamline" AND
  // reject the `streamline` config block on any other mark (mirrors
  // the math-text `expr` validation gate). Without this, a `mark:
  // "line"` layer could declare a `streamline` block and the value
  // would silently parse but never render — a real footgun for agents.
  .refine(
    (l) => l.mark !== "streamline" || (typeof l.streamline === "object" && l.streamline !== null),
    {
      message: "Layer with mark 'streamline' requires a 'streamline' config block.",
    },
  )
  .refine((l) => l.mark === "streamline" || l.streamline === undefined, {
    message: "Field 'streamline' is only valid when mark is 'streamline'.",
  })
  // A5 — bezier mark: require config when mark="bezier" AND reject
  // the `bezier` config block on any other mark. Same gate shape as
  // the streamline pattern above.
  .refine((l) => l.mark !== "bezier" || (typeof l.bezier === "object" && l.bezier !== null), {
    message: "Layer with mark 'bezier' requires a 'bezier' config block.",
    path: ["bezier"],
  })
  .refine((l) => l.mark === "bezier" || l.bezier === undefined, {
    message: "Field 'bezier' is only valid when mark is 'bezier'.",
    path: ["bezier"],
  })
  // Moat 3 review IMPORTANT-3 — layer-level `data.onMissing` is silently
  // ignored by the compiler (it only reads `spec.data.onMissing`). Reject
  // it at parse time so the agent isn't surprised by silent skip
  // behavior. Honoring per-layer overrides requires a separate
  // materialization pass and is queued for a follow-up.
  .refine((l) => l.data?.onMissing === undefined, {
    message:
      "Per-layer `data.onMissing` overrides are not yet supported. Set onMissing on the top-level `data` block instead.",
    path: ["data", "onMissing"],
  })
  // Math PR4 review BLOCKER-B1 — the math-text-only fields `expr`, `fontSize`,
  // `color`, `align`, `at` live at the layer level because they don't fit the
  // per-row encoding model. Without this gate, a `mark: "line"` layer could
  // declare `expr: "y = sin(x)"` and the value would parse cleanly but get
  // silently dropped by every non-math compiler — a real footgun for agents
  // emitting specs. Reject the combination at validation time so the error
  // surfaces immediately instead of via mysterious missing output.
  .refine(
    (l) => {
      if (l.mark === "math-text") return true;
      const mathOnlyFields = ["expr", "fontSize", "color", "align", "at"] as const;
      return mathOnlyFields.every((k) => (l as Record<string, unknown>)[k] === undefined);
    },
    {
      message:
        "Fields 'expr', 'fontSize', 'color', 'align', and 'at' are only valid when mark is 'math-text'.",
    },
  );

// ---------------------------------------------------------------------------
// Top-level Glyph spec
// ---------------------------------------------------------------------------

/**
 * Opt-in interactivity. When present, the renderer emits `data-*` attributes
 * on each mark so:
 *   1. CSS `:hover` can highlight bars (zero-JS feedback).
 *   2. `@glyph/live` can hydrate the SVG with click/brush handlers.
 *   3. `glyph_drill` (MCP) can derive a SQL WHERE clause from a click.
 * When absent, the rendered SVG is byte-identical to the non-interactive path.
 */
export const InteractiveSchema = z
  .object({
    /**
     * Optional source field used as the stable mark key (emitted as
     * `data-key`). Defaults to the row index. Useful when re-rendering
     * across data refreshes so the same row keeps its identity.
     */
    key: z.string().optional(),
    /**
     * Hover highlight: when true (default), inject a small `<style>` block
     * giving each interactive mark a `:hover` outline. Pure CSS, no JS.
     */
    hover: z.boolean().optional(),
    /**
     * PR61 (PLAN item 2.3) — uncertainty rendering. When the underlying
     * DataHandle carries `provenance` with `confidence != "high"` (or low
     * sample count), the renderer overlays hatching on bars, dims points,
     * and emits a top-right "n=N · confidence: X" badge. Default: on.
     * Set to `false` to suppress (e.g. for snapshot baselines that predate
     * provenance plumbing).
     */
    uncertainty: z.boolean().optional(),
    /**
     * PR77 (D3 Gap 8) — declarative zoom/pan. When true, the renderer
     * wraps the marks group in `<g class="glyph-zoomable" data-glyph-zoom="true">`.
     * Browser-side hydration (`@glyph/live`) attaches wheel + drag-pan
     * handlers that update the SVG viewBox.
     */
    zoomable: z.boolean().optional(),
    /**
     * PR77 (D3 Gap 8) — declarative lasso. When true, the renderer adds
     * `data-glyph-lasso="true"` to the SVG root. `@glyph/live` draws a
     * lasso path on drag and emits a selection event with the enclosed
     * mark keys.
     */
    lassoable: z.boolean().optional(),
    /**
     * PR77 (D3 Gap 8) — voronoi-hover targeting. When true, the
     * renderer adds `data-glyph-voronoi="true"` so `@glyph/live` knows
     * to use nearest-neighbor hover (any pointer position highlights
     * the closest mark, not just direct hits). Helpful for dense
     * scatter plots where tiny circles are hard to hit.
     */
    voronoi: z.boolean().optional(),
    /**
     * Moat 5/5 — declarative crossfilter. The first single-spec-field
     * primitive for "small multiples that talk" since crossfilter.js
     * shipped in 2012 (and died in 2017). Two charts that share
     * `crossfilter.group` participate in the same crossfilter group:
     * hovering or clicking a mark in one highlights matching marks in
     * the others.
     *
     * Static-SVG path: every mark gains
     *   `data-crossfilter-group="<group>"` and
     *   `data-crossfilter-key="<key-value>"`
     * plus a small `<style>` block driving a same-chart "focus + dim"
     * effect via CSS attribute selectors (zero JS). The static path
     * cannot key-match siblings (CSS can't read the hovered element's
     * attribute value); it dims non-hovered marks as a focus aid.
     *
     * Live-SVG path: `@glyph/live` reads the same data-attrs and
     * broadcasts hover events across all charts subscribed to the
     * group. Real key-matched highlight (same-chart) and cross-chart
     * linkage both require JS — the browser-side hydration extension
     * is out of scope for the moat PR; the static contract above is
     * the durable surface.
     *
     * v0 limitation — `spec.facet`: faceted compile lifts each panel's
     * marks but drops the top-level `scene.schema`, so the root-level
     * `data-crossfilter-group` attribute is not emitted on faceted
     * SVGs. Per-mark data-attrs still land via panel sub-compiles, but
     * `@glyph/live` needs the root attr to bind a group bus. Use two
     * separate (non-faceted) charts that share the same group string
     * until faceted scenes carry the schema upward.
     */
    crossfilter: z
      .object({
        /**
         * Cross-chart group id. Two charts that share this id
         * participate in the same crossfilter group: hovering or
         * clicking a mark in one filters / highlights matching marks
         * in the others. Required when `crossfilter` is set.
         */
        group: z.string().min(1).max(64),
        /**
         * Which field's value is the crossfilter key. Defaults to the
         * `encoding.color` field; falls back to `encoding.x` if no
         * color is encoded. Marks with the same key in two charts of
         * the same group are "matching."
         */
        key: z.string().min(1).optional(),
        /**
         * Forward-compat scaffolding for `@glyph/live` hydration —
         * NOT yet read by the static-SVG compile path. `"hover"`
         * highlights on mouseover; `"click"` toggles persistent
         * selection; `"both"` enables hover preview + click commit.
         * The static path's CSS is hover-only regardless of value;
         * the field is accepted (and round-trips through the schema)
         * so spec authors can pin intent before the live runtime
         * lands. Default `"hover"`.
         */
        mode: z.enum(["hover", "click", "both"]).default("hover"),
      })
      .strict()
      .optional(),
    /**
     * Track A4 — declarative interactive sliders.
     *
     * Each entry describes one numeric knob the host page can expose
     * as an `<input type="range">`. The static SVG renderer in
     * `@glyph/core` **does not read this field**: a spec that only
     * differs by the contents of `interactive.sliders` produces a
     * byte-identical SVG, so existing snapshots stay stable when an
     * author adds slider metadata.
     *
     * `@glyph/live` is the consumer: `bootSlidersFromSpec()` reads
     * this array, attaches one labelled `<input type="range">` per
     * entry into the host element, and debounces a caller-supplied
     * re-render function so dragging the slider keeps the chart in
     * sync without flooding work on every input tick.
     *
     * `field` names a caller-provided variable that the downstream
     * re-render path interprets — typically a free variable in
     * `spec.data.expr` (function-shape data) or any other parameter
     * the caller's compile + render pipeline knows how to splice in.
     * The schema itself does not constrain how the variable is used.
     *
     * Capped at 8 entries to keep the host UI from drowning in knobs.
     */
    sliders: z
      .array(
        z
          .object({
            /** Variable name the slider drives (e.g. "k", "amplitude"). */
            field: z.string().min(1).max(64),
            /** Inclusive minimum value (left edge of the range). */
            min: z.number().finite(),
            /** Inclusive maximum value (right edge of the range). */
            max: z.number().finite(),
            /** Slider granularity. Must be strictly positive. */
            step: z.number().positive().finite(),
            /** Initial slider position. */
            value: z.number().finite(),
            /** Optional UI label. Defaults to `field` when omitted. */
            label: z.string().min(1).max(64).optional(),
          })
          .strict(),
      )
      .max(8)
      .optional(),
  })
  .strict();

/**
 * Faceting splits a single chart into a grid of small multiples. Phase 1.0
 * supports `col` (side-by-side panels with a shared y scale + independent
 * x scales per panel). `row` and `wrap` land in a follow-up.
 */
export const FacetSchema = z
  .object({
    /** Source field to partition rows by; one panel per distinct value. */
    col: z.string().min(1),
  })
  .strict();

/**
 * A declarative action attached to a spec — Phase 3 §4 (PR40). The MCP
 * `glyph_act` verb resolves the action's argMap (substituting
 * `$selection.keys` / `$selection.count` / `$selection.summary` from the
 * selection passed to the verb) and writes an audit row to
 * `~/.glyph/memory.duckdb`. v0 is dry-run-only — the external tool dispatch
 * happens via the host MCP plane in a follow-up.
 */
export const ActionSchema = z
  .object({
    /** SQL-safe identifier — the key used by glyph_act. */
    name: z.string().min(1),
    /** Human-readable button label. */
    label: z.string().min(1),
    /** Name of an external MCP tool to invoke. Optional in v0 (audit-only). */
    tool: z.string().min(1).optional(),
    /**
     * Per-arg substitution map. Values can be plain JSON OR placeholder
     * strings beginning with `$selection.` (resolved at glyph_act time).
     */
    argMap: z.record(z.unknown()).optional(),
    /** Free-form description shown in audit / hover tooltips. */
    description: z.string().optional(),
  })
  .strict();

/**
 * Moat PR1 — Cryptographic provenance seal config. The renderer always
 * emits the seal; this knob controls one optional field on it.
 *
 *   - `includeTimestamp` (default false): when true, the seal carries
 *     a `generatedAt` ISO 8601 timestamp. Off by default so two renders
 *     of the same spec produce byte-identical SVGs (the determinism
 *     contract every other Glyph feature relies on).
 */
export const ProvenanceConfigSchema = z
  .object({
    includeTimestamp: z.boolean().optional(),
  })
  .strict();

/**
 * Spec versions known to the compiler. The compiler dispatches by version so
 * old specs keep working when new features ship. Bumping the major component
 * (\`glyph/0\` → \`glyph/1\`) is the breaking-change signal; minor bumps
 * (\`glyph/0.1\` → \`glyph/0.2\`) are additive.
 */
export const SUPPORTED_SPEC_VERSIONS = ["glyph/0.1"] as const;
export type SpecVersion = (typeof SUPPORTED_SPEC_VERSIONS)[number];
export const DEFAULT_SPEC_VERSION: SpecVersion = "glyph/0.1";

/**
 * Theme — color tokens for backgrounds, axes, grids, and the categorical
 * palette. Brand colors are non-negotiable for SaaS deployments; two
 * built-in themes ("light" / "dark") were a Phase-0 stand-in.
 */
export const ThemeConfigSchema = z
  .object({
    /** SVG/HTML color string for the chart background. */
    background: z.string().min(1),
    /** Foreground (titles, axis labels, rules' default stroke). */
    fg: z.string().min(1),
    /** Axis line color. */
    axis: z.string().min(1),
    /** Grid line color. */
    grid: z.string().min(1),
    /**
     * Categorical palette. Used by buildBars/buildPoints/buildLines/buildAreas
     * when color encoding is set; the i-th palette entry maps to the i-th
     * first-seen color domain value.
     */
    palette: z.array(z.string().min(1)).min(1),
  })
  .strict();

// ---------------------------------------------------------------------------
// Moat PR4 — BrandKit (compositional theme tokens)
//
// A BrandKit is a structured, reusable bundle of design tokens (palette
// + typography + spacing + a11y). It is the higher-level abstraction over
// `theme:` — designers and agents declare a brand once and every chart
// inherits it. Dark mode is one token swap on `palette.surface`.
//
// The renderer resolves a BrandKit into the flat `Theme` tokens it already
// understands (via `brandKitToTheme()` in render/brand.ts). When both
// `brand` and `theme` are set on a spec, brand wins for the surface +
// categorical palette; explicit `theme:` keys merge on top as overrides.
// ---------------------------------------------------------------------------

/**
 * Strict regex for color literals the brand-kit accepts. Matches:
 *   - `#rgb` / `#rrggbb` / `#rgba` / `#rrggbbaa` (hex with optional alpha)
 *   - `rgb(R, G, B)` / `rgba(R, G, B, A)` (the parser clamps overflow + drops alpha)
 *
 * Deliberately rejects:
 *   - Named colors (`"white"`) — parseColor returns null, AUDIT-11 would
 *     silently see a perfect contrast ratio of 1.0 (i.e. the moat
 *     defeats itself). Fix per Moat 4 review IMPORTANT-1.
 *   - HSL / HWB / LAB — parseColor doesn't handle them; tightening the
 *     schema fails them at parse-time instead of letting them slip
 *     through to silently pass the audit.
 *   - Negative or wildly-malformed rgb (e.g. `rgb(-5, 0, 0)`).
 *
 * Callers needing named colors should use the matching hex literal.
 * This is a v0 scope decision — when the renderer grows a full CSS
 * Color parser we can loosen this.
 */
const BRAND_COLOR_RE = /^(?:#[0-9a-fA-F]{3,8}|rgba?\(\s*\d+(?:\s*,\s*\d+){2,3}\s*\))$/;
const BrandColor = z.string().regex(BRAND_COLOR_RE, {
  message:
    "Brand color must be #rgb / #rrggbb / #rrggbbaa / rgb(R,G,B) / rgba(R,G,B,A). Named colors and HSL are rejected so AUDIT-11 can't be silently bypassed.",
});

/** Surface tokens — what the existing theme.{bg,fg,axis,grid} map to. */
export const BrandSurfaceSchema = z
  .object({
    /** Foreground (titles, labels, default mark stroke). */
    fg: BrandColor,
    /** Chart canvas background. */
    bg: BrandColor,
    /** Muted accent (subtitles, secondary labels, axis lines). */
    muted: BrandColor,
    /** Border / grid color. */
    border: BrandColor,
  })
  .strict();

export const BrandPaletteSchema = z
  .object({
    /** Primary categorical colors — mark fills, line strokes. >= 1. */
    categorical: z.array(BrandColor).min(1),
    /**
     * Sequential ramp for continuous color encodings. >= 2 stops.
     *
     * Math PR4 review IMPORTANT-3 follow-up: brandKitToTheme now
     * forwards this into theme.sequential so heatmap / contour /
     * sequential-color-encoded marks honor the brand kit's ramp.
     */
    sequential: z.array(BrandColor).min(2).optional(),
    /**
     * Diverging ramp (e.g. red-white-blue) for signed quantities.
     * Forwarded into theme.diverging via brandKitToTheme.
     */
    diverging: z.array(BrandColor).min(3).optional(),
    /** Surface colors — derived theme.bg/fg/grid. */
    surface: BrandSurfaceSchema,
  })
  .strict();

export const BrandTypographySchema = z
  .object({
    /** CSS font-family stack. */
    fontFamily: z.string().min(1),
    /** Base font size in px. */
    fontSize: z.number().positive(),
    /** Title scale multiplier (e.g. 1.2 → titles are 1.2× fontSize). */
    titleScale: z.number().positive(),
  })
  .strict();

export const BrandSpacingSchema = z
  .object({
    /** Padding unit in px. All chart paddings derive from this. */
    unit: z.number().positive(),
    /** Plot-area margin multiplier (e.g. 4 → 4×unit padding). */
    plotMargin: z.number().positive(),
  })
  .strict();

export const BrandAccessibilitySchema = z
  .object({
    /**
     * Minimum WCAG contrast ratio for fg/bg. Brands violating this
     * threshold emit an AUDIT-11 finding.
     */
    minContrastRatio: z.number().positive(),
    /**
     * When true, the categorical palette is validated under a deuteranopia
     * simulation matrix. Palettes that collapse two entries to
     * indistinguishable hues trigger AUDIT-11 with the offending pair.
     */
    colorBlindSafe: z.boolean().optional(),
  })
  .strict();

/**
 * BrandKit — Moat PR4. A reusable bundle of design tokens.
 *
 * The wire format version is `"glyph-brand/1"`; bump on breaking shape
 * changes. The renderer compiles a BrandKit to a Theme via
 * `brandKitToTheme()`; the contrast/colour-blind checks live in the
 * audit module (AUDIT-11).
 */
export const BrandKitSchema = z
  .object({
    /** Schema version. */
    format: z.literal("glyph-brand/1"),
    palette: BrandPaletteSchema,
    typography: BrandTypographySchema,
    spacing: BrandSpacingSchema,
    accessibility: BrandAccessibilitySchema,
  })
  .strict();

export const GlyphSpecSchema = z
  .object({
    /**
     * Spec format version. Optional in 0.1 (defaults to "glyph/0.1");
     * required from 0.2 onward. Lets agents and the compiler negotiate
     * features without breaking older specs.
     */
    version: z.enum(SUPPORTED_SPEC_VERSIONS).optional(),
    /**
     * Top-level data source. Layers inherit unless they specify their own
     * `data`. Optional only when every layer overrides.
     */
    data: DataSourceSchema.optional(),
    /** At least one drawing layer. */
    layers: z.array(LayerSchema).min(1),
    /** Override the chart title (otherwise inferred from data + encoding). */
    title: z.string().optional(),
    /** Pixel dimensions of the rendered chart. Defaults: 640 x 400. */
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    /**
     * Color theme. Four built-in presets or a full ThemeConfig with
     * brand colors. Defaults to "light".
     *
     * Presets:
     *   - "light" / "dark" — Phase-0 minimal themes
     *   - "playground"     — Joy of Math kid-friendly preset (warm cream
     *                        bg, primary-toy categorical). Resolved
     *                        through the BrandKit pipeline.
     *   - "3b1b"           — Joy of Math 3Blue1Brown-style preset
     *                        (chalkboard bg, signature blue). Resolved
     *                        through the BrandKit pipeline.
     */
    theme: z.union([z.enum(["light", "dark", "playground", "3b1b"]), ThemeConfigSchema]).optional(),
    /**
     * Moat PR4 — compositional brand kit. When set, the renderer resolves
     * the legacy `theme:` tokens from `brand` first, then merges any
     * explicit `theme:` overrides on top. `brand:` wins for palette +
     * surface colors. See BrandKitSchema for the shape; see
     * `brandKitToTheme()` in render/brand.ts for the resolution rule.
     */
    brand: BrandKitSchema.optional(),
    /**
     * BCP-47 locale used for number / date tick formatting. Defaults to
     * "en-US" so snapshot tests stay byte-identical across machines. Set
     * to e.g. "de-DE" to render 1234.5 as "1.234,5".
     */
    locale: z.string().min(2).optional(),
    /** Small-multiples layout. Phase 1.0 supports col-faceting only. */
    facet: FacetSchema.optional(),
    /** Opt into data-bound, hydratable SVG output. */
    interactive: InteractiveSchema.optional(),
    /**
     * Moat PR1 — cryptographic provenance seal. Always emitted on the
     * rendered SVG; this object only configures the optional timestamp
     * field. Omit the field entirely to keep the seal fully deterministic.
     */
    provenance: ProvenanceConfigSchema.optional(),
    /** Declarative actions for `glyph_act` — Phase 3 §4. */
    actions: z.array(ActionSchema).optional(),
    /** Map projection — required when any layer uses a `geo-*` mark. */
    projection: ProjectionSchema.optional(),
    /**
     * PR66 — polar coordinate system. When set, the compiler dispatches
     * to a polar-aware compilation path: `encoding.x` becomes the angle
     * channel, `encoding.y` becomes the radius channel. Marks translate
     * to arc / point / path in cartesian space at render time.
     */
    coordinates: CoordinatesSchema.optional(),
    /**
     * PR68 (D3 Gap 5) — deterministic seed for any layout that uses an
     * RNG (currently: force simulation). Same seed + same input → same
     * pixel positions. Defaults to 42 when unset; expose this knob so
     * agents can A/B-test different layouts of the same graph.
     */
    seed: z.number().int().optional(),
    /**
     * PR75 (D3 Gap 4) — isovalue thresholds for contour rendering. When
     * `mark: "contour"` is set, each threshold produces a separate path
     * tracing the isoline. Default: [50th percentile of grid values].
     */
    thresholds: z.array(z.number()).optional(),
    /**
     * GeoJSON FeatureCollection used by `geo-region` marks. Each feature's
     * `properties[idField]` (default: `id`) is matched against the layer's
     * `encoding.region` field on the data rows.
     *
     * Stored as `unknown` because GeoJSON is recursively typed; the
     * compiler validates shape lazily.
     */
    geojson: z
      .object({
        features: z.array(z.unknown()).optional(),
        /**
         * PR57 — alternative source: TopoJSON topology + object name. The
         * compiler converts to GeoFeatures via `topoToGeo()`. Either
         * `features` or (`topology` + optional `object`) must be set.
         */
        topology: z.unknown().optional(),
        object: z.string().optional(),
        idField: z.string().optional(),
      })
      .passthrough()
      .optional(),
    /**
     * When true, overlay a lat/lon graticule on geo charts. Optional grid
     * step in degrees (default 30°).
     */
    graticule: z
      .union([
        z.boolean(),
        z.object({ step: z.number().int().min(5).max(180).optional() }).strict(),
      ])
      .optional(),
    /**
     * Innovation #4 (PR46) — linked-view filter context. Charts that share
     * a `link_group` participate in the same selection bus: a click in one
     * chart broadcasts a SQL predicate to the others via
     * `glyph_linked_publish`. Subscribers consume via `glyph_linked_await`.
     */
    link_group: z.string().min(1).optional(),
    /**
     * Data-driven animation (PR43 + PR45 + Math Phase 2 / Track A2). Five kinds:
     *   - "stage"          — chart-wide entrance fade (PR43)
     *   - "stage-stagger"  — per-mark entrance with row-index delay (PR45)
     *   - "race"           — bar-race / scatter-race driven by `frame_field`;
     *                        emits SMIL <animate> elements over N frames (PR45)
     *   - "scrub"          — temporal slider that re-aggregates per frame
     *                        (PR45 ships the spec contract; the UI lives in
     *                        @glyph/preview-server / @glyph/live in PR46+)
     *   - "draw-in"        — pen-draw effect: line/path marks trace themselves
     *                        via SMIL `<animate>` on `stroke-dashoffset`. Use
     *                        to reveal the construction order of a parametric
     *                        curve / function plot / ODE trajectory (Track A2).
     */
    animation: z
      .union([
        z
          .object({
            kind: z.enum(["stage", "stage-stagger"]),
            duration_ms: z.number().int().min(0).max(60_000).optional(),
            /** Per-mark delay step (ms). Only honored by stage-stagger. Default 60. */
            stagger_ms: z.number().int().min(0).max(2000).optional(),
          })
          .strict(),
        z
          .object({
            kind: z.literal("race"),
            /** Column whose distinct values define the frames (e.g. "year"). */
            frame_field: z.string().min(1),
            duration_ms: z.number().int().min(100).max(120_000).optional(),
          })
          .strict(),
        z
          .object({
            kind: z.literal("scrub"),
            frame_field: z.string().min(1),
            duration_ms: z.number().int().min(100).max(120_000).optional(),
          })
          .strict(),
        z
          .object({
            kind: z.literal("draw-in"),
            duration_ms: z.number().int().min(100).max(60_000).default(2000),
            /**
             * Optional easing curve for the dashoffset animation. SMIL
             * natively supports linear and discrete; "ease-in-out" emits
             * keyTimes + keySplines so the trace starts and ends slowly.
             */
            easing: z.enum(["linear", "ease-in-out"]).optional(),
          })
          .strict(),
        // E3 — timeline animation. Sequenced scenes that fade in groups of
        // layers at declared beats, optionally with a fading caption beneath
        // the plot area. Composes with A2 draw-in / E1 annotations / E2
        // travelers: a layer included in a scene inherits that scene's
        // `begin_ms`, so per-layer animations start at the scene beat rather
        // than at chart start. Capped at 20 scenes — beyond that, the agent
        // should emit multiple story-page charts instead of one mega-spec.
        //
        // Caption cross-fade contract (E3 review IMPORTANT-3): captioned
        // scenes use a hard-coded 200ms cross-fade — caption N fades out
        // over 200ms starting at scene N+1's `begin_ms`, while caption N+1
        // fades in over its own `duration_ms` starting at that same moment.
        // The two captions overlap visually for those 200ms. When successive
        // scenes are less than 200ms apart the fade-out leaks past the next
        // scene's caption fade-in window; keep `begin_ms` deltas ≥ 300ms
        // between captioned scenes to avoid visual stutter. Final scene's
        // caption never fades out.
        //
        // Layer-membership contract (E3 review IMPORTANT-2): each layer
        // index can appear in AT MOST ONE scene's `layers` array. Duplicate
        // indices within a single scene OR across scenes throw at compile
        // time. Layers that should persist across scenes belong outside
        // any scene's `layers` — those marks render without a scene wrapper
        // (always visible, no fade-in).
        z
          .object({
            kind: z.literal("timeline"),
            scenes: z
              .array(
                z
                  .object({
                    /** Optional id for cross-references (annotations / travelers can scope to a scene). */
                    id: z.string().min(1).optional(),
                    /** When this scene becomes visible relative to chart start (ms). */
                    begin_ms: z.number().int().min(0).max(600_000),
                    /** Duration the scene's marks fade in (default 500). */
                    duration_ms: z.number().int().min(50).max(60_000).default(500),
                    /**
                     * Which layer indexes the scene contains. Other layers
                     * stay hidden until their scene fires.
                     */
                    layers: z.array(z.number().int().nonnegative()).min(1),
                    /**
                     * Optional caption rendered at the bottom of the chart,
                     * fading in alongside the scene.
                     */
                    caption: z.string().min(1).max(200).optional(),
                  })
                  .strict(),
              )
              .min(1)
              .max(20),
          })
          .strict(),
      ])
      .optional(),
  })
  .strict()
  .refine((spec) => spec.data !== undefined || spec.layers.every((l) => l.data !== undefined), {
    message: "Spec must have a top-level `data` field or every layer must override `data`.",
  });
