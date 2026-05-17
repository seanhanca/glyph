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

import { type GeoFeature, buildGraticule, featureToPath, projector } from "../geo/index.js";
import type {
  AxisTick,
  LegendEntry,
  MarkData,
  Scene,
  SceneAxis,
  SceneLegend,
  SceneMark,
  SceneSchema,
} from "../scenegraph/types.js";
import type { Channel, Encoding, GlyphSpec, InteractiveConfig } from "../spec/types.js";
import { bandScale, linearScale, niceTicks, roundPx } from "./scales.js";

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

  const tooltip = buildTooltipText(ctx, row, schema, xVal, yVal, colorVal);
  return { key, dataAttrs, tooltip };
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_WIDTH = 640;
const DEFAULT_HEIGHT = 400;
const PADDING = { top: 24, right: 24, bottom: 40, left: 56 } as const;

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
 * - ThemeConfig          → user palette + tokens, normalized to internal shape
 */
function resolveTheme(specTheme: GlyphSpec["theme"]): Theme {
  if (specTheme === undefined || specTheme === "light") return LIGHT_THEME;
  if (specTheme === "dark") return DARK_THEME;
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
}

/** Y-axis side a layer renders against. */
type YSide = "left" | "right";

function ySideOfLayer(enc: Encoding): YSide {
  const y = enc.y;
  if (y && typeof y !== "string" && y.scale?.side === "right") return "right";
  return "left";
}

