/**
 * compileSpec — parsed GlyphSpec + rows + schema → Scene.
 *
 * Phase 0 supports bar and point marks with single-layer specs. Multi-layer
 * compilation and the remaining marks (line, area, rect) ship in the
 * grammar fill-in PRs.
 *
 * Determinism notes:
 *   - All numeric outputs go through roundPx() (8-decimal).
 *   - Domain order for band scales is deterministic (first-seen order).
 *   - Default colors are picked deterministically from a small fixed palette.
 */

import { LIBRARY_VERSION } from "../capabilities.js";
import { type ContourGrid, marchingSquares, segmentsToPathD } from "../contour/index.js";
import {
  type FunctionDataSpec,
  type FunctionRow,
  type ParametricDataSpec,
  sampleFunction,
} from "../data/shapes/function.js";
import {
  type GeodesicDataSpec,
  type GeodesicRow,
  iterateGeodesic,
} from "../data/shapes/geodesic.js";
import { type PdeRow, type PdeSolveDataSpec, solvePde } from "../data/shapes/pde-solve.js";
import {
  type RecurrenceDataSpec,
  type RecurrenceRow,
  iterateRecurrence,
} from "../data/shapes/recurrence.js";
import {
  type TrajectoryDataSpec,
  type TrajectoryRow,
  integrateTrajectory,
} from "../data/shapes/trajectory.js";
import {
  type GeoFeature,
  type Topology,
  buildGraticule,
  featureToPath,
  projector,
  topoToGeo,
} from "../geo/index.js";
import { simulateForce } from "../layout/force.js";
import {
  flattenArcs,
  flattenRects,
  partitionLayout,
  squarifiedTreemap,
} from "../layout/hierarchy.js";
import { brandKitToTheme, mergeBrandWithTheme } from "../render/brand.js";
import { type ProvenanceScales, computeProvenance } from "../render/provenance.js";
import type {
  AxisTick,
  LegendEntry,
  MarkData,
  Scene,
  SceneAxis,
  SceneLegend,
  SceneMark,
  SceneProvenance,
  SceneSchema,
  SceneUncertainty,
} from "../scenegraph/types.js";
import type {
  Channel,
  DataProvenance,
  Encoding,
  GlyphSpec,
  GraphData,
  GridData,
  HierarchyNode,
  InteractiveConfig,
} from "../spec/types.js";
import type { MissingPolicy } from "../spec/types.js";
import { PLAYGROUND_BRAND, THREEBLUEONE_BROWN_BRAND } from "../themes/index.js";
import { getMarkCompiler, registerMark } from "./mark-registry.js";
// Moat PR3 — failure-aware rendering. buildBars / buildPoints / buildLines /
// buildAreas thread the policy through `applyMissingPolicy` instead of
// inline `Number.isFinite(yv)` filters, so the "callout" + "interpolate"
// semantics stay in one helper.
import { applyMissingPolicy } from "./missing-policy.js";
// Side-effect imports: each mark module registers itself with the registry
// at module-load. The vector-field mark is the first PR3 user; future
// math marks (math-text, streamline, ...) plug in the same way.
import "./marks/vector-field.js";
// Math PR4 — math-text registers `math-text` (KaTeX → MathML → positioned
// <text>/<path> SceneMarks).
import "./marks/math-text.js";
// E1 — annotation mark
// Joy of Math PR E1 — annotation registers `annotation` (labeled callout
// = arrow + bubble + optional highlight ring; reuses the glyph-arrow
// <marker> defined by the vector-field mark).
import "./marks/annotation.js";
// Joy of Math E2 — traveler registers `traveler` (SMIL <animateMotion> dot
// that traces a sibling layer's polyline).
import "./marks/traveler.js";
// Math Phase 2 Track A PR A3 — streamline registers `streamline` (RK4
// integration of a 2D vector field into continuous flow lines).
import "./marks/streamline.js";
// Math Phase 2 Track A PR A5 — bezier registers `bezier` (N-degree
// Bezier curve via de Casteljau with optional control polygon +
// construction-line overlay at a given parameter t).
import "./marks/bezier.js";
import {
  angleScale,
  bandScale,
  linearScale,
  niceTicks,
  polarToCartesian,
  roundPx,
} from "./scales.js";

/** Minimal field metadata needed by the compiler. ColumnInfo is a superset. */
export interface CompileFieldInfo {
  readonly name: string;
  readonly type: string;
}

/** Compiler context passed to mark builders for interactive metadata. */
interface MarkCtx {
  readonly interactive: InteractiveConfig | undefined;
  readonly xField: string;
  readonly yField: string;
  readonly colorField: string | undefined;
  /** Spec-driven tooltip override (encoding.tooltip), if set. */
  readonly tooltip: Encoding["tooltip"];
}

/** Coerce any cell value to a stable string for data attributes. */
function attrValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "bigint") return String(v);
  return String(v);
}

/**
 * Moat PR3 — resolve the spec's missing-data policy, defaulting to "skip"
 * (back-compat: every existing snapshot was rendered under skip semantics).
 * Read from `spec.data.onMissing`; layer-level overrides aren't supported
 * yet (the multi-layer compiler rejects per-layer `data` blocks upstream).
 */
function resolveMissingPolicy(spec: GlyphSpec): MissingPolicy {
  const block = spec.data as { onMissing?: MissingPolicy } | undefined;
  return block?.onMissing ?? "skip";
}

/** Build the tooltip text. Honors `encoding.tooltip` when set; otherwise
 *  falls back to the default "x: <v> · y: <v> [· color: <v>]" form. */
function buildTooltipText(
  ctx: MarkCtx,
  row: ReadonlyArray<unknown>,
  schema: ReadonlyArray<CompileFieldInfo>,
  xVal: string,
  yVal: string,
  colorVal: string | undefined,
): string {
  const tt = ctx.tooltip;
  if (tt === undefined) {
    const parts = [`${ctx.xField}: ${xVal}`, `${ctx.yField}: ${yVal}`];
    if (ctx.colorField && colorVal !== undefined) {
      parts.push(`${ctx.colorField}: ${colorVal}`);
    }
    return parts.join(" · ");
  }

  // Helper: render one channel as "<label>: <value>".
  const oneChannel = (ch: Encoding["x"]): string => {
    if (ch === undefined) return "";
    if (typeof ch === "string") {
      const v = attrValue(valueAt(row, schema, ch));
      return `${ch}: ${v}`;
    }
    // Metric channels (PR37 §1) are rewritten to `_metric_<name>` field
    // references in the materializer before compile sees them — but be
    // defensive in case a caller compiles without that pass.
    const fieldName = ch.field ?? (ch.metric ? `_metric_${ch.metric}` : "");
    const label = ch.title ?? fieldName;
    const v = attrValue(valueAt(row, schema, fieldName));
    return `${label}: ${v}`;
  };

  if (typeof tt === "string") {
    // Bare field-name string → just the value (no label prefix).
    return attrValue(valueAt(row, schema, tt));
  }
  if (Array.isArray(tt)) {
    return tt
      .map(oneChannel)
      .filter((s) => s.length > 0)
      .join(" · ");
  }
  // Single channel object.
  return oneChannel(tt);
}

/**
 * Moat 5/5 — resolve the crossfilter key-field for a spec. Precedence:
 *   1. Explicit `interactive.crossfilter.key` (caller knows best).
 *   2. The `encoding.color` field — the most common "shared dimension"
 *      across small multiples (a category that exists in every panel).
 *   3. Fallback to `encoding.x` — guarantees a key for every chart.
 * Returns `undefined` only when no crossfilter is configured.
 */
function resolveCrossfilterKeyField(ctx: MarkCtx): string | undefined {
  const xf = ctx.interactive?.crossfilter;
  if (!xf) return undefined;
  if (xf.key) return xf.key;
  if (ctx.colorField) return ctx.colorField;
  return ctx.xField;
}

