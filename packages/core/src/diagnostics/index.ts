/**
 * Diagnostic primitives — Phase 3 §3 (PR36).
 *
 * Pure deterministic functions that turn a handle's rows into structured
 * diagnostic results. The four pillars analysts hand-roll today every time
 * a number moves:
 *
 *   - anomalyDetect   — rows > N σ from the segment mean (z-score)
 *   - driftAttribute  — per-group contribution to the delta between two periods
 *   - decomposeVar    — per-factor share of total variance (which dimension explains the spread)
 *   - seasonalNaive   — h-step-ahead forecast + 2σ bands from historical residuals
 *
 * The MCP verbs `glyph_anomaly` / `glyph_drift` / `glyph_decompose` /
 * `glyph_forecast` (in `@glyph/mcp`) wrap these and produce a derived
 * DataHandle so the result is queryable with `glyph_query` / `glyph_drill`.
 *
 * Determinism is the contract — every diagnostic verb in Phase 3 §13 Tier B
 * §3 needs to produce the same JSON for the same rows. No clock, no PRNG,
 * no LLM here.
 */

import type { ExplainColumn, ExplainResult } from "../explain/index.js";

// ---------------------------------------------------------------------------
// Small shared helpers
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

function fieldIndex(schema: ReadonlyArray<ExplainColumn>, name: string): number {
  const i = schema.findIndex((c) => c.name === name);
  if (i < 0) throw new Error(`Diagnostic: field "${name}" not found in schema`);
  return i;
}

function meanStd(values: ReadonlyArray<number>): { mean: number; std: number } {
  if (values.length === 0) return { mean: 0, std: 0 };
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / values.length;
  if (values.length < 2) return { mean, std: 0 };
  let sse = 0;
  for (const v of values) {
    const d = v - mean;
    sse += d * d;
  }
  return { mean, std: Math.sqrt(sse / (values.length - 1)) };
}

// ---------------------------------------------------------------------------
// §3a — glyph_anomaly
// ---------------------------------------------------------------------------

export interface AnomalyRow {
  /** The original row, columns positionally aligned to the input schema. */
  readonly row: ReadonlyArray<unknown>;
  /** Segment label (group field value), or "" when no grouping. */
  readonly segment: string;
  /** z = (value - segment_mean) / segment_std. */
  readonly z: number;
  /** Numeric value for this row. */
  readonly value: number;
}

export interface AnomalyResult {
  /** Top rows by |z|, descending. Capped at limit. */
  readonly rows: ReadonlyArray<AnomalyRow>;
  readonly schema: ReadonlyArray<ExplainColumn>;
  readonly threshold: number;
  /** Per-segment summary stats. */
  readonly segments: ReadonlyArray<{
    readonly segment: string;
    readonly mean: number;
    readonly std: number;
    readonly n: number;
  }>;
  readonly explanation: ExplainResult;
}

export interface AnomalyInput {
  readonly schema: ReadonlyArray<ExplainColumn>;
  readonly rows: ReadonlyArray<ReadonlyArray<unknown>>;
  readonly valueField: string;
  readonly groupField?: string | undefined;
  readonly labelField?: string | undefined;
  /** |z| > threshold triggers a hit. Default 2. */
  readonly threshold?: number | undefined;
  /** Cap the returned row count. Default 20. */
  readonly limit?: number | undefined;
}

