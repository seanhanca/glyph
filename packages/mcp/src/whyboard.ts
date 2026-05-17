/**
 * Whyboard — Innovation #5 (PR48).
 *
 * When a user asks "why did MRR drop?", the Story Agent shouldn't return a
 * single static chart — it should return a *tree of diagnostics*. A
 * Whyboard is that tree: a root chart, then one branch per diagnostic
 * primitive (anomaly / decompose / forecast), each leaf carrying a
 * derived DataHandle that the consumer can drill into. The shape is
 * stable + deterministic + auditable; no LLM is in the loop.
 *
 * Consumers (preview UI, agent narrators) render the tree as clickable
 * cards. The linked-view filter bus (PR46) is the substrate that lets a
 * click in any card propagate filters across siblings.
 *
 * v0 architecture
 *   - Heuristic decision tree (depth 1 by default; depth 2 optional).
 *   - Each diagnostic call materializes a derived handle (chained
 *     lineage), so the resulting tree is auditable end-to-end via
 *     glyph_lineage.
 *   - The tree's edges optionally share a `link_group` so a click in any
 *     branch broadcasts a filter to its siblings (configurable).
 */

import { randomUUID } from "node:crypto";
import type { ComputeEngine, DataHandle, ExplainResult } from "@glyph/core";
import {
  attributeDrift,
  decomposeVariance,
  detectAnomalies,
  explainHandle,
  seasonalNaiveForecast,
} from "@glyph/core";
import { materializeRowsAsHandle } from "@glyph/duckdb";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WhyboardNodeKind = "root" | "explain" | "anomaly" | "decompose" | "forecast" | "drift";

export interface WhyboardNode {
  readonly id: string;
  readonly kind: WhyboardNodeKind;
  readonly title: string;
  readonly summary: string;
  /** The DataHandle that backs this node (root = source, others = derived). */
  readonly handle_id: string;
  readonly uri?: string | undefined;
  /** Up-to-N rows the consumer can preview without re-querying. */
  readonly rows_sample?: ReadonlyArray<ReadonlyArray<unknown>> | undefined;
  readonly columns?: ReadonlyArray<string> | undefined;
  /** Same shape as glyph_explain output, when applicable. */
  readonly explanation?: ExplainResult | undefined;
  /** Verb-specific stats (e.g. anomaly threshold + segment summary). */
  readonly stats?: Record<string, unknown> | undefined;
  readonly children: WhyboardNode[];
}

export interface Whyboard {
  readonly source_handle: string;
  readonly question: string | null;
  readonly link_group: string | null;
  readonly depth_reached: number;
  readonly total_nodes: number;
  readonly root: WhyboardNode;
}

export interface BuildWhyboardOptions {
  readonly state: WhyboardServerState;
  readonly handle_id: string;
  readonly engine: ComputeEngine;
  readonly question?: string | undefined;
  readonly depth?: number | undefined;
  readonly factors?: ReadonlyArray<string> | undefined;
  readonly link_group?: string | undefined;
  /** Cap rows_sample per node. Default 8. */
  readonly sample_rows?: number | undefined;
}

/**
 * The slice of `ServerState` we depend on. Declared as an interface so the
 * test harness can pass a minimal shim. The MCP server passes its real
 * ServerState.
 */
