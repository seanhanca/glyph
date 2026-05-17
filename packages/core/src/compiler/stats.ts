/**
 * Stats compiler — pure SQL rewriter (PR21).
 *
 * Translates a `stat` declaration on a layer into a SQL fragment that
 * aggregates the underlying rows before they reach the renderer. The
 * compiler is engine-agnostic (no DuckDB dependency); engines wrap the
 * resulting SQL in their own materialization step.
 *
 * Phase 1.0 supports `count`, `sum`, `mean`. `bin`, `median`, `quantile`
 * land in a follow-up since they need range/quantile primitives that
 * vary by engine.
 *
 * Rewrite strategy:
 *   - Inputs: a SELECT statement that produces the base rows; a layer's
 *     encoding (x, y, color) and stat declaration.
 *   - Output: a wrapping SELECT that GROUPs BY x (and color when present)
 *     and aggregates y.
 *   - When y is missing (e.g. `stat: count` with only an x encoding), the
 *     stat invents a `_count` column and the layer's renderer reads it.
 */

import type { Channel, Encoding, Layer } from "../spec/types.js";

/** Stat types this build implements. */
export const SUPPORTED_STAT_TYPES = ["count", "sum", "mean"] as const;
export type SupportedStatType = (typeof SUPPORTED_STAT_TYPES)[number];

/** Quote a SQL identifier (doubled-quote escape). */
function q(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

function fieldOf(ch: Channel | undefined): string | undefined {
  if (ch === undefined) return undefined;
  return typeof ch === "string" ? ch : ch.field;
}

/** Return value of stat compilation. */
export interface StatCompileResult {
  /** The rewritten SQL (or unchanged base when the layer has no stat). */
  readonly sql: string;
  /**
   * The y-field name the renderer should read. Differs from the encoding's
   * declared y when the stat invents a column (e.g. count produces a
   * synthetic `_count` field).
   */
  readonly outputYField: string | undefined;
}

export interface StatCompileError {
  readonly message: string;
}

/**
 * Apply the layer's stat (if any) to the given base SELECT statement.
 *
 * Returns the rewritten SQL and the y-field name to read. When the layer
 * has no stat, the function is a pass-through.
 */
export function applyStat(layer: Layer, baseSelect: string): StatCompileResult | StatCompileError {
  if (!layer.stat) {
    return { sql: baseSelect, outputYField: fieldOf(layer.encoding.y) };
  }

  const stat = layer.stat;
  if (!SUPPORTED_STAT_TYPES.includes(stat.type as SupportedStatType)) {
    return {
      message: `Stat '${stat.type}' is not yet implemented; supported: ${SUPPORTED_STAT_TYPES.join(", ")}`,
    };
  }

  const enc: Encoding = layer.encoding;
  const xField = fieldOf(enc.x);
  const yField = fieldOf(enc.y);
  const cField = fieldOf(enc.color);
  if (!xField) {
    return { message: "Stat requires an x encoding (the GROUP BY key)" };
  }

  // GROUP BY x (and color, if present).
  const groupFields = cField ? [xField, cField] : [xField];
  const groupSelect = groupFields.map(q).join(", ");
  const groupBy = groupSelect;

  let aggSelect: string;
  let outputYField: string;

  switch (stat.type as SupportedStatType) {
    case "count":
      // Count rows per group. The output column is `_count` if y is unset,
      // otherwise honors the encoded y field name.
      outputYField = yField ?? "_count";
      aggSelect = `COUNT(*) AS ${q(outputYField)}`;
      break;
    case "sum":
      if (!yField) {
        return { message: "Stat 'sum' requires a y encoding to aggregate" };
      }
      outputYField = yField;
      aggSelect = `SUM(${q(yField)}) AS ${q(yField)}`;
      break;
    case "mean":
      if (!yField) {
        return { message: "Stat 'mean' requires a y encoding to aggregate" };
      }
      outputYField = yField;
      aggSelect = `AVG(${q(yField)}) AS ${q(yField)}`;
      break;
  }

  const sql = `SELECT ${groupSelect}, ${aggSelect} FROM (${baseSelect}) glyph_stat_base GROUP BY ${groupBy} ORDER BY ${q(xField)}`;
  return { sql, outputYField };
}

/** Type guard: did the compilation produce an error rather than a result? */
export function isStatError(r: StatCompileResult | StatCompileError): r is StatCompileError {
  return "message" in r;
}
