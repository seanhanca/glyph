/**
 * Self-explaining charts — Phase 3 §2 (PR35).
 *
 * `explainHandle` runs a fixed deterministic pipeline against rows that back
 * a chart and returns a `{ headline, highlights, questions }` JSON. The
 * pipeline has four stages:
 *
 *   1. Top-line   — extent, max value + label, min value + label, ratio
 *   2. Compositional — top-3 contributing groups by share (color/group field)
 *   3. Anomaly    — values > 2σ from the segment mean
 *   4. Temporal   — if x is temporal, period-over-period delta + trend
 *
 * Determinism is the whole point: the same rows + the same Glyph version
 * always yield the same explanation. The `questions` array is fuel for an
 * agent graph — the next prompt a downstream diagnostician picks up.
 *
 * Pure logic: no engine handles, no MCP — `explainHandle` takes rows +
 * schema and returns the JSON. The MCP `glyph_explain` verb (in
 * `@glyph/mcp`) wires the engine I/O around this.
 */

export type FieldRoleHint = {
  readonly xField?: string | undefined;
  readonly yField?: string | undefined;
  readonly groupField?: string | undefined;
};

/** Column descriptor `explainHandle` consumes. Matches DataHandle.schema. */
export interface ExplainColumn {
  readonly name: string;
  readonly type: string;
  readonly nullable?: boolean;
  readonly suggested?: "quantitative" | "ordinal" | "nominal" | "temporal";
}

export interface ExplainInput {
  readonly schema: ReadonlyArray<ExplainColumn>;
  /** Row tuples positionally aligned to `schema`. */
  readonly rows: ReadonlyArray<ReadonlyArray<unknown>>;
  /** Optional manual role hints — overrides heuristics. */
  readonly hints?: FieldRoleHint | undefined;
}

export interface ExplainResult {
  /** One-sentence top-line observation. */
  readonly headline: string;
  /** 1–4 short observations the user should walk away knowing. */
  readonly highlights: ReadonlyArray<string>;
  /** 1–4 follow-up questions an agent can hand off to a diagnostician. */
  readonly questions: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// Heuristic encoding-type inference
// ---------------------------------------------------------------------------

/**
 * Map DuckDB logical type names to suggested encoding types. Matches the
 * mapping in `@glyph/duckdb`'s engine; duplicated here so `@glyph/core` can
 * reason about handle schemas without a runtime dependency on duckdb.
 */
function suggestFromType(duckType: string): ExplainColumn["suggested"] {
  const t = duckType.toUpperCase();
  if (/TIMESTAMP|DATE|TIME/.test(t)) return "temporal";
  if (/INT|DECIMAL|DOUBLE|FLOAT|REAL|NUMERIC|HUGEINT/.test(t)) return "quantitative";
  if (/BOOL|VARCHAR|CHAR|TEXT|STRING|UUID/.test(t)) return "nominal";
  return "nominal";
}

function inferRole(col: ExplainColumn): NonNullable<ExplainColumn["suggested"]> {
  return col.suggested ?? suggestFromType(col.type) ?? "nominal";
}

/**
 * Pick the columns that play x / y / group. Heuristics:
 *   - y: first quantitative column
 *   - x: first temporal column, else first non-quantitative column
 *   - group: second nominal/ordinal column (after x) if any
 * Hints override heuristics column-by-column.
 */
function pickRoles(
  schema: ReadonlyArray<ExplainColumn>,
  hints: FieldRoleHint | undefined,
): {
  readonly x: { col: ExplainColumn; index: number } | undefined;
  readonly y: { col: ExplainColumn; index: number } | undefined;
  readonly group: { col: ExplainColumn; index: number } | undefined;
} {
  const indexed = schema.map((col, index) => ({ col, index, role: inferRole(col) }));
  const byName = (name: string | undefined) =>
    name === undefined ? undefined : indexed.find((c) => c.col.name === name);

  let y = byName(hints?.yField);
  if (!y) y = indexed.find((c) => c.role === "quantitative");

  let x = byName(hints?.xField);
  if (!x)
    x =
      indexed.find((c) => c.role === "temporal") ??
      indexed.find((c) => c !== y && c.role !== "quantitative") ??
      indexed.find((c) => c !== y);

  let group = byName(hints?.groupField);
  if (!group)
    group = indexed.find(
      (c) => c !== x && c !== y && (c.role === "nominal" || c.role === "ordinal"),
    );

  return {
    x: x ? { col: x.col, index: x.index } : undefined,
    y: y ? { col: y.col, index: y.index } : undefined,
    group: group ? { col: group.col, index: group.index } : undefined,
  };
}

// ---------------------------------------------------------------------------
// Stats helpers — kept tiny and deterministic
// ---------------------------------------------------------------------------

function toNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function stats(values: ReadonlyArray<number>): {
  readonly n: number;
  readonly mean: number;
  readonly std: number;
} {
  const n = values.length;
  if (n === 0) return { n, mean: 0, std: 0 };
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / n;
  let sse = 0;
  for (const v of values) {
    const d = v - mean;
    sse += d * d;
  }
  const std = n > 1 ? Math.sqrt(sse / (n - 1)) : 0;
  return { n, mean, std };
}

/** Format a number compactly for narrative output. */
function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Math.abs(n) >= 1000) return n.toFixed(0);
  if (Math.abs(n) >= 10) return n.toFixed(1).replace(/\.0$/, "");
  return n.toFixed(2).replace(/\.?0+$/, "");
}

