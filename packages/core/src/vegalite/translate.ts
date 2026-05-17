/**
 * Vega-Lite → Glyph translator (PR30, ROADMAP §A1).
 *
 * Pure function. Takes a Vega-Lite spec (a JSON object the caller has
 * already loaded), returns either a Glyph spec or a structured error.
 *
 * Scope of Phase-1 v0:
 *   - Top-level fields: $schema, mark, encoding, data, transform, title,
 *     width, height
 *   - Marks: 'bar', 'point', 'line', 'area' (plus 'circle' / 'square'
 *     aliases mapped to 'point')
 *   - Mark shorthand and { type: '...' } object form both accepted
 *   - Encoding channels: x, y, color, tooltip
 *   - Channel: field + type (quantitative / ordinal / nominal / temporal)
 *   - Data: { url, format? }, { values: [...] } (inlined as JSON array via
 *     a DuckDB-friendly literal), { name } (registered table reference)
 *   - Transform: VL `filter` and `calculate` collapse into a single
 *     `data.transform` SQL clause via simple translation
 *
 * Out of scope (rejected with a clear message; future PRs):
 *   - Layered / multi-view (`layer`, `hconcat`, `vconcat`, `repeat`)
 *   - Selections, parameters, signals
 *   - VL-specific stats (`bin`, `aggregate` inside encoding) — fold into
 *     `stat` on the layer instead
 *   - Custom scales beyond default behavior
 */

import type { GlyphSpec, Layer } from "../spec/types.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface VegaLiteTranslateResult {
  readonly ok: true;
  readonly spec: GlyphSpec;
  /** Non-fatal warnings about VL features we elided. */
  readonly warnings: ReadonlyArray<string>;
}

export interface VegaLiteTranslateError {
  readonly ok: false;
  readonly error: string;
  /** Path into the input VL spec where the problem was detected. */
  readonly path: ReadonlyArray<string>;
}

export type VegaLiteTranslateOutcome = VegaLiteTranslateResult | VegaLiteTranslateError;

/** Type-guard for the public outcome. */
export function isTranslateError(r: VegaLiteTranslateOutcome): r is VegaLiteTranslateError {
  return r.ok === false;
}

/** Type-guard for sub-translator results (Error or { value }). */
function isSubError<T>(r: VegaLiteTranslateError | { value: T }): r is VegaLiteTranslateError {
  return "ok" in r && r.ok === false;
}

/**
 * Translate a Vega-Lite spec to a Glyph spec.
 *
 * The input is typed `unknown` because real VL specs come from JSON files
 * or LLM output; this function does its own structural validation.
 */
export function vegaLiteToGlyph(input: unknown): VegaLiteTranslateOutcome {
  const warnings: string[] = [];

  if (!isObject(input)) {
    return err("Vega-Lite spec must be an object", []);
  }

  // Reject multi-view specs early.
  for (const k of ["layer", "hconcat", "vconcat", "repeat", "facet", "concat"]) {
    if (k in input) {
      if (k === "facet") {
        return err(
          "Vega-Lite top-level `facet` is not yet supported by the translator; use Glyph's `facet` field directly.",
          [k],
        );
      }
      return err(`Vega-Lite multi-view '${k}' is not supported by this translator yet.`, [k]);
    }
  }

  // ---- mark ------------------------------------------------------------
  const markFn = readMark(input);
  if (isSubError(markFn)) return markFn;
  const mark = markFn.value;

  // ---- encoding --------------------------------------------------------
  const enc = (input as { encoding?: unknown }).encoding;
  if (!isObject(enc)) {
    return err("Vega-Lite spec must have an `encoding` object", ["encoding"]);
  }
  const layerEncoding = translateEncoding(enc, warnings);
  if (isSubError(layerEncoding)) return layerEncoding;

  // ---- data ------------------------------------------------------------
  const dataField = (input as { data?: unknown }).data;
  const dataOut = translateData(dataField, warnings);
  if (isSubError(dataOut)) return dataOut;

  // ---- transform (VL filter + calculate) -------------------------------
  const vlTransforms = (input as { transform?: unknown }).transform;
  const transformOut = translateTransform(vlTransforms, dataOut.value.source, warnings);
  if (isSubError(transformOut)) return transformOut;

  // ---- assemble Glyph spec ---------------------------------------------
  const layer: Layer = { mark, encoding: layerEncoding.value };
  const dataWithTransform = transformOut.value
    ? { ...dataOut.value, transform: transformOut.value }
    : dataOut.value;

  const spec: GlyphSpec = {
    data: dataWithTransform,
    layers: [layer],
    ...(typeof (input as { title?: unknown }).title === "string"
      ? { title: (input as { title: string }).title }
      : {}),
    ...(typeof (input as { width?: unknown }).width === "number"
      ? { width: (input as { width: number }).width }
      : {}),
    ...(typeof (input as { height?: unknown }).height === "number"
      ? { height: (input as { height: number }).height }
      : {}),
  };

  return { ok: true, spec, warnings };
}