/** Build optional MarkData for a row. Returns an empty object when off. */
function markDataFor(
  ctx: MarkCtx,
  row: ReadonlyArray<unknown>,
  schema: ReadonlyArray<CompileFieldInfo>,
  rowIndex: number,
): MarkData {
  if (!ctx.interactive) return {};
  const xVal = attrValue(valueAt(row, schema, ctx.xField));
  const yVal = attrValue(valueAt(row, schema, ctx.yField));
  const dataAttrs: Record<string, string> = {
    row: String(rowIndex),
    x: xVal,
    y: yVal,
  };
  let colorVal: string | undefined;
  if (ctx.colorField) {
    colorVal = attrValue(valueAt(row, schema, ctx.colorField));
    dataAttrs.color = colorVal;
  }
  const keyField = ctx.interactive.key;
  const key = keyField ? attrValue(valueAt(row, schema, keyField)) : String(rowIndex);

  // Moat 5/5 — emit `data-crossfilter-key` (and group, surfaced at the
  // scene root) whenever interactive.crossfilter is configured. Precedence
  // for the key field: explicit `crossfilter.key` → encoding.color →
  // encoding.x. Renderer wires the matching `data-crossfilter-group`
  // attribute on every mark via `renderDataAttrs`.
  if (ctx.interactive.crossfilter) {
    const xfKeyField = resolveCrossfilterKeyField(ctx);
    if (xfKeyField) {
      dataAttrs["crossfilter-key"] = attrValue(valueAt(row, schema, xfKeyField));
    }
    dataAttrs["crossfilter-group"] = ctx.interactive.crossfilter.group;
  }

  const tooltip = buildTooltipText(ctx, row, schema, xVal, yVal, colorVal);
  return { key, dataAttrs, tooltip };
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_WIDTH = 640;
const DEFAULT_HEIGHT = 400;
// PADDING.bottom must cover:
//   - the x-axis tick line itself (1 px)
//   - the tick mark (4 px below the axis)
//   - the tick labels (font 11, hanging baseline → reaches ~+27 px from
//     the axis)
//   - the x-axis title (positioned at +32 from the axis, font 12,
//     hanging baseline → reaches ~+44 px from the axis)
// 40 px was sized for the ticks alone and silently clipped the title
// bottom by ~4 px against the SVG viewBox. 48 gives a 4 px safety
// margin under the lowest descender of the title text.
const PADDING = { top: 24, right: 24, bottom: 48, left: 56 } as const;

/** Estimate how much horizontal space the legend block will need (px).
 *  Returns 0 when no color encoding is present on any layer.
 *  Used to widen padRight so legend labels don't get clipped by the SVG edge.
 */
function estimateLegendWidth(
  spec: GlyphSpec,
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
  schema: ReadonlyArray<CompileFieldInfo>,
): number {
  if (rows.length === 0) return 0;
  let max = 0;
  const seen = new Set<string>();
  const approxCharW = 6.5;
  const swatchW = 10;
  const swatchPad = 6;
  for (const layer of spec.layers) {
    const cf = fieldOf(layer.encoding.color);
    if (!cf || seen.has(cf)) continue;
    seen.add(cf);
    const cIdx = schema.findIndex((c) => c.name === cf);
    const colType = schema[cIdx]?.type ?? "VARCHAR";
    const isContinuous =
      cIdx >= 0 &&
      isQuantitativeType(colType) &&
      (layer.mark === "heatmap" || layer.mark === "geo-region");
    if (isContinuous) {
      // 7 numeric stops + title; ~6 chars per number
      const labelChars = 7;
      max = Math.max(max, swatchW + swatchPad + labelChars * approxCharW);
    } else {
      const domain = distinctOrdered(rows, schema, cf);
      const widest = domain.reduce((m, s) => Math.max(m, (s ?? "").length), cf.length);
      max = Math.max(max, swatchW + swatchPad + widest * approxCharW);
    }
  }
  // Pad the estimate so labels never touch the SVG edge.
  return max > 0 ? Math.ceil(max + 16) : 0;
}

/** Estimate bottom padding needed so x-axis ticks + axis-title don't clip.
 *  Base is PADDING.bottom (40 px); for nominal axes with longer or denser
 *  labels we add headroom. (Glyph doesn't rotate ticks yet, so we just
 *  reserve more vertical room.)
 */
function computeBottomPad(
  spec: GlyphSpec,
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
  schema: ReadonlyArray<CompileFieldInfo>,
): number {
  if (rows.length === 0) return PADDING.bottom;
  // Geo specs don't draw an axis at all.
  if (spec.layers.some((l) => l.mark === "geo-region" || l.mark === "geo-point")) {
    return PADDING.top;
  }
  // Use the first layer's x channel as a representative.
  const xCh = spec.layers[0]?.encoding.x;
  const xField = fieldOf(xCh);
  if (!xField) return PADDING.bottom;
  const cIdx = schema.findIndex((c) => c.name === xField);
  const xType = schema[cIdx]?.type ?? "VARCHAR";
  // For nominal/string axes, peek at the longest distinct value and the
  // count. The compiler may rotate labels -45° when slot < label width and
  // n ≤ 30; rotation eats ~60 px vertical instead of ~16 px horizontal.
  if (!isQuantitativeType(xType)) {
    const domain = distinctOrdered(rows, schema, xField);
    const n = domain.length;
    const widest = domain.reduce((m, s) => Math.max(m, (s ?? "").length), 0);
    if (widest >= 8) {
      // Will rotation kick in? Same condition as makeBottomAxis.
      // Approximate: if labels per available width > 1, rotate when n ≤ 30.
      // We don't know plotArea here, but we know spec.width. Use it.
      const approxW = (spec.width ?? 640) - PADDING.left - PADDING.right;
      const labelPx = widest * 6.5 + 8;
      const slot = approxW / Math.max(n, 1);
      if (labelPx > slot && n <= 30) {
        // Rotated -45°: vertical = labelPx * sin(45°) + 8px gap + 16 title.
        return Math.ceil(labelPx * 0.71 + 24);
      }
      return PADDING.bottom + 12;
    }
  }
  return PADDING.bottom;
}

interface Theme {
  readonly background: string;
  readonly fg: string;
  readonly axis: string;
  readonly grid: string;
  readonly marks: ReadonlyArray<string>;
}

const LIGHT_THEME: Theme = {
  background: "#ffffff",
  fg: "#1a1a1a",
  axis: "#999999",
  grid: "#e6e6e6",
  marks: ["#4c78a8", "#f58518", "#54a24b", "#e45756", "#72b7b2", "#eeca3b"],
};

const DARK_THEME: Theme = {
  background: "#0e0e10",
  fg: "#f3f3f3",
  axis: "#666666",
  grid: "#2a2a2a",
  marks: ["#6ea8fe", "#ffb066", "#7cd281", "#ff8284", "#9adddd", "#ffe07a"],
};

/**
 * Resolve spec.theme to an internal Theme.
 * - undefined / "light" → LIGHT_THEME
 * - "dark"               → DARK_THEME
 * - "playground"         → PLAYGROUND_BRAND, resolved via brandKitToTheme (Joy of Math E4)
 * - "3b1b"               → THREEBLUEONE_BROWN_BRAND, resolved via brandKitToTheme (Joy of Math E4)
 * - ThemeConfig          → user palette + tokens, normalized to internal shape
 *
 * Moat PR4 — when `spec.brand` is set, the brand kit resolves to a
 * Theme first; any explicit `spec.theme` ThemeConfig then layers on
 * top as overrides. `brand:` wins for surface + categorical palette
 * when no explicit override is set.
 *
 * Joy of Math E4 — when `spec.brand` is absent and `spec.theme` is a
 * BrandKit-backed preset string ("playground" / "3b1b"), the matching
 * built-in kit is resolved through `brandKitToTheme()`, so the chart
 * picks up palette + surface tokens the same way an explicit brand
 * kit would.
 */
function resolveTheme(spec: GlyphSpec): Theme {
  const specTheme = spec.theme;
  if (spec.brand !== undefined) {
    // Brand-only: derive everything from the kit. String presets
    // (including the BrandKit-backed ones) are treated as "no
    // explicit ThemeConfig override" — the brand kit alone wins.
    if (
      specTheme === undefined ||
      specTheme === "light" ||
      specTheme === "dark" ||
      specTheme === "playground" ||
      specTheme === "3b1b"
    ) {
      return brandKitToTheme(spec.brand);
    }
    // Brand + explicit ThemeConfig: merge (explicit keys win).
    return mergeBrandWithTheme(spec.brand, specTheme);
  }
  if (specTheme === undefined || specTheme === "light") return LIGHT_THEME;
  if (specTheme === "dark") return DARK_THEME;
  if (specTheme === "playground") return brandKitToTheme(PLAYGROUND_BRAND);
  if (specTheme === "3b1b") return brandKitToTheme(THREEBLUEONE_BROWN_BRAND);
  // Custom ThemeConfig — Zod has already validated structure + non-empty palette.
  return {
    background: specTheme.background,
    fg: specTheme.fg,
    axis: specTheme.axis,
    grid: specTheme.grid,
    marks: specTheme.palette,
  };
}

// ---------------------------------------------------------------------------
// Channel helpers
// ---------------------------------------------------------------------------

function fieldOf(ch: Channel | undefined): string | undefined {
  if (ch === undefined) return undefined;
  return typeof ch === "string" ? ch : ch.field;
}

function isQuantitativeType(t: string): boolean {
  return /INT|DECIMAL|DOUBLE|FLOAT|REAL|NUMERIC|HUGEINT|BIGINT|SMALLINT|TINYINT/i.test(t);
}

function typeOfColumn(schema: ReadonlyArray<CompileFieldInfo>, name: string): string {
  return schema.find((c) => c.name === name)?.type ?? "VARCHAR";
}

function fieldType(
  ch: Channel | undefined,
  schema: ReadonlyArray<CompileFieldInfo>,
): "quantitative" | "categorical" {
  if (ch === undefined) return "categorical";
  if (typeof ch !== "string" && ch.type !== undefined) {
    if (ch.type === "quantitative" || ch.type === "temporal") return "quantitative";
    return "categorical";
  }
  const name = fieldOf(ch);
  if (!name) return "categorical";
  return isQuantitativeType(typeOfColumn(schema, name)) ? "quantitative" : "categorical";
}

// ---------------------------------------------------------------------------
// Row helpers
// ---------------------------------------------------------------------------

function valueAt(
  row: ReadonlyArray<unknown>,
  schema: ReadonlyArray<CompileFieldInfo>,
  field: string,
): unknown {
  const i = schema.findIndex((c) => c.name === field);
  return i === -1 ? undefined : row[i];
}

function distinctOrdered(
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
  schema: ReadonlyArray<CompileFieldInfo>,
  field: string,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    const v = valueAt(r, schema, field);
    const s = v == null ? "" : String(v);
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

function numericExtent(
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
  schema: ReadonlyArray<CompileFieldInfo>,
  field: string,
): [number, number] {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const r of rows) {
    const v = Number(valueAt(r, schema, field));
    if (Number.isFinite(v)) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) return [min - 1, max + 1];
  return [min, max];
}

// ---------------------------------------------------------------------------
// Compilation
// ---------------------------------------------------------------------------

export interface CompileInput {
  readonly spec: GlyphSpec;
  readonly rows: ReadonlyArray<ReadonlyArray<unknown>>;
  readonly schema: ReadonlyArray<CompileFieldInfo>;
  /**
   * Internal: override the computed plot area. Used by the facet compiler
   * when laying out per-panel sub-scenes within the same SVG. Most callers
   * should leave this unset and let the compiler compute from PADDING +
   * spec.width / spec.height.
   */
  readonly plotAreaOverride?: Scene["plotArea"];
  /**
   * PR61 (PLAN item 2.3) — optional trust signals propagated from the
   * DataHandle backing this render. When present and the data is not
   * "high" confidence (or has < 30 sample rows), the compiler emits
   * `Scene.uncertainty`. When unset, Scene.uncertainty stays undefined
   * and snapshot byte-identity holds.
   */
  readonly provenance?: DataProvenance;
}

/** Threshold below which we deem a sample "low" for uncertainty rendering. */
const LOW_SAMPLE_THRESHOLD = 30;

/**
 * PR61 — derive a SceneUncertainty (or undefined) from optional provenance
 * + the spec's interactive opt-out flag. Determinism: pure function of
 * inputs, no clock, no randomness.
 */
function deriveUncertainty(
  provenance: DataProvenance | undefined,
  interactive: InteractiveConfig | undefined,
): SceneUncertainty | undefined {
  // Opt-out via spec.interactive.uncertainty = false.
  if (interactive && interactive.uncertainty === false) return undefined;
  if (!provenance) return undefined;
  const confidence = provenance.confidence;
  const lowSample = provenance.sampleRows > 0 && provenance.sampleRows < LOW_SAMPLE_THRESHOLD;
  // High-confidence + sufficient sample → don't bother the chart.
  if (confidence === "high" && !lowSample) return undefined;
  return {
    confidence,
    sampleRows: provenance.sampleRows,
    hatchBars: confidence !== "high" || lowSample,
    dimPoints: confidence === "low" || lowSample,
  };
}

/**
 * Moat PR1 — Build a `SceneProvenance` block for a compile path. Pure
 * wrapper around `computeProvenance` that supplies the package version
 * and the spec's opt-in timestamp flag so callers only have to pass
 * what they have on hand (the spec, rows, schema, and resolved scales).
 */
function buildSceneProvenance(
  spec: GlyphSpec,
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
  schema: ReadonlyArray<CompileFieldInfo>,
  scales: ProvenanceScales,
): SceneProvenance {
  return computeProvenance({
    spec,
    rows,
    schema,
    scales,
    libraryVersion: LIBRARY_VERSION,
    includeTimestamp: spec.provenance?.includeTimestamp === true,
  });
}

/** Y-axis side a layer renders against. */
type YSide = "left" | "right";

function ySideOfLayer(enc: Encoding): YSide {
  const y = enc.y;
  if (y && typeof y !== "string" && y.scale?.side === "right") return "right";
  return "left";
}

/**
 * Math PR5 — Internal source marker indicating the materialized data
 * came from a parametric `data.function` (with `parameter`+`xExpr`+`yExpr`).
 * Read by `buildLines` / `buildAreas` to decide whether to sort points
 * by x. Sorting parametric rows by x collapses closed curves like
 * Lissajous into zigzags (the curve revisits the same x values).
 *
 * Public consumers should NOT key off this string — it's an internal
 * compiler sentinel and may change. Use `spec.data.function.parameter`
 * on the unmaterialized spec instead.
 */
const PARAMETRIC_FUNCTION_SOURCE = "<inline:function-parametric>";

/**
 * Math Phase 2 Track A PR A1 — Internal source marker for materialized
 * trajectory data. Trajectories are inherently time-ordered (RK4
 * marches forward in `t`), and closed orbits like the Lotka-Volterra
 * limit cycle revisit the same `x` values — sorting by `x` would
 * zigzag them exactly the way it zigzagged parametric Lissajous in
 * PR5. The line / area mark compilers check for this sentinel and
 * disable the sort.
 *
 * Public consumers should NOT key off this string — it's an internal
 * compiler sentinel and may change. Check `spec.data.trajectory` on
 * the unmaterialized spec instead.
 */
const TRAJECTORY_SOURCE = "<inline:trajectory>";

/**
 * Math PR1 — Materialize a `data.shape: "function"` spec into row +
 * schema form so the normal compile pipeline can render it. The
 * function shape is the math sibling of the inline hierarchy / graph
 * / grid shapes (PR67 / PR68 / PR75); we follow the same "skip DuckDB,
 * synthesize rows in-process" pattern those PRs established. The
 * returned CompileInput strips `spec.data.function` (otherwise the
 * dispatch would recurse) and substitutes a `source: "<inline>"`
 * marker that satisfies the DataSourceSchema refinement.
 *
 * Determinism: pure function of the spec. Same input → same rows in
 * the same order, byte-stable.
 */
function materializeFunctionInput(input: CompileInput): CompileInput {
  const { spec } = input;
  const fn = spec.data?.function as FunctionDataSpec | ParametricDataSpec | undefined;
  if (!fn) {
    throw new Error("materializeFunctionInput called without spec.data.function");
  }
  const sampledRows = sampleFunction(fn);
  const hasZ = sampledRows.length > 0 && sampledRows[0]?.z !== undefined;
  // Math PR2 — parametric form adds the free parameter as an extra
  // schema column under its declared name (e.g. `t`). This is what
  // makes `animation.kind: "scrub" | "race"` with
  // `frame_field: "<param>"` Just Work — the existing animation
  // compiler does a `schema.findIndex(c => c.name === frame_field)`,
  // so as long as the column is in the schema, no compiler changes
  // are needed.
  const isParametric = "parameter" in fn;
  const paramName = isParametric ? fn.parameter.name : undefined;
  const schema: CompileFieldInfo[] = [
    { name: "x", type: "DOUBLE" },
    { name: "y", type: "DOUBLE" },
    ...(hasZ ? [{ name: "z", type: "DOUBLE" }] : []),
    ...(paramName !== undefined ? [{ name: paramName, type: "DOUBLE" }] : []),
  ];
  // Row layout is positional and aligned with `schema`. Null y values
  // are preserved verbatim — the renderer's line interpolator treats
  // null y as a path break, matching the convention for missing
  // tabular data. Parametric rows append the parameter value last so
  // its index lines up with the schema entry above.
  const rows: ReadonlyArray<unknown>[] = sampledRows.map((r: FunctionRow) => {
    const base: unknown[] = hasZ ? [r.x, r.y, r.z ?? null] : [r.x, r.y];
    if (paramName !== undefined) {
      base.push(r[paramName] ?? null);
    }
    return base;
  });
  return {
    ...input,
    spec: {
      ...spec,
      // Drop spec.data.function so the recursive compileSpec call falls
      // through to the normal tabular path. Substitute a stub `source`
      // so the spec still satisfies DataSourceSchema's refinement when
      // re-validated downstream.
      //
      // Math PR5 — the source marker distinguishes scalar vs parametric
      // function data downstream. Line + area marks check it to decide
      // whether to sort points by x (scalar: yes; parametric: no — the
      // sort collapses closed curves like Lissajous into zigzags). See
      // PARAMETRIC_FUNCTION_SOURCE below.
      //
      // DO NOT pattern-match this source string in user code. It's an
      // internal compiler sentinel and the value may change without
      // notice. Check `spec.data.function.parameter` on the
      // unmaterialized spec instead.
      data: { source: isParametric ? PARAMETRIC_FUNCTION_SOURCE : "<inline:function>" },
    },
    rows,
    schema,
  };
}

/**
 * Math Phase 2 Track A PR A1 — Materialize a `data.shape: "trajectory"`
 * spec into row + schema form so the normal compile pipeline can
 * render it. Mirrors {@link materializeFunctionInput} structurally:
 * skip DuckDB, integrate the ODE in-process via RK4, swap
 * `spec.data.trajectory` for a sentinel source so the recursive
 * `compileSpec` call falls through to the tabular path.
 *
 * Schema order: `t` first, then `x`, `y`. The leading `t` column is
 * the orthogonality contract with the existing `animation.kind:
 * "scrub"` engine — scrub looks up `frame_field` by name in the
 * schema, so `frame_field: "t"` Just Works. (PR2 did the same trick
 * with the parametric form's parameter column.)
 *
 * Determinism: pure function of the spec. Same input → same rows
 * (insertion order, identical evaluator), byte-stable across runs.
 */
function materializeTrajectoryInput(input: CompileInput): CompileInput {
  const { spec } = input;
  const traj = spec.data?.trajectory as TrajectoryDataSpec | undefined;
  if (!traj) {
    throw new Error("materializeTrajectoryInput called without spec.data.trajectory");
  }
  const sampledRows = integrateTrajectory(traj);
  // Schema is `[t, x, y]` — `t` first so animation.frame_field: "t"
  // resolves through the existing schema lookup with no compiler
  // changes. Row layout is positional and aligned with this order.
  const schema: CompileFieldInfo[] = [
    { name: "t", type: "DOUBLE" },
    { name: "x", type: "DOUBLE" },
    { name: "y", type: "DOUBLE" },
  ];
  const rows: ReadonlyArray<unknown>[] = sampledRows.map((r: TrajectoryRow) => [r.t, r.x, r.y]);
  return {
    ...input,
    spec: {
      ...spec,
      // Drop spec.data.trajectory so the recursive compileSpec call
      // falls through to the normal tabular path. Substitute the
      // TRAJECTORY_SOURCE sentinel so line / area marks know to
      // preserve insertion order (closed orbits would zigzag if
      // sorted by x).
      data: { source: TRAJECTORY_SOURCE },
    },
    rows,
    schema,
  };
}

/**
 * RFC 2026-05-22 — Materialize a `data.shape: "recurrence"` spec
 * into row + schema form. Structurally a sibling of
 * `materializeTrajectoryInput`: skip DuckDB, iterate the recurrence
 * via `iterateRecurrence`, swap `spec.data.recurrence` for the
 * trajectory sentinel source so line / area marks preserve insertion
 * order (closed walks like curlicues would zigzag if sorted by x).
 *
 * Schema order: `n` first, then the state variables in their declared
 * `spec.state` order. `n`-first is the orthogonality contract with
 * `animation.kind: "scrub"` and `frame_field: "n"` — same trick the
 * function shape uses with parameter columns and the trajectory shape
 * uses with `t`.
 *
 * Determinism: pure function of the spec. Every step expression goes
 * through the same `expr-eval` evaluator function / trajectory use.
 * Same input → byte-identical rows across runs and platforms.
 */
function materializeRecurrenceInput(input: CompileInput): CompileInput {
  const { spec } = input;
  const rec = spec.data?.recurrence as RecurrenceDataSpec | undefined;
  if (!rec) {
    throw new Error("materializeRecurrenceInput called without spec.data.recurrence");
  }
  const sampledRows = iterateRecurrence(rec);
  const stateNames = rec.state;
  // Schema is `[n, ...state]` — `n` first so animation.frame_field
  // resolves through the existing schema lookup with no compiler
  // changes. State variables follow in their declared order.
  const schema: CompileFieldInfo[] = [
    { name: "n", type: "BIGINT" },
    ...stateNames.map((name) => ({ name, type: "DOUBLE" as const })),
  ];
  const rows: ReadonlyArray<unknown>[] = sampledRows.map((r: RecurrenceRow) => [
    r.n,
    ...stateNames.map((name) => r[name] as number),
  ]);
  return {
    ...input,
    spec: {
      ...spec,
      // Drop spec.data.recurrence so the recursive compileSpec call
      // falls through to the normal tabular path. The TRAJECTORY_SOURCE
      // sentinel tells line / area marks to skip the x-sort — a
      // curlicue (or any recurrence with a non-monotone state) would
      // otherwise render as a zigzag.
      data: { source: TRAJECTORY_SOURCE },
    },
    rows,
    schema,
  };
}

/**
 * RFC 2026-05-22 — Materialize a `data.shape: "geodesic"` spec into
 * row + schema form. Mirrors the trajectory/recurrence materializers
 * structurally: skip DuckDB, integrate via `iterateGeodesic`, swap
 * the data source for the trajectory sentinel so line marks keep
 * insertion order (deflected geodesics are non-monotone in x when
 * they cross the y-axis).
 *
 * Schema: `[seed_id (BIGINT), lambda (DOUBLE), x (DOUBLE), y (DOUBLE)]`.
 * `seed_id` first so a `color` encoding on that field gives one hue
 * per ray (which is exactly how the joy.html gravity-lens demo
 * visualizes light bending — different rays in different colors).
 */
function materializeGeodesicInput(input: CompileInput): CompileInput {
  const { spec } = input;
  const geo = spec.data?.geodesic as GeodesicDataSpec | undefined;
  if (!geo) {
    throw new Error("materializeGeodesicInput called without spec.data.geodesic");
  }
  const sampledRows = iterateGeodesic(geo);
  const schema: CompileFieldInfo[] = [
    { name: "seed_id", type: "BIGINT" },
    { name: "lambda", type: "DOUBLE" },
    { name: "x", type: "DOUBLE" },
    { name: "y", type: "DOUBLE" },
  ];
  const rows: ReadonlyArray<unknown>[] = sampledRows.map((r: GeodesicRow) => [
    r.seed_id,
    r.lambda,
    r.x,
    r.y,
  ]);
  return {
    ...input,
    spec: {
      ...spec,
      data: { source: TRAJECTORY_SOURCE },
    },
    rows,
    schema,
  };
}

/**
 * RFC 2026-05-22 — Materialize a `data.shape: "pde-solve"` spec
 * into row + schema form. Solves the PDE forward `steps` time-steps
 * on a rows·cols grid and emits one row per cell with `[x, y, u]`.
 * Pairs with `mark: "heatmap"` for visual rendering — the same way
 * a CSV-sourced heatmap spec would compose.
 *
 * Schema: `[x (DOUBLE), y (DOUBLE), u (DOUBLE)]`. Source sentinel
 * left as `<inline:pde-solve>` so the tabular path treats rows as
 * positional 3-arrays.
 */
function materializePdeSolveInput(input: CompileInput): CompileInput {
  const { spec } = input;
  const pde = spec.data?.pde_solve as PdeSolveDataSpec | undefined;
  if (!pde) {
    throw new Error("materializePdeSolveInput called without spec.data.pde_solve");
  }
  const sampledRows = solvePde(pde);
  const schema: CompileFieldInfo[] = [
    { name: "x", type: "DOUBLE" },
    { name: "y", type: "DOUBLE" },
    { name: "u", type: "DOUBLE" },
  ];
  const rows: ReadonlyArray<unknown>[] = sampledRows.map((r: PdeRow) => [r.x, r.y, r.u]);
  return {
    ...input,
    spec: {
      ...spec,
      data: { source: "<inline:pde-solve>" },
    },
    rows,
    schema,
  };
}

export function compileSpec(input: CompileInput): Scene {
  const { spec, rows, schema } = input;
  // Faceted specs split into multiple panels; handle that upfront before
  // the single-panel compilation path below.
  if (spec.facet) {
    return compileFaceted(input);
  }
  // PR66 — polar coordinates take a dedicated compilation path; encoding
  // x → angle, y → radius. Marks emit arc / point / radial-path.
  if (spec.coordinates?.type === "polar") {
    return compilePolar(input);
  }
  // Tier-2 — `mark: "arc"` is syntactic sugar for "bar + polar". The
  // spec author writes
  //   { mark: "arc", encoding: { theta: "share", color: "department" } }
  // and we rewrite it internally into the polar bar pipeline:
  //   - coordinates auto-injected as { type: "polar", innerRadius: 0 }
  //   - encoding.theta → encoding.y  (the angle-weight field)
  //   - encoding.color stays as the slice color field
  //   - mark switches to "bar" so compilePolar's existing branch fires
  // Per-layer `innerRadius` (0..1) sets the donut hole proportionally.
  // Mixed-mark specs (an arc layer alongside non-arc layers) aren't
  // supported here — drop the sugar and write polar explicitly.
  if (spec.layers.some((l) => l.mark === "arc")) {
    const allArc = spec.layers.every((l) => l.mark === "arc");
    if (!allArc) {
      throw new Error(
        '`mark: "arc"` cannot be mixed with other marks in the same spec. ' +
          "Use polar coordinates explicitly for mixed-mark specs.",
      );
    }
    // Use the first arc layer's innerRadius as the donut config (more
    // than one arc layer is unusual; we honor the leading one).
    const firstArc = spec.layers[0] as {
      innerRadius?: number;
      encoding: { theta?: unknown; color?: unknown };
    };
    const innerRadius = Math.max(0, Math.min(0.95, firstArc.innerRadius ?? 0));
    const rewritten = {
      ...spec,
      coordinates: { type: "polar" as const, innerRadius },
      layers: spec.layers.map((l) => {
        const enc = l.encoding as Encoding & { theta?: Channel };
        const theta = enc.theta;
        // theta → x (the categorical axis for polar bar) AND → y (the
        // weight). Use the same field for both since polar bar treats
        // x as the category and y as the slice weight. If color is set,
        // the categorical x defaults to color so each slice gets its
        // own band.
        const xField = enc.color !== undefined ? enc.color : theta;
        const { theta: _omit, ...restEnc } = enc;
        const newEnc: Encoding = { ...restEnc, x: xField, y: theta };
        return { ...l, mark: "bar" as const, encoding: newEnc };
      }),
    } as typeof spec;
    return compilePolar({ ...input, spec: rewritten });
  }
  // PR67 — hierarchy data shape. Skips DuckDB entirely; the layout
  // algorithm reads the inline tree and emits rect / arc marks.
  if (spec.data?.hierarchy) {
    return compileHierarchy(input);
  }
  // PR68 — graph data shape (force-directed layout). Skips DuckDB; runs
  // the seeded force simulation and emits circle + line marks.
  if (spec.data?.graph) {
    return compileGraph(input);
  }
  // PR75 — 2D scalar-field grid for contour / density viz. Skips DuckDB;
  // runs marching-squares and emits one path mark per threshold.
  if (spec.data?.grid) {
    return compileContour(input);
  }
  // Math PR1 — `data.shape: "function"`. Samples the math expression at
  // evenly-spaced points and routes the synthesized rows through the
  // normal compile pipeline. Re-entering with materialized rows means
  // all downstream features (line / area / point marks, facet, polar,
  // animation, audit) work unchanged.
  if (spec.data?.function) {
    return compileSpec(materializeFunctionInput(input));
  }
  // Math Phase 2 Track A PR A1 — `data.shape: "trajectory"`. Integrates
  // the ODE via RK4 and routes the synthesized (t, x, y) rows through
  // the normal compile pipeline. Same orthogonality story as the
  // function shape: `animation.kind: "scrub"` with `frame_field: "t"`
  // composes with zero compiler changes because `t` is just another
  // schema column.
  if (spec.data?.trajectory) {
    return compileSpec(materializeTrajectoryInput(input));
  }
  // RFC 2026-05-22 — `data.shape: "recurrence"`. Iterates the
  // user-supplied step function for N steps and routes the
  // synthesized (n, ...state) rows through the normal compile
  // pipeline. Same orthogonality story as trajectory + function:
  // `animation.kind: "scrub"` with `frame_field: "n"` composes with
  // zero compiler changes because `n` is just another schema column.
  if (spec.data?.recurrence) {
    return compileSpec(materializeRecurrenceInput(input));
  }
  // RFC 2026-05-22 — `data.shape: "geodesic"`. RK4-integrates photon
  // paths through Schwarzschild weak-field gravity and routes
  // (seed_id, lambda, x, y) rows through the normal compile pipeline.
  // `encoding.color: "seed_id"` gives one hue per ray.
  if (spec.data?.geodesic) {
    return compileSpec(materializeGeodesicInput(input));
  }
  // RFC 2026-05-22 — `data.shape: "pde-solve"`. Heat-equation solver
  // on a 2D grid; emits `[x, y, u]` rows that pair with mark:
  // "heatmap".
  if (spec.data?.pde_solve) {
    return compileSpec(materializePdeSolveInput(input));
  }
  const width = spec.width ?? DEFAULT_WIDTH;
  const height = spec.height ?? DEFAULT_HEIGHT;
  const theme = resolveTheme(spec);
  const formatTick = makeTickFormatter(spec.locale);

  // Adjust right padding for (a) right-side axis OR (b) a legend that will
  // be drawn to the right of the plot area. Without (b), legend labels for
  // categorical / continuous color encodings overflow the SVG and clip.
  const anyRight = spec.layers.some((l) => ySideOfLayer(l.encoding) === "right");
  const legendW = estimateLegendWidth(spec, rows, schema);
  const padRight = (anyRight ? PADDING.left : PADDING.right) + (legendW > 0 ? legendW + 12 : 0);
  // Bump bottom padding when the x-axis has a non-trivial number of band
  // labels (date strings, country names) so the axis title + ticks fit.
  const padBottom = computeBottomPad(spec, rows, schema);
  const plotArea = input.plotAreaOverride ?? {
    x: PADDING.left,
    y: PADDING.top,
    width: width - PADDING.left - padRight,
    height: height - PADDING.top - padBottom,
  };

  if (spec.layers.length === 0) throw new Error("Spec has no layers");

  // Phase-1 scope guard: per-layer data overrides need separate materialization
  // and aren't supported by this compiler yet. (Re-enabled in a follow-up PR.)
  for (let i = 0; i < spec.layers.length; i++) {
    if (spec.layers[i]?.data !== undefined) {
      throw new Error(
        `Layer ${i}: per-layer 'data' overrides not yet supported in the multi-layer compiler`,
      );
    }
  }

  // Encoding-field existence check.
  //
  // Failure mode this catches: an author writes `encoding: { x: "hour" }`
  // but the schema column is `pickup_hour`. Previously the compiler
  // silently returned `undefined` from `valueAt`, every row collapsed to
  // the same empty-string band, and 12 bars stacked at the same X
  // position looking like ONE bar. No error, no warning, just a wrong
  // chart — exactly the class of bug the determinism contract is
  // supposed to make impossible to ship.
  //
  // Skip the check when:
  //   - rows is empty (no data yet — the schema may not be authoritative;
  //     this is the case used by hierarchy/graph/grid data shapes and by
  //     mark types that synthesize their own data, e.g. bezier).
  //   - the channel value is an aggregate object without a field, like
  //     `{ aggregate: "count" }` — fieldOf returns undefined and there's
  //     nothing to validate.
  //   - the mark is `geo-point`/`geo-region` (geo specs use a different
  //     coordinate model and their own field-resolution path).
  //
  // The check covers x, y, color, size, opacity — the encoding channels
  // that resolve to a row column. `tooltip`/`text` are intentionally
  // permissive (downstream consumers handle missing fields by omitting
  // the artifact). Geo channels (`lat`/`lon`/`region`) are also skipped
  // because they live on geo marks whose field-resolution path is
  // separate.
  if (rows.length > 0) {
    const validatedChannels = ["x", "y", "color", "size", "opacity"] as const;
    const schemaNames = new Set(schema.map((c) => c.name));
    for (let i = 0; i < spec.layers.length; i++) {
      const l = spec.layers[i];
      if (!l) continue;
      if (l.mark === "geo-point" || l.mark === "geo-region") continue;
      for (const ch of validatedChannels) {
        const f = fieldOf(l.encoding[ch]);
        if (f !== undefined && !schemaNames.has(f)) {
          const available = schema.map((c) => c.name).join(", ");
          throw new Error(
            `Layer ${i} encoding.${ch} references field "${f}" which is not in the schema. Available columns: [${available || "(none)"}]`,
          );
        }
      }
    }
  }

  // Validate every layer's mark + encoding upfront.
  for (let i = 0; i < spec.layers.length; i++) {
    const l = spec.layers[i];
    if (!l) continue;
    const allowedMarks = [
      "bar",
      "point",
      "line",
      "area",
      "rule",
      "geo-region",
      "heatmap",
      "boxplot",
      "text",
      // Math PR3 — vector-field rides the cartesian path with linear x/y.
      "vector-field",
      // Math PR4 — math-text renders LaTeX glyphs at (x, y) positions.
      "math-text",
      // E1 — annotation mark
      // Joy of Math PR E1 — annotation callouts with auto-positioned
      // arrow + text bubble.
      "annotation",
      // Joy of Math E2 — traveler rides the cartesian path; the leaf
      // mark compiler builds its polyline from the followed sibling.
      "traveler",
      // Math Phase 2 Track A PR A3 — streamline integrates a 2D vector
      // field into continuous flow lines via RK4. Cartesian path with
      // linear x/y, same as vector-field.
      "streamline",
      // Math Phase 2 Track A PR A5 — bezier renders a Bezier curve from
      // control points (no row data; configuration lives in
      // `layer.bezier`). Cartesian path with linear x/y.
      "bezier",
    ];
    if (!allowedMarks.includes(l.mark)) {
      throw new Error(`Phase 1 supports marks ${allowedMarks.join("|")}; layer ${i} has ${l.mark}`);
    }
    if (l.mark === "rule") {
      const hasX = fieldOf(l.encoding.x) !== undefined;
      const hasY = fieldOf(l.encoding.y) !== undefined;
      if (!hasX && !hasY) {
        throw new Error(`Layer ${i} (rule) requires either x or y encoding`);
      }
      continue;
    }
    // PR44 / PR57: geo-region needs encoding.region + spec.geojson with
    // either features[] OR topology (TopoJSON; converted at compile).
    if (l.mark === "geo-region") {
      if (fieldOf(l.encoding.region) === undefined) {
        throw new Error(`Layer ${i} (geo-region) requires encoding.region`);
      }
      const g = spec.geojson;
      const hasFeatures = g && Array.isArray((g as { features?: unknown }).features);
      const hasTopology = g && (g as { topology?: unknown }).topology !== undefined;
      if (!g || (!hasFeatures && !hasTopology)) {
        throw new Error(
          `Layer ${i} (geo-region) requires spec.geojson.features OR spec.geojson.topology`,
        );
      }
      continue;
    }
    // PR49 heatmap: requires x, y, and color (the value to encode). x and y
    // are both treated as band scales; color is quantitative.
    if (l.mark === "heatmap") {
      if (fieldOf(l.encoding.x) === undefined || fieldOf(l.encoding.y) === undefined) {
        throw new Error(`Layer ${i} (heatmap) requires both x and y encodings`);
      }
      if (fieldOf(l.encoding.color) === undefined) {
        throw new Error(`Layer ${i} (heatmap) requires color encoding (the cell value)`);
      }
      continue;
    }
    // PR50 boxplot: categorical x + quantitative y, per-group quartile box.
    if (l.mark === "boxplot") {
      if (fieldOf(l.encoding.x) === undefined || fieldOf(l.encoding.y) === undefined) {
        throw new Error(`Layer ${i} (boxplot) requires both x and y encodings`);
      }
      if (fieldType(l.encoding.y, schema) !== "quantitative") {
        throw new Error(`Layer ${i} (boxplot): y encoding must be quantitative`);
      }
      continue;
    }
    // PR50 text: x + y + text channel (the label content).
    if (l.mark === "text") {
      if (fieldOf(l.encoding.x) === undefined || fieldOf(l.encoding.y) === undefined) {
        throw new Error(`Layer ${i} (text) requires both x and y encodings`);
      }
      if (fieldOf(l.encoding.text) === undefined) {
        throw new Error(`Layer ${i} (text) requires encoding.text`);
      }
      continue;
    }
    // Math PR4 — math-text requires `expr` (the LaTeX source). Either
    // (a) `at: { x, y }` for fixed annotations / titles, OR
    // (b) `encoding.x` + `encoding.y` to render at the first row's (x, y).
    // The shared x/y scales must be linear (numeric coords); band scales
    // mean categorical data, which math-text cannot meaningfully anchor.
    if (l.mark === "math-text") {
      const expr = (l as unknown as { expr?: unknown }).expr;
      if (typeof expr !== "string" || expr.length === 0) {
        throw new Error(`Layer ${i} (math-text) requires a non-empty 'expr' field`);
      }
      const hasAt = (l as unknown as { at?: { x: unknown; y: unknown } }).at !== undefined;
      const hasEnc = fieldOf(l.encoding.x) !== undefined && fieldOf(l.encoding.y) !== undefined;
      if (!hasAt && !hasEnc) {
        throw new Error(
          `Layer ${i} (math-text) requires either 'at: { x, y }' or both x and y encodings`,
        );
      }
      continue;
    }
    // E1 — annotation mark
    // Joy of Math PR E1 — annotation needs `annotation` block (LayerSchema
    // already enforces this via refine, but re-assert here so the
    // diagnostic surfaces from the compiler rather than from the runtime
    // mark code if the schema is bypassed). The anchor's `kind: "coord"`
    // mode doesn't need encoding.x/y to resolve the anchor — but the
    // shared chart scales still need to come from somewhere, so the
    // encoding fields are required (matches how math-text routes with
    // shared x/y scales).
    if (l.mark === "annotation") {
      const ann = (l as unknown as { annotation?: unknown }).annotation;
      if (ann === undefined) {
        throw new Error(`Layer ${i} (annotation) requires an 'annotation' object`);
      }
      if (fieldOf(l.encoding.x) === undefined || fieldOf(l.encoding.y) === undefined) {
        throw new Error(`Layer ${i} (annotation) requires both x and y encodings`);
      }
      continue;
    }
    // Joy of Math E2 — traveler needs an x and y encoding (the traveler
    // projects the followed layer through the shared scales) and a
    // `traveler:` config block (the schema's refine gate enforces
    // this too, but a runtime check here surfaces a friendlier message
    // when the compiler is reached via a non-zod path — e.g. a
    // pre-validated cached spec).
    if (l.mark === "traveler") {
      if (fieldOf(l.encoding.x) === undefined || fieldOf(l.encoding.y) === undefined) {
        throw new Error(`Layer ${i} (traveler) requires both x and y encodings`);
      }
      const t = (l as { traveler?: unknown }).traveler;
      if (typeof t !== "object" || t === null) {
        throw new Error(`Layer ${i} (traveler) requires a 'traveler' config block`);
      }
      continue;
    }
    // Math Phase 2 Track A PR A3 — streamline gets its (dxdt, dydt)
    // expressions + seeds from layer.streamline; it does NOT read row
    // data. But it still needs x/y encoding so the resolved scales
    // can map integrated (x, y) points to pixels.
    if (l.mark === "streamline") {
      if (fieldOf(l.encoding.x) === undefined || fieldOf(l.encoding.y) === undefined) {
        throw new Error(`Layer ${i} (streamline) requires both x and y encodings`);
      }
      const sc = (l as unknown as { streamline?: unknown }).streamline;
      if (typeof sc !== "object" || sc === null) {
        throw new Error(`Layer ${i} (streamline) requires a 'streamline' config block`);
      }
      continue;
    }
    // Math Phase 2 Track A PR A5 — bezier reads control points + flags
    // from `layer.bezier`; rows are unused. Still needs x/y encoding so
    // the resolved scales can project (x, y) control points to pixels.
    if (l.mark === "bezier") {
      if (fieldOf(l.encoding.x) === undefined || fieldOf(l.encoding.y) === undefined) {
        throw new Error(`Layer ${i} (bezier) requires both x and y encodings`);
      }
      const bc = (l as unknown as { bezier?: unknown }).bezier;
      if (typeof bc !== "object" || bc === null) {
        throw new Error(`Layer ${i} (bezier) requires a 'bezier' config block`);
      }
      continue;
    }
    // Math PR3 — vector-field needs x, y, dx, dy in the schema. dx + dy
    // are read directly from row['dx'] / row['dy'] (no encoding override
    // yet — kept simple for v0; a `vector` encoding channel can ship in
    // a later PR).
    if (l.mark === "vector-field") {
      if (fieldOf(l.encoding.x) === undefined || fieldOf(l.encoding.y) === undefined) {
        throw new Error(`Layer ${i} (vector-field) requires both x and y encodings`);
      }
      const haveDx = schema.some((c) => c.name === "dx");
      const haveDy = schema.some((c) => c.name === "dy");
      if (!haveDx || !haveDy) {
        throw new Error(
          `Layer ${i} (vector-field) requires schema fields "dx" and "dy" (got ${schema.map((c) => c.name).join(", ")})`,
        );
      }
      continue;
    }
    if (fieldOf(l.encoding.x) === undefined || fieldOf(l.encoding.y) === undefined) {
      throw new Error(`Layer ${i} requires both x and y encodings`);
    }
    if (fieldType(l.encoding.y, schema) !== "quantitative") {
      throw new Error(`Layer ${i}: y encoding must be quantitative`);
    }
  }

  // ---- Shared x scale --------------------------------------------------
  // All layers must agree on x-field kind for now. Mixing band + linear x
  // across layers is undefined; the compiler picks band when any layer's x
  // is categorical (the safer choice for shared axes).
  const xRange: readonly [number, number] = [plotArea.x, plotArea.x + plotArea.width];
  const yRange: readonly [number, number] = [plotArea.y + plotArea.height, plotArea.y];

  const allXFields = spec.layers.map((l) => fieldOf(l.encoding.x) as string);
  const anyXCategorical = spec.layers.some(
    (l) => fieldType(l.encoding.x, schema) !== "quantitative",
  );
  // Bar marks always need a band x scale; lines + points prefer linear when
  // the x is quantitative. When mixed (a band-shaped bar layer + a line),
  // band wins so axes align — same Phase-0 trade-off.
  const anyBarLayer = spec.layers.some((l) => l.mark === "bar");

  // x scale resolver: returns either a bandScale or a linearScale
  type XScaleAny = ReturnType<typeof bandScale> | ReturnType<typeof linearScale>;
  let xScale: XScaleAny;
  let xTicksLinear: ReadonlyArray<number> | undefined;
  if (anyXCategorical || anyBarLayer) {
    // Use band: union of distinct values, in first-seen order across layers.
    const domain: string[] = [];
    const seen = new Set<string>();
    for (const f of allXFields) {
      for (const v of distinctOrdered(rows, schema, f)) {
        if (!seen.has(v)) {
          seen.add(v);
          domain.push(v);
        }
      }
    }
    xScale = bandScale(domain, xRange, 0.1);
  } else {
    // Linear: union of numeric extents.
    let xMin = Number.POSITIVE_INFINITY;
    let xMax = Number.NEGATIVE_INFINITY;
    for (const f of allXFields) {
      const [a, b] = numericExtent(rows, schema, f);
      if (a < xMin) xMin = a;
      if (b > xMax) xMax = b;
    }
    const nice = niceTicks(xMin, xMax, 6);
    xScale = linearScale(nice.domain, xRange);
    xTicksLinear = nice.ticks;
  }

  // ---- Y scales (left + optional right) --------------------------------
  function buildYScaleFor(
    side: YSide,
  ): { scale: ReturnType<typeof linearScale>; ticks: number[] } | null {
    const layersOnSide = spec.layers.filter(
      (l) =>
        ySideOfLayer(l.encoding) === side &&
        // Skip rule layers that don't encode y (vertical rules don't
        // contribute to the y domain).
        !(l.mark === "rule" && fieldOf(l.encoding.y) === undefined),
    );
    if (layersOnSide.length === 0) return null;
    let yMin = Number.POSITIVE_INFINITY;
    let yMax = Number.NEGATIVE_INFINITY;
    for (const l of layersOnSide) {
      const f = fieldOf(l.encoding.y) as string;
      const [a, b] = numericExtent(rows, schema, f);
      if (a < yMin) yMin = a;
      if (b > yMax) yMax = b;
    }
    const nice = niceTicks(Math.min(0, yMin), yMax, 5);
    return { scale: linearScale(nice.domain, yRange), ticks: nice.ticks };
  }

  const leftY = buildYScaleFor("left");
  const rightY = buildYScaleFor("right");
  if (!leftY && !rightY) throw new Error("No y scales could be built (no layers?)");

  // ---- Build marks per layer -------------------------------------------
  const marks: SceneMark[] = [];
  // For the scene.schema (interactive metadata) we use the FIRST layer's
  // encoding fields — agents that don't yet know about multi-layer get a
  // sensible default. Future PR may emit per-layer schemas.
  const firstLayer = spec.layers[0];
  if (!firstLayer) throw new Error("Spec has no layers");

  // E3 — track how many marks each layer emitted (so timeline scenes
  // can resolve `layers: number[]` → concrete `markIndices: number[]`).
  // Length === spec.layers.length; entry `i` is the count of marks
  // contributed by layer `i`. Layers that emit zero marks (e.g. due to
  // a missing scale) keep a 0 entry so downstream indexing stays
  // aligned with `spec.layers`.
  const layerMarkCounts: number[] = [];

  for (let __li = 0; __li < spec.layers.length; __li++) {
    const layer = spec.layers[__li];
    if (!layer) {
      layerMarkCounts.push(0);
      continue;
    }
    const __layerStart = marks.length;
    // The original per-layer body emits via `marks.push(…)` / mark
    // compilers' `out: marks` and uses `continue` to early-exit. We
    // wrap the body in an IIFE so those `continue`s become `return`s,
    // letting us record the per-layer count after the body runs
    // (regardless of which branch took the early exit).
    ((): void => {
      const enc = layer.encoding;
      const xField = fieldOf(enc.x);
      const yField = fieldOf(enc.y);
      const ySide = ySideOfLayer(enc);
      const yScale = (ySide === "right" ? rightY : leftY)?.scale ?? leftY?.scale;
      // Math PR3 — leaf mark dispatch goes through the mark registry. The
      // spec-shape gates BELOW (yScale/xField/yField presence; band-x for
      // bar+boxplot) remain inline because they're preconditions, not mark
      // work. Each registered compiler is a thin trampoline into the
      // matching private build* function with identical argument order so
      // byte output stays identical to the pre-registry path.
      if (layer.mark === "rule") {
        // Rule needs only one side; its y/x encoding may be missing.
        const ruleYScale = yField ? yScale : undefined;
        getMarkCompiler("rule").compile({
          layer,
          spec,
          rows,
          schema,
          theme,
          xScale,
          yScale: ruleYScale,
          xField: xField ?? "",
          yField: yField ?? "",
          ctx: undefined,
          plotArea,
          out: marks,
        });
        return;
      }
      if (layer.mark === "geo-region") {
        getMarkCompiler("geo-region").compile({
          layer,
          spec,
          rows,
          schema,
          theme,
          xScale,
          yScale,
          xField: xField ?? "",
          yField: yField ?? "",
          ctx: undefined,
          plotArea,
          out: marks,
        });
        return;
      }
      if (layer.mark === "heatmap") {
        // Heatmap bypasses the y-quantitative requirement of the regular path.
        getMarkCompiler("heatmap").compile({
          layer,
          spec,
          rows,
          schema,
          theme,
          xScale,
          yScale,
          xField: xField ?? "",
          yField: yField ?? "",
          ctx: undefined,
          plotArea,
          out: marks,
        });
        return;
      }
      if (layer.mark === "math-text") {
        // Math PR4 — math-text doesn't consume `ctx` (no tooltips on glyph
        // shards) so dispatch explicitly with ctx: undefined. The registry's
        // compiler reads layer.expr / fontSize / color / align / at off the
        // layer record directly. Dispatched BEFORE the xField/yField gate
        // because math-text supports an explicit `at: { x, y }` anchor that
        // makes the encoding-x/y fields optional (use case: chart titles).
        if (!yScale) return;
        getMarkCompiler("math-text").compile({
          layer,
          spec,
          rows,
          schema,
          theme,
          xScale,
          yScale,
          xField: xField ?? "",
          yField: yField ?? "",
          ctx: undefined,
          plotArea,
          out: marks,
        });
        return;
      }
      if (!yScale || !xField || !yField) return;
      if (layer.mark === "boxplot") {
        if (xScale.type !== "band") {
          throw new Error("boxplot mark requires a band x scale");
        }
        getMarkCompiler("boxplot").compile({
          layer,
          spec,
          rows,
          schema,
          theme,
          xScale,
          yScale,
          xField,
          yField,
          ctx: undefined,
          plotArea,
          out: marks,
        });
        return;
      }
      if (layer.mark === "text") {
        getMarkCompiler("text").compile({
          layer,
          spec,
          rows,
          schema,
          theme,
          xScale,
          yScale,
          xField,
          yField,
          ctx: undefined,
          plotArea,
          out: marks,
        });
        return;
      }
      if (layer.mark === "bar" && xScale.type !== "band") {
        throw new Error("bar mark requires a band x scale");
      }
      const ctx: MarkCtx = {
        interactive: spec.interactive,
        xField,
        yField,
        colorField: fieldOf(enc.color),
        tooltip: enc.tooltip,
      };
      // bar / point / line / area / vector-field all route via the registry.
      getMarkCompiler(layer.mark).compile({
        layer,
        spec,
        rows,
        schema,
        theme,
        xScale,
        yScale,
        xField,
        yField,
        ctx,
        plotArea,
        out: marks,
      });
    })();
    layerMarkCounts.push(marks.length - __layerStart);
  }

  // ---- Axes ------------------------------------------------------------
  const axes: SceneAxis[] = [];
  // Geo-region marks render projected polygons in their own coordinate
  // system; cartesian x/y axes are meaningless. Skip axis emission entirely
  // when any layer is a geo mark.
  const hasGeo = spec.layers.some((l) => l.mark === "geo-region" || l.mark === "geo-point");
  const xLabel = allXFields[0] ?? "x";
  if (!hasGeo) {
    if (xScale.type === "band") {
      axes.push(makeBottomAxis(xScale, plotArea, xLabel));
    } else if (xTicksLinear) {
      axes.push(makeBottomAxisLinear(xTicksLinear, xScale, plotArea, xLabel, formatTick));
    }
  }
  // Heatmap y-axis override: when the layer is a heatmap with a categorical
  // y, the leftY linear scale built above is wrong (it tries to coerce
  // strings to numbers). Replace with a band-scale axis built from
  // distinctOrdered values, matching buildHeatmap's internal scale.
  const heatmapLayer = spec.layers.find((l) => l.mark === "heatmap");
  if (heatmapLayer) {
    const hy = fieldOf(heatmapLayer.encoding.y);
    if (hy) {
      const yDomain = distinctOrdered(rows, schema, hy);
      if (yDomain.length > 0) {
        const yBand = bandScale(yDomain, [plotArea.y, plotArea.y + plotArea.height]);
        // Thin y-axis labels by available vertical budget (~16 px per row).
        const slot = 16;
        const maxRows = Math.max(1, Math.floor(plotArea.height / slot));
        const yStep = yDomain.length <= maxRows ? 1 : Math.ceil(yDomain.length / maxRows);
        const yTicks: AxisTick[] = [];
        for (let i = 0; i < yDomain.length; i += yStep) {
          const d = yDomain[i];
          if (d === undefined) continue;
          yTicks.push({ position: yBand.apply(d) + yBand.bandwidth / 2, label: d });
        }
        axes.push({
          orientation: "left",
          origin: { x: plotArea.x, y: plotArea.y },
          length: plotArea.height,
          ticks: yTicks,
          label: hy,
        });
      }
    }
  } else if (leftY && !hasGeo) {
    const leftLabel = fieldOf(
      spec.layers.find((l) => ySideOfLayer(l.encoding) === "left")?.encoding.y,
    );
    // Grid: one tick per axis tick, rendered behind the marks.
    axes.push({
      ...makeLeftAxis(leftY.ticks, leftY.scale, plotArea, leftLabel ?? "y", formatTick),
      gridTicks: leftY.ticks.map((t) => ({
        position: leftY.scale.apply(t),
        label: formatTick(t),
      })),
    });
  }
  if (rightY && !hasGeo) {
    const rightLabel = fieldOf(
      spec.layers.find((l) => ySideOfLayer(l.encoding) === "right")?.encoding.y,
    );
    axes.push(makeRightAxis(rightY.ticks, rightY.scale, plotArea, rightLabel ?? "y", formatTick));
  }

  // ---- Legends ---------------------------------------------------------
  // One legend per unique color field across all encoded layers. For
  // heatmaps with quantitative color we emit a continuous color-bar legend
  // (7 stops spanning lo..hi) with a diverging palette when the domain
  // straddles 0; for categorical color we keep the one-entry-per-value form.
  const legends: SceneLegend[] = [];
  const seenColorFields = new Set<string>();
  for (const layer of spec.layers) {
    const cf = fieldOf(layer.encoding.color);
    if (!cf || seenColorFields.has(cf)) continue;
    seenColorFields.add(cf);
    const cIdx = schema.findIndex((c) => c.name === cf);
    const isQuant =
      cIdx >= 0 &&
      isQuantitativeType(schema[cIdx]?.type ?? "VARCHAR") &&
      (layer.mark === "heatmap" || layer.mark === "geo-region");
    if (isQuant) {
      let lo = Number.POSITIVE_INFINITY;
      let hi = Number.NEGATIVE_INFINITY;
      for (const r of rows) {
        const v = r[cIdx];
        const n = typeof v === "number" ? v : typeof v === "bigint" ? Number(v) : Number(v);
        if (Number.isFinite(n)) {
          if (n < lo) lo = n;
          if (n > hi) hi = n;
        }
      }
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) continue;
      const diverging = lo < 0 && hi > 0;
      const stops = 7;
      const entries: LegendEntry[] = [];
      // Top of legend = high value (matches y-axis "high goes up")
      for (let i = stops - 1; i >= 0; i--) {
        const t = i / (stops - 1);
        const value = lo + t * (hi - lo);
        entries.push({
          label: formatTick(roundToSig(value, 3)),
          color: heatmapColor(value, lo, hi, diverging, theme),
        });
      }
      legends.push({
        kind: "color",
        title: cf,
        origin: { x: plotArea.x + plotArea.width + 12, y: plotArea.y },
        entries,
      });
      continue;
    }
    const domain = distinctOrdered(rows, schema, cf);
    if (domain.length === 0) continue;
    const entries: LegendEntry[] = domain.map((label, idx) => ({
      label,
      color: theme.marks[idx % theme.marks.length] ?? "#000",
    }));
    legends.push({
      kind: "color",
      title: cf,
      origin: { x: plotArea.x + plotArea.width + 12, y: plotArea.y },
      entries,
    });
  }

  // ---- Scene-level schema (interactivity metadata) ---------------------
  let sceneSchema: SceneSchema | undefined;
  if (spec.interactive) {
    const fields: Record<string, string> = {
      x: fieldOf(firstLayer.encoding.x) as string,
      y: fieldOf(firstLayer.encoding.y) as string,
    };
    const cf = fieldOf(firstLayer.encoding.color);
    if (cf) fields.color = cf;
    sceneSchema = {
      fields,
      // PR77 (D3 Gap 8) — surface the declarative interaction flags so
      // the renderer can emit data-glyph-* attrs for @glyph/live.
      ...(spec.interactive.zoomable === true ? { zoomable: true } : {}),
      ...(spec.interactive.lassoable === true ? { lassoable: true } : {}),
      ...(spec.interactive.voronoi === true ? { voronoiHover: true } : {}),
      // Moat 5/5 — surface the crossfilter group at the scene root so
      // the renderer emits `data-crossfilter-group="<id>"` on the SVG
      // element plus the same-chart hover CSS rule.
      ...(spec.interactive.crossfilter
        ? { crossfilterGroup: spec.interactive.crossfilter.group }
        : {}),
    };
  }

  // PR61 — uncertainty signals from optional provenance.
  const uncertainty = deriveUncertainty(input.provenance, spec.interactive);

  // Moat PR1 — cryptographic provenance seal. Captures the resolved x +
  // y domains so a regression in scale inference surfaces as a hash
  // mismatch even when (spec, rows) are unchanged.
  const scenePr = buildSceneProvenance(spec, rows, schema, {
    xDomain: xScale.domain,
    yDomain: leftY?.scale.domain ?? rightY?.scale.domain,
  });

  // E4 review IMPORTANT-1 — pass resolved theme text colors so the
  // renderer paints titles in theme.fg and axis/legend labels in
  // theme.axis. Without this, dark themes rendered dark-on-dark.
  //
  // BUT — for the default LIGHT_THEME, theme.axis is `#999` (axis-
  // LINE color), distinct from the previously hardcoded label color
  // `#333`. Populating textMuted from theme.axis on light themes
  // would lighten every axis label and shift 18+ existing snapshots.
  // Solution: only set textPrimary/textMuted when the theme is
  // non-default (i.e. background is NOT the LIGHT_THEME bg). Light
  // theme keeps the legacy hardcoded values; dark / branded themes
  // get readable text.
  const isDefaultLight = theme.background === LIGHT_THEME.background;
  return {
    width,
    height,
    background: theme.background,
    plotArea,
    axes,
    marks,
    ...(isDefaultLight ? {} : { textPrimary: theme.fg, textMuted: theme.fg }),
    ...(spec.title ? { title: spec.title } : {}),
    ...(sceneSchema ? { schema: sceneSchema } : {}),
    ...(legends.length > 0 ? { legends } : {}),
    ...(uncertainty ? { uncertainty } : {}),
    ...(spec.animation
      ? { animation: buildSceneAnimation(spec, rows, schema, marks, layerMarkCounts) }
      : {}),
    provenance: scenePr,
  };
}