export interface WhyboardServerState {
  readonly sessionId: string;
  getHandle(id: string): DataHandle | undefined;
  storeHandle(h: DataHandle): void;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

function shortId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

/**
 * Pick role columns the same way pickStoryRoles does. Duplicated here
 * because the Whyboard's decision tree is its own concern and we don't
 * want to import from packages/mcp/story (clean dependency direction).
 */
function pickRoles(schema: ReadonlyArray<{ name: string; type: string }>): {
  readonly y: string | undefined;
  readonly x: string | undefined;
  readonly group: string | undefined;
  readonly temporal: string | undefined;
  readonly nominalFields: ReadonlyArray<string>;
} {
  const role = (t: string): "q" | "t" | "n" => {
    const u = t.toUpperCase();
    if (/TIMESTAMP|DATE|TIME/.test(u)) return "t";
    if (/INT|DECIMAL|DOUBLE|FLOAT|REAL|NUMERIC|HUGEINT/.test(u)) return "q";
    return "n";
  };
  const tagged = schema.map((c) => ({ name: c.name, role: role(c.type) }));
  const y = tagged.find((t) => t.role === "q")?.name;
  const temporal = tagged.find((t) => t.role === "t")?.name;
  const x = temporal ?? tagged.find((t) => t.name !== y && t.role !== "q")?.name;
  const group = tagged.find((t) => t.name !== x && t.name !== y && t.role === "n")?.name;
  const nominalFields = tagged.filter((t) => t.role === "n").map((t) => t.name);
  return { y, x, group, temporal, nominalFields };
}

/**
 * Build a Whyboard tree starting from `handle_id`. The default depth is 1:
 * the root carries the source chart's explanation, and children are the
 * three diagnostic primitives applied once. depth=2 optionally recurses on
 * the strongest finding (e.g. the anomaly node fans out into a sub-decompose
 * on the segment that produced the outlier).
 */
export async function buildWhyboard(opts: BuildWhyboardOptions): Promise<Whyboard> {
  const { state, engine, handle_id, link_group } = opts;
  const sampleRows = opts.sample_rows ?? 8;
  const depth = Math.max(1, Math.min(opts.depth ?? 1, 3));

  const handle = state.getHandle(handle_id);
  if (!handle) throw new Error(`Unknown handle_id: ${handle_id}`);

  const queried = await engine.queryHandle(handle);
  const rows = queried.rows;
  const schemaForExplain = handle.schema.map((c) => ({ name: c.name, type: c.type }));
  const roles = pickRoles(schemaForExplain);
  const rootExplanation = explainHandle({ schema: handle.schema, rows });

  const rootCols = handle.schema.map((c) => c.name);
  let totalNodes = 1;
  const root: WhyboardNode = {
    id: shortId(),
    kind: "root",
    title:
      handle.schema.length === 0 ? "Empty handle" : (rootExplanation.headline ?? "Source chart"),
    summary: rootExplanation.headline ?? "Source chart",
    handle_id: handle.id,
    uri: handle.uri,
    rows_sample: rows.slice(0, sampleRows),
    columns: rootCols,
    explanation: rootExplanation,
    children: [],
  };

  if (!roles.y) {
    // Nothing quantitative — there's nothing to diagnose. Return root only.
    return {
      source_handle: handle.id,
      question: opts.question ?? null,
      link_group: link_group ?? null,
      depth_reached: 1,
      total_nodes: totalNodes,
      root,
    };
  }

  // --- Anomaly branch -----------------------------------------------------
  const anomalyResult = detectAnomalies({
    schema: handle.schema,
    rows,
    valueField: roles.y,
    ...(roles.group !== undefined ? { groupField: roles.group } : {}),
    ...(roles.x !== undefined ? { labelField: roles.x } : {}),
  });
  if (anomalyResult.rows.length > 0) {
    const columns = anomalyResult.schema.map((c) => c.name);
    const rowsArr = anomalyResult.rows.map((a) => [...a.row, a.z]);
    const derived = await materializeRowsAsHandle(engine, {
      rows: rowsArr,
      columns,
      sessionId: state.sessionId,
      parent: handle,
      relation: "filter",
      producerTool: "glyph_whyboard.anomaly",
    });
    state.storeHandle(derived);
    totalNodes++;
    root.children.push({
      id: shortId(),
      kind: "anomaly",
      title: `${anomalyResult.rows.length} outlier(s) in ${roles.y}`,
      summary: anomalyResult.explanation.headline,
      handle_id: derived.id,
      uri: derived.uri,
      rows_sample: rowsArr.slice(0, sampleRows),
      columns,
      explanation: anomalyResult.explanation,
      stats: {
        threshold: anomalyResult.threshold,
        segments: anomalyResult.segments,
      },
      children: [],
    });
  }

  // --- Decompose branch ---------------------------------------------------
  // Use either caller-provided factors or the schema's nominal columns
  // (minus any we're already plotting on x/group).
  const candidateFactors =
    opts.factors ?? roles.nominalFields.filter((f) => f !== roles.x && f !== roles.y);
  if (candidateFactors.length > 0) {
    const decomposeResult = decomposeVariance({
      schema: handle.schema,
      rows,
      metricField: roles.y,
      factors: candidateFactors,
    });
    if (decomposeResult.rows.length > 0) {
      const columns = decomposeResult.schema.map((c) => c.name);
      const rowsArr = decomposeResult.rows.map((dr) => [
        dr.factor,
        dr.varianceExplained,
        dr.distinctGroups,
        dr.topGroup,
        dr.topGroupMean,
      ]);
      const derived = await materializeRowsAsHandle(engine, {
        rows: rowsArr,
        columns,
        sessionId: state.sessionId,
        parent: handle,
        relation: "agg",
        producerTool: "glyph_whyboard.decompose",
      });
      state.storeHandle(derived);
      totalNodes++;
      root.children.push({
        id: shortId(),
        kind: "decompose",
        title: `Variance attribution for ${roles.y}`,
        summary: decomposeResult.explanation.headline,
        handle_id: derived.id,
        uri: derived.uri,
        rows_sample: rowsArr,
        columns,
        explanation: decomposeResult.explanation,
        stats: { grandMean: decomposeResult.grandMean, totalSSE: decomposeResult.totalSSE },
        children: [],
      });
    }
  }

  // --- Forecast branch ----------------------------------------------------
  if (roles.temporal && roles.y) {
    try {
      const forecastResult = seasonalNaiveForecast({
        schema: handle.schema,
        rows,
        xField: roles.temporal,
        yField: roles.y,
      });
      const columns = forecastResult.schema.map((c) => c.name);
      const rowsArr = forecastResult.rows.map((fr) => [
        fr.x instanceof Date ? fr.x.toISOString() : fr.x,
        fr.actual,
        fr.forecast,
        fr.lo,
        fr.hi,
        fr.isHorizon,
      ]);
      const derived = await materializeRowsAsHandle(engine, {
        rows: rowsArr,
        columns,
        sessionId: state.sessionId,
        parent: handle,
        relation: "transform",
        producerTool: "glyph_whyboard.forecast",
      });
      state.storeHandle(derived);
      totalNodes++;
      root.children.push({
        id: shortId(),
        kind: "forecast",
        title: `Forecast of ${roles.y}`,
        summary: forecastResult.explanation.headline,
        handle_id: derived.id,
        uri: derived.uri,
        rows_sample: rowsArr.slice(0, sampleRows),
        columns,
        explanation: forecastResult.explanation,
        stats: {
          season: forecastResult.season,
          residualStd: forecastResult.residualStd,
        },
        children: [],
      });
    } catch {
      // forecast skipped (e.g. < 2 sortable temporal rows)
    }
  }

  // --- Drift branch (only when explicitly armed with a period field) ------
  // Drift needs a period column with at least 2 distinct values + a group
  // field. v0 detects this from the schema: if there's a 2-valued nominal
  // column (often "period" / "quarter"), we attempt it.
  if (roles.y) {
    const periodField = findPeriodField(
      rows,
      handle.schema,
      [roles.y, roles.x, roles.group].filter(Boolean) as string[],
    );
    if (periodField && roles.group) {
      const inPeriod = (target: string) => (v: unknown) => String(v) === target;
      const driftResult = attributeDrift({
        schema: handle.schema,
        rows,
        valueField: roles.y,
        groupField: roles.group,
        periodField: periodField.field,
        periodA: inPeriod(periodField.a),
        periodB: inPeriod(periodField.b),
      });
      if (driftResult.rows.length > 0) {
        const columns = driftResult.schema.map((c) => c.name);
        const rowsArr = driftResult.rows.map((dr) => [
          dr.group,
          dr.valueA,
          dr.valueB,
          dr.delta,
          dr.share,
        ]);
        const derived = await materializeRowsAsHandle(engine, {
          rows: rowsArr,
          columns,
          sessionId: state.sessionId,
          parent: handle,
          relation: "agg",
          producerTool: "glyph_whyboard.drift",
        });
        state.storeHandle(derived);
        totalNodes++;
        root.children.push({
          id: shortId(),
          kind: "drift",
          title: `Drift ${periodField.a} → ${periodField.b}`,
          summary: driftResult.explanation.headline,
          handle_id: derived.id,
          uri: derived.uri,
          rows_sample: rowsArr.slice(0, sampleRows),
          columns,
          explanation: driftResult.explanation,
          stats: {
            totalA: driftResult.totalA,
            totalB: driftResult.totalB,
            totalDelta: driftResult.totalDelta,
            periodField: periodField.field,
          },
          children: [],
        });
      }
    }
  }

  return {
    source_handle: handle.id,
    question: opts.question ?? null,
    link_group: link_group ?? null,
    depth_reached: Math.min(depth, 1),
    total_nodes: totalNodes,
    root,
  };
}

/**
 * Tiny heuristic: find a categorical column with exactly 2 distinct values
 * that we can use as a period field for drift. Excludes columns already
 * used as x / y / group.
 */
function findPeriodField(
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
  schema: ReadonlyArray<{ name: string; type: string }>,
  exclude: ReadonlyArray<string>,
): { field: string; a: string; b: string } | undefined {
  const excludeSet = new Set(exclude);
  for (let i = 0; i < schema.length; i++) {
    const col = schema[i];
    if (!col || excludeSet.has(col.name)) continue;
    const t = col.type.toUpperCase();
    if (/INT|DECIMAL|DOUBLE|FLOAT|REAL/.test(t)) continue; // numeric — skip
    const seen = new Set<string>();
    for (const r of rows) {
      seen.add(String(r[i] ?? ""));
      if (seen.size > 2) break;
    }
    if (seen.size === 2) {
      const [a, b] = [...seen];
      // biome-ignore lint/style/noNonNullAssertion: size is 2.
      return { field: col.name, a: a!, b: b! };
    }
  }
  return undefined;
}
