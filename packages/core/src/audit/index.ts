/**
 * Chart auditor — PR63 / PLAN item 2.2.
 *
 * A pure-fn linter that inspects a GlyphSpec (+ optional Scene) and flags
 * common ways charts mislead readers. Findings are advisory by default
 * (`strictness: "warn"`); a spec can opt into `strictness: "error"` to
 * make the materializer refuse to render. Hosts can also call the
 * `glyph_audit_spec` MCP verb directly.
 *
 * Rules implemented in v0:
 *
 *   AUDIT-01 (high)   Bar chart with y-axis not starting at 0.
 *   AUDIT-02 (medium) Dual-axis layers — two layers writing different
 *                     fields to left + right y axes, hard to compare.
 *   AUDIT-03 (high)   Logarithmic y scale without "log" mentioned in
 *                     title / subtitle (readers can't tell from a glance).
 *   AUDIT-04 (medium) Excessive aggregation — fewer than 5 underlying
 *                     rows per visible bar/point (low statistical power).
 *   AUDIT-06 (low)    Color count > 8 (categorical palette confusion).
 *   AUDIT-07 (low)    Extreme aspect ratio (width:height < 0.5 or > 3).
 *   AUDIT-08 (medium) Diverging palette without explicit midpoint
 *                     declared (palette implies a midpoint, encoding
 *                     doesn't specify what it is).
 *   AUDIT-09 (medium) Stacked layers on top of negative values
 *                     (numeric reading is ambiguous; bars can cancel).
 *   AUDIT-10 (medium) Moat PR3 — render-time pass: silent missing-data
 *                     dropout. Fires when `data.onMissing` is unset OR
 *                     "skip" AND >5% of rows have a null / NaN y value.
 *                     Emitted by `renderTimeAuditFindings(spec, rows,
 *                     yField, schema)` because computing the missing-rate
 *                     needs row access (the pure `auditSpec` path doesn't
 *                     have it). MCP `glyph_audit_spec` invokes both passes
 *                     and merges the results.
 *   AUDIT-11 (medium) Moat PR4 — brand-kit accessibility. Fires when
 *                     surface fg/bg contrast falls below the declared
 *                     `minContrastRatio`, or when `colorBlindSafe` is set
 *                     and the categorical palette collapses under
 *                     deuteranopia simulation.
 *   AUDIT-05 (medium) Line / area mark with a CATEGORICAL x-encoding.
 *                     The connecting line implies an ordered progression
 *                     that nominal categories don't carry — viewers
 *                     read a fake trend.
 *   AUDIT-12 (medium) Pie / donut / arc with too many slices (>7). Angle
 *                     comparison drops sharply past ~5 slices (Cleveland-
 *                     McGill); past 7 is essentially unreadable.
 *   AUDIT-13 (low)    Bar chart with a quantitative x. Bars on a
 *                     continuous axis usually want `mark: "rect"` or
 *                     binned histogram semantics; otherwise the chart
 *                     conflates ordinal grouping with continuous space.
 *   AUDIT-14 (low)    More than 4 overlay layers in one chart. Visual
 *                     overload past 4 layers makes individual series
 *                     hard to follow; small multiples or faceting reads
 *                     better.
 *   AUDIT-15 (low)    Multi-layer chart with no title. A bare multi-
 *                     series chart is unreadable without context; title
 *                     anchors what the reader is comparing.
 *
 *
 * Deterministic, no clock, no LLM. Each rule lives in its own function so
 * adding rules is a single-file extension.
 */

import { checkBrandContrast } from "../render/brand.js";
import type { Channel, Encoding, GlyphSpec, Layer } from "../spec/types.js";

/** Severity tiers — `high` typically gates rendering when strictness=error. */
export type AuditSeverity = "low" | "medium" | "high";

/** A single audit finding. */
export interface AuditFinding {
  /** Stable id (e.g. "AUDIT-01") for filter / suppress workflows. */
  readonly rule_id: string;
  readonly severity: AuditSeverity;
  /** One-line description. */
  readonly message: string;
  /** Optional suggestion the agent / user can act on. */
  readonly suggestion?: string;
  /** RFC 6901 JSON pointer to the offending spec node (e.g. "/layers/0/encoding/y"). */
  readonly path?: string;
}