export function detectAnomalies(input: AnomalyInput): AnomalyResult {
  const threshold = input.threshold ?? 2;
  const limit = input.limit ?? 20;
  const valueIdx = fieldIndex(input.schema, input.valueField);
  const groupIdx = input.groupField ? fieldIndex(input.schema, input.groupField) : -1;
  const labelIdx = input.labelField !== undefined ? fieldIndex(input.schema, input.labelField) : -1;

  // Bucket rows by segment.
  const buckets = new Map<string, Array<{ row: ReadonlyArray<unknown>; value: number }>>();
  for (const row of input.rows) {
    const v = toNumber(row[valueIdx]);
    if (v === undefined) continue;
    const seg = groupIdx >= 0 ? fmtLabel(row[groupIdx]) : "";
    let bucket = buckets.get(seg);
    if (!bucket) {
      bucket = [];
      buckets.set(seg, bucket);
    }
    bucket.push({ row, value: v });
  }

  const segments: AnomalyResult["segments"] = [...buckets.entries()].map(([seg, items]) => {
    const { mean, std } = meanStd(items.map((i) => i.value));
    return { segment: seg, mean, std, n: items.length };
  });
  const segMap = new Map(segments.map((s) => [s.segment, s]));

  const ranked: AnomalyRow[] = [];
  for (const [seg, items] of buckets) {
    const s = segMap.get(seg);
    if (!s || s.std === 0) continue;
    for (const item of items) {
      const z = (item.value - s.mean) / s.std;
      if (Math.abs(z) > threshold) {
        ranked.push({ row: item.row, segment: seg, z, value: item.value });
      }
    }
  }
  ranked.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
  const top = ranked.slice(0, limit);

  // Output schema: input columns + a z column.
  const schema: ExplainColumn[] = [
    ...input.schema,
    { name: "_z", type: "DOUBLE", suggested: "quantitative" as const },
  ];

  const explanation = buildAnomalyExplanation({
    top,
    threshold,
    valueField: input.valueField,
    groupField: input.groupField,
    labelIdx,
    schema: input.schema,
  });

  return { rows: top, schema, threshold, segments, explanation };
}

function buildAnomalyExplanation(args: {
  readonly top: ReadonlyArray<AnomalyRow>;
  readonly threshold: number;
  readonly valueField: string;
  readonly groupField: string | undefined;
  readonly labelIdx: number;
  readonly schema: ReadonlyArray<ExplainColumn>;
}): ExplainResult {
  if (args.top.length === 0) {
    return {
      headline: `No outliers > ${args.threshold}σ in ${args.valueField}.`,
      highlights: [],
      questions: [],
    };
  }
  const strongest = args.top[0];
  // biome-ignore lint/style/noNonNullAssertion: length checked.
  const s = strongest!;
  const label =
    args.labelIdx >= 0
      ? fmtLabel(s.row[args.labelIdx])
      : `row with ${args.valueField}=${fmtNum(s.value)}`;
  const direction = s.z > 0 ? "+" : "";
  const inSeg = args.groupField ? ` within ${args.groupField}=${s.segment}` : "";
  return {
    headline: `${args.top.length} outlier${args.top.length === 1 ? "" : "s"} > ${args.threshold}σ in ${args.valueField}; strongest is ${label} (${direction}${s.z.toFixed(1)}σ).`,
    highlights: args.top.slice(0, 3).map((r) => {
      const lab =
        args.labelIdx >= 0
          ? fmtLabel(r.row[args.labelIdx])
          : `${args.valueField}=${fmtNum(r.value)}`;
      const seg = args.groupField ? ` (${args.groupField}=${r.segment})` : "";
      return `${lab}${seg}: ${fmtNum(r.value)} at ${r.z > 0 ? "+" : ""}${r.z.toFixed(1)}σ`;
    }),
    questions: [
      `Why is ${label}${inSeg} ${s.z > 0 ? "above" : "below"} the segment mean?`,
      args.top.length > 1
        ? `Do the ${args.top.length} outliers share a common cause?`
        : `Could ${label} be a recurring effect or one-off?`,
    ],
  };
}

// ---------------------------------------------------------------------------
// §3b — glyph_drift
// ---------------------------------------------------------------------------

export interface DriftRow {
  readonly group: string;
  readonly valueA: number;
  readonly valueB: number;
  readonly delta: number;
  /** Share of total Δ contributed by this group. Sum across rows = 1.0. */
  readonly share: number;
}

export interface DriftResult {
  readonly rows: ReadonlyArray<DriftRow>;
  readonly schema: ReadonlyArray<ExplainColumn>;
  readonly totalA: number;
  readonly totalB: number;
  readonly totalDelta: number;
  readonly explanation: ExplainResult;
}

export interface DriftInput {
  readonly schema: ReadonlyArray<ExplainColumn>;
  readonly rows: ReadonlyArray<ReadonlyArray<unknown>>;
  readonly valueField: string;
  readonly groupField: string;
  readonly periodField: string;
  /** Partitions row → period A or B. Anything else is dropped. */
  readonly periodA: (value: unknown) => boolean;
  readonly periodB: (value: unknown) => boolean;
  readonly limit?: number | undefined;
}

