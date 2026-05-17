/**
 * Glyph spec — TypeScript types.
 *
 * These types describe the wire format an agent writes. They are derived from
 * the Zod schemas in `./schemas.ts` — keep both in sync by always editing the
 * schema and inferring the type via `z.infer`.
 *
 * Design principles (token-efficient agent surface):
 *   - Short, meaningful field names.
 *   - Most fields optional with sensible inferred defaults.
 *   - Single-field shorthands (e.g. encoding can be a bare field name string).
 *   - Layers stack — every plot is one or more layers.
 *   - No alternate config files; one JSON object describes everything.
 */

import type { z } from "zod";
import type {
  ActionSchema,
  ChannelSchema,
  DataSourceSchema,
  EncodingSchema,
  GlyphSpecSchema,
  InteractiveSchema,
  LayerSchema,
  MarkSchema,
  ProjectionSchema,
  ScaleSchema,
  StatSchema,
  ThemeConfigSchema,
} from "./schemas.js";

/** Map projection config — Phase 3 PR42. See ProjectionSchema. */
export type Projection = z.infer<typeof ProjectionSchema>;

/** A declarative action — Phase 3 §4. See ActionSchema for the shape. */
export type SpecAction = z.infer<typeof ActionSchema>;

/** Top-level Glyph spec. */
export type GlyphSpec = z.infer<typeof GlyphSpecSchema>;

/** A data source: a path/URL plus an optional SQL transform. */
export type DataSource = z.infer<typeof DataSourceSchema>;

/** One drawing layer: mark + encoding (+ optional stat/position). */
export type Layer = z.infer<typeof LayerSchema>;

/** The mark type — what shape gets drawn for each row. */
export type Mark = z.infer<typeof MarkSchema>;

/** The encoding maps fields to visual channels. */
export type Encoding = z.infer<typeof EncodingSchema>;

/** A single channel value: either a bare field name or a fully-specified channel. */
export type Channel = z.infer<typeof ChannelSchema>;

/** Per-channel scale override. */
export type Scale = z.infer<typeof ScaleSchema>;

/** Aggregation/binning statistic applied before drawing. */
export type Stat = z.infer<typeof StatSchema>;

/** Opt-in interactivity config (see InteractiveSchema for details). */
export type InteractiveConfig = z.infer<typeof InteractiveSchema>;

/** Full theme tokens. Spec.theme accepts this or the built-in 'light'/'dark'. */
export type ThemeConfig = z.infer<typeof ThemeConfigSchema>;

/**
 * Helper to build a ThemeConfig with brand colors. Pure identity at runtime;
 * exists so consumers get TS type inference and a discoverable API.
 *
 *   const myBrand = defineTheme({
 *     background: '#0d1b2a', fg: '#e0e1dd',
 *     axis: '#778da9', grid: '#1b263b',
 *     palette: ['#e0aaff', '#c77dff', '#9d4edd', '#7b2cbf'],
 *   });
 *   render(myBrand) // pass to glyph_render in spec.theme
 */
export function defineTheme(config: ThemeConfig): ThemeConfig {
  return config;
}

/**
 * GDF protocol relation kinds — how one handle derives from another.
 * See phase-3-agent-graph.md §8.2.
 */
export type LineageRelation = "transform" | "filter" | "join" | "agg" | "source";

/** Confidence tier for a handle's underlying data — Phase 3 §B4 trust signals. */
export type DataConfidence = "high" | "medium" | "low";

/** How the bytes are physically reached. The resolver picks the cheapest. */
export type DataBindingKind = "duckdb-view" | "arrow-ipc" | "arrow-flight" | "parquet-uri";

/** Lineage record on a DataHandle. */
export interface DataLineage {
  /** Direct parent handles + the relation that produced this child. */
  readonly parents: ReadonlyArray<{ readonly uri: string; readonly relation: LineageRelation }>;
  /** The SQL (or transform statement) that produced this handle. */
  readonly sql: string;
  /** Who produced this handle and when. */
  readonly producer: {
    readonly agent: string;
    readonly tool: string;
    readonly sessionId: string;
    readonly at: string; // ISO timestamp
  };
}

/** Trust signals attached to a DataHandle — Phase 3 §B4. */
export interface DataProvenance {
  /** ISO timestamp of the underlying read that backs this handle. */
  readonly freshness: string;
  /** How many rows were summarized into any aggregates (0 = unaggregated). */
  readonly sampleRows: number;
  /** Rows the transform dropped (e.g. via a filter / NULL exclusion). */
  readonly filteredOut: number;
  /** Coarse confidence tier — surfaced in glyph_explain. */
  readonly confidence: DataConfidence;
}

/** Where the bytes are reachable from. */
export interface DataBinding {
  readonly kind: DataBindingKind;
  readonly location: string;
}

/**
 * A **DataHandle** — Phase 3 GDF protocol primitive. Identifies a queryable
 * dataset by URI plus the metadata an agent (or another tool) needs to
 * reason about, trust, and follow-up-query it.
 *
 * **Non-breaking promotion of `QueryHandle`.** Existing code that only
 * reads `id` / `viewName` / `schema` continues to work — those three fields
 * are still required. The GDF additions (`uri`, `version`, `lineage`,
 * `provenance`, `binding`, `subscribable`) are present-when-known and
 * unobserved by older callers.
 *
 * The same value is also exported as `QueryHandle` (type alias) so existing
 * imports keep compiling.
 */
export interface DataHandle {
  // ---- Phase 0 / Phase 1 fields (required, stable) -----------------------
  /** Unique within a session. Used as the local handle key. */
  readonly id: string;
  /** Engine-side view name; the source of truth for `SELECT * FROM <view>`. */
  readonly viewName: string;
  /** Column schema; the `suggested` + `nullable` keys are added in Phase 3. */
  readonly schema: ReadonlyArray<{
    readonly name: string;
    readonly type: string;
    readonly nullable?: boolean;
    readonly suggested?: "quantitative" | "ordinal" | "nominal" | "temporal";
  }>;

  // ---- Phase 3 GDF fields (optional during transition) -------------------
  /** Globally addressable URI: gdf://<sessionId>/<id>. */
  readonly uri?: string;
  /** Monotonic version; bumps when the underlying data changes. */
  readonly version?: number;
  /** Lineage chain — where this handle came from. */
  readonly lineage?: DataLineage;
  /** Trust signals — freshness + sample size + confidence tier. */
  readonly provenance?: DataProvenance;
  /** Where the bytes are reachable. */
  readonly binding?: DataBinding;
  /** True if this handle supports push notifications via subscriptionUri. */
  readonly subscribable?: boolean;
  /** Optional URI for change subscriptions (Tier B+). */
  readonly subscriptionUri?: string;
}

/**
 * Back-compat alias. Pre-Phase-3 code that imports `QueryHandle` continues
 * to compile — the type now permits the additional GDF metadata fields.
 */
export type QueryHandle = DataHandle;