function fmtPct(p: number): string {
  return `${(p * 100).toFixed(0)}%`;
}

function fmtLabel(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "bigint") return String(v);
  return String(v);
}

// ---------------------------------------------------------------------------
// The four pipeline stages
// ---------------------------------------------------------------------------

interface PipelineCtx {
  readonly rows: ReadonlyArray<ReadonlyArray<unknown>>;
  readonly xIdx: number | undefined;
  readonly yIdx: number;
  readonly groupIdx: number | undefined;
  readonly xCol: ExplainColumn | undefined;
  readonly yCol: ExplainColumn;
  readonly groupCol: ExplainColumn | undefined;
  readonly xIsTemporal: boolean;
}

/** Stage 1: top-line — peak, trough, ratio. Always populates a headline. */
function topLine(ctx: PipelineCtx): {
  readonly headline: string;
  readonly highlights: string[];
  readonly questions: string[];
} {
  const yName = ctx.yCol.name;
  const pairs = ctx.rows
    .map((row) => ({
      x: ctx.xIdx !== undefined ? row[ctx.xIdx] : undefined,
      y: toNumber(row[ctx.yIdx]),
    }))
    .filter((p): p is { x: unknown; y: number } => p.y !== undefined);

  if (pairs.length === 0) {
    return {
      headline: `No numeric values in ${yName}.`,
      highlights: [],
      questions: [],
    };
  }

  const sortedDesc = [...pairs].sort((a, b) => b.y - a.y);
  // biome-ignore lint/style/noNonNullAssertion: length checked.
  const peak = sortedDesc[0]!;
  // biome-ignore lint/style/noNonNullAssertion: length checked.
  const trough = sortedDesc[sortedDesc.length - 1]!;
  const ratio = trough.y !== 0 ? peak.y / trough.y : Number.POSITIVE_INFINITY;
  const ratioStr =
    Number.isFinite(ratio) && trough.y !== 0 ? `${ratio.toFixed(1)}×` : "much higher than";

  let headline: string;
  if (ctx.xIdx !== undefined && peak.x !== undefined && trough.x !== undefined) {
    headline =
      Number.isFinite(ratio) && trough.y !== 0
        ? `${yName} peaked at ${fmtLabel(peak.x)} (${fmtNum(peak.y)}), ${ratioStr} the ${fmtLabel(trough.x)} low (${fmtNum(trough.y)}).`
        : `${yName} peaked at ${fmtLabel(peak.x)} (${fmtNum(peak.y)}); trough at ${fmtLabel(trough.x)}.`;
  } else {
    headline = `${yName} ranges ${fmtNum(trough.y)} – ${fmtNum(peak.y)} across ${pairs.length} rows.`;
  }

  const highlights: string[] = [];
  const questions: string[] = [];
  if (ctx.xIdx !== undefined && Number.isFinite(ratio) && ratio >= 2) {
    questions.push(
      `What drives the ${ratioStr} spread between ${fmtLabel(peak.x)} and ${fmtLabel(trough.x)}?`,
    );
  }

  return { headline, highlights, questions };
}