export function attributeDrift(input: DriftInput): DriftResult {
  const limit = input.limit ?? 20;
  const valueIdx = fieldIndex(input.schema, input.valueField);
  const groupIdx = fieldIndex(input.schema, input.groupField);
  const periodIdx = fieldIndex(input.schema, input.periodField);

  const sumA = new Map<string, number>();
  const sumB = new Map<string, number>();
  let totalA = 0;
  let totalB = 0;

  for (const row of input.rows) {
    const v = toNumber(row[valueIdx]);
    if (v === undefined) continue;
    const period = row[periodIdx];
    const group = fmtLabel(row[groupIdx]);
    if (input.periodA(period)) {
      sumA.set(group, (sumA.get(group) ?? 0) + v);
      totalA += v;
    } else if (input.periodB(period)) {
      sumB.set(group, (sumB.get(group) ?? 0) + v);
      totalB += v;
    }
  }

  const groups = new Set([...sumA.keys(), ...sumB.keys()]);
  const totalDelta = totalB - totalA;

  const rows: DriftRow[] = [...groups].map((g) => {
    const a = sumA.get(g) ?? 0;
    const b = sumB.get(g) ?? 0;
    const delta = b - a;
    const share = totalDelta === 0 ? 0 : delta / totalDelta;
    return { group: g, valueA: a, valueB: b, delta, share };
  });
  rows.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  const top = rows.slice(0, limit);

  const schema: ExplainColumn[] = [
    { name: input.groupField, type: "VARCHAR", suggested: "nominal" as const },
    { name: "valueA", type: "DOUBLE", suggested: "quantitative" as const },
    { name: "valueB", type: "DOUBLE", suggested: "quantitative" as const },
    { name: "delta", type: "DOUBLE", suggested: "quantitative" as const },
    { name: "share", type: "DOUBLE", suggested: "quantitative" as const },
  ];

  const explanation = buildDriftExplanation({
    rows: top,
    totalA,
    totalB,
    totalDelta,
    valueField: input.valueField,
    groupField: input.groupField,
  });

  return { rows: top, schema, totalA, totalB, totalDelta, explanation };
}

function buildDriftExplanation(args: {
  readonly rows: ReadonlyArray<DriftRow>;
  readonly totalA: number;
  readonly totalB: number;
  readonly totalDelta: number;
  readonly valueField: string;
  readonly groupField: string;
}): ExplainResult {
  const direction = args.totalDelta > 0 ? "up" : args.totalDelta < 0 ? "down" : "flat";
  const pct =
    args.totalA !== 0
      ? `${args.totalDelta > 0 ? "+" : ""}${((args.totalDelta / args.totalA) * 100).toFixed(1)}%`
      : "n/a";
  if (args.rows.length === 0) {
    return {
      headline: `${args.valueField} unchanged between the two periods.`,
      highlights: [],
      questions: [],
    };
  }
  const top = args.rows[0];
  // biome-ignore lint/style/noNonNullAssertion: length checked.
  const lead = top!;
  return {
    headline: `${args.valueField} moved ${direction} ${pct} (${fmtNum(args.totalA)} → ${fmtNum(args.totalB)}); ${args.groupField}=${lead.group} drove ${fmtPct(Math.abs(lead.share))}.`,
    highlights: args.rows
      .slice(0, 3)
      .map(
        (r) =>
          `${args.groupField}=${r.group}: ${fmtNum(r.valueA)} → ${fmtNum(r.valueB)} (Δ ${r.delta > 0 ? "+" : ""}${fmtNum(r.delta)}, ${fmtPct(Math.abs(r.share))} of total drift)`,
      ),
    questions: [
      `What changed for ${args.groupField}=${lead.group} between the two periods?`,
      args.rows.length > 1
        ? `Did ${args.rows
            .slice(0, 3)
            .map((r) => r.group)
            .join(", ")} drift for the same reason?`
        : `Is the drift in ${lead.group} a permanent shift or recoverable?`,
    ],
  };
}

// ---------------------------------------------------------------------------
// §3c — glyph_decompose  (variance attribution per factor, v0)
// ---------------------------------------------------------------------------

export interface DecomposeRow {
  readonly factor: string;
  /** Sum of squared between-group deviation / total SSE. In [0, 1]. */
  readonly varianceExplained: number;
  readonly distinctGroups: number;
  readonly topGroup: string;
  readonly topGroupMean: number;
}