/** Input to `auditSpec`. Pass at least the spec; rows are optional. */
export interface AuditInput {
  readonly spec: GlyphSpec;
  /** Optional row count for the underlying data (used by AUDIT-04). */
  readonly rowCount?: number;
  /** Optional total distinct colors used (used by AUDIT-06). */
  readonly colorCardinality?: number;
}

/**
 * Audit a spec, returning all findings sorted by severity desc, then rule_id.
 * Pure function — same input → same output, no side effects.
 */
export function auditSpec(input: AuditInput): ReadonlyArray<AuditFinding> {
  const out: AuditFinding[] = [];
  const { spec } = input;
  for (let i = 0; i < spec.layers.length; i++) {
    const layer = spec.layers[i];
    if (!layer) continue;
    auditTruncatedYAxis(out, layer, i);
    auditLogScaleDisclosure(out, layer, i, spec.title);
    auditDivergingPalette(out, layer, i);
    auditLineOnCategoricalX(out, layer, i);
    auditBarOnQuantitativeX(out, layer, i);
  }
  auditDualAxis(out, spec);
  auditExcessiveAggregation(out, spec, input.rowCount);
  auditColorCount(out, input.colorCardinality);
  auditAspectRatio(out, spec);
  auditStackedNegatives(out, spec);
  auditBrandContrast(out, spec);
  auditTooManyArcSlices(out, spec, input.rowCount);
  auditOverlayLayerCount(out, spec);
  auditMissingTitle(out, spec);
  return out.sort((a, b) => {
    const sa = severityRank(a.severity);
    const sb = severityRank(b.severity);
    if (sa !== sb) return sb - sa;
    return a.rule_id.localeCompare(b.rule_id);
  });
}

function severityRank(s: AuditSeverity): number {
  return s === "high" ? 3 : s === "medium" ? 2 : 1;
}

// ---------------------------------------------------------------------------
// Rule: AUDIT-01 — truncated y axis on a bar chart
// ---------------------------------------------------------------------------

function auditTruncatedYAxis(out: AuditFinding[], layer: Layer, idx: number): void {
  if (layer.mark !== "bar") return;
  const yCh = layer.encoding?.y;
  const domain = channelDomain(yCh);
  if (!domain) return;
  if (domain.length < 2) return;
  const lo = Number(domain[0]);
  if (!Number.isFinite(lo)) return;
  if (lo > 0) {
    out.push({
      rule_id: "AUDIT-01",
      severity: "high",
      message: `Layer ${idx}: bar chart y-axis domain starts at ${lo}, not 0 — bar heights misrepresent magnitude.`,
      suggestion:
        "Set scale.domain to [0, max] or use a different mark (point/line) when a non-zero baseline is intentional.",
      path: `/layers/${idx}/encoding/y`,
    });
  }
}

// ---------------------------------------------------------------------------
// Rule: AUDIT-03 — log scale without disclosure
// ---------------------------------------------------------------------------

function auditLogScaleDisclosure(
  out: AuditFinding[],
  layer: Layer,
  idx: number,
  title: string | undefined,
): void {
  const yCh = layer.encoding?.y;
  const scaleType = channelScaleType(yCh);
  if (scaleType !== "log") return;
  const titleText = (title ?? "").toLowerCase();
  if (titleText.includes("log") || titleText.includes("logarithmic")) return;
  out.push({
    rule_id: "AUDIT-03",
    severity: "high",
    message: `Layer ${idx}: y axis uses a logarithmic scale but the chart title doesn't mention it.`,
    suggestion: "Add 'log' to the title or annotate the axis so readers don't read it as linear.",
    path: `/layers/${idx}/encoding/y`,
  });
}

// ---------------------------------------------------------------------------
// Rule: AUDIT-08 — diverging palette without explicit midpoint
// ---------------------------------------------------------------------------