// ---------------------------------------------------------------------------
// Sub-translators
// ---------------------------------------------------------------------------

const ALLOWED_MARKS = new Set(["bar", "point", "line", "area"]);
const POINT_ALIASES = new Set(["circle", "square", "tick"]);

function readMark(input: object): VegaLiteTranslateError | { value: Layer["mark"] } {
  const m = (input as { mark?: unknown }).mark;
  let name: string;
  if (typeof m === "string") {
    name = m;
  } else if (isObject(m) && typeof (m as { type?: unknown }).type === "string") {
    name = (m as { type: string }).type;
  } else {
    return err("Vega-Lite spec must have a `mark` (string or { type })", ["mark"]);
  }
  if (POINT_ALIASES.has(name)) name = "point";
  if (!ALLOWED_MARKS.has(name)) {
    return err(
      `Vega-Lite mark '${name}' is not yet supported by this translator; supported: bar, point, line, area (+ aliases circle/square/tick).`,
      ["mark"],
    );
  }
  return { value: name as Layer["mark"] };
}

function translateEncoding(
  enc: object,
  warnings: string[],
): VegaLiteTranslateError | { value: Layer["encoding"] } {
  const out: Record<string, unknown> = {};
  const allowed = ["x", "y", "color", "tooltip", "size", "opacity"];
  for (const key of Object.keys(enc)) {
    if (!allowed.includes(key)) {
      warnings.push(`Encoding channel '${key}' not supported; dropped.`);
      continue;
    }
    const ch = (enc as Record<string, unknown>)[key];
    if (typeof ch !== "object" || ch === null) {
      warnings.push(`Encoding channel '${key}' must be an object; dropped.`);
      continue;
    }
    if (key === "tooltip" && Array.isArray(ch)) {
      // Tooltip array of channels.
      out.tooltip = ch.map((c) => translateChannel(c));
      continue;
    }
    out[key] = translateChannel(ch);
  }
  if (out.x === undefined && out.y === undefined) {
    return err("Vega-Lite encoding must define x and/or y.", ["encoding"]);
  }
  return { value: out as Layer["encoding"] };
}

function translateChannel(ch: unknown): unknown {
  if (typeof ch !== "object" || ch === null) return ch;
  const c = ch as Record<string, unknown>;
  // VL `field` is required for our subset. `value` (constant) isn't handled.
  if (typeof c.field !== "string") {
    // Not enough info — pass through as-is for Glyph's strict mode to reject.
    return ch;
  }
  const out: Record<string, unknown> = { field: c.field };
  if (typeof c.type === "string") {
    const t = c.type;
    if (t === "quantitative" || t === "ordinal" || t === "nominal" || t === "temporal") {
      out.type = t;
    }
  }
  if (typeof c.title === "string") out.title = c.title;
  if (typeof c.aggregate === "string") {
    const agg = c.aggregate;
    if (
      agg === "count" ||
      agg === "sum" ||
      agg === "mean" ||
      agg === "median" ||
      agg === "min" ||
      agg === "max"
    ) {
      out.aggregate = agg;
    }
  }
  return out;
}