/**
 * Build the scene's `animation` field from the spec + rendered marks.
 * For stage / stage-stagger we just plumb duration + stagger. For race /
 * scrub we compute per-mark values across frames so the renderer can emit
 * SMIL `<animate>` elements without re-querying the data.
 */
// ---------------------------------------------------------------------------
// PR66 — Polar coordinates
// ---------------------------------------------------------------------------

/**
 * Compile a spec under polar coordinates. Encoding x → angle, y → radius.
 * Supports the main combinations:
 *   - bar  + polar (band x, quantitative y) → pie / donut / nightingale rose
 *   - bar  + polar (band x, no y)           → equal-sized pie slices
 *   - point + polar                          → points at (cx + r·cos θ, cy + r·sin θ)
 *   - line  + polar                          → closed radial line
 *
 * Axes are not emitted in polar v0 (legends still are). Tick rings + radial
 * gridlines can be added in a follow-up when a use-case demands them.
 */
function compilePolar(input: CompileInput): Scene {
  const { spec, rows, schema } = input;
  const width = spec.width ?? DEFAULT_WIDTH;
  const height = spec.height ?? DEFAULT_HEIGHT;
  const theme = resolveTheme(spec);
  // Plot area is centered; we don't need left/right axes so just inset.
  const inset = 16;
  const plotArea = input.plotAreaOverride ?? {
    x: inset,
    y: inset,
    width: width - inset * 2,
    height: height - inset * 2,
  };
  const cx = plotArea.x + plotArea.width / 2;
  const cy = plotArea.y + plotArea.height / 2;
  const radius = Math.min(plotArea.width, plotArea.height) / 2;
  const coord = spec.coordinates;
  if (!coord) throw new Error("compilePolar called without spec.coordinates");
  const innerR = (coord.innerRadius ?? 0) * radius;
  const outerR = (coord.outerRadius ?? 0.9) * radius;
  // Default startAngle = 0° (top), endAngle = 360°. Convert deg → rad.
  const startA = ((coord.startAngle ?? 0) * Math.PI) / 180;
  const endA = ((coord.endAngle ?? 360) * Math.PI) / 180;

  if (spec.layers.length === 0) throw new Error("Spec has no layers");
  const marks: SceneMark[] = [];
  const legends: SceneLegend[] = [];

  for (let li = 0; li < spec.layers.length; li++) {
    const layer = spec.layers[li];
    if (!layer) continue;
    const enc = layer.encoding;
    const xField = fieldOf(enc.x);
    const yField = fieldOf(enc.y);
    if (!xField) {
      throw new Error(`Layer ${li}: polar coordinates require an x encoding`);
    }
    // Collect categories in first-seen order (deterministic).
    const xi = schema.findIndex((c) => c.name === xField);
    if (xi < 0) throw new Error(`Layer ${li}: field "${xField}" not in schema`);
    const yi = yField ? schema.findIndex((c) => c.name === yField) : -1;
    const seen = new Set<string>();
    const domain: string[] = [];
    const weights: number[] = [];
    for (const r of rows) {
      const xv = String(r[xi] ?? "");
      if (!seen.has(xv)) {
        seen.add(xv);
        domain.push(xv);
        weights.push(yi >= 0 ? Number(r[yi]) || 0 : 1);
      } else if (yi >= 0) {
        // Sum weights for repeated categories (group-by-x semantics).
        const idx = domain.indexOf(xv);
        weights[idx] = (weights[idx] ?? 0) + (Number(r[yi]) || 0);
      }
    }
    // Color: support color encoding (categorical) — same domain as x for pie.
    const colorField = fieldOf(enc.color);
    const colorDomain = colorField ? collectColorDomain(rows, schema, colorField) : domain;
    // Weighted angle scale for pie / donut / rose.
    const angle = angleScale(domain, startA, endA, weights);

    if (layer.mark === "bar") {
      // Pie / donut: slice angle is proportional to weight (y or count);
      // every slice uses the full outerR. Rose / nightingale (radius
      // varies per slice) can land in a follow-up via a `stat: "rose"`
      // marker on the layer.
      for (let i = 0; i < domain.length; i++) {
        const cat = domain[i] ?? "";
        const [a0, a1] = angle.apply(cat);
        if (!Number.isFinite(a0)) continue;
        const fillColor = colorForCategorical(domain[i] ?? "", colorDomain, theme);
        const arcMark: SceneMark = {
          type: "arc",
          cx: roundPx(cx),
          cy: roundPx(cy),
          innerRadius: roundPx(innerR),
          outerRadius: roundPx(outerR),
          startAngle: a0,
          endAngle: a1,
          fill: fillColor,
        };
        marks.push(arcMark);
      }
      // Legend.
      legends.push({
        kind: "color",
        title: colorField ?? xField,
        origin: { x: plotArea.x + plotArea.width + 12, y: plotArea.y },
        entries: domain.map((d) => ({
          label: d,
          color: colorForCategorical(d, colorDomain, theme),
        })),
      });
    } else if (layer.mark === "point") {
      // Points at (cx + r cos θ, cy + r sin θ). Radius from yField; if no
      // y encoding, default to outerR.
      const yMax = yi >= 0 ? Math.max(...weights, 1) : 1;
      for (let i = 0; i < domain.length; i++) {
        const cat = domain[i] ?? "";
        const [a0, a1] = angle.apply(cat);
        const a = (a0 + a1) / 2;
        const r = yi >= 0 ? (outerR * (weights[i] ?? 0)) / yMax : outerR;
        const p = polarToCartesian(cx, cy, a, r);
        marks.push({
          type: "circle",
          cx: p.x,
          cy: p.y,
          r: 4,
          fill: theme.marks[0] ?? "#000",
        });
      }
    } else if (layer.mark === "line") {
      // Build a closed radial path: connect each category's (angle, radius).
      const yMax = yi >= 0 ? Math.max(...weights, 1) : 1;
      const points: string[] = [];
      for (let i = 0; i < domain.length; i++) {
        const cat = domain[i] ?? "";
        const [a0, a1] = angle.apply(cat);
        const a = (a0 + a1) / 2;
        const r = yi >= 0 ? (outerR * (weights[i] ?? 0)) / yMax : outerR;
        const p = polarToCartesian(cx, cy, a, r);
        points.push(`${i === 0 ? "M" : "L"} ${p.x} ${p.y}`);
      }
      // Close the loop.
      points.push("Z");
      marks.push({
        type: "path",
        d: points.join(" "),
        stroke: theme.marks[0] ?? "#000",
        strokeWidth: 2,
        fill: "none",
      });
    } else {
      // Fail loudly rather than emit an empty chart. Polar v0 supports
      // bar (pie/donut), point, and line; other marks need explicit
      // polar-mode support — see H3 from PR review.
      throw new Error(
        `Layer ${li}: polar coordinates support marks "bar" | "point" | "line" in v0, got "${layer.mark}". Drop spec.coordinates to render in cartesian space.`,
      );
    }
  }

  // Uncertainty (PR61) still works in polar.
  const uncertainty = deriveUncertainty(input.provenance, spec.interactive);

  // Moat PR1 — polar charts don't share x/y scale objects with the
  // cartesian path; the seal captures the radial geometry instead.
  const scenePr = buildSceneProvenance(spec, rows, schema, {
    xDomain: [String(innerR), String(outerR)],
    yDomain: [startA, endA],
  });

  return {
    width,
    height,
    background: theme.background,
    plotArea,
    axes: [],
    marks,
    ...(spec.title ? { title: spec.title } : {}),
    ...(legends.length > 0 ? { legends } : {}),
    ...(uncertainty ? { uncertainty } : {}),
    provenance: scenePr,
  };
}

