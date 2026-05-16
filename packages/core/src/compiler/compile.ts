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

import type { ColumnInfo } from "../compute/engine.js";
import type { AxisTick, Scene, SceneAxis, SceneMark } from "../scenegraph/types.js";
import type { Channel, Encoding, GlyphSpec } from "../spec/types.js";
import { bandScale, linearScale, niceTicks, roundPx } from "./scales.js";

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

function typeOfColumn(schema: ReadonlyArray<ColumnInfo>, name: string): string {
  return schema.find((c) => c.name === name)?.type ?? "VARCHAR";
}

function fieldType(
  ch: Channel | undefined,
  schema: ReadonlyArray<ColumnInfo>,
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
  schema: ReadonlyArray<ColumnInfo>,
  field: string,
): unknown {
  const i = schema.findIndex((c) => c.name === field);
  return i === -1 ? undefined : row[i];
}

function distinctOrdered(
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
  schema: ReadonlyArray<ColumnInfo>,
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
  schema: ReadonlyArray<ColumnInfo>,
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
  readonly schema: ReadonlyArray<ColumnInfo>;
}

export function compileSpec(input: CompileInput): Scene {
  const { spec, rows, schema } = input;
  const width = spec.width ?? DEFAULT_WIDTH;
  const height = spec.height ?? DEFAULT_HEIGHT;
  const theme = spec.theme === "dark" ? DARK_THEME : LIGHT_THEME;

  const plotArea = {
    x: PADDING.left,
    y: PADDING.top,
    width: width - PADDING.left - PADDING.right,
    height: height - PADDING.top - PADDING.bottom,
  };

  // Phase 0: single-layer compilation.
  const layer = spec.layers[0];
  if (!layer) throw new Error("Spec has no layers");

  const enc = layer.encoding;
  const xField = fieldOf(enc.x);
  const yField = fieldOf(enc.y);
  if (!xField || !yField) {
    throw new Error("Phase 0 requires both x and y encodings");
  }

  const xKind = fieldType(enc.x, schema);
  const yKind = fieldType(enc.y, schema);

  // Build scales.
  const xRange: readonly [number, number] = [plotArea.x, plotArea.x + plotArea.width];
  const yRange: readonly [number, number] = [plotArea.y + plotArea.height, plotArea.y];

  const marks: SceneMark[] = [];
  const axes: SceneAxis[] = [];

  if (yKind !== "quantitative") {
    throw new Error("Phase 0 requires the y encoding to be quantitative");
  }
  const yExtent = numericExtent(rows, schema, yField);
  const yNice = niceTicks(Math.min(0, yExtent[0]), yExtent[1], 5);
  const yScale = linearScale(yNice.domain, yRange);

  // ---- BAR --------------------------------------------------------------
  if (layer.mark === "bar") {
    if (xKind === "quantitative") {
      // Treat numeric x as discrete bins for bars (Phase 0 simplification).
      const domain = distinctOrdered(rows, schema, xField);
      const xScale = bandScale(domain, xRange, 0.1);
      buildBars(marks, rows, schema, enc, xField, yField, xScale, yScale, theme);
      axes.push(makeBottomAxis(xScale, plotArea, xField));
    } else {
      const domain = distinctOrdered(rows, schema, xField);
      const xScale = bandScale(domain, xRange, 0.1);
      buildBars(marks, rows, schema, enc, xField, yField, xScale, yScale, theme);
      axes.push(makeBottomAxis(xScale, plotArea, xField));
    }
  }
  // ---- POINT ------------------------------------------------------------
  else if (layer.mark === "point") {
    if (xKind === "quantitative") {
      const xExtent = numericExtent(rows, schema, xField);
      const xNice = niceTicks(xExtent[0], xExtent[1], 6);
      const xScale = linearScale(xNice.domain, xRange);
      buildPoints(marks, rows, schema, enc, xField, yField, xScale, yScale, theme);
      axes.push(makeBottomAxisLinear(xNice.ticks, xScale, plotArea, xField));
    } else {
      const domain = distinctOrdered(rows, schema, xField);
      const xScale = bandScale(domain, xRange, 0.1);
      buildPoints(marks, rows, schema, enc, xField, yField, xScale, yScale, theme);
      axes.push(makeBottomAxis(xScale, plotArea, xField));
    }
  } else {
    throw new Error(`Phase 0 supports marks bar|point; got ${layer.mark}`);
  }

  axes.push(makeLeftAxis(yNice.ticks, yScale, plotArea, yField));

  return {
    width,
    height,
    background: theme.background,
    plotArea,
    axes,
    marks,
    ...(spec.title ? { title: spec.title } : {}),
  };
}

// ---------------------------------------------------------------------------
// Mark builders
// ---------------------------------------------------------------------------

function colorForRow(
  encoding: Encoding,
  schema: ReadonlyArray<ColumnInfo>,
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
  schema: ReadonlyArray<ColumnInfo>,
  encoding: Encoding,
  xField: string,
  yField: string,
  xScale: ReturnType<typeof bandScale>,
  yScale: ReturnType<typeof linearScale>,
  theme: Theme,
): void {
  const colorField = fieldOf(encoding.color);
  const colorDomain = colorField ? distinctOrdered(rows, schema, colorField) : [];
  const yZero = yScale.apply(0);
  for (const r of rows) {
    const xv = valueAt(r, schema, xField);
    const yv = Number(valueAt(r, schema, yField));
    if (!Number.isFinite(yv)) continue;
    const xpx = xScale.apply(xv == null ? "" : String(xv));
    if (!Number.isFinite(xpx)) continue;
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
    });
  }
}

function buildPoints(
  out: SceneMark[],
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
  schema: ReadonlyArray<ColumnInfo>,
  encoding: Encoding,
  xField: string,
  yField: string,
  xScale: ReturnType<typeof bandScale> | ReturnType<typeof linearScale>,
  yScale: ReturnType<typeof linearScale>,
  theme: Theme,
): void {
  const colorField = fieldOf(encoding.color);
  const colorDomain = colorField ? distinctOrdered(rows, schema, colorField) : [];
  for (const r of rows) {
    const xv = valueAt(r, schema, xField);
    const yv = Number(valueAt(r, schema, yField));
    if (!Number.isFinite(yv)) continue;
    const xpx =
      xScale.type === "linear"
        ? xScale.apply(Number(xv))
        : xScale.apply(xv == null ? "" : String(xv)) + xScale.bandwidth / 2;
    if (!Number.isFinite(xpx)) continue;
    const ypx = yScale.apply(yv);
    out.push({
      type: "circle",
      cx: roundPx(xpx),
      cy: ypx,
      r: 3,
      fill: colorForRow(encoding, schema, r, colorDomain, theme),
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

function formatTick(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2).replace(/\.?0+$/, "");
}
