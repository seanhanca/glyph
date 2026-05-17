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

import type {
  AxisTick,
  MarkData,
  Scene,
  SceneAxis,
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
}

/** Coerce any cell value to a stable string for data attributes. */
function attrValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "bigint") return String(v);
  return String(v);
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
  if (ctx.colorField) {
    dataAttrs.color = attrValue(valueAt(row, schema, ctx.colorField));
  }
  const keyField = ctx.interactive.key;
  const key = keyField ? attrValue(valueAt(row, schema, keyField)) : String(rowIndex);

  // Native SVG <title> tooltip — zero JS, deterministic. Stolen from D3.
  // Example: "pickup_hour: 7 · rides: 210"
  const tooltipParts = [`${ctx.xField}: ${xVal}`, `${ctx.yField}: ${yVal}`];
  if (ctx.colorField) {
    tooltipParts.push(`${ctx.colorField}: ${dataAttrs.color}`);
  }
  const tooltip = tooltipParts.join(" · ");

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
  const width = spec.width ?? DEFAULT_WIDTH;
  const height = spec.height ?? DEFAULT_HEIGHT;
  const theme = spec.theme === "dark" ? DARK_THEME : LIGHT_THEME;

  // Adjust right padding when we'll need a right-side axis.
  const anyRight = spec.layers.some((l) => ySideOfLayer(l.encoding) === "right");
  const padRight = anyRight ? PADDING.left : PADDING.right;
  const plotArea = {
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
    if (l.mark !== "bar" && l.mark !== "point" && l.mark !== "line") {
      throw new Error(`Phase 1 supports marks bar|point|line; layer ${i} has ${l.mark}`);
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
    const layersOnSide = spec.layers.filter((l) => ySideOfLayer(l.encoding) === side);
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
    const xField = fieldOf(enc.x) as string;
    const yField = fieldOf(enc.y) as string;
    const yScale = (ySideOfLayer(enc) === "right" ? rightY : leftY)?.scale;
    if (!yScale) continue; // unreachable: validated above
    const ctx: MarkCtx = {
      interactive: spec.interactive,
      xField,
      yField,
      colorField: fieldOf(enc.color),
    };
    if (layer.mark === "bar") {
      if (xScale.type !== "band") {
        throw new Error("bar mark requires a band x scale");
      }
      buildBars(marks, rows, schema, enc, xField, yField, xScale, yScale, theme, ctx);
    } else if (layer.mark === "point") {
      buildPoints(marks, rows, schema, enc, xField, yField, xScale, yScale, theme, ctx);
    } else {
      // line
      buildLines(marks, rows, schema, enc, xField, yField, xScale, yScale, theme);
    }
  }

  // ---- Axes ------------------------------------------------------------
  const axes: SceneAxis[] = [];
  const xLabel = allXFields[0] ?? "x";
  if (xScale.type === "band") {
    axes.push(makeBottomAxis(xScale, plotArea, xLabel));
  } else if (xTicksLinear) {
    axes.push(makeBottomAxisLinear(xTicksLinear, xScale, plotArea, xLabel));
  }
  if (leftY) {
    const leftLabel = fieldOf(
      spec.layers.find((l) => ySideOfLayer(l.encoding) === "left")?.encoding.y,
    );
    axes.push(makeLeftAxis(leftY.ticks, leftY.scale, plotArea, leftLabel ?? "y"));
  }
  if (rightY) {
    const rightLabel = fieldOf(
      spec.layers.find((l) => ySideOfLayer(l.encoding) === "right")?.encoding.y,
    );
    axes.push(makeRightAxis(rightY.ticks, rightY.scale, plotArea, rightLabel ?? "y"));
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
  };
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
): SceneAxis {
  const ticks: AxisTick[] = tickValues.map((t) => ({
    position: scale.apply(t),
    label: formatTick(t),
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
): SceneAxis {
  const ticks: AxisTick[] = tickValues.map((t) => ({
    position: scale.apply(t),
    label: formatTick(t),
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
): SceneAxis {
  const ticks: AxisTick[] = tickValues.map((t) => ({
    position: scale.apply(t),
    label: formatTick(t),
  }));
  return {
    orientation: "right",
    origin: { x: plotArea.x + plotArea.width, y: plotArea.y },
    length: plotArea.height,
    ticks,
    label,
  };
}

function formatTick(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2).replace(/\.?0+$/, "");
}