function colorForCategorical(
  category: string,
  domain: ReadonlyArray<string>,
  theme: Theme,
): string {
  const idx = domain.indexOf(category);
  if (idx < 0) return theme.marks[0] ?? "#000";
  return theme.marks[idx % theme.marks.length] ?? "#000";
}

function collectColorDomain(
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
  schema: ReadonlyArray<CompileFieldInfo>,
  field: string,
): string[] {
  const idx = schema.findIndex((c) => c.name === field);
  if (idx < 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    const v = String(r[idx] ?? "");
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// PR67 — Hierarchy data shape (treemap / sunburst)
// ---------------------------------------------------------------------------

/**
 * Compile a spec whose data is an inline hierarchy. Dispatches on the
 * layer mark:
 *   - "treemap"  → squarifiedTreemap → rect marks (one per node).
 *                  Leaves get the deepest fill color; interior nodes get
 *                  a translucent outline so the hierarchy is visible.
 *   - "sunburst" → partitionLayout   → arc marks (one per node).
 *
 * Only the first layer's mark is honored in v0 (hierarchical viz is
 * inherently single-mark — overlays would be added in a follow-up).
 *
 * Determinism: layout algorithms use no clock / no RNG. Re-rendering
 * the same spec produces the same SVG bytes.
 */
function compileHierarchy(input: CompileInput): Scene {
  const { spec } = input;
  // The Zod schema declares hierarchy as recursively-typed `any` to avoid
  // exactOptionalPropertyTypes friction; cast back to the public type
  // since the materializer would have validated shape upfront.
  const hierarchy = spec.data?.hierarchy as HierarchyNode | undefined;
  if (!hierarchy) {
    throw new Error("compileHierarchy called without spec.data.hierarchy");
  }
  const width = spec.width ?? DEFAULT_WIDTH;
  const height = spec.height ?? DEFAULT_HEIGHT;
  const theme = resolveTheme(spec);
  const inset = 16;
  const plotArea = input.plotAreaOverride ?? {
    x: inset,
    y: inset,
    width: width - inset * 2,
    height: height - inset * 2,
  };
  if (spec.layers.length === 0) throw new Error("Spec has no layers");
  const layer = spec.layers[0];
  if (!layer) throw new Error("Spec has no first layer");
  const mark = layer.mark;
  const marks: SceneMark[] = [];

  if (mark === "treemap") {
    const root = squarifiedTreemap(
      hierarchy,
      plotArea.x,
      plotArea.y,
      plotArea.x + plotArea.width,
      plotArea.y + plotArea.height,
    );
    const all = flattenRects(root);
    // Leaves get filled rects; interior nodes (depth > 0 but with children)
    // get outline-only rects so the hierarchy structure stays visible.
    for (const node of all) {
      if (node.depth === 0) continue; // skip root rectangle (would cover the chart)
      const w = node.x1 - node.x0;
      const h = node.y1 - node.y0;
      if (w <= 0 || h <= 0) continue;
      const isLeaf = !node.children || node.children.length === 0;
      const palette = theme.marks;
      const fill = isLeaf ? (palette[(node.depth - 1) % palette.length] ?? "#000") : "transparent";
      const rectMark: SceneMark = {
        type: "rect",
        x: roundPx(node.x0),
        y: roundPx(node.y0),
        width: roundPx(w),
        height: roundPx(h),
        fill,
        stroke: theme.background ?? "#fff",
        strokeWidth: 1,
      };
      marks.push(rectMark);
      // Add a text label for leaves big enough to fit.
      if (isLeaf && w > 50 && h > 16) {
        marks.push({
          type: "text",
          x: roundPx(node.x0 + 4),
          y: roundPx(node.y0 + 14),
          text: node.name,
          fontSize: 11,
          fill: "#fff",
          anchor: "start",
          baseline: "alphabetic",
        });
      }
    }
  } else if (mark === "sunburst") {
    const cx = plotArea.x + plotArea.width / 2;
    const cy = plotArea.y + plotArea.height / 2;
    const radius = Math.min(plotArea.width, plotArea.height) / 2 - 4;
    const root = partitionLayout(hierarchy, 0, radius);
    const all = flattenArcs(root);
    const palette = theme.marks;
    for (const node of all) {
      if (node.depth === 0) continue; // skip root (would be a point)
      if (node.endAngle - node.startAngle <= 0) continue;
      const fill = palette[(node.depth - 1) % palette.length] ?? "#000";
      marks.push({
        type: "arc",
        cx: roundPx(cx),
        cy: roundPx(cy),
        innerRadius: roundPx(node.innerRadius),
        outerRadius: roundPx(node.outerRadius),
        startAngle: node.startAngle,
        endAngle: node.endAngle,
        fill,
        stroke: theme.background ?? "#fff",
        strokeWidth: 1,
      });
    }
  } else {
    throw new Error(
      `Hierarchy data shape requires a "treemap" or "sunburst" mark on the first layer, got "${mark}"`,
    );
  }

  const uncertainty = deriveUncertainty(input.provenance, spec.interactive);

  // Moat PR1 — hierarchy charts skip the cartesian scale plumbing; the
  // seal still captures the plot-area dimensions so a layout regression
  // surfaces as a scaleDigest mismatch.
  const scenePr = buildSceneProvenance(spec, input.rows, input.schema, {
    xDomain: [plotArea.x, plotArea.x + plotArea.width],
    yDomain: [plotArea.y, plotArea.y + plotArea.height],
  });

  return {
    width,
    height,
    background: theme.background,
    plotArea,
    axes: [],
    marks,
    ...(spec.title ? { title: spec.title } : {}),
    ...(uncertainty ? { uncertainty } : {}),
    provenance: scenePr,
  };
}

// ---------------------------------------------------------------------------
// PR68 — Graph data shape (force-directed layout)
// ---------------------------------------------------------------------------

/**
 * Compile a spec whose data is an inline graph (nodes + edges). Runs
 * `simulateForce` with a deterministic seed (spec.seed, default 42) and
 * emits:
 *   - one line mark per edge
 *   - one circle mark per node (color picked by group if encoded)
 *
 * Determinism: same spec → same SVG bytes. The seed is the determinism
 * knob; agents can A/B-test different layouts by varying it.
 */
function compileGraph(input: CompileInput): Scene {
  const { spec } = input;
  const graph = spec.data?.graph as GraphData | undefined;
  if (!graph) throw new Error("compileGraph called without spec.data.graph");
  const width = spec.width ?? DEFAULT_WIDTH;
  const height = spec.height ?? DEFAULT_HEIGHT;
  const theme = resolveTheme(spec);
  const inset = 16;
  const plotArea = input.plotAreaOverride ?? {
    x: inset,
    y: inset,
    width: width - inset * 2,
    height: height - inset * 2,
  };
  if (spec.layers.length === 0) throw new Error("Spec has no layers");
  const layer = spec.layers[0];
  if (!layer || layer.mark !== "force") {
    throw new Error(`Graph data requires a "force" mark on the first layer, got "${layer?.mark}"`);
  }
  // Run the simulation.
  const bounds: readonly [number, number, number, number] = [
    plotArea.x,
    plotArea.y,
    plotArea.x + plotArea.width,
    plotArea.y + plotArea.height,
  ];
  // Validate edges reference real nodes — silent skip masks data bugs the
  // user needs to know about (H4 from PR review).
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  for (const e of graph.edges ?? []) {
    if (!nodeIds.has(e.source)) {
      throw new Error(`Edge { source: "${e.source}" } references an unknown node id`);
    }
    if (!nodeIds.has(e.target)) {
      throw new Error(`Edge { target: "${e.target}" } references an unknown node id`);
    }
  }
  const positioned = simulateForce(
    graph.nodes.map((n) => ({
      id: n.id,
      ...(n.x !== undefined ? { x: n.x } : {}),
      ...(n.y !== undefined ? { y: n.y } : {}),
      ...(n.r !== undefined ? { r: n.r } : {}),
    })),
    graph.edges ?? [],
    {
      bounds,
      seed: spec.seed ?? 42,
    },
  );
  const positionMap = new Map(positioned.map((p) => [p.id, p]));
  const marks: SceneMark[] = [];

  // Edges first (so they sit under nodes).
  for (const e of graph.edges ?? []) {
    const s = positionMap.get(e.source);
    const t = positionMap.get(e.target);
    if (!s || !t) continue;
    marks.push({
      type: "line",
      x1: s.x,
      y1: s.y,
      x2: t.x,
      y2: t.y,
      stroke: "#999",
      strokeWidth: 1,
    });
  }

  // Nodes — color by group if any node carries a group field.
  const groups = new Set<string>();
  for (const n of graph.nodes) {
    if (n.group !== undefined) groups.add(n.group);
  }
  const groupArr = [...groups];
  for (const n of graph.nodes) {
    const p = positionMap.get(n.id);
    if (!p) continue;
    const fill =
      n.group !== undefined
        ? (theme.marks[groupArr.indexOf(n.group) % theme.marks.length] ?? theme.marks[0] ?? "#000")
        : (theme.marks[0] ?? "#000");
    marks.push({
      type: "circle",
      cx: p.x,
      cy: p.y,
      r: p.r,
      fill,
    });
  }

  const uncertainty = deriveUncertainty(input.provenance, spec.interactive);

  // Moat PR1 — graph layout has no shared scale; the seal anchors on
  // the seeded simulation's bounding box via plotArea.
  const scenePr = buildSceneProvenance(spec, input.rows, input.schema, {
    xDomain: [plotArea.x, plotArea.x + plotArea.width],
    yDomain: [plotArea.y, plotArea.y + plotArea.height],
  });

  return {
    width,
    height,
    background: theme.background,
    plotArea,
    axes: [],
    marks,
    ...(spec.title ? { title: spec.title } : {}),
    ...(uncertainty ? { uncertainty } : {}),
    provenance: scenePr,
  };
}

// ---------------------------------------------------------------------------
// PR75 — Contour / density (D3 Gap 4)
// ---------------------------------------------------------------------------

/**
 * Compile a spec whose data is a 2D scalar-field grid. Runs marching
 * squares at each threshold in `spec.thresholds` (defaults to the
 * grid's 50th percentile when unset) and emits one `path` SceneMark
 * per threshold, scaled to the plot area.
 *
 * Determinism: marching squares is pure-fn; same grid + thresholds →
 * same SVG bytes.
 */
function compileContour(input: CompileInput): Scene {
  const { spec } = input;
  const grid = spec.data?.grid as GridData | undefined;
  if (!grid) throw new Error("compileContour called without spec.data.grid");
  const width = spec.width ?? DEFAULT_WIDTH;
  const height = spec.height ?? DEFAULT_HEIGHT;
  const theme = resolveTheme(spec);
  const inset = 16;
  const plotArea = input.plotAreaOverride ?? {
    x: inset,
    y: inset,
    width: width - inset * 2,
    height: height - inset * 2,
  };
  if (spec.layers.length === 0) throw new Error("Spec has no layers");
  const layer = spec.layers[0];
  if (!layer || layer.mark !== "contour") {
    throw new Error(
      `Grid data shape requires a "contour" mark on the first layer, got "${layer?.mark}".`,
    );
  }

  // Default thresholds: a single isoline at the median of the grid.
  const defaultThresholds = (): number[] => {
    // Defense-in-depth — the schema rejects non-finite values, but if
    // the compiler is reached via a direct compileSpec call (no spec
    // parse), NaN would non-deterministically reorder the sort (PR75
    // review).
    const finite = grid.values.filter((v) => Number.isFinite(v));
    if (finite.length === 0) return [];
    const sorted = [...finite].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    return [median];
  };
  const thresholds = spec.thresholds ?? defaultThresholds();

  // Cell-to-pixel scale: the grid's (col, row) span maps to the plot area.
  const cellW = plotArea.width / Math.max(1, grid.cols - 1);
  const cellH = plotArea.height / Math.max(1, grid.rows - 1);
  const scaleFn = (cx: number, cy: number) => ({
    x: roundPx(plotArea.x + cx * cellW),
    y: roundPx(plotArea.y + cy * cellH),
  });

  const marks: SceneMark[] = [];
  const palette = theme.marks;
  // Group segments by threshold so each isoline gets one path element.
  const segments = marchingSquares(
    { rows: grid.rows, cols: grid.cols, values: grid.values } as ContourGrid,
    thresholds,
  );
  const byThreshold = new Map<number, (typeof segments)[number][]>();
  for (const s of segments) {
    const bucket = byThreshold.get(s.threshold);
    if (bucket) bucket.push(s);
    else byThreshold.set(s.threshold, [s]);
  }
  // Emit in input-threshold order for determinism.
  for (let i = 0; i < thresholds.length; i++) {
    const t = thresholds[i];
    if (t === undefined || !Number.isFinite(t)) continue;
    const segs = byThreshold.get(t) ?? [];
    if (segs.length === 0) continue;
    const d = segmentsToPathD(segs, scaleFn);
    marks.push({
      type: "path",
      d,
      stroke: palette[i % palette.length] ?? "#000",
      strokeWidth: 1.5,
      fill: "none",
    });
  }

  const uncertainty = deriveUncertainty(input.provenance, spec.interactive);

  // Moat PR1 — contour has no input rows table; the seal hashes the
  // grid's dimensions + threshold list via the spec (the only source
  // of truth for both).
  const scenePr = buildSceneProvenance(spec, input.rows, input.schema, {
    xDomain: [plotArea.x, plotArea.x + plotArea.width],
    yDomain: [plotArea.y, plotArea.y + plotArea.height],
  });

  return {
    width,
    height,
    background: theme.background,
    plotArea,
    axes: [],
    marks,
    ...(spec.title ? { title: spec.title } : {}),
    ...(uncertainty ? { uncertainty } : {}),
    provenance: scenePr,
  };
}

function buildSceneAnimation(
  spec: GlyphSpec,
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
  schema: ReadonlyArray<CompileFieldInfo>,
  marks: ReadonlyArray<SceneMark>,
  layerMarkCounts: ReadonlyArray<number>,
): NonNullable<Scene["animation"]> {
  const anim = spec.animation;
  if (!anim) throw new Error("buildSceneAnimation called without spec.animation");
  if (anim.kind === "stage" || anim.kind === "stage-stagger") {
    return {
      kind: anim.kind,
      duration_ms: anim.duration_ms ?? 700,
      ...("stagger_ms" in anim && anim.stagger_ms !== undefined
        ? { stagger_ms: anim.stagger_ms }
        : anim.kind === "stage-stagger"
          ? { stagger_ms: 60 }
          : {}),
    };
  }
  if (anim.kind === "draw-in") {
    // Math Phase 2 / Track A2 — pen-draw effect. The renderer reads each
    // path mark's `d` attribute, computes the polyline length, and emits
    // a SMIL <animate> on stroke-dashoffset. No frame plumbing needed
    // here — the animation is purely geometric and lives in the renderer.
    return {
      kind: "draw-in",
      duration_ms: anim.duration_ms ?? 2000,
      ...(anim.easing !== undefined ? { easing: anim.easing } : {}),
    };
  }
  // E3 — timeline animation. Resolve each spec-scene's `layers: number[]`
  // to the concrete `markIndices: number[]` of the scene's marks in
  // `Scene.marks`. Layer-i contributes marks at positions
  // [sum(counts[0..i-1]) .. sum(counts[0..i])-1].
  if (anim.kind === "timeline") {
    const layerOffsets: number[] = [];
    let acc = 0;
    for (const n of layerMarkCounts) {
      layerOffsets.push(acc);
      acc += n;
    }
    // E3 review IMPORTANT-2 — `scene.layers` is a user-supplied number[].
    // Duplicate indices ([0, 0, 1]) used to silently double-render the
    // layer's marks inside the scene's <g>; same problem if layer 1
    // appeared in two scenes' layers arrays — its marks would render
    // twice. Track every layer index claimed across the WHOLE timeline,
    // throw on cross-scene duplicates, and dedupe within a single scene's
    // layers array with a clear error message.
    const claimedLayers = new Set<number>();
    const resolvedScenes = anim.scenes.map((s, sceneIdx) => {
      const sceneLayers = new Set<number>();
      const indices: number[] = [];
      for (const li of s.layers) {
        if (li >= layerMarkCounts.length) {
          throw new Error(
            `animation.scenes[${sceneIdx}]: layer index ${li} out of range (spec has ${layerMarkCounts.length} layers)`,
          );
        }
        if (sceneLayers.has(li)) {
          throw new Error(
            `animation.scenes[${sceneIdx}].layers contains duplicate index ${li}. Each layer can appear at most once per scene; deduplicate the array.`,
          );
        }
        if (claimedLayers.has(li)) {
          throw new Error(
            `animation.scenes[${sceneIdx}].layers: layer ${li} is already claimed by an earlier scene. Each layer can appear in at most one scene; a layer that should persist across scenes belongs outside the scenes arrays (it will render without a scene wrapper).`,
          );
        }
        sceneLayers.add(li);
        claimedLayers.add(li);
        const offset = layerOffsets[li] ?? 0;
        const count = layerMarkCounts[li] ?? 0;
        for (let k = 0; k < count; k++) indices.push(offset + k);
      }
      return {
        ...(s.id !== undefined ? { id: s.id } : {}),
        begin_ms: s.begin_ms,
        duration_ms: s.duration_ms,
        markIndices: indices,
        ...(s.caption !== undefined ? { caption: s.caption } : {}),
      };
    });
    return { kind: "timeline", scenes: resolvedScenes };
  }
  // race / scrub — bucket rows by frame_field, derive a per-row series.
  // For v0 we drive bar widths (the most common race chart). The renderer
  // detects rect marks and animates their width attribute through the
  // computed frame values.
  if (anim.kind !== "race" && anim.kind !== "scrub") {
    throw new Error(`Unsupported animation kind: ${(anim as { kind: string }).kind}`);
  }
  const frameField = anim.frame_field;
  const fieldIdx = schema.findIndex((c) => c.name === frameField);
  if (fieldIdx < 0) {
    throw new Error(`animation.frame_field "${frameField}" not found in schema`);
  }
  // Distinct frame values, in their natural order (first-seen).
  const seen = new Set<string>();
  const frameLabels: string[] = [];
  for (const r of rows) {
    const v = String(r[fieldIdx] ?? "");
    if (!seen.has(v)) {
      seen.add(v);
      frameLabels.push(v);
    }
  }
  const frames = frameLabels.map((label) => ({
    label,
    // For v0, the per-mark values are the mark's existing geometric value
    // (width for rect, r for circle). The renderer interpolates them via
    // SMIL across frames. A complete race needs ranked rows + per-frame
    // bar-width recompute; that lands once the per-frame compile path
    // (re-aggregating per frame) is built.
    values: marks.map((m) => extractRaceValue(m)),
  }));
  return {
    kind: anim.kind,
    duration_ms: anim.duration_ms ?? 8000,
    frame_field: anim.frame_field,
    frames,
  };
}

function extractRaceValue(m: SceneMark): number {
  if (m.type === "rect") return m.width;
  if (m.type === "circle") return m.r;
  return 0;
}

// ---------------------------------------------------------------------------
// Mark builders
// ---------------------------------------------------------------------------

function colorForRow(
  encoding: Encoding,
  schema: ReadonlyArray<CompileFieldInfo>,
  row: ReadonlyArray<unknown>,
  colorDomain: ReadonlyArray<string>,
  theme: Theme,
  rows?: ReadonlyArray<ReadonlyArray<unknown>>,
): string {
  // Tier-1 encoder fix: `color: { value: "#hex" }` short-circuits all the
  // domain/range / palette logic — every row uses the literal.
  if (
    typeof encoding.color === "object" &&
    encoding.color !== null &&
    (encoding.color as { value?: unknown }).value !== undefined
  ) {
    return String((encoding.color as { value: unknown }).value);
  }
  const field = fieldOf(encoding.color);
  if (!field || colorDomain.length <= 1) return theme.marks[0] ?? "#000";
  // If the color field is quantitative (declared or schema-inferred), use a
  // continuous color scale rather than mapping each row to a palette entry.
  if (rows && isQuantColorField(encoding.color, schema, field)) {
    const idx = schema.findIndex((c) => c.name === field);
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (const r of rows) {
      const n = Number(r[idx]);
      if (Number.isFinite(n)) {
        if (n < lo) lo = n;
        if (n > hi) hi = n;
      }
    }
    const n = Number(valueAt(row, schema, field));
    if (!Number.isFinite(n) || !Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi)
      return theme.grid;
    const diverging = lo < 0 && hi > 0;
    return heatmapColor(n, lo, hi, diverging, theme);
  }
  const v = valueAt(row, schema, field);
  const s = v == null ? "" : String(v);
  const i = colorDomain.indexOf(s);
  return theme.marks[Math.max(0, i) % theme.marks.length] ?? "#000";
}

function isQuantColorField(
  ch: Channel | undefined,
  schema: ReadonlyArray<CompileFieldInfo>,
  field: string,
): boolean {
  if (typeof ch !== "string" && ch && ch.type === "quantitative") return true;
  return isQuantitativeType(typeOfColumn(schema, field));
}

/**
 * Build the SVG `d` string for a sequence of polyline points, honoring
 * the layer's `interpolate` mode. Used by both line and area marks.
 *
 *   - "linear" (default): straight segments. Output identical to the
 *     pre-Tier-2 implementation, so existing snapshots stay byte-equal.
 *   - "step": horizontal at yᵢ until xᵢ₊₁, then vertical to yᵢ₊₁.
 *     The classic staircase — value holds until the next sample.
 *   - "step-before": vertical to yᵢ₊₁ first at xᵢ, then horizontal.
 *     For "the value changes AT the timestamp" semantics.
 */
function buildLinePath(
  pts: ReadonlyArray<{ x: number; y: number }>,
  interpolate: "linear" | "step" | "step-before" | undefined,
): string {
  if (pts.length === 0) return "";
  const first = pts[0];
  if (!first) return "";
  let d = `M ${first.x} ${first.y}`;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (!a || !b) continue;
    if (interpolate === "step") {
      d += ` L ${b.x} ${a.y} L ${b.x} ${b.y}`;
    } else if (interpolate === "step-before") {
      d += ` L ${a.x} ${b.y} L ${b.x} ${b.y}`;
    } else {
      d += ` L ${b.x} ${b.y}`;
    }
  }
  return d;
}

/**
 * Tier-1 encoder fix — map a row's `encoding.size` value to a pixel
 * radius. Previously the compiler ignored the size channel and emitted
 * every point with r=3, which broke the canonical "bubble area =
 * magnitude" pattern (Gapminder, CAC/LTV scatter, etc.).
 *
 * Behavior:
 *   - `encoding.size === undefined`               → returns `defaultR`
 *   - `encoding.size = { value: <n> }`            → returns the literal
 *   - `encoding.size = "field"` or `{ field }`    → linearly maps the
 *      field's [min, max] across `rows` to the radius range
 *      [rMin, rMax]. Range defaults to [3, 24]; override with
 *      `encoding.size.scale.range`.
 *
 * Mapping uses sqrt so visual *area* scales with value (Tufte's rule —
 * eyes read area, not radius). Stays deterministic: the min/max scan
 * is in row order with no random tiebreakers.
 */
function radiusForRow(
  encoding: Encoding,
  schema: ReadonlyArray<CompileFieldInfo>,
  row: ReadonlyArray<unknown>,
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
  defaultR = 3,
): number {
  const size = encoding.size;
  if (size === undefined) return defaultR;
  if (typeof size === "object" && size !== null) {
    const sObj = size as { value?: unknown; field?: string; scale?: { range?: unknown } };
    if (sObj.value !== undefined) {
      const n = Number(sObj.value);
      return Number.isFinite(n) && n >= 0 ? n : defaultR;
    }
  }
  const field = fieldOf(size);
  if (!field) return defaultR;
  const v = Number(valueAt(row, schema, field));
  if (!Number.isFinite(v)) return defaultR;
  let rMin = 3;
  let rMax = 24;
  if (typeof size === "object" && size !== null) {
    const range = (size as { scale?: { range?: unknown } }).scale?.range;
    if (Array.isArray(range) && range.length >= 2) {
      const a = Number(range[0]);
      const b = Number(range[1]);
      if (Number.isFinite(a) && Number.isFinite(b) && a >= 0 && b >= 0) {
        rMin = Math.min(a, b);
        rMax = Math.max(a, b);
      }
    }
  }
  const idx = schema.findIndex((c) => c.name === field);
  if (idx === -1) return defaultR;
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const r of rows) {
    const n = Number(r[idx]);
    if (Number.isFinite(n)) {
      if (n < lo) lo = n;
      if (n > hi) hi = n;
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) {
    return (rMin + rMax) / 2;
  }
  const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  return rMin + Math.sqrt(t) * (rMax - rMin);
}

function buildBars(
  out: SceneMark[],
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
  schema: ReadonlyArray<CompileFieldInfo>,
  encoding: Encoding,
  xField: string,
  yField: string,
  xScale: ReturnType<typeof bandScale>,
  yScale: ReturnType<typeof linearScale>,
  theme: Theme,
  ctx: MarkCtx,
  policy: MissingPolicy = "skip",
): void {
  const colorField = fieldOf(encoding.color);
  const colorDomain = colorField ? distinctOrdered(rows, schema, colorField) : [];
  const yZero = yScale.apply(0);
  // Moat PR3 — every yv decision routes through the policy resolver so
  // the "skip" / "callout" / "interpolate" semantics live in one helper.
  // Under "skip" (the default), this function is byte-equivalent to the
  // pre-PR3 implementation: missing rows drop, valid rows render as
  // before.
  const yIdx = schema.findIndex((c) => c.name === yField);
  const policied = applyMissingPolicy(
    rows.map((r) => ({ x: valueAt(r, schema, xField), y: yIdx >= 0 ? r[yIdx] : undefined })),
    policy,
  );
  // Iterate rows directly so MarkData carries the original row index
  // (matches prior data-row attribute semantics). Under "skip", drop
  // missing rows on the fly via a parallel cursor into `policied`.
  let policyCursor = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    let pt: ReturnType<typeof applyMissingPolicy>[number] | undefined;
    if (policy === "skip") {
      const yvRaw = yIdx >= 0 ? r[yIdx] : undefined;
      const yvNum = Number(yvRaw);
      if (yvRaw === null || yvRaw === undefined || !Number.isFinite(yvNum)) continue;
      pt = policied[policyCursor++];
    } else {
      pt = policied[i];
    }
    if (!pt) continue;
    const xv = valueAt(r, schema, xField);
    const xpx = xScale.apply(xv == null ? "" : String(xv));
    if (!Number.isFinite(xpx)) continue;
    if (pt.y === undefined) {
      // Missing row under "callout" (or unresolved edge under "interpolate").
      if (policy === "callout") {
        // Small dashed rect on the baseline — visually says "data was
        // supposed to live here." Anchored at y=0; we use a fixed pixel
        // height since plotArea isn't threaded in. The dashed stroke
        // distinguishes it from any real bar.
        const calloutH = 12;
        out.push({
          type: "rect",
          x: xpx,
          y: roundPx(yZero - calloutH),
          width: xScale.bandwidth,
          height: calloutH,
          fill: "none",
          stroke: theme.axis,
          strokeWidth: 1,
          strokeDasharray: "3 3",
          tooltip: `Missing value at x=${xv == null ? "" : String(xv)}`,
        });
      }
      // "interpolate" with an unresolved edge falls through silently —
      // no neighbor to bridge against.
      continue;
    }
    const ypx = yScale.apply(pt.y);
    const top = Math.min(ypx, yZero);
    const h = Math.abs(yZero - ypx);
    out.push({
      type: "rect",
      x: xpx,
      y: roundPx(top),
      width: xScale.bandwidth,
      height: roundPx(h),
      fill: colorForRow(encoding, schema, r, colorDomain, theme, rows),
      ...markDataFor(ctx, r, schema, i),
    });
  }
}