export function compileSpec(input: CompileInput): Scene {
  const { spec, rows, schema } = input;
  // Faceted specs split into multiple panels; handle that upfront before
  // the single-panel compilation path below.
  if (spec.facet) {
    return compileFaceted(input);
  }
  const width = spec.width ?? DEFAULT_WIDTH;
  const height = spec.height ?? DEFAULT_HEIGHT;
  const theme = resolveTheme(spec.theme);
  const formatTick = makeTickFormatter(spec.locale);

  // Adjust right padding when we'll need a right-side axis.
  const anyRight = spec.layers.some((l) => ySideOfLayer(l.encoding) === "right");
  const padRight = anyRight ? PADDING.left : PADDING.right;
  const plotArea = input.plotAreaOverride ?? {
    x: PADDING.left,
    y: PADDING.top,
    width: width - PADDING.left - padRight,
    height: height - PADDING.top - PADDING.bottom,
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
    // PR44: geo-region needs encoding.region (the join field) + spec.geojson.
    // x/y are inferred from the projected polygons; no x/y encoding required.
    if (l.mark === "geo-region") {
      if (fieldOf(l.encoding.region) === undefined) {
        throw new Error(`Layer ${i} (geo-region) requires encoding.region`);
      }
      if (!spec.geojson || !Array.isArray((spec.geojson as { features?: unknown }).features)) {
        throw new Error(`Layer ${i} (geo-region) requires spec.geojson.features`);
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

  for (const layer of spec.layers) {
    const enc = layer.encoding;
    const xField = fieldOf(enc.x);
    const yField = fieldOf(enc.y);
    const ySide = ySideOfLayer(enc);
    const yScale = (ySide === "right" ? rightY : leftY)?.scale ?? leftY?.scale;
    if (layer.mark === "rule") {
      // Rule needs only one side; its y/x encoding may be missing.
      const ruleYScale = yField ? yScale : undefined;
      buildRules(marks, rows, schema, enc, xScale, ruleYScale, theme);
      continue;
    }
    if (layer.mark === "geo-region") {
      // PR44: project each GeoJSON feature, fill by color encoding.
      buildGeoRegions(marks, spec, rows, schema, enc, theme);
      continue;
    }
    if (layer.mark === "heatmap") {
      // PR49: 2D categorical x × categorical y; color from a quantitative
      // field interpolated between two stops. Bypasses the y-quantitative
      // requirement of the regular path.
      buildHeatmap(marks, rows, schema, enc, plotArea, theme);
      continue;
    }
    if (!yScale || !xField || !yField) continue;
    if (layer.mark === "boxplot") {
      if (xScale.type !== "band") {
        throw new Error("boxplot mark requires a band x scale");
      }
      buildBoxplot(marks, rows, schema, enc, xField, yField, xScale, yScale, theme);
      continue;
    }
    if (layer.mark === "text") {
      buildTextAnnotations(marks, rows, schema, enc, xField, yField, xScale, yScale, theme);
      continue;
    }
    const ctx: MarkCtx = {
      interactive: spec.interactive,
      xField,
      yField,
      colorField: fieldOf(enc.color),
      tooltip: enc.tooltip,
    };
    if (layer.mark === "bar") {
      if (xScale.type !== "band") {
        throw new Error("bar mark requires a band x scale");
      }
      buildBars(marks, rows, schema, enc, xField, yField, xScale, yScale, theme, ctx);
    } else if (layer.mark === "point") {
      buildPoints(marks, rows, schema, enc, xField, yField, xScale, yScale, theme, ctx);
    } else if (layer.mark === "line") {
      buildLines(marks, rows, schema, enc, xField, yField, xScale, yScale, theme);
    } else {
      // area
      buildAreas(marks, rows, schema, enc, xField, yField, xScale, yScale, theme);
    }
  }

  // ---- Axes ------------------------------------------------------------
  const axes: SceneAxis[] = [];
  const xLabel = allXFields[0] ?? "x";
  if (xScale.type === "band") {
    axes.push(makeBottomAxis(xScale, plotArea, xLabel));
  } else if (xTicksLinear) {
    axes.push(makeBottomAxisLinear(xTicksLinear, xScale, plotArea, xLabel, formatTick));
  }
  if (leftY) {
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
  if (rightY) {
    const rightLabel = fieldOf(
      spec.layers.find((l) => ySideOfLayer(l.encoding) === "right")?.encoding.y,
    );
    axes.push(makeRightAxis(rightY.ticks, rightY.scale, plotArea, rightLabel ?? "y", formatTick));
  }

  // ---- Legends ---------------------------------------------------------
  // One legend per unique color field across all encoded layers.
  const legends: SceneLegend[] = [];
  const seenColorFields = new Set<string>();
  for (const layer of spec.layers) {
    const cf = fieldOf(layer.encoding.color);
    if (!cf || seenColorFields.has(cf)) continue;
    seenColorFields.add(cf);
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
    sceneSchema = { fields };
  }

  return {
    width,
    height,
    background: theme.background,
    plotArea,
    axes,
    marks,
    ...(spec.title ? { title: spec.title } : {}),
    ...(sceneSchema ? { schema: sceneSchema } : {}),
    ...(legends.length > 0 ? { legends } : {}),
    ...(spec.animation ? { animation: buildSceneAnimation(spec, rows, schema, marks) } : {}),
  };
}

/**
 * Build the scene's `animation` field from the spec + rendered marks.
 * For stage / stage-stagger we just plumb duration + stagger. For race /
 * scrub we compute per-mark values across frames so the renderer can emit
 * SMIL `<animate>` elements without re-querying the data.
 */
function buildSceneAnimation(
  spec: GlyphSpec,
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
  schema: ReadonlyArray<CompileFieldInfo>,
  marks: ReadonlyArray<SceneMark>,
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
): string {
  const field = fieldOf(encoding.color);
  if (!field || colorDomain.length <= 1) return theme.marks[0] ?? "#000";
  const v = valueAt(row, schema, field);
  const s = v == null ? "" : String(v);
  const i = colorDomain.indexOf(s);
  return theme.marks[Math.max(0, i) % theme.marks.length] ?? "#000";
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
): void {
  const colorField = fieldOf(encoding.color);
  const colorDomain = colorField ? distinctOrdered(rows, schema, colorField) : [];
  const yZero = yScale.apply(0);
  let i = 0;
  for (const r of rows) {
    const xv = valueAt(r, schema, xField);
    const yv = Number(valueAt(r, schema, yField));
    if (!Number.isFinite(yv)) {
      i++;
      continue;
    }
    const xpx = xScale.apply(xv == null ? "" : String(xv));
    if (!Number.isFinite(xpx)) {
      i++;
      continue;
    }
    const ypx = yScale.apply(yv);
    const top = Math.min(ypx, yZero);
    const h = Math.abs(yZero - ypx);
    out.push({
      type: "rect",
      x: xpx,
      y: roundPx(top),
      width: xScale.bandwidth,
      height: roundPx(h),
      fill: colorForRow(encoding, schema, r, colorDomain, theme),
      ...markDataFor(ctx, r, schema, i),
    });
    i++;
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
): void {
  const colorField = fieldOf(encoding.color);
  const colorDomain = colorField ? distinctOrdered(rows, schema, colorField) : [];
  let i = 0;
  for (const r of rows) {
    const xv = valueAt(r, schema, xField);
    const yv = Number(valueAt(r, schema, yField));
    if (!Number.isFinite(yv)) {
      i++;
      continue;
    }
    const xpx =
      xScale.type === "linear"
        ? xScale.apply(Number(xv))
        : xScale.apply(xv == null ? "" : String(xv)) + xScale.bandwidth / 2;
    if (!Number.isFinite(xpx)) {
      i++;
      continue;
    }
    const ypx = yScale.apply(yv);
    out.push({
      type: "circle",
      cx: roundPx(xpx),
      cy: ypx,
      r: 3,
      fill: colorForRow(encoding, schema, r, colorDomain, theme),
      ...markDataFor(ctx, r, schema, i),
    });
    i++;
  }
}

/**
 * buildLines — ported d3-shape `line()` math (PR19 in ROADMAP §C).
 *
 * Linear interpolation only; curve types (monotone, step) land in a
 * follow-up. When a color encoding is set, rows are grouped by color and
 * one `path` mark is emitted per group. Within each group, points are
 * sorted by x ascending so the path doesn't self-cross.
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
): void {
  const colorField = fieldOf(encoding.color);
  const colorDomain = colorField ? distinctOrdered(rows, schema, colorField) : [""];

  // Group rows by color (single group when no color encoding).
  const groups = new Map<string, Array<{ x: number; y: number }>>();
  for (const r of rows) {
    const xv = valueAt(r, schema, xField);
    const yv = Number(valueAt(r, schema, yField));
    if (!Number.isFinite(yv)) continue;
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
    pts.push({ x: roundPx(xpx), y: yScale.apply(yv) });
  }

  // Emit one path per group, sorted by x for stable, non-crossing lines.
  for (const [groupKey, pts] of groups) {
    if (pts.length < 2) continue;
    pts.sort((a, b) => a.x - b.x);
    let d = `M ${pts[0]?.x} ${pts[0]?.y}`;
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      if (!p) continue;
      d += ` L ${p.x} ${p.y}`;
    }
    // Color: positional pick from the palette by the group's index in the
    // domain (first-seen order). Falls back to the first palette entry.
    const idx = colorField ? Math.max(0, colorDomain.indexOf(groupKey)) : 0;
    const stroke = theme.marks[idx % theme.marks.length] ?? "#000";
    out.push({
      type: "path",
      d,
      stroke,
      strokeWidth: 1.5,
      fill: "none",
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
): void {
  const colorField = fieldOf(encoding.color);
  const colorDomain = colorField ? distinctOrdered(rows, schema, colorField) : [""];
  const baselinePx = yScale.apply(0);

  const groups = new Map<string, Array<{ x: number; y: number }>>();
  for (const r of rows) {
    const xv = valueAt(r, schema, xField);
    const yv = Number(valueAt(r, schema, yField));
    if (!Number.isFinite(yv)) continue;
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
    pts.push({ x: roundPx(xpx), y: yScale.apply(yv) });
  }

  for (const [groupKey, pts] of groups) {
    if (pts.length < 2) continue;
    pts.sort((a, b) => a.x - b.x);
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
    // biome-ignore lint/style/noNonNullAssertion: same.
    const hiWhisker =
      inBounds.length > 0 ? inBounds[inBounds.length - 1]! : sorted[sorted.length - 1]!;
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
  const range = hi - lo === 0 ? 1 : hi - lo;

  const lowColor = theme.grid;
  const highColor = theme.marks[0] ?? "#1a1a1a";

  for (const row of rows) {
    const xPos = xScale.apply(String(row[xIdx] ?? ""));
    const yPos = yScale.apply(String(row[yIdx] ?? ""));
    const v = row[cIdx];
    const n = typeof v === "number" ? v : typeof v === "bigint" ? Number(v) : Number(v);
    const t = Number.isFinite(n) ? (n - lo) / range : 0;
    const fill = interpolateRgb(lowColor, highColor, t);
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
): void {
  const regionField = fieldOf(encoding.region);
  if (!regionField) return;
  const features = (spec.geojson?.features as ReadonlyArray<GeoFeature> | undefined) ?? [];
  if (features.length === 0) return;
  const idField =
    typeof (spec.geojson as { idField?: unknown })?.idField === "string"
      ? (spec.geojson as { idField: string }).idField
      : "id";
  const width = spec.width ?? DEFAULT_WIDTH;
  const height = spec.height ?? DEFAULT_HEIGHT;
  const project = projector(spec.projection, { width, height });

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
      ? colorForRow(encoding, schema, matchedRow, colorDomain, theme)
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
  const theme = resolveTheme(spec.theme);
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
    const panelPlot = {
      x: offsetX + PADDING.left,
      y: offsetY + PADDING.top,
      width: panelW - PADDING.left - padR,
      height: panelH - PADDING.top - PADDING.bottom,
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

  return {
    width: W,
    height: H,
    background: theme.background,
    plotArea: { x: 0, y: 0, width: W, height: H },
    axes: [],
    marks: [],
    panels,
    ...(spec.title ? { title: spec.title } : {}),
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
  const ticks: AxisTick[] = scale.domain.map((d) => ({
    position: scale.apply(d) + scale.bandwidth / 2,
    label: d,
  }));
  return {
    orientation: "bottom",
    origin: { x: plotArea.x, y: plotArea.y + plotArea.height },
    length: plotArea.width,
    ticks,
    label,
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
