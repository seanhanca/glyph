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

export const MarkSchema = z.enum([
  "bar",
  "line",
  "point",
  "area",
  "rect",
  "rule",
  // PR42 — geo viz primitives. `geo-point` plots lat/lon points through a
  // projection; the compiler translates to plain points after projection.
  "geo-point",
  // PR44 — `geo-region` renders projected polygons from a GeoJSON feature
  // collection; each region's fill is taken from the encoding (typically
  // `color: { metric: ... }` or `color: "<value-field>"`).
  "geo-region",
  // PR49 — 2D categorical × categorical grid with color from a
  // quantitative field. Both axes use band scales; color interpolated
  // between two stops.
  "heatmap",
]);

/**
 * Projection for `geo-*` marks. v0 supports the two simplest projections —
 * equirectangular (rectangular lat/lon → screen mapping) and Mercator
 * (conformal, web-map style). Both are pure-math; no external GIS dep.
 * Other projections (albers, naturalEarth, ortho) land once a real GIS
 * library is bundled.
 */
export const ProjectionSchema = z
  .object({
    type: z.enum(["equirectangular", "mercator", "naturalEarth", "albersUsa"]),
    /** [lon, lat] center of the projection. Defaults to [0, 0]. */
    center: z.tuple([z.number(), z.number()]).optional(),
    /** Pixel scale per radian. Defaults to (chart width / (2π)) for equirectangular. */
    scale: z.number().positive().optional(),
  })
  .strict();

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
 *   - an object: { metric, type?, scale?, ... } — Phase 3 §1 (PR37); the
 *     materializer resolves `metric` against a session-scoped registry and
 *     emits a `_metric_<name>` column the encoding then resolves to.
 *
 * The shorthand form is what agents reach for first; the object form is the
 * escape hatch when defaults need to be overridden.
 *
 * Constraint: a channel must carry exactly one of `field` or `metric`.
 */
export const ChannelObjectSchema = z
  .object({
    field: z.string().min(1).optional(),
    /**
     * Reference to a named metric registered via `glyph_metrics_register`
     * (or a yaml registry, in a later PR). The materializer rewrites this
     * to a SQL aggregate at compile time.
     */
    metric: z.string().min(1).optional(),
    type: FieldTypeSchema.optional(),
    scale: ScaleSchema.optional(),
    aggregate: z.enum(["count", "sum", "mean", "median", "min", "max"]).optional(),
    /** Override the axis/legend title. */
    title: z.string().optional(),
  })
  .strict()
  .refine((c) => (c.field === undefined) !== (c.metric === undefined), {
    message: "Channel must have exactly one of `field` or `metric`.",
  });

export const ChannelSchema = z.union([z.string().min(1), ChannelObjectSchema]);