function buildPoints(
  out: SceneMark[],
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
  schema: ReadonlyArray<CompileFieldInfo>,
  encoding: Encoding,
  xField: string,
  yField: string,
  xScale: ReturnType<typeof bandScale> | ReturnType<typeof linearScale>,
  yScale: ReturnType<typeof linearScale>,
  theme: Theme,
  ctx: MarkCtx,
  policy: MissingPolicy = "skip",
): void {
  const colorField = fieldOf(encoding.color);
  const colorDomain = colorField ? distinctOrdered(rows, schema, colorField) : [];
  // Moat PR3 — policy-aware row pipeline. Point marks emit a "✕" glyph
  // on the y-baseline for callout-mode missing values; "skip" matches
  // the prior implementation byte-for-byte.
  const yIdx = schema.findIndex((c) => c.name === yField);
  const policied = applyMissingPolicy(
    rows.map((r) => ({ x: valueAt(r, schema, xField), y: yIdx >= 0 ? r[yIdx] : undefined })),
    policy,
  );
  const yBaseline = yScale.apply(0);
  let policyCursor = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    let pt: ReturnType<typeof applyMissingPolicy>[number] | undefined;
    if (policy === "skip") {
      const yvRaw = yIdx >= 0 ? r[yIdx] : undefined;
      const yvNum = Number(yvRaw);
      if (yvRaw === null || yvRaw === undefined || !Number.isFinite(yvNum)) continue;
      pt = policied[policyCursor++];
    } else {
      pt = policied[i];
    }
    if (!pt) continue;
    const xv = valueAt(r, schema, xField);
    const xpx =
      xScale.type === "linear"
        ? xScale.apply(Number(xv))
        : xScale.apply(xv == null ? "" : String(xv)) + xScale.bandwidth / 2;
    if (!Number.isFinite(xpx)) continue;
    if (pt.y === undefined) {
      if (policy === "callout") {
        out.push({
          type: "text",
          x: roundPx(xpx),
          y: roundPx(yBaseline),
          text: "✕",
          fontSize: 10,
          // NIT-2 from review: theme.axis is the muted shade. theme.fg
          // would match titles + (on monochrome themes) the line stroke,
          // making the callout vanish into the line. axis is the
          // right "secondary signal" tier.
          fill: theme.axis,
          anchor: "middle",
          baseline: "middle",
          tooltip: `Missing value at x=${xv == null ? "" : String(xv)}`,
        });
      }
      continue;
    }
    const ypx = yScale.apply(pt.y);
    out.push({
      type: "circle",
      cx: roundPx(xpx),
      cy: ypx,
      // Tier-1 fix: previously hardcoded to 3. Now responds to
      // `encoding.size` — fields are scaled into a [3, 24] (or
      // user-supplied range) px radius via sqrt so area tracks value.
      r: roundPx(radiusForRow(encoding, schema, r, rows)),
      fill: colorForRow(encoding, schema, r, colorDomain, theme, rows),
      ...markDataFor(ctx, r, schema, i),
    });
  }
}