function auditDivergingPalette(out: AuditFinding[], layer: Layer, idx: number): void {
  const colorCh = layer.encoding?.color;
  if (!colorCh || typeof colorCh === "string") return;
  const scale = (colorCh as { scale?: { scheme?: string; midpoint?: number } }).scale;
  if (!scale) return;
  const scheme = (scale.scheme ?? "").toLowerCase();
  if (!/diverging|rdbu|brbg|prgn|piyg|puor|rdgy|rdylbu|rdylgn/.test(scheme)) return;
  if (scale.midpoint !== undefined) return;
  out.push({
    rule_id: "AUDIT-08",
    severity: "medium",
    message: `Layer ${idx}: diverging color palette ("${scheme}") used without an explicit midpoint.`,
    suggestion: "Set color.scale.midpoint (typically 0) so readers know where the palette pivots.",
    path: `/layers/${idx}/encoding/color/scale`,
  });
}

// ---------------------------------------------------------------------------
// Rule: AUDIT-02 — dual-axis layers
// ---------------------------------------------------------------------------

function auditDualAxis(out: AuditFinding[], spec: GlyphSpec): void {
  if (spec.layers.length < 2) return;
  const sides = spec.layers.map((l) => {
    const y = l.encoding?.y;
    if (!y || typeof y === "string") return "left";
    return y.scale?.side === "right" ? "right" : "left";
  });
  const hasLeft = sides.includes("left");
  const hasRight = sides.includes("right");
  if (hasLeft && hasRight) {
    out.push({
      rule_id: "AUDIT-02",
      severity: "medium",
      message:
        "Dual-axis chart: layers use both left and right y axes. Readers often misjudge magnitudes when the two scales differ.",
      suggestion:
        "Prefer normalizing both series to a shared scale, or split into two stacked panels.",
    });
  }
}

// ---------------------------------------------------------------------------
// Rule: AUDIT-04 — excessive aggregation
// ---------------------------------------------------------------------------

function auditExcessiveAggregation(
  out: AuditFinding[],
  spec: GlyphSpec,
  rowCount: number | undefined,
): void {
  if (rowCount === undefined || rowCount === 0) return;
  for (let i = 0; i < spec.layers.length; i++) {
    const layer = spec.layers[i];
    if (!layer || layer.mark !== "bar") continue;
    // If x is grouped (which is the typical bar chart), each bar represents
    // the aggregate of N rows. A reasonable threshold: < 5 rows per bar.
    const xCh = layer.encoding?.x;
    if (!xCh) continue;
    // We don't know the distinct-x count at audit time without scene info,
    // but we can flag the easy case: rowCount < 5 total.
    if (rowCount < 5) {
      out.push({
        rule_id: "AUDIT-04",
        severity: "medium",
        message: `Layer ${i}: only ${rowCount} underlying rows — bar chart aggregates lose statistical power below 5 samples per category.`,
        suggestion:
          "Show the raw data as points or document the sample size in the chart subtitle.",
        path: `/layers/${i}`,
      });
      // Falls through to the next iteration — a multi-bar-layer spec
      // gets one finding per layer rather than stopping at the first
      // (M2 from PR review changed `return` to a fall-through).
    }
  }
}

// ---------------------------------------------------------------------------
// Rule: AUDIT-06 — too many colors
// ---------------------------------------------------------------------------

function auditColorCount(out: AuditFinding[], colorCardinality: number | undefined): void {
  if (colorCardinality === undefined) return;
  if (colorCardinality > 8) {
    out.push({
      rule_id: "AUDIT-06",
      severity: "low",
      message: `Color encoding uses ${colorCardinality} distinct categories — readers can't reliably distinguish more than ~8.`,
      suggestion:
        "Group rarer categories under an 'Other' bucket, or facet by color instead of encoding it.",
    });
  }
}

// ---------------------------------------------------------------------------
// Rule: AUDIT-07 — extreme aspect ratio
// ---------------------------------------------------------------------------

function auditAspectRatio(out: AuditFinding[], spec: GlyphSpec): void {
  const w = spec.width;
  const h = spec.height;
  if (w === undefined || h === undefined) return;
  const ratio = w / h;
  if (ratio < 0.5 || ratio > 3) {
    out.push({
      rule_id: "AUDIT-07",
      severity: "low",
      message: `Aspect ratio ${ratio.toFixed(2)} (${w}×${h}) is unusual; very tall or wide charts can exaggerate trends.`,
      suggestion:
        "Keep width:height between 0.5 and 3 unless the data shape genuinely demands otherwise.",
    });
  }
}