export interface DecomposeResult {
  readonly rows: ReadonlyArray<DecomposeRow>;
  readonly schema: ReadonlyArray<ExplainColumn>;
  readonly grandMean: number;
  readonly totalSSE: number;
  readonly explanation: ExplainResult;
}

export interface DecomposeInput {
  readonly schema: ReadonlyArray<ExplainColumn>;
  readonly rows: ReadonlyArray<ReadonlyArray<unknown>>;
  readonly metricField: string;
  readonly factors: ReadonlyArray<string>;
}

/**
 * v0 decomposition: for each candidate factor, compute the fraction of the
 * metric's total variance that's "explained" by between-group differences
 * (one-way ANOVA's η²). Higher → that dimension carries more of the
 * spread. Honest about its scope: this is a quick scan to point at which
 * factor to look at first, not a full mix/rate/volume decomposition (that
 * needs explicit volume + rate inputs and lands in a follow-up).
 */
export function decomposeVariance(input: DecomposeInput): DecomposeResult {
  const valueIdx = fieldIndex(input.schema, input.metricField);
  // Pull all numeric values for the global stats.
  const allValues: number[] = [];
  for (const row of input.rows) {
    const v = toNumber(row[valueIdx]);
    if (v !== undefined) allValues.push(v);
  }
  const { mean: grandMean } = meanStd(allValues);
  let totalSSE = 0;
  for (const v of allValues) {
    const d = v - grandMean;
    totalSSE += d * d;
  }

  const rows: DecomposeRow[] = [];
  for (const factor of input.factors) {
    const factorIdx = fieldIndex(input.schema, factor);
    const groups = new Map<string, number[]>();
    for (const row of input.rows) {
      const v = toNumber(row[valueIdx]);
      if (v === undefined) continue;
      const g = fmtLabel(row[factorIdx]);
      let arr = groups.get(g);
      if (!arr) {
        arr = [];
        groups.set(g, arr);
      }
      arr.push(v);
    }
    let ssb = 0;
    let topGroup = "";
    let topGroupMean = grandMean;
    let topGroupDiff = Number.NEGATIVE_INFINITY;
    for (const [g, vs] of groups) {
      const { mean } = meanStd(vs);
      const diff = mean - grandMean;
      ssb += vs.length * diff * diff;
      if (Math.abs(diff) > topGroupDiff) {
        topGroupDiff = Math.abs(diff);
        topGroup = g;
        topGroupMean = mean;
      }
    }
    const varianceExplained = totalSSE === 0 ? 0 : Math.min(1, ssb / totalSSE);
    rows.push({
      factor,
      varianceExplained,
      distinctGroups: groups.size,
      topGroup,
      topGroupMean,
    });
  }
  rows.sort((a, b) => b.varianceExplained - a.varianceExplained);

  const schema: ExplainColumn[] = [
    { name: "factor", type: "VARCHAR", suggested: "nominal" as const },
    { name: "varianceExplained", type: "DOUBLE", suggested: "quantitative" as const },
    { name: "distinctGroups", type: "INTEGER", suggested: "quantitative" as const },
    { name: "topGroup", type: "VARCHAR", suggested: "nominal" as const },
    { name: "topGroupMean", type: "DOUBLE", suggested: "quantitative" as const },
  ];

  const explanation = buildDecomposeExplanation({
    rows,
    metricField: input.metricField,
    grandMean,
  });

  return { rows, schema, grandMean, totalSSE, explanation };
}

function buildDecomposeExplanation(args: {
  readonly rows: ReadonlyArray<DecomposeRow>;
  readonly metricField: string;
  readonly grandMean: number;
}): ExplainResult {
  if (args.rows.length === 0) {
    return {
      headline: `No factors supplied to decompose ${args.metricField}.`,
      highlights: [],
      questions: [],
    };
  }
  const top = args.rows[0];
  // biome-ignore lint/style/noNonNullAssertion: length checked.
  const lead = top!;
  return {
    headline: `${lead.factor} explains ${fmtPct(lead.varianceExplained)} of variance in ${args.metricField} (top group: ${lead.factor}=${lead.topGroup}).`,
    highlights: args.rows
      .slice(0, 4)
      .map(
        (r) =>
          `${r.factor}: ${fmtPct(r.varianceExplained)} explained across ${r.distinctGroups} groups; top ${r.factor}=${r.topGroup} (mean ${fmtNum(r.topGroupMean)} vs grand ${fmtNum(args.grandMean)}).`,
      ),
    questions: [
      `What drives the spread in ${lead.factor}?`,
      `Is ${lead.factor}=${lead.topGroup} structurally different from the others?`,
    ],
  };
}