/**
 * buildLines — ported d3-shape `line()` math (PR19 in ROADMAP §C).
 *
 * Linear interpolation only; curve types (monotone, step) land in a
 * follow-up. When a color encoding is set, rows are grouped by color and
 * one `path` mark is emitted per group. Within each group, points are
 * sorted by x ascending so the path doesn't self-cross — UNLESS
 * `preserveOrder=true`, in which case insertion order wins (Math PR5,
 * for parametric curves like Lissajous where the curve legitimately
 * revisits the same x values).
 *
 * Moat PR3 — missing-data policy: rows are pre-resolved against
 * `applyMissingPolicy`. Under "interpolate", interpolated points are
 * flagged so the per-group emission below splits the polyline into a
 * solid run + a dashed bridge sub-path (visually distinct from real
 * data). Under "callout", a "✕" glyph is emitted at each missing row's
 * x position. Under "skip" (the default), missing rows drop and the
 * output is byte-identical to the pre-PR3 implementation.
 *
 * The `path` mark carries an SVG-d string built deterministically:
 *   "M x0 y0 L x1 y1 L x2 y2 …"
 * Every coordinate goes through roundPx so byte-identity holds.
 */
function buildLines(
  out: SceneMark[],
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
  schema: ReadonlyArray<CompileFieldInfo>,
  encoding: Encoding,
  xField: string,
  yField: string,
  xScale: ReturnType<typeof bandScale> | ReturnType<typeof linearScale>,
  yScale: ReturnType<typeof linearScale>,
  theme: Theme,
  preserveOrder = false,
  policy: MissingPolicy = "skip",
  // Tier-2 RFC — line interpolation mode. "linear" matches prior
  // behavior byte-for-byte; "step" + "step-before" emit staircase
  // paths. Ignored when undefined.
  interpolate: "linear" | "step" | "step-before" | undefined = "linear",
): void {
  const colorField = fieldOf(encoding.color);
  const colorDomain = colorField ? distinctOrdered(rows, schema, colorField) : [""];
  const yIdx = schema.findIndex((c) => c.name === yField);
  const policied = applyMissingPolicy(
    rows.map((r) => ({ x: valueAt(r, schema, xField), y: yIdx >= 0 ? r[yIdx] : undefined })),
    policy,
  );

  // Group resolved points by color group. Each point also carries the
  // `interpolated` flag (only set when policy === "interpolate" AND the
  // original y was missing).
  interface PolyPoint {
    readonly x: number;
    readonly y: number;
    readonly interpolated: boolean;
  }
  const groups = new Map<string, Array<PolyPoint>>();
  const calloutPoints: Array<{ x: number; xRaw: unknown }> = [];

  let policyCursor = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    let pt: ReturnType<typeof applyMissingPolicy>[number] | undefined;
    if (policy === "skip") {
      const yvRaw = yIdx >= 0 ? r[yIdx] : undefined;
      const yvNum = Number(yvRaw);
      if (yvRaw === null || yvRaw === undefined || !Number.isFinite(yvNum)) continue;
      pt = policied[policyCursor++];
    } else {
      pt = policied[i];
    }
    if (!pt) continue;
    const xv = valueAt(r, schema, xField);
    const xpx =
      xScale.type === "linear"
        ? xScale.apply(Number(xv))
        : xScale.apply(xv == null ? "" : String(xv)) + xScale.bandwidth / 2;
    if (!Number.isFinite(xpx)) continue;
    if (pt.y === undefined) {
      if (policy === "callout") {
        calloutPoints.push({ x: roundPx(xpx), xRaw: xv });
      }
      continue;
    }
    const groupKey = colorField
      ? (() => {
          const cv = valueAt(r, schema, colorField);
          return cv == null ? "" : String(cv);
        })()
      : "";
    let pts = groups.get(groupKey);
    if (!pts) {
      pts = [];
      groups.set(groupKey, pts);
    }
    pts.push({ x: roundPx(xpx), y: yScale.apply(pt.y), interpolated: pt.interpolated === true });
  }

  // Emit one path per group. When no interpolated points exist the
  // single-path branch produces byte-identical output to the pre-PR3
  // implementation. When some points are interpolated, split into
  // solid + dashed sub-paths.
  for (const [groupKey, ptsRaw] of groups) {
    if (ptsRaw.length < 2) continue;
    const pts: PolyPoint[] = preserveOrder
      ? ptsRaw.slice()
      : ptsRaw.slice().sort((a, b) => a.x - b.x);
    const idx = colorField ? Math.max(0, colorDomain.indexOf(groupKey)) : 0;
    const stroke = theme.marks[idx % theme.marks.length] ?? "#000";
    const hasInterp = pts.some((p) => p.interpolated);
    if (!hasInterp) {
      const d = buildLinePath(pts, interpolate);
      out.push({ type: "path", d, stroke, strokeWidth: 1.5, fill: "none" });
      continue;
    }
    // Split into runs of solid + dashed sub-paths. A segment from
    // p[i-1] to p[i] is dashed iff EITHER endpoint is interpolated —
    // not just the trailing point. Without the `||`, a single-gap
    // sequence [A, null, B] produces a dashed A→bridge segment but
    // a solid bridge→B segment (Moat 3 review IMPORTANT-1). Same
    // problem on multi-row gaps: every exit edge lost the dash.
    // Both endpoints flagged → the full bridge stroke is dashed.
    //
    // Each segment honors the layer's `interpolate` mode so step lines
    // with bridged gaps render correctly (staircase solid + staircase
    // dashed, not a hybrid).
    const solidSegs: string[] = [];
    const dashedSegs: string[] = [];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (!a || !b) continue;
      const seg = buildLinePath([a, b], interpolate);
      if (a.interpolated || b.interpolated) dashedSegs.push(seg);
      else solidSegs.push(seg);
    }
    if (solidSegs.length > 0) {
      out.push({ type: "path", d: solidSegs.join(" "), stroke, strokeWidth: 1.5, fill: "none" });
    }
    if (dashedSegs.length > 0) {
      out.push({
        type: "path",
        d: dashedSegs.join(" "),
        stroke,
        strokeWidth: 1.5,
        fill: "none",
        strokeDasharray: "4 4",
      });
    }
  }

  // Emit standalone callout markers AFTER the polylines so they paint
  // on top of the polyline (and stay visible in any gap).
  const yBaseline = yScale.apply(0);
  for (const c of calloutPoints) {
    out.push({
      type: "text",
      x: c.x,
      y: roundPx(yBaseline),
      text: "✕",
      fontSize: 10,
      // NIT-2 from review — see the matching point-mark callout above.
      fill: theme.axis,
      anchor: "middle",
      baseline: "middle",
      tooltip: `Missing value at x=${c.xRaw == null ? "" : String(c.xRaw)}`,
    });
  }
}