// ---------------------------------------------------------------------------
// Rule: AUDIT-09 — stacked layers crossing zero
// ---------------------------------------------------------------------------

function auditStackedNegatives(out: AuditFinding[], spec: GlyphSpec): void {
  // Heuristic: if any layer has y with a domain that crosses zero AND the
  // mark is bar, stacking would produce ambiguous readings. v0 flags only
  // when an explicit scale.domain is provided.
  for (let i = 0; i < spec.layers.length; i++) {
    const layer = spec.layers[i];
    if (!layer || layer.mark !== "bar") continue;
    const domain = channelDomain(layer.encoding?.y);
    if (!domain || domain.length < 2) continue;
    const lo = Number(domain[0]);
    const hi = Number(domain[domain.length - 1]);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
    if (lo < 0 && hi > 0 && spec.layers.length > 1) {
      out.push({
        rule_id: "AUDIT-09",
        severity: "medium",
        message: `Layer ${i}: bar chart y domain crosses zero (${lo} → ${hi}) with multiple layers — stacking yields ambiguous totals.`,
        suggestion:
          "Split into separate panels for positive and negative values, or use diverging color encoding.",
        path: `/layers/${i}/encoding/y/scale/domain`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Rule: AUDIT-11 — brand-kit accessibility (Moat PR4)
//
// Fires when the spec sets `brand:` AND the brand kit fails its
// declared `accessibility.minContrastRatio` or (when
// `colorBlindSafe` is set) the categorical palette collapses to
// indistinguishable hues under deuteranope simulation.
// ---------------------------------------------------------------------------

function auditBrandContrast(out: AuditFinding[], spec: GlyphSpec): void {
  if (spec.brand === undefined) return;
  const failure = checkBrandContrast(spec.brand);
  if (failure === null) return;
  // Moat 4 review NIT-6 + NIT-9: branch on failure kind so the path
  // points at the specific failing block (surface vs categorical) and
  // the message distinguishes a WCAG contrast ratio from a deuteranope
  // distance — they're semantically different signals and the agent
  // needs both to act on the finding.
  if (failure.kind === "contrast") {
    out.push({
      rule_id: "AUDIT-11",
      severity: "medium",
      message: `Brand surface contrast too low: ${failure.a} on ${failure.b} has WCAG ratio ${failure.ratio.toFixed(2)} (threshold ${failure.threshold}). Foreground and background are too close for WCAG-compliant text.`,
      suggestion:
        "Adjust palette.surface.fg or palette.surface.bg until contrastRatio(fg, bg) ≥ accessibility.minContrastRatio.",
      path: "/brand/palette/surface",
    });
    return;
  }
  // failure.kind === "color-blind"
  out.push({
    rule_id: "AUDIT-11",
    severity: "medium",
    message:
      `Categorical palette pair collapses under deuteranopia: ${failure.a} and ${failure.b} ` +
      `differ by only ${failure.distance.toFixed(2)} units in simulated RGB ` +
      `(threshold ${failure.threshold}). Viewers with red-green color blindness will see them as the same color.`,
    suggestion:
      "Replace one of the colliding hues with a distinct lightness or chroma. Sites like https://colorbrewer2.org/ list deuteranope-safe palettes.",
    path: "/brand/palette/categorical",
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Rule: AUDIT-05 — line / area mark on a categorical x
// ---------------------------------------------------------------------------
// A connecting line implies ordered progression. Nominal categories like
// "Engineering / Sales / Marketing" don't carry that order, so the slope
// between two adjacent categories is artifactual — viewers read a fake
// trend. Bar / point marks are the right alternative.

function auditLineOnCategoricalX(out: AuditFinding[], layer: Layer, idx: number): void {
  if (layer.mark !== "line" && layer.mark !== "area") return;
  const x = layer.encoding?.x;
  if (!x || typeof x === "string") return;
  // Look only at explicit nominal/ordinal-no-order signal.
  const t = (x as { type?: string }).type;
  if (t !== "nominal") return;
  out.push({
    rule_id: "AUDIT-05",
    severity: "medium",
    message: `Layer ${idx}: ${layer.mark} mark connects across a nominal x-encoding. The connecting line implies ordered progression that nominal categories don't have — readers see a fake trend.`,
    suggestion:
      'Switch to `mark: "bar"` (or `mark: "point"`), or change x.type to `"ordinal"` if there is a real ordering.',
    path: `/layers/${idx}/encoding/x`,
  });
}

// ---------------------------------------------------------------------------
// Rule: AUDIT-13 — bar chart on a quantitative x
// ---------------------------------------------------------------------------
// Bars on a continuous numeric axis usually wants `mark: "rect"` (binned
// heat) or histogram semantics. A `mark: "bar"` on quantitative x leaves
// gaps that imply each bar is a categorical bucket; readers misjudge
// magnitudes when bar widths don't sum to the axis range.

function auditBarOnQuantitativeX(out: AuditFinding[], layer: Layer, idx: number): void {
  if (layer.mark !== "bar") return;
  const x = layer.encoding?.x;
  if (!x || typeof x === "string") return;
  const t = (x as { type?: string }).type;
  if (t !== "quantitative") return;
  out.push({
    rule_id: "AUDIT-13",
    severity: "low",
    message: `Layer ${idx}: bar mark on a quantitative x-encoding. Bars suggest categorical bins, but a continuous x suggests a histogram or rect mark.`,
    suggestion:
      'Either switch to `mark: "rect"` for binned data, or change x.type to `"ordinal"` if each bar is a discrete category.',
    path: `/layers/${idx}/encoding/x`,
  });
}

// ---------------------------------------------------------------------------
// Rule: AUDIT-12 — too many pie / arc slices
// ---------------------------------------------------------------------------
// Cleveland-McGill rank angle judgment near the bottom; past ~5 slices
// readers can't distinguish 18% from 22%. Past 7 the whole chart is
// noise. Detection: when the spec has a `mark: "arc"` layer and the
// caller passes `rowCount` (or colorCardinality), flag the threshold.

function auditTooManyArcSlices(
  out: AuditFinding[],
  spec: GlyphSpec,
  rowCount: number | undefined,
): void {
  const hasArc = spec.layers.some((l) => l.mark === "arc");
  if (!hasArc) return;
  const n = rowCount ?? 0;
  if (n <= 7) return;
  out.push({
    rule_id: "AUDIT-12",
    severity: "medium",
    message: `Pie / donut chart with ${n} slices. Angle comparison drops sharply past ~5 slices; past 7 the chart is essentially unreadable.`,
    suggestion:
      "Group small slices into an 'Other' bucket, or switch to a horizontal bar chart sorted by value.",
  });
}

// ---------------------------------------------------------------------------
// Rule: AUDIT-14 — overlay layer count too high
// ---------------------------------------------------------------------------
// More than 4 overlay layers makes individual series indistinguishable.
// Faceting / small multiples reads better past that count. Doesn't fire
// for compose specs (a compose with 20 silhouette-path children isn't
// "overlay confusion", it's a hand-laid illustration).

function auditOverlayLayerCount(out: AuditFinding[], spec: GlyphSpec): void {
  if (spec.layers.length <= 4) return;
  if (spec.facet) return; // small-multiple layout handles the cognitive load
  out.push({
    rule_id: "AUDIT-14",
    severity: "low",
    message: `Chart has ${spec.layers.length} overlay layers. Viewer accuracy on individual series drops sharply past ~4 overlaid layers.`,
    suggestion:
      "Use `spec.facet` to split into small multiples, or normalize the data and use a single layer with a color encoding.",
  });
}

// ---------------------------------------------------------------------------
// Rule: AUDIT-15 — multi-layer chart with no title
// ---------------------------------------------------------------------------
// A bare multi-layer chart is unreadable without context. Even a 30-
// character title anchors what the reader is comparing. Single-layer
// charts with a clear y-encoding don't trigger; this is for layered or
// faceted charts where ambiguity is real.

function auditMissingTitle(out: AuditFinding[], spec: GlyphSpec): void {
  if (spec.title && spec.title.trim().length > 0) return;
  const layered = spec.layers.length > 1;
  const faceted = !!spec.facet;
  const hasColor = spec.layers.some((l) => {
    const c = l.encoding?.color;
    if (typeof c === "string") return true;
    return (c as { field?: string } | undefined)?.field !== undefined;
  });
  if (!layered && !faceted && !hasColor) return;
  out.push({
    rule_id: "AUDIT-15",
    severity: "low",
    message:
      "Multi-layer / faceted / color-encoded chart has no title. Readers need a title to anchor what the chart is comparing.",
    suggestion: "Add a `title` to the spec — even a short one prevents misreading.",
    path: "/title",
  });
}

function channelDomain(c: Channel | undefined): ReadonlyArray<unknown> | undefined {
  if (!c || typeof c === "string") return undefined;
  const scale = (c as { scale?: { domain?: ReadonlyArray<unknown> } }).scale;
  return scale?.domain;
}

function channelScaleType(c: Channel | undefined): string | undefined {
  if (!c || typeof c === "string") return undefined;
  const scale = (c as { scale?: { type?: string } }).scale;
  return scale?.type;
}

// Re-export the encoding/layer types to make this module self-contained.
export type { Channel, Encoding, Layer };

// ---------------------------------------------------------------------------
// Render-time audit: AUDIT-10 (silent missing-data dropout)
// ---------------------------------------------------------------------------
//
// `auditSpec` is `pure-fn(spec)` — it never sees rows, so it can't compute
// the per-chart missing-data rate. Rather than shoe-horn rows into the
// pure pass (and break every existing call site), Moat PR3 ships a
// **separate** render-time audit helper that the MCP layer (or any caller
// with rows in hand) invokes after `auditSpec`. The two result arrays
// concatenate cleanly; downstream code treats them identically.
//
// The rule:
//   - Fires when `spec.data.onMissing` is unset OR set to "skip" (the
//     two cases where the renderer drops rows silently).
//   - Fires when > 5% of input rows have a null / undefined / NaN value
//     in the encoded y field.
//   - Severity: medium. Suggests setting `data.onMissing: "callout"` to
//     surface the gap visually.
//
// The 5% threshold matches the bar in the moat doc: a single NaN in a
// thousand rows isn't worth a finding; ten in a hundred is.

import { countMissingY } from "../compiler/missing-policy.js";
import type { MissingPolicy } from "../spec/types.js";

/** Minimum row-missing fraction at which AUDIT-10 fires. */
const AUDIT_10_THRESHOLD = 0.05;

/**
 * Compute the render-time audit findings that need row access. Today
 * this only emits AUDIT-10; future rules of the same shape land here.
 *
 * @param spec    The validated spec.
 * @param rows    The materialized row stream (column order matches schema).
 * @param yField  Name of the y-encoded field (the compiler's resolved
 *                `yField`). The helper reads y values by column index
 *                so callers don't need to convert the rows.
 * @param schema  Column metadata so we can index into rows[i][yIdx].
 */
export function renderTimeAuditFindings(
  spec: GlyphSpec,
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
  yField: string,
  schema: ReadonlyArray<{ readonly name: string }>,
): ReadonlyArray<AuditFinding> {
  const out: AuditFinding[] = [];
  const dataBlock = spec.data as { onMissing?: MissingPolicy } | undefined;
  const policy: MissingPolicy = dataBlock?.onMissing ?? "skip";
  // Only the silent-dropout case is worth flagging — "callout" and
  // "interpolate" both produce explicit visual signals, so the agent
  // already knows.
  if (policy !== "skip") return out;
  if (rows.length === 0) return out;
  const yIdx = schema.findIndex((c) => c.name === yField);
  if (yIdx < 0) return out;
  const { total, missing } = countMissingY(rows.map((r) => ({ y: r[yIdx] })));
  if (total === 0) return out;
  const frac = missing / total;
  if (frac <= AUDIT_10_THRESHOLD) return out;
  // NIT-1 from review: the prior threshold guard already filters
  // `missing === 0` (frac would be 0). Dropped the redundant check.
  const pct = Math.round(frac * 1000) / 10; // one decimal place
  out.push({
    rule_id: "AUDIT-10",
    severity: "medium",
    message: `Chart silently dropped ${missing} of ${total} rows (${pct}%) due to missing y values. Set data.onMissing: "callout" to surface them.`,
    path: "/data/onMissing",
    suggestion: 'Add `"onMissing": "callout"` to data, OR document the gap in an annotation layer.',
  });
  return out;
}