// ---------------------------------------------------------------------------
// §3d — glyph_forecast (seasonal-naive baseline + 2σ bands)
// ---------------------------------------------------------------------------

export interface ForecastRow {
  readonly index: number;
  readonly x: unknown;
  readonly actual: number | undefined;
  readonly forecast: number | undefined;
  readonly lo: number | undefined;
  readonly hi: number | undefined;
  /** True for the trailing `horizon` rows where actual === undefined. */
  readonly isHorizon: boolean;
}

export interface ForecastResult {
  readonly rows: ReadonlyArray<ForecastRow>;
  readonly schema: ReadonlyArray<ExplainColumn>;
  readonly season: number;
  readonly residualStd: number;
  readonly explanation: ExplainResult;
}

export interface ForecastInput {
  readonly schema: ReadonlyArray<ExplainColumn>;
  readonly rows: ReadonlyArray<ReadonlyArray<unknown>>;
  readonly xField: string;
  readonly yField: string;
  /** Default = round(n/2), capped to [1, 7]. */
  readonly season?: number | undefined;
  /** How many steps ahead. Default 7. */
  readonly horizon?: number | undefined;
}

/**
 * Seasonal-naive forecast: y_hat[t] = y[t - season]. Confidence band =
 * ±2 · stddev of historical residuals. Deterministic and small; useful as
 * a baseline to flag actuals that fall outside the band.
 *
 * When `season < 2` (no detectable seasonality), the baseline collapses to
 * a one-step-back random walk: y_hat[t] = y[t-1].
 */
export function seasonalNaiveForecast(input: ForecastInput): ForecastResult {
  const horizon = input.horizon ?? 7;
  const xIdx = fieldIndex(input.schema, input.xField);
  const yIdx = fieldIndex(input.schema, input.yField);

  // Sort by x to get a sequence.
  const sorted = [...input.rows]
    .map((row) => ({ row, x: row[xIdx], y: toNumber(row[yIdx]) }))
    .filter((p): p is { row: ReadonlyArray<unknown>; x: unknown; y: number } => p.y !== undefined)
    .sort((a, b) => {
      const av = a.x instanceof Date ? a.x.getTime() : Number(a.x);
      const bv = b.x instanceof Date ? b.x.getTime() : Number(b.x);
      return av - bv;
    });

  const n = sorted.length;
  // Pick a season. Phase 3 §13 says "deterministic"; the simplest signal is
  // n/2 capped to a small window. Callers can override via `season`.
  const season = Math.max(
    1,
    Math.min(input.season ?? Math.max(1, Math.min(7, Math.floor(n / 2))), n - 1),
  );

  // Compute historical residuals via the same naive rule (look back `season`).
  const residuals: number[] = [];
  for (let i = season; i < n; i++) {
    // biome-ignore lint/style/noNonNullAssertion: indices bounded by n.
    const actual = sorted[i]!.y;
    // biome-ignore lint/style/noNonNullAssertion: indices bounded by n.
    const expected = sorted[i - season]!.y;
    residuals.push(actual - expected);
  }
  const { std: residualStd } = meanStd(residuals);

  const rows: ForecastRow[] = sorted.map((p, i) => {
    // biome-ignore lint/style/noNonNullAssertion: bounded.
    const fc = i >= season ? sorted[i - season]!.y : undefined;
    return {
      index: i,
      x: p.x,
      actual: p.y,
      forecast: fc,
      lo: fc !== undefined ? fc - 2 * residualStd : undefined,
      hi: fc !== undefined ? fc + 2 * residualStd : undefined,
      isHorizon: false,
    };
  });

  // Append horizon future rows. We don't know future x values precisely
  // without a cadence inference; we extrapolate by stepping the last gap.
  if (n >= 2) {
    // biome-ignore lint/style/noNonNullAssertion: n>=2 ensures index.
    const lastX = sorted[n - 1]!.x;
    // biome-ignore lint/style/noNonNullAssertion: n>=2 ensures index.
    const priorX = sorted[n - 2]!.x;
    let stepMs = 0;
    if (lastX instanceof Date && priorX instanceof Date) {
      stepMs = lastX.getTime() - priorX.getTime();
    }
    for (let h = 1; h <= horizon; h++) {
      const i = n - 1 + h;
      const lookbackIdx = i - season;
      const fc =
        lookbackIdx >= 0 && lookbackIdx < n
          ? // biome-ignore lint/style/noNonNullAssertion: bounded above.
            sorted[lookbackIdx]!.y
          : undefined;
      let futureX: unknown = h;
      if (lastX instanceof Date && stepMs > 0) {
        futureX = new Date(lastX.getTime() + stepMs * h);
      } else if (typeof lastX === "number") {
        futureX = lastX + h;
      }
      rows.push({
        index: i,
        x: futureX,
        actual: undefined,
        forecast: fc,
        lo: fc !== undefined ? fc - 2 * residualStd : undefined,
        hi: fc !== undefined ? fc + 2 * residualStd : undefined,
        isHorizon: true,
      });
    }
  }

  const schema: ExplainColumn[] = [
    { name: input.xField, type: "VARCHAR", suggested: "ordinal" as const },
    { name: "actual", type: "DOUBLE", suggested: "quantitative" as const },
    { name: "forecast", type: "DOUBLE", suggested: "quantitative" as const },
    { name: "lo", type: "DOUBLE", suggested: "quantitative" as const },
    { name: "hi", type: "DOUBLE", suggested: "quantitative" as const },
    { name: "isHorizon", type: "BOOLEAN", suggested: "nominal" as const },
  ];

  const explanation = buildForecastExplanation({
    rows,
    season,
    residualStd,
    yField: input.yField,
    horizon,
  });

  return { rows, schema, season, residualStd, explanation };
}