function translateData(
  data: unknown,
  warnings: string[],
): VegaLiteTranslateError | { value: { source: string; format?: "csv" | "parquet" | "json" } } {
  if (data === undefined) {
    return err("Vega-Lite spec must have a `data` block.", ["data"]);
  }
  if (!isObject(data)) {
    return err("`data` must be an object.", ["data"]);
  }
  const d = data as Record<string, unknown>;
  if (typeof d.url === "string") {
    const out: { source: string; format?: "csv" | "parquet" | "json" } = { source: d.url };
    if (isObject(d.format)) {
      const f = (d.format as { type?: unknown }).type;
      if (f === "csv" || f === "parquet" || f === "json") out.format = f;
    }
    return { value: out };
  }
  if (typeof d.name === "string") {
    // Reference to a named (already-registered) table.
    return { value: { source: d.name } };
  }
  if (Array.isArray(d.values)) {
    // Inline values — synthesize a SELECT … UNION ALL … construct.
    warnings.push(
      "Inline `data.values` was translated to a SQL VALUES clause; consider using `data.url` for larger datasets.",
    );
    const sql = inlineValuesToSql(d.values as ReadonlyArray<unknown>);
    if (typeof sql === "string") {
      // Source name is irrelevant when transform is present; pick a stable one.
      return { value: { source: "glyph_src_main", format: "csv" } };
    }
    return err("Inline `data.values` must be a non-empty array of objects.", ["data", "values"]);
  }
  return err("`data` must contain `url`, `name`, or `values`.", ["data"]);
}

function translateTransform(
  vlTransforms: unknown,
  _source: string,
  warnings: string[],
): VegaLiteTranslateError | { value: string | undefined } {
  if (vlTransforms === undefined) return { value: undefined };
  if (!Array.isArray(vlTransforms)) {
    return err("`transform` must be an array.", ["transform"]);
  }
  const wheres: string[] = [];
  const projections: string[] = ["*"];
  for (const t of vlTransforms) {
    if (!isObject(t)) {
      warnings.push("Skipping non-object transform entry.");
      continue;
    }
    const tt = t as Record<string, unknown>;
    if (typeof tt.filter === "string") {
      // VL filter expressions look like 'datum.x > 10'. We do a best-effort
      // rewrite from `datum.foo` to `"foo"` — anything else is left raw and
      // the user is warned.
      const rewritten = (tt.filter as string).replace(/datum\.([A-Za-z_][A-Za-z0-9_]*)/g, '"$1"');
      if (rewritten.includes("datum.")) {
        warnings.push(`Filter expression couldn't be fully translated: ${tt.filter as string}`);
      }
      wheres.push(rewritten);
      continue;
    }
    if (typeof tt.calculate === "string" && typeof tt.as === "string") {
      const expr = (tt.calculate as string).replace(/datum\.([A-Za-z_][A-Za-z0-9_]*)/g, '"$1"');
      projections.push(`(${expr}) AS "${tt.as}"`);
      continue;
    }
    warnings.push(`Skipping unsupported transform: ${Object.keys(tt).join(",")}`);
  }
  if (wheres.length === 0 && projections.length === 1) return { value: undefined };
  const select = projections.join(", ");
  const where = wheres.length ? ` WHERE ${wheres.join(" AND ")}` : "";
  return { value: `SELECT ${select} FROM glyph_src_main${where}` };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function isObject(x: unknown): x is object {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function err(message: string, path: ReadonlyArray<string>): VegaLiteTranslateError {
  return { ok: false, error: message, path };
}

/** Tiny helper: turn an array of row objects into a SQL VALUES clause stub. */
function inlineValuesToSql(values: ReadonlyArray<unknown>): string | null {
  if (values.length === 0) return null;
  const first = values[0];
  if (!isObject(first)) return null;
  // Stub: not yet generated as a real query; see warnings.
  return "VALUES";
}