/**
 * buildAreas — ported d3-shape `area()` math (PR20 in ROADMAP §C).
 *
 * Same point pipeline as `buildLines`, but each group's path is closed
 * down to the y=0 baseline so the SVG fill encloses a shape:
 *   "M x0 y0 L x1 y1 … L xN-1 yN-1 L xN-1 y0 L x0 y0 Z"
 *
 * Color groups + sorting follow `buildLines`. The fill uses the same
 * positional palette as line strokes but at reduced opacity (0.55) so
 * overlapping series remain readable. Stroke is drawn over the fill at
 * full opacity for an explicit outline.
 *
 * Moat PR3 — area marks treat "callout" the same as "skip" (a dashed
 * rectangle on a filled region would bleed into the surrounding paint),
 * but "interpolate" lets the polygon close cleanly across the gap so
 * the area shape is continuous. AUDIT-10 still flags the missing rate.
 */
function buildAreas(
  out: SceneMark[],
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
  schema: ReadonlyArray<CompileFieldInfo>,
  encoding: Encoding,
  xField: string,
  yField: string,
  xScale: ReturnType<typeof bandScale> | ReturnType<typeof linearScale>,
  yScale: ReturnType<typeof linearScale>,
  theme: Theme,
  preserveOrder = false,
  policy: MissingPolicy = "skip",
): void {
  const colorField = fieldOf(encoding.color);
  const colorDomain = colorField ? distinctOrdered(rows, schema, colorField) : [""];
  const baselinePx = yScale.apply(0);
  const yIdx = schema.findIndex((c) => c.name === yField);
  const policied = applyMissingPolicy(
    rows.map((r) => ({ x: valueAt(r, schema, xField), y: yIdx >= 0 ? r[yIdx] : undefined })),
    policy,
  );

  const groups = new Map<string, Array<{ x: number; y: number }>>();
  let policyCursor = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    let pt: ReturnType<typeof applyMissingPolicy>[number] | undefined;
    if (policy === "skip") {
      const yvRaw = yIdx >= 0 ? r[yIdx] : undefined;
      const yvNum = Number(yvRaw);
      if (yvRaw === null || yvRaw === undefined || !Number.isFinite(yvNum)) continue;
      pt = policied[policyCursor++];
    } else {
      pt = policied[i];
    }
    if (!pt || pt.y === undefined) continue;
    const xv = valueAt(r, schema, xField);
    const xpx =
      xScale.type === "linear"
        ? xScale.apply(Number(xv))
        : xScale.apply(xv == null ? "" : String(xv)) + xScale.bandwidth / 2;
    if (!Number.isFinite(xpx)) continue;
    const groupKey = colorField
      ? (() => {
          const cv = valueAt(r, schema, colorField);
          return cv == null ? "" : String(cv);
        })()
      : "";
    let pts = groups.get(groupKey);
    if (!pts) {
      pts = [];
      groups.set(groupKey, pts);
    }
    pts.push({ x: roundPx(xpx), y: yScale.apply(pt.y) });
  }

  for (const [groupKey, pts] of groups) {
    if (pts.length < 2) continue;
    // Math PR5 — same parametric carve-out as buildLines: closed regions
    // traced by parametric curves shouldn't be x-sorted (would zigzag).
    if (!preserveOrder) pts.sort((a, b) => a.x - b.x);
    let d = `M ${pts[0]?.x} ${pts[0]?.y}`;
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      if (!p) continue;
      d += ` L ${p.x} ${p.y}`;
    }
    const last = pts[pts.length - 1];
    const first = pts[0];
    if (!last || !first) continue;
    // Close down to baseline → back to start → Z.
    d += ` L ${last.x} ${baselinePx} L ${first.x} ${baselinePx} Z`;

    const idx = colorField ? Math.max(0, colorDomain.indexOf(groupKey)) : 0;
    const color = theme.marks[idx % theme.marks.length] ?? "#000";
    out.push({
      type: "path",
      d,
      stroke: color,
      strokeWidth: 1.5,
      fill: color,
      opacity: 0.55,
    });
  }
}

/**
 * buildRules — annotation mark (PR22).
 *
 * Draws one perpendicular reference line per row:
 *   - encoding.y set, no x  → horizontal line across the plot area at y
 *   - encoding.x set, no y  → vertical line across the plot area at x
 *   - both set              → not supported in PR22 (a "segment" mark
 *                              would handle that; defer)
 *
 * Color encoding picks a palette stroke; otherwise a dim foreground gray.
 */
function buildRules(
  out: SceneMark[],
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
  schema: ReadonlyArray<CompileFieldInfo>,
  encoding: Encoding,
  xScale: ReturnType<typeof bandScale> | ReturnType<typeof linearScale>,
  yScale: ReturnType<typeof linearScale> | undefined,
  theme: Theme,
): void {
  const xField = fieldOf(encoding.x);
  const yField = fieldOf(encoding.y);
  const colorField = fieldOf(encoding.color);
  const colorDomain = colorField ? distinctOrdered(rows, schema, colorField) : [];
  // Use the theme's mid-tone foreground for the default rule color.
  const defaultStroke = theme.fg;

  for (const r of rows) {
    let stroke = defaultStroke;
    if (colorField) {
      const cv = valueAt(r, schema, colorField);
      const idx = Math.max(0, colorDomain.indexOf(cv == null ? "" : String(cv)));
      stroke = theme.marks[idx % theme.marks.length] ?? defaultStroke;
    }
    if (yField && !xField && yScale) {
      // Horizontal rule at y value.
      const yv = Number(valueAt(r, schema, yField));
      if (!Number.isFinite(yv)) continue;
      const ypx = yScale.apply(yv);
      const xMin = xScale.type === "band" ? xScale.range[0] : xScale.range[0];
      const xMax = xScale.type === "band" ? xScale.range[1] : xScale.range[1];
      out.push({
        type: "line",
        x1: xMin,
        y1: ypx,
        x2: xMax,
        y2: ypx,
        stroke,
        strokeWidth: 1.5,
      });
    } else if (xField && !yField) {
      // Vertical rule at x value.
      const xv = valueAt(r, schema, xField);
      const xpx =
        xScale.type === "linear"
          ? xScale.apply(Number(xv))
          : xScale.apply(xv == null ? "" : String(xv)) + xScale.bandwidth / 2;
      if (!Number.isFinite(xpx)) continue;
      const yMin = yScale ? yScale.range[1] : 0;
      const yMax = yScale ? yScale.range[0] : 0;
      out.push({
        type: "line",
        x1: roundPx(xpx),
        y1: yMin,
        x2: roundPx(xpx),
        y2: yMax,
        stroke,
        strokeWidth: 1.5,
      });
    }
  }
}

/**
 * buildBoxplot — distribution mark (PR50).
 *
 * For each x-group, compute Tukey's five-number summary
 * (Q1, median, Q3, lo-whisker, hi-whisker = Q1 - 1.5×IQR / Q3 + 1.5×IQR
 * clamped to the nearest within-bound observation). Emit:
 *   - rect for the IQR box (Q1 → Q3)
 *   - line for the median
 *   - line for the whiskers (lo to Q1, Q3 to hi)
 *   - circle for any outlier beyond the whisker bounds
 *
 * Deterministic — same rows + same theme → byte-identical mark sequence.
 */
function buildBoxplot(
  out: SceneMark[],
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
  schema: ReadonlyArray<CompileFieldInfo>,
  encoding: Encoding,
  xField: string,
  yField: string,
  xScale: ReturnType<typeof bandScale> | ReturnType<typeof linearScale>,
  yScale: ReturnType<typeof linearScale>,
  theme: Theme,
): void {
  if (xScale.type !== "band") return;
  const xIdx = schema.findIndex((c) => c.name === xField);
  const yIdx = schema.findIndex((c) => c.name === yField);
  if (xIdx < 0 || yIdx < 0) return;

  // Bucket numeric values per x-group.
  const buckets = new Map<string, number[]>();
  for (const row of rows) {
    const key = String(row[xIdx] ?? "");
    const v = row[yIdx];
    const n = typeof v === "number" ? v : typeof v === "bigint" ? Number(v) : Number(v);
    if (!Number.isFinite(n)) continue;
    let arr = buckets.get(key);
    if (!arr) {
      arr = [];
      buckets.set(key, arr);
    }
    arr.push(n);
  }

  const fill = theme.marks[0] ?? "#999";
  const cellW = xScale.bandwidth;
  const inset = cellW * 0.2;
  const boxW = cellW - 2 * inset;

  for (const [groupKey, values] of buckets) {
    if (values.length === 0) continue;
    const sorted = [...values].sort((a, b) => a - b);
    const q = quantiles(sorted);
    const iqr = q.q3 - q.q1;
    const loBound = q.q1 - 1.5 * iqr;
    const hiBound = q.q3 + 1.5 * iqr;
    const inBounds = sorted.filter((v) => v >= loBound && v <= hiBound);
    // biome-ignore lint/style/noNonNullAssertion: inBounds is non-empty (Q1/Q3 are inside).
    const loWhisker = inBounds.length > 0 ? inBounds[0]! : sorted[0]!;
    const hiWhisker =
      inBounds.length > 0
        ? // biome-ignore lint/style/noNonNullAssertion: same.
          inBounds[inBounds.length - 1]!
        : // biome-ignore lint/style/noNonNullAssertion: same.
          sorted[sorted.length - 1]!;
    const outliers = sorted.filter((v) => v < loBound || v > hiBound);

    const xCenter = xScale.apply(groupKey) + cellW / 2;
    const xLeft = xCenter - boxW / 2;
    const yQ1 = yScale.apply(q.q1);
    const yQ3 = yScale.apply(q.q3);
    const yMed = yScale.apply(q.median);
    const yLo = yScale.apply(loWhisker);
    const yHi = yScale.apply(hiWhisker);

    // Box (Q1 → Q3). y axis is inverted so smaller y = higher value.
    const yTop = Math.min(yQ1, yQ3);
    const boxH = Math.abs(yQ3 - yQ1);
    out.push({
      type: "rect",
      x: roundPx(xLeft),
      y: roundPx(yTop),
      width: roundPx(boxW),
      height: roundPx(boxH),
      fill,
      stroke: theme.fg,
      strokeWidth: 1,
    });
    // Median line across the box.
    out.push({
      type: "line",
      x1: roundPx(xLeft),
      y1: roundPx(yMed),
      x2: roundPx(xLeft + boxW),
      y2: roundPx(yMed),
      stroke: theme.fg,
      strokeWidth: 1.5,
    });
    // Whiskers: vertical from box edges to whisker bounds.
    out.push({
      type: "line",
      x1: roundPx(xCenter),
      y1: roundPx(yQ1),
      x2: roundPx(xCenter),
      y2: roundPx(yLo),
      stroke: theme.fg,
      strokeWidth: 1,
    });
    out.push({
      type: "line",
      x1: roundPx(xCenter),
      y1: roundPx(yQ3),
      x2: roundPx(xCenter),
      y2: roundPx(yHi),
      stroke: theme.fg,
      strokeWidth: 1,
    });
    // Outlier dots (small circles beyond the whisker bounds).
    for (const v of outliers) {
      out.push({
        type: "circle",
        cx: roundPx(xCenter),
        cy: roundPx(yScale.apply(v)),
        r: 2,
        fill: theme.fg,
      });
    }
  }
  // Silence unused parameter for encoding (color encoding lands when we
  // add a per-box palette override; v0 uses the theme's first mark color).
  void encoding;
}

/** Linear quantile interpolation (R type-7 ⁠— the npm default). */
function quantiles(sorted: ReadonlyArray<number>): {
  q1: number;
  median: number;
  q3: number;
} {
  return {
    q1: percentile(sorted, 0.25),
    median: percentile(sorted, 0.5),
    q3: percentile(sorted, 0.75),
  };
}

function percentile(sorted: ReadonlyArray<number>, p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0] ?? 0;
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  // biome-ignore lint/style/noNonNullAssertion: lo/hi bounded by length-1.
  if (lo === hi) return sorted[lo]!;
  // biome-ignore lint/style/noNonNullAssertion: same.
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

/**
 * buildTextAnnotations — direct labels on (x, y) (PR50).
 *
 * Emits one `text` SceneMark per row at the row's (x, y) with the
 * value of encoding.text as the rendered string. Composes via multi-
 * layer specs: bars + text labels, lines + annotations, etc.
 */
function buildTextAnnotations(
  out: SceneMark[],
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
  schema: ReadonlyArray<CompileFieldInfo>,
  encoding: Encoding,
  xField: string,
  yField: string,
  xScale: ReturnType<typeof bandScale> | ReturnType<typeof linearScale>,
  yScale: ReturnType<typeof linearScale>,
  theme: Theme,
): void {
  const textField = fieldOf(encoding.text);
  if (!textField) return;
  const xIdx = schema.findIndex((c) => c.name === xField);
  const yIdx = schema.findIndex((c) => c.name === yField);
  const tIdx = schema.findIndex((c) => c.name === textField);
  if (xIdx < 0 || yIdx < 0 || tIdx < 0) return;
  const bandShift = xScale.type === "band" ? xScale.bandwidth / 2 : 0;
  for (const row of rows) {
    const xRaw = row[xIdx];
    const yRaw = row[yIdx];
    const tRaw = row[tIdx];
    if (tRaw === null || tRaw === undefined) continue;
    const xVal =
      xScale.type === "band"
        ? xScale.apply(String(xRaw ?? "")) + bandShift
        : xScale.apply(typeof xRaw === "number" ? xRaw : Number(xRaw));
    const yNum =
      typeof yRaw === "number" ? yRaw : typeof yRaw === "bigint" ? Number(yRaw) : Number(yRaw);
    if (!Number.isFinite(yNum)) continue;
    out.push({
      type: "text",
      x: roundPx(xVal),
      y: roundPx(yScale.apply(yNum) - 6),
      text: String(tRaw),
      fontSize: 11,
      fill: theme.fg,
      anchor: "middle",
      baseline: "alphabetic",
    });
  }
}

/**
 * buildHeatmap — 2D categorical grid (PR49).
 *
 * Each row in the data becomes a rect at (x-cell, y-cell). Cell color is
 * interpolated between two stops based on the row's color-encoded value.
 * Both axes use band scales independently computed from the distinct
 * values in the rows; the y-cell ordering is top-to-bottom in
 * first-seen order (canonical heatmap convention).
 *
 * v0 limitations
 *   - One row per cell; duplicate (x, y) pairs overwrite (last wins).
 *     Aggregation lives in `data.transform` SQL.
 *   - Color stops are theme's grid (low) → first palette color (high).
 *     A configurable diverging / sequential ramp lands in a follow-up.
 */