function buildForecastExplanation(args: {
  readonly rows: ReadonlyArray<ForecastRow>;
  readonly season: number;
  readonly residualStd: number;
  readonly yField: string;
  readonly horizon: number;
}): ExplainResult {
  const breaches = args.rows.filter(
    (r) =>
      r.actual !== undefined &&
      r.lo !== undefined &&
      r.hi !== undefined &&
      (r.actual < r.lo || r.actual > r.hi),
  );
  const futureRows = args.rows.filter((r) => r.isHorizon && r.forecast !== undefined);
  const futureForecast =
    futureRows.length > 0
      ? futureRows.reduce((s, r) => s + (r.forecast ?? 0), 0) / futureRows.length
      : undefined;

  const seasonNote =
    args.season > 1
      ? `seasonal-naive (season=${args.season})`
      : "one-step-back baseline (no seasonality)";

  const headline =
    breaches.length > 0
      ? `${breaches.length} actual value${breaches.length === 1 ? "" : "s"} fell outside the ${seasonNote} ±2σ band.`
      : `${args.yField} tracked the ${seasonNote} baseline within ±2σ.`;

  const highlights: string[] = [];
  if (futureForecast !== undefined) {
    highlights.push(
      `Next ${args.horizon}-step forecast averages ${fmtNum(futureForecast)} (±${fmtNum(2 * args.residualStd)} band).`,
    );
  }
  for (const b of breaches.slice(0, 2)) {
    const dir =
      b.actual !== undefined && b.forecast !== undefined && b.actual > b.forecast
        ? "above"
        : "below";
    highlights.push(
      `${args.yField} at ${fmtLabel(b.x)}: ${fmtNum(b.actual ?? 0)} ${dir} forecast ${fmtNum(b.forecast ?? 0)} (band ${fmtNum(b.lo ?? 0)}–${fmtNum(b.hi ?? 0)}).`,
    );
  }

  const questions: string[] = [];
  if (breaches.length > 0) {
    // biome-ignore lint/style/noNonNullAssertion: length>0 checked.
    const first = breaches[0]!;
    questions.push(`What caused the deviation in ${args.yField} at ${fmtLabel(first.x)}?`);
  }
  if (futureForecast !== undefined && args.season > 1) {
    questions.push(`Is the season=${args.season} pattern stable enough to plan against?`);
  }

  return { headline, highlights, questions };
}