/** Stage 2: compositional — top-3 contributing groups by share. */
function compositional(ctx: PipelineCtx): {
  readonly highlights: string[];
  readonly questions: string[];
} {
  const highlights: string[] = [];
  const questions: string[] = [];
  // Prefer an explicit group column; fall back to x when x is categorical.
  let groupIdx = ctx.groupIdx;
  let groupName = ctx.groupCol?.name;
  if (groupIdx === undefined && ctx.xIdx !== undefined && !ctx.xIsTemporal) {
    groupIdx = ctx.xIdx;
    groupName = ctx.xCol?.name;
  }
  if (groupIdx === undefined || groupName === undefined) return { highlights, questions };

  const sums = new Map<string, number>();
  let total = 0;
  for (const row of ctx.rows) {
    const y = toNumber(row[ctx.yIdx]);
    if (y === undefined || y < 0) continue;
    const key = fmtLabel(row[groupIdx]);
    sums.set(key, (sums.get(key) ?? 0) + y);
    total += y;
  }
  if (total === 0 || sums.size < 2) return { highlights, questions };

  const top = [...sums.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const [topKey, topVal] = top[0] ?? [undefined, 0];
  if (topKey !== undefined) {
    const share = topVal / total;
    if (share >= 0.3) {
      highlights.push(
        `${groupName}=${topKey} contributes ${fmtPct(share)} of total ${ctx.yCol.name}.`,
      );
      questions.push(`What drives ${groupName}=${topKey}'s outsized share?`);
    } else {
      // Even without a dominant group, surface the top-3 share if meaningful.
      const top3Share = top.reduce((s, [, v]) => s + v, 0) / total;
      if (top3Share >= 0.6) {
        const names = top.map(([k]) => k).join(", ");
        highlights.push(
          `Top 3 ${groupName} (${names}) together account for ${fmtPct(top3Share)} of ${ctx.yCol.name}.`,
        );
      }
    }
  }

  return { highlights, questions };
}

/** Stage 3: anomaly — rows > 2σ from segment mean. */
function anomaly(ctx: PipelineCtx): {
  readonly highlights: string[];
  readonly questions: string[];
} {
  const highlights: string[] = [];
  const questions: string[] = [];
  if (ctx.rows.length < 4) return { highlights, questions };

  // Segment rows by groupCol if present, else single segment.
  const segments = new Map<string, Array<{ row: ReadonlyArray<unknown>; y: number }>>();
  for (const row of ctx.rows) {
    const y = toNumber(row[ctx.yIdx]);
    if (y === undefined) continue;
    const seg = ctx.groupIdx !== undefined ? fmtLabel(row[ctx.groupIdx]) : "__all__";
    if (!segments.has(seg)) segments.set(seg, []);
    // biome-ignore lint/style/noNonNullAssertion: just set above.
    segments.get(seg)!.push({ row, y });
  }

  // Find the strongest outlier across segments.
  let bestOutlier:
    | {
        z: number;
        yVal: number;
        xLabel: string;
        segLabel: string;
        mean: number;
      }
    | undefined;

  for (const [segLabel, items] of segments) {
    if (items.length < 4) continue;
    const ys = items.map((i) => i.y);
    const s = stats(ys);
    if (s.std === 0) continue;
    for (const item of items) {
      const z = (item.y - s.mean) / s.std;
      if (Math.abs(z) > 2 && (!bestOutlier || Math.abs(z) > Math.abs(bestOutlier.z))) {
        const xLabel =
          ctx.xIdx !== undefined ? fmtLabel(item.row[ctx.xIdx]) : `row ${ys.indexOf(item.y)}`;
        bestOutlier = { z, yVal: item.y, xLabel, segLabel, mean: s.mean };
      }
    }
  }

  if (bestOutlier) {
    const direction = bestOutlier.z > 0 ? "+" : "";
    const seg =
      bestOutlier.segLabel === "__all__"
        ? ""
        : ` within ${ctx.groupCol?.name}=${bestOutlier.segLabel}`;
    highlights.push(
      `${ctx.xCol?.name ?? "value"}=${bestOutlier.xLabel} is an outlier${seg}: ${fmtNum(bestOutlier.yVal)} (${direction}${bestOutlier.z.toFixed(1)}σ vs mean ${fmtNum(bestOutlier.mean)}).`,
    );
    questions.push(
      `Why is ${ctx.xCol?.name ?? "this value"}=${bestOutlier.xLabel}${seg ? ` ${seg.trim()}` : ""} anomalous?`,
    );
  }
  return { highlights, questions };
}

/** Stage 4: temporal — period-over-period + trend direction. */
function temporal(ctx: PipelineCtx): {
  readonly highlights: string[];
  readonly questions: string[];
} {
  const highlights: string[] = [];
  const questions: string[] = [];
  if (!ctx.xIsTemporal || ctx.xIdx === undefined || ctx.rows.length < 3) {
    return { highlights, questions };
  }

  // Sort by x for a meaningful sequence.
  const pairs = ctx.rows
    .map((row) => {
      const y = toNumber(row[ctx.yIdx]);
      const x = row[ctx.xIdx as number];
      return { row, y, x };
    })
    .filter((p): p is { row: ReadonlyArray<unknown>; y: number; x: unknown } => p.y !== undefined)
    .sort((a, b) => {
      const av = a.x instanceof Date ? a.x.getTime() : Number(a.x);
      const bv = b.x instanceof Date ? b.x.getTime() : Number(b.x);
      return av - bv;
    });

  if (pairs.length < 2) return { highlights, questions };

  // biome-ignore lint/style/noNonNullAssertion: length checked.
  const last = pairs[pairs.length - 1]!;
  // biome-ignore lint/style/noNonNullAssertion: length checked.
  const prior = pairs[pairs.length - 2]!;
  const deltaPct = prior.y !== 0 ? (last.y - prior.y) / prior.y : Number.POSITIVE_INFINITY;
  const direction = deltaPct > 0 ? "up" : deltaPct < 0 ? "down" : "flat";

  if (Number.isFinite(deltaPct) && Math.abs(deltaPct) >= 0.05) {
    highlights.push(
      `Most recent period ${direction} ${fmtPct(Math.abs(deltaPct))} vs prior (${fmtNum(prior.y)} → ${fmtNum(last.y)}).`,
    );
  }

  // Trend strength via Pearson r between (rank of x) and y. Cheap, deterministic.
  const n = pairs.length;
  if (n >= 4) {
    let sx = 0;
    let sy = 0;
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    pairs.forEach((p, i) => {
      sx += i;
      sy += p.y;
      sxy += i * p.y;
      sxx += i * i;
      syy += p.y * p.y;
    });
    const num = n * sxy - sx * sy;
    const den = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
    const r = den === 0 ? 0 : num / den;
    if (Math.abs(r) >= 0.6) {
      const dir = r > 0 ? "upward" : "downward";
      highlights.push(`Trend is ${dir} (r=${r.toFixed(2)}) over ${n} periods.`);
      questions.push(`Is the ${dir} trend in ${ctx.yCol.name} sustainable?`);
    }
  }
  return { highlights, questions };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Run the deterministic explain pipeline. Pure function — no I/O, no time
 * source. Same input always yields the same output.
 */
export function explainHandle(input: ExplainInput): ExplainResult {
  const roles = pickRoles(input.schema, input.hints);
  if (!roles.y) {
    return {
      headline: "No quantitative column to explain.",
      highlights: [],
      questions: [],
    };
  }
  if (input.rows.length === 0) {
    return {
      headline: `${roles.y.col.name}: no rows to explain.`,
      highlights: [],
      questions: [],
    };
  }

  const xIsTemporal = roles.x ? inferRole(roles.x.col) === "temporal" : false;
  const ctx: PipelineCtx = {
    rows: input.rows,
    xIdx: roles.x?.index,
    yIdx: roles.y.index,
    groupIdx: roles.group?.index,
    xCol: roles.x?.col,
    yCol: roles.y.col,
    groupCol: roles.group?.col,
    xIsTemporal,
  };

  const t = topLine(ctx);
  const c = compositional(ctx);
  const a = anomaly(ctx);
  const tm = temporal(ctx);

  // Compose: dedupe + cap each list at 4 to keep the JSON small and useful.
  const dedupe = (xs: ReadonlyArray<string>): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const s of xs) {
      if (s && !seen.has(s)) {
        seen.add(s);
        out.push(s);
      }
    }
    return out;
  };

  const highlights = dedupe([
    ...t.highlights,
    ...c.highlights,
    ...a.highlights,
    ...tm.highlights,
  ]).slice(0, 4);
  const questions = dedupe([...t.questions, ...c.questions, ...a.questions, ...tm.questions]).slice(
    0,
    4,
  );

  return { headline: t.headline, highlights, questions };
}