function buildHeatmap(
  out: SceneMark[],
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
  schema: ReadonlyArray<CompileFieldInfo>,
  encoding: Encoding,
  plotArea: { x: number; y: number; width: number; height: number },
  theme: Theme,
): void {
  const xField = fieldOf(encoding.x);
  const yField = fieldOf(encoding.y);
  const colorField = fieldOf(encoding.color);
  if (!xField || !yField || !colorField) return;

  const xVals = distinctOrdered(rows, schema, xField);
  const yVals = distinctOrdered(rows, schema, yField);
  if (xVals.length === 0 || yVals.length === 0) return;

  const xScale = bandScale(xVals, [plotArea.x, plotArea.x + plotArea.width]);
  const yScale = bandScale(yVals, [plotArea.y, plotArea.y + plotArea.height]);
  const cellW = xScale.bandwidth;
  const cellH = yScale.bandwidth;

  // Quantitative color: find numeric min + max across the rows.
  const xIdx = schema.findIndex((c) => c.name === xField);
  const yIdx = schema.findIndex((c) => c.name === yField);
  const cIdx = schema.findIndex((c) => c.name === colorField);
  if (xIdx < 0 || yIdx < 0 || cIdx < 0) return;
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const r of rows) {
    const v = r[cIdx];
    const n = typeof v === "number" ? v : typeof v === "bigint" ? Number(v) : Number(v);
    if (Number.isFinite(n)) {
      if (n < lo) lo = n;
      if (n > hi) hi = n;
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return;
  const diverging = lo < 0 && hi > 0;

  for (const row of rows) {
    const xPos = xScale.apply(String(row[xIdx] ?? ""));
    const yPos = yScale.apply(String(row[yIdx] ?? ""));
    const v = row[cIdx];
    const n = typeof v === "number" ? v : typeof v === "bigint" ? Number(v) : Number(v);
    const fill = heatmapColor(n, lo, hi, diverging, theme);
    out.push({
      type: "rect",
      x: roundPx(xPos),
      y: roundPx(yPos),
      width: roundPx(cellW),
      height: roundPx(cellH),
      fill,
      stroke: theme.background,
      strokeWidth: 0.5,
    });
  }
}

/** Heatmap cell color. Diverging (red→neutral→green) when domain spans 0,
 *  otherwise sequential (theme.grid → theme.marks[0]). Centered at 0 in the
 *  diverging case using the max(|lo|,|hi|) magnitude so the midpoint is
 *  visually anchored at value=0.
 */
function heatmapColor(
  value: number,
  lo: number,
  hi: number,
  diverging: boolean,
  theme: Theme,
): string {
  if (!Number.isFinite(value)) return theme.grid;
  if (diverging) {
    const m = Math.max(Math.abs(lo), Math.abs(hi));
    if (m === 0) return "#f4f4f5";
    const t = Math.max(-1, Math.min(1, value / m)); // -1..1
    if (t >= 0) return interpolateRgb("#f1f5f9", "#15803d", t); // neutral → green
    return interpolateRgb("#f1f5f9", "#b91c1c", -t); // neutral → red
  }
  const range = hi - lo === 0 ? 1 : hi - lo;
  const t = Math.max(0, Math.min(1, (value - lo) / range));
  return interpolateRgb(theme.grid, theme.marks[0] ?? "#1a1a1a", t);
}

/** Round to n significant figures for tidy legend labels. */
function roundToSig(v: number, n: number): number {
  if (!Number.isFinite(v) || v === 0) return v;
  const d = Math.ceil(Math.log10(Math.abs(v)));
  const power = n - d;
  const m = 10 ** power;
  return Math.round(v * m) / m;
}

/** Linear interpolate two #RRGGBB colors at parameter t ∈ [0,1]. */
function interpolateRgb(a: string, b: string, t: number): string {
  const ra = parseHex(a);
  const rb = parseHex(b);
  if (!ra || !rb) return a;
  const clamped = Math.max(0, Math.min(1, t));
  const out = ra.map((c, i) => Math.round(c + ((rb[i] ?? c) - c) * clamped));
  return `#${out.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function parseHex(c: string): [number, number, number] | undefined {
  const m = /^#([0-9a-f]{6})$/i.exec(c.trim());
  if (!m || !m[1]) return undefined;
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/**
 * buildGeoRegions — choropleth mark (PR44).
 *
 * For each GeoJSON feature, finds the matching row (by joining
 * feature.properties[idField] against the row's encoding.region field),
 * projects the polygon to pixel-space SVG path d, and emits a path
 * SceneMark with fill from encoding.color. Features with no matching row
 * render with the theme's neutral grid color (the "no data" tone).
 */
function buildGeoRegions(
  out: SceneMark[],
  spec: GlyphSpec,
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
  schema: ReadonlyArray<CompileFieldInfo>,
  encoding: Encoding,
  theme: Theme,
  plotArea?: Scene["plotArea"],
): void {
  const regionField = fieldOf(encoding.region);
  if (!regionField) return;
  // PR57: source can be GeoJSON features[] OR a TopoJSON topology that the
  // compiler converts on the fly. The converted features feed the same
  // projection + path-emit loop below.
  let features: ReadonlyArray<GeoFeature> = [];
  const g = spec.geojson;
  if (g && Array.isArray((g as { features?: unknown }).features)) {
    features = (g as { features?: unknown }).features as ReadonlyArray<GeoFeature>;
  } else if (g && (g as { topology?: unknown }).topology !== undefined) {
    const topo = (g as { topology: Topology }).topology;
    const obj = (g as { object?: string }).object;
    try {
      features = topoToGeo(topo, obj).features;
    } catch {
      return;
    }
  }
  if (features.length === 0) return;
  const idField =
    typeof (spec.geojson as { idField?: unknown })?.idField === "string"
      ? (spec.geojson as { idField: string }).idField
      : "id";
  // Project into the plotArea (not the raw spec width/height) so the map
  // doesn't bleed into legend or padding zones. Wrap the projector with an
  // (x, y) translation matching plotArea origin.
  const projW = plotArea?.width ?? spec.width ?? DEFAULT_WIDTH;
  const projH = plotArea?.height ?? spec.height ?? DEFAULT_HEIGHT;
  const dx = plotArea?.x ?? 0;
  const dy = plotArea?.y ?? 0;
  const project0 = projector(spec.projection, { width: projW, height: projH });
  const project = (lon: number, lat: number): [number, number] => {
    const [x, y] = project0(lon, lat);
    return [x + dx, y + dy];
  };

  // Build row → value lookup keyed by the region field.
  const regionIdx = schema.findIndex((c) => c.name === regionField);
  if (regionIdx < 0) return;
  const colorField = fieldOf(encoding.color);
  const colorDomain = colorField ? distinctOrdered(rows, schema, colorField) : [];
  const valueByRegion = new Map<string, ReadonlyArray<unknown>>();
  for (const row of rows) {
    const key = String(row[regionIdx] ?? "");
    valueByRegion.set(key, row);
  }

  // Graticule is rendered first (so regions paint on top).
  if (spec.graticule) {
    const step =
      typeof spec.graticule === "object" && spec.graticule !== null
        ? ((spec.graticule as { step?: number }).step ?? 30)
        : 30;
    const grat = buildGraticule(project, { step });
    for (const d of grat.paths) {
      out.push({
        type: "path",
        d,
        stroke: theme.grid,
        strokeWidth: 0.5,
        opacity: 0.6,
      });
    }
  }

  // Project each feature; fill by the matching row's color.
  for (const feature of features) {
    const featureId = String(
      (feature.properties as Record<string, unknown> | undefined)?.[idField] ?? "",
    );
    const matchedRow = valueByRegion.get(featureId);
    const fill = matchedRow
      ? colorForRow(encoding, schema, matchedRow, colorDomain, theme, rows)
      : theme.grid;
    const d = featureToPath(feature, project);
    if (!d) continue;
    out.push({
      type: "path",
      d,
      fill,
      stroke: theme.background,
      strokeWidth: 0.75,
    });
  }
}

// ---------------------------------------------------------------------------
// Facet compiler (PR28)
// ---------------------------------------------------------------------------

/**
 * compileFaceted — partition rows by spec.facet.col and produce one
 * ScenePanel per distinct value. Panels are laid out side-by-side with
 * a small inter-panel gap.
 *
 * Phase 1.0 limitations:
 *   - `col` faceting only (no `row` or `wrap` yet)
 *   - Each panel has independent x AND y scales (no shared y yet)
 *   - Panels share the same theme + locale formatter
 */
function compileFaceted(input: CompileInput): Scene {
  const { spec, rows, schema } = input;
  if (!spec.facet) throw new Error("compileFaceted called without spec.facet");

  const W = spec.width ?? DEFAULT_WIDTH;
  const H = spec.height ?? DEFAULT_HEIGHT;
  const theme = resolveTheme(spec);
  const facetField = spec.facet.col;

  const values = distinctOrdered(rows, schema, facetField);
  if (values.length === 0) {
    return {
      width: W,
      height: H,
      background: theme.background,
      plotArea: { x: 0, y: 0, width: W, height: H },
      axes: [],
      marks: [],
      panels: [],
      ...(spec.title ? { title: spec.title } : {}),
      provenance: buildSceneProvenance(spec, rows, schema, {
        xDomain: [0, W],
        yDomain: [0, H],
      }),
    };
  }

  const GAP = 16;
  const HEADER = 24; // per-panel title strip above each panel
  const titleH = spec.title ? 24 : 0;
  const panelW = Math.max(40, (W - GAP * (values.length - 1)) / values.length);
  const panelH = H - titleH - HEADER;

  // Build a sub-spec without `facet` (so compileSpec takes the non-faceted
  // path) and without `title` (the top-level title renders once at the top).
  const subSpec: GlyphSpec = { ...spec };
  // biome-ignore lint/performance/noDelete: simplest way to drop a field
  delete (subSpec as { facet?: unknown }).facet;
  // biome-ignore lint/performance/noDelete: simplest way to drop a field
  delete (subSpec as { title?: unknown }).title;

  const panels: Scene["panels"] = values.map((val, idx) => {
    // Filter rows for this panel.
    const subRows = rows.filter((r) => {
      const v = valueAt(r, schema, facetField);
      return (v == null ? "" : String(v)) === val;
    });
    const offsetX = idx * (panelW + GAP);
    const offsetY = titleH + HEADER;
    const padR = spec.layers.some((l) => ySideOfLayer(l.encoding) === "right")
      ? PADDING.left
      : PADDING.right;
    // Use the same legend / bottom-padding logic as the single-panel path
    // so per-panel x-axis titles + thinned ticks don't get clipped.
    const panelBottomPad = computeBottomPad(subSpec, subRows, schema);
    const panelPlot = {
      x: offsetX + PADDING.left,
      y: offsetY + PADDING.top,
      width: panelW - PADDING.left - padR,
      height: panelH - PADDING.top - panelBottomPad,
    };
    const sub = compileSpec({
      spec: subSpec,
      rows: subRows,
      schema,
      plotAreaOverride: panelPlot,
    });
    return {
      title: val,
      titleX: offsetX + panelW / 2,
      titleY: offsetY - 8,
      plotArea: sub.plotArea,
      marks: sub.marks,
      axes: sub.axes,
    };
  });

  // Moat PR1 — faceted seal hashes the full spec (so it captures every
  // panel's encoding) + the union of all rows. Each sub-panel's own
  // provenance was discarded above when we lifted only marks/axes out.
  const scenePr = buildSceneProvenance(spec, rows, schema, {
    xDomain: [0, W],
    yDomain: [0, H],
  });

  return {
    width: W,
    height: H,
    background: theme.background,
    plotArea: { x: 0, y: 0, width: W, height: H },
    axes: [],
    marks: [],
    panels,
    ...(spec.title ? { title: spec.title } : {}),
    provenance: scenePr,
  };
}

// ---------------------------------------------------------------------------
// Axis builders
// ---------------------------------------------------------------------------

function makeBottomAxis(
  scale: ReturnType<typeof bandScale>,
  plotArea: Scene["plotArea"],
  label: string,
): SceneAxis {
  // Decide: emit all horizontally / emit all rotated / thin + horizontal.
  //   - All horizontal: slot >= label width
  //   - All rotated -45°: slot < label width AND n is modest (≤ 30); rotated
  //     labels need only ~13 px each
  //   - Thin (every Nth): n is too large for either to be readable
  const n = scale.domain.length;
  const approxCharW = 6.5;
  const maxLabelLen = scale.domain.reduce((m, s) => Math.max(m, (s ?? "").length), 1);
  const labelPx = maxLabelLen * approxCharW + 8;
  const slot = n > 0 ? plotArea.width / n : plotArea.width;
  let rotation = 0;
  let step = 1;
  if (labelPx > slot) {
    if (n <= 30) {
      // Tilt labels -45° — frees most horizontal space at modest cost
      rotation = -45;
      step = 1;
    } else {
      const maxLabelsThatFit = Math.max(1, Math.floor(plotArea.width / labelPx));
      step = Math.ceil(n / maxLabelsThatFit);
    }
  }
  const ticks: AxisTick[] = [];
  for (let i = 0; i < n; i += step) {
    const d = scale.domain[i];
    if (d === undefined) continue;
    ticks.push({
      position: scale.apply(d) + scale.bandwidth / 2,
      label: d,
    });
  }
  // Always include the final label when thinning so the right edge is anchored.
  if (step > 1) {
    const last = scale.domain[n - 1];
    if (last !== undefined && (n - 1) % step !== 0) {
      ticks.push({
        position: scale.apply(last) + scale.bandwidth / 2,
        label: last,
      });
    }
  }
  return {
    orientation: "bottom",
    origin: { x: plotArea.x, y: plotArea.y + plotArea.height },
    length: plotArea.width,
    ticks,
    label,
    ...(rotation !== 0 ? { tickRotation: rotation } : {}),
  };
}

function makeBottomAxisLinear(
  tickValues: ReadonlyArray<number>,
  scale: ReturnType<typeof linearScale>,
  plotArea: Scene["plotArea"],
  label: string,
  format: (n: number) => string = formatTickDefault,
): SceneAxis {
  const ticks: AxisTick[] = tickValues.map((t) => ({
    position: scale.apply(t),
    label: format(t),
  }));
  return {
    orientation: "bottom",
    origin: { x: plotArea.x, y: plotArea.y + plotArea.height },
    length: plotArea.width,
    ticks,
    label,
  };
}

function makeLeftAxis(
  tickValues: ReadonlyArray<number>,
  scale: ReturnType<typeof linearScale>,
  plotArea: Scene["plotArea"],
  label: string,
  format: (n: number) => string = formatTickDefault,
): SceneAxis {
  const ticks: AxisTick[] = tickValues.map((t) => ({
    position: scale.apply(t),
    label: format(t),
  }));
  return {
    orientation: "left",
    origin: { x: plotArea.x, y: plotArea.y },
    length: plotArea.height,
    ticks,
    label,
  };
}

function makeRightAxis(
  tickValues: ReadonlyArray<number>,
  scale: ReturnType<typeof linearScale>,
  plotArea: Scene["plotArea"],
  label: string,
  format: (n: number) => string = formatTickDefault,
): SceneAxis {
  const ticks: AxisTick[] = tickValues.map((t) => ({
    position: scale.apply(t),
    label: format(t),
  }));
  return {
    orientation: "right",
    origin: { x: plotArea.x + plotArea.width, y: plotArea.y },
    length: plotArea.height,
    ticks,
    label,
  };
}

/**
 * Default locale-agnostic tick formatter. Used when spec.locale is unset.
 * Stable across Node versions; integer → "n", float → trimmed 2-decimal.
 */
function formatTickDefault(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2).replace(/\.?0+$/, "");
}

/**
 * Locale-aware tick formatter (PR26). When the spec sets `locale`, format
 * via Intl.NumberFormat with sensible defaults (max 3 fraction digits,
 * grouping separator). When unset, falls back to the locale-agnostic
 * formatter so existing snapshots stay byte-identical.
 */
function makeTickFormatter(locale: string | undefined): (n: number) => string {
  if (!locale) return formatTickDefault;
  // Intl is environment-driven (ICU on Node ≥18); pin maximumFractionDigits
  // so output is stable for the same inputs at the same locale + ICU version.
  const fmt = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 3,
    useGrouping: true,
  });
  return (n: number): string => fmt.format(n);
}

// ---------------------------------------------------------------------------
// Math PR3 — register builtin cartesian mark compilers.
//
// Each compiler is a thin trampoline into a private build* function above,
// preserving the exact argument order so byte output stays identical to
// the pre-registry switch. The registry's value-add is for marks added
// in later PRs (math-text, streamline, ...) which can `registerMark(...)`
// at module-load without touching this file.
//
// Marks NOT registered here:
//   - `treemap`, `sunburst` — dispatched in `compileHierarchy`
//     (spec.data.hierarchy branch); they don't go through the cartesian
//     mark loop, so the registry isn't on their hot path.
//   - `force` — dispatched in `compileGraph` (spec.data.graph branch).
//   - `contour` — dispatched in `compileContour` (spec.data.grid branch).
//   - polar `bar/line/point/arc` — dispatched in `compilePolar`.
// All four data-shape paths render a single mark family per layer
// and would distort the registry's mark-name keying. PR4-6 marks land
// in the cartesian path and route through the registry; the four
// data-shape branches stay direct dispatches.
// ---------------------------------------------------------------------------
registerMark({
  type: "bar",
  compile(args) {
    if (args.xScale.type !== "band") {
      throw new Error("bar mark requires a band x scale");
    }
    if (!args.yScale || !args.ctx) return;
    buildBars(
      args.out,
      args.rows,
      args.schema,
      args.layer.encoding,
      args.xField,
      args.yField,
      args.xScale,
      args.yScale,
      args.theme,
      args.ctx,
      resolveMissingPolicy(args.spec),
    );
  },
});
registerMark({
  type: "point",
  compile(args) {
    if (!args.yScale || !args.ctx) return;
    buildPoints(
      args.out,
      args.rows,
      args.schema,
      args.layer.encoding,
      args.xField,
      args.yField,
      args.xScale,
      args.yScale,
      args.theme,
      args.ctx,
      resolveMissingPolicy(args.spec),
    );
  },
});
registerMark({
  type: "line",
  compile(args) {
    if (!args.yScale) return;
    // Math PR5 — parametric function data preserves insertion order.
    // `materializeFunctionInput` swaps `data.source` for our sentinel
    // marker, which is the cheapest signal that survives the recursive
    // compileSpec round-trip without expanding MarkCompileArgs.
    // Math Phase 2 Track A PR A1 — trajectory data uses the same trick:
    // RK4-emitted rows are inherently time-ordered, and closed orbits
    // (Lotka-Volterra limit cycle, damped oscillator spiral) would
    // zigzag if sorted by x.
    const dataBlock = args.spec.data;
    const dataSource =
      typeof dataBlock === "object" && dataBlock !== null && "source" in dataBlock
        ? (dataBlock as { source?: unknown }).source
        : undefined;
    const preserveOrder =
      dataSource === PARAMETRIC_FUNCTION_SOURCE || dataSource === TRAJECTORY_SOURCE;
    buildLines(
      args.out,
      args.rows,
      args.schema,
      args.layer.encoding,
      args.xField,
      args.yField,
      args.xScale,
      args.yScale,
      args.theme,
      preserveOrder,
      resolveMissingPolicy(args.spec),
      // Tier-2 — line interpolation mode (linear / step / step-before).
      (args.layer as { interpolate?: "linear" | "step" | "step-before" }).interpolate,
    );
  },
});
registerMark({
  type: "area",
  compile(args) {
    if (!args.yScale) return;
    // Math PR5 — match the line mark's parametric handling so closed
    // regions traced by parametric curves don't get x-sorted.
    // Math Phase 2 Track A PR A1 — trajectories use the same insertion-
    // order contract; closed orbits revisit x values, so sorting would
    // collapse them.
    const dataBlock = args.spec.data;
    const dataSource =
      typeof dataBlock === "object" && dataBlock !== null && "source" in dataBlock
        ? (dataBlock as { source?: unknown }).source
        : undefined;
    const preserveOrder =
      dataSource === PARAMETRIC_FUNCTION_SOURCE || dataSource === TRAJECTORY_SOURCE;
    buildAreas(
      args.out,
      args.rows,
      args.schema,
      args.layer.encoding,
      args.xField,
      args.yField,
      args.xScale,
      args.yScale,
      args.theme,
      preserveOrder,
      resolveMissingPolicy(args.spec),
    );
  },
});
registerMark({
  type: "rule",
  compile(args) {
    buildRules(
      args.out,
      args.rows,
      args.schema,
      args.layer.encoding,
      args.xScale,
      args.yScale,
      args.theme,
    );
  },
});
registerMark({
  type: "geo-region",
  compile(args) {
    buildGeoRegions(
      args.out,
      args.spec,
      args.rows,
      args.schema,
      args.layer.encoding,
      args.theme,
      args.plotArea,
    );
  },
});
registerMark({
  type: "heatmap",
  compile(args) {
    buildHeatmap(args.out, args.rows, args.schema, args.layer.encoding, args.plotArea, args.theme);
  },
});
registerMark({
  type: "boxplot",
  compile(args) {
    if (!args.yScale) return;
    buildBoxplot(
      args.out,
      args.rows,
      args.schema,
      args.layer.encoding,
      args.xField,
      args.yField,
      args.xScale,
      args.yScale,
      args.theme,
    );
  },
});
registerMark({
  type: "text",
  compile(args) {
    if (!args.yScale) return;
    buildTextAnnotations(
      args.out,
      args.rows,
      args.schema,
      args.layer.encoding,
      args.xField,
      args.yField,
      args.xScale,
      args.yScale,
      args.theme,
    );
  },
});