export const EncodingSchema = z
  .object({
    x: ChannelSchema.optional(),
    y: ChannelSchema.optional(),
    color: ChannelSchema.optional(),
    size: ChannelSchema.optional(),
    opacity: ChannelSchema.optional(),
    tooltip: z.union([ChannelSchema, z.array(ChannelSchema)]).optional(),
    /** Latitude column for `geo-*` marks (PR42). */
    lat: ChannelSchema.optional(),
    /** Longitude column for `geo-*` marks (PR42). */
    lon: ChannelSchema.optional(),
    /**
     * Row field that joins to a GeoJSON feature's `properties[idField]`.
     * Used by `geo-region` marks (PR44).
     */
    region: ChannelSchema.optional(),
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
 * Faceting splits a single chart into a grid of small multiples. Phase 1.0
 * supports `col` (side-by-side panels with a shared y scale + independent
 * x scales per panel). `row` and `wrap` land in a follow-up.
 */
export const FacetSchema = z
  .object({
    /** Source field to partition rows by; one panel per distinct value. */
    col: z.string().min(1),
  })
  .strict();

/**
 * A declarative action attached to a spec — Phase 3 §4 (PR40). The MCP
 * `glyph_act` verb resolves the action's argMap (substituting
 * `$selection.keys` / `$selection.count` / `$selection.summary` from the
 * selection passed to the verb) and writes an audit row to
 * `~/.glyph/memory.duckdb`. v0 is dry-run-only — the external tool dispatch
 * happens via the host MCP plane in a follow-up.
 */
export const ActionSchema = z
  .object({
    /** SQL-safe identifier — the key used by glyph_act. */
    name: z.string().min(1),
    /** Human-readable button label. */
    label: z.string().min(1),
    /** Name of an external MCP tool to invoke. Optional in v0 (audit-only). */
    tool: z.string().min(1).optional(),
    /**
     * Per-arg substitution map. Values can be plain JSON OR placeholder
     * strings beginning with `$selection.` (resolved at glyph_act time).
     */
    argMap: z.record(z.unknown()).optional(),
    /** Free-form description shown in audit / hover tooltips. */
    description: z.string().optional(),
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

/**
 * Theme — color tokens for backgrounds, axes, grids, and the categorical
 * palette. Brand colors are non-negotiable for SaaS deployments; two
 * built-in themes ("light" / "dark") were a Phase-0 stand-in.
 */
export const ThemeConfigSchema = z
  .object({
    /** SVG/HTML color string for the chart background. */
    background: z.string().min(1),
    /** Foreground (titles, axis labels, rules' default stroke). */
    fg: z.string().min(1),
    /** Axis line color. */
    axis: z.string().min(1),
    /** Grid line color. */
    grid: z.string().min(1),
    /**
     * Categorical palette. Used by buildBars/buildPoints/buildLines/buildAreas
     * when color encoding is set; the i-th palette entry maps to the i-th
     * first-seen color domain value.
     */
    palette: z.array(z.string().min(1)).min(1),
  })
  .strict();

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
    /**
     * Color theme. Two built-ins ("light" / "dark") or a full ThemeConfig
     * with brand colors. Defaults to "light".
     */
    theme: z.union([z.enum(["light", "dark"]), ThemeConfigSchema]).optional(),
    /**
     * BCP-47 locale used for number / date tick formatting. Defaults to
     * "en-US" so snapshot tests stay byte-identical across machines. Set
     * to e.g. "de-DE" to render 1234.5 as "1.234,5".
     */
    locale: z.string().min(2).optional(),
    /** Small-multiples layout. Phase 1.0 supports col-faceting only. */
    facet: FacetSchema.optional(),
    /** Opt into data-bound, hydratable SVG output. */
    interactive: InteractiveSchema.optional(),
    /** Declarative actions for `glyph_act` — Phase 3 §4. */
    actions: z.array(ActionSchema).optional(),
    /** Map projection — required when any layer uses a `geo-*` mark. */
    projection: ProjectionSchema.optional(),
    /**
     * GeoJSON FeatureCollection used by `geo-region` marks. Each feature's
     * `properties[idField]` (default: `id`) is matched against the layer's
     * `encoding.region` field on the data rows.
     *
     * Stored as `unknown` because GeoJSON is recursively typed; the
     * compiler validates shape lazily.
     */
    geojson: z
      .object({
        features: z.array(z.unknown()),
        idField: z.string().optional(),
      })
      .passthrough()
      .optional(),
    /**
     * When true, overlay a lat/lon graticule on geo charts. Optional grid
     * step in degrees (default 30°).
     */
    graticule: z
      .union([
        z.boolean(),
        z.object({ step: z.number().int().min(5).max(180).optional() }).strict(),
      ])
      .optional(),
    /**
     * Innovation #4 (PR46) — linked-view filter context. Charts that share
     * a `link_group` participate in the same selection bus: a click in one
     * chart broadcasts a SQL predicate to the others via
     * `glyph_linked_publish`. Subscribers consume via `glyph_linked_await`.
     */
    link_group: z.string().min(1).optional(),
    /**
     * Data-driven animation (PR43 + PR45). Four kinds:
     *   - "stage"          — chart-wide entrance fade (PR43)
     *   - "stage-stagger"  — per-mark entrance with row-index delay (PR45)
     *   - "race"           — bar-race / scatter-race driven by `frame_field`;
     *                        emits SMIL <animate> elements over N frames (PR45)
     *   - "scrub"          — temporal slider that re-aggregates per frame
     *                        (PR45 ships the spec contract; the UI lives in
     *                        @glyph/preview-server / @glyph/live in PR46+)
     */
    animation: z
      .union([
        z
          .object({
            kind: z.enum(["stage", "stage-stagger"]),
            duration_ms: z.number().int().min(0).max(60_000).optional(),
            /** Per-mark delay step (ms). Only honored by stage-stagger. Default 60. */
            stagger_ms: z.number().int().min(0).max(2000).optional(),
          })
          .strict(),
        z
          .object({
            kind: z.literal("race"),
            /** Column whose distinct values define the frames (e.g. "year"). */
            frame_field: z.string().min(1),
            duration_ms: z.number().int().min(100).max(120_000).optional(),
          })
          .strict(),
        z
          .object({
            kind: z.literal("scrub"),
            frame_field: z.string().min(1),
            duration_ms: z.number().int().min(100).max(120_000).optional(),
          })
          .strict(),
      ])
      .optional(),
  })
  .strict()
  .refine((spec) => spec.data !== undefined || spec.layers.every((l) => l.data !== undefined), {
    message: "Spec must have a top-level `data` field or every layer must override `data`.",
  });
