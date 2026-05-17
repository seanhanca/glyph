/**
 * Glyph spec — Zod schemas.
 *
 * Source of truth for the wire format. The TypeScript types in `./types.ts`
 * are derived from these schemas via `z.infer`.
 *
 * The schemas are written defensively: every union has clear discriminators,
 * every optional field has a documented default, and unknown keys are
 * rejected (`strict()`) so agents get fast, specific errors instead of
 * silently-ignored typos.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Data source
// ---------------------------------------------------------------------------

export const DataFormatSchema = z.enum(["parquet", "csv", "json", "arrow"]);

export const DataSourceSchema = z
  .object({
    /** Path, URL, or named registered table. Required. */
    source: z.string().min(1),
    /** File format hint. Inferred from extension when omitted. */
    format: DataFormatSchema.optional(),
    /**
     * SQL transform applied before binding to the visualization. Optional.
     * The result of this query becomes the materialized view backing the chart.
     */
    transform: z.string().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Marks — what gets drawn per row
// ---------------------------------------------------------------------------

export const MarkSchema = z.enum(["bar", "line", "point", "area", "rect", "rule"]);

// ---------------------------------------------------------------------------
// Channels & encoding
// ---------------------------------------------------------------------------

export const FieldTypeSchema = z.enum(["quantitative", "ordinal", "nominal", "temporal"]);

export const ScaleTypeSchema = z.enum([
  "linear",
  "log",
  "sqrt",
  "time",
  "band",
  "point",
  "ordinal",
]);

export const ScaleSchema = z
  .object({
    type: ScaleTypeSchema.optional(),
    domain: z
      .union([z.tuple([z.number(), z.number()]), z.array(z.string()), z.array(z.number())])
      .optional(),
    range: z.union([z.tuple([z.number(), z.number()]), z.array(z.string())]).optional(),
    /**
     * "left" (default) or "right" — for layered plots that want a secondary
     * y-axis on a per-channel basis.
     */
    side: z.enum(["left", "right"]).optional(),
  })
  .strict();

/**
 * A channel value. Either:
 *   - a string shorthand: the field name; type/scale inferred from data
 *   - an object: { field, type?, scale?, aggregate? }
 *
 * The shorthand form is what agents reach for first; the object form is the
 * escape hatch when defaults need to be overridden.
 */
export const ChannelObjectSchema = z
  .object({
    field: z.string().min(1),
    type: FieldTypeSchema.optional(),
    scale: ScaleSchema.optional(),
    aggregate: z.enum(["count", "sum", "mean", "median", "min", "max"]).optional(),
    /** Override the axis/legend title. */
    title: z.string().optional(),
  })
  .strict();

export const ChannelSchema = z.union([z.string().min(1), ChannelObjectSchema]);

export const EncodingSchema = z
  .object({
    x: ChannelSchema.optional(),
    y: ChannelSchema.optional(),
    color: ChannelSchema.optional(),
    size: ChannelSchema.optional(),
    opacity: ChannelSchema.optional(),
    tooltip: z.union([ChannelSchema, z.array(ChannelSchema)]).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Stat — pre-draw aggregation
// ---------------------------------------------------------------------------

export const StatSchema = z
  .object({
    type: z.enum(["bin", "count", "sum", "mean", "median", "quantile"]),
    /**
     * For `bin`: number of bins or explicit step. For `quantile`: the q in [0,1].
     */
    params: z.record(z.union([z.number(), z.string()])).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

export const PositionSchema = z.enum(["stack", "dodge", "identity"]);

export const LayerSchema = z
  .object({
    /** Per-layer data override; defaults to the top-level data source. */
    data: DataSourceSchema.optional(),
    mark: MarkSchema,
    encoding: EncodingSchema,
    stat: StatSchema.optional(),
    position: PositionSchema.optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Top-level Glyph spec
// ---------------------------------------------------------------------------

/**
 * Opt-in interactivity. When present, the renderer emits `data-*` attributes
 * on each mark so:
 *   1. CSS `:hover` can highlight bars (zero-JS feedback).
 *   2. `@glyph/live` can hydrate the SVG with click/brush handlers.
 *   3. `glyph_drill` (MCP) can derive a SQL WHERE clause from a click.
 * When absent, the rendered SVG is byte-identical to the non-interactive path.
 */
export const InteractiveSchema = z
  .object({
    /**
     * Optional source field used as the stable mark key (emitted as
     * `data-key`). Defaults to the row index. Useful when re-rendering
     * across data refreshes so the same row keeps its identity.
     */
    key: z.string().optional(),
    /**
     * Hover highlight: when true (default), inject a small `<style>` block
     * giving each interactive mark a `:hover` outline. Pure CSS, no JS.
     */
    hover: z.boolean().optional(),
  })
  .strict();

/**
 * Spec versions known to the compiler. The compiler dispatches by version so
 * old specs keep working when new features ship. Bumping the major component
 * (\`glyph/0\` → \`glyph/1\`) is the breaking-change signal; minor bumps
 * (\`glyph/0.1\` → \`glyph/0.2\`) are additive.
 */
export const SUPPORTED_SPEC_VERSIONS = ["glyph/0.1"] as const;
export type SpecVersion = (typeof SUPPORTED_SPEC_VERSIONS)[number];
export const DEFAULT_SPEC_VERSION: SpecVersion = "glyph/0.1";

export const GlyphSpecSchema = z
  .object({
    /**
     * Spec format version. Optional in 0.1 (defaults to "glyph/0.1");
     * required from 0.2 onward. Lets agents and the compiler negotiate
     * features without breaking older specs.
     */
    version: z.enum(SUPPORTED_SPEC_VERSIONS).optional(),
    /**
     * Top-level data source. Layers inherit unless they specify their own
     * `data`. Optional only when every layer overrides.
     */
    data: DataSourceSchema.optional(),
    /** At least one drawing layer. */
    layers: z.array(LayerSchema).min(1),
    /** Override the chart title (otherwise inferred from data + encoding). */
    title: z.string().optional(),
    /** Pixel dimensions of the rendered chart. Defaults: 640 x 400. */
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    /** Color theme; defaults to "light". */
    theme: z.enum(["light", "dark"]).optional(),
    /** Opt into data-bound, hydratable SVG output. */
    interactive: InteractiveSchema.optional(),
  })
  .strict()
  .refine((spec) => spec.data !== undefined || spec.layers.every((l) => l.data !== undefined), {
    message: "Spec must have a top-level `data` field or every layer must override `data`.",
  });
