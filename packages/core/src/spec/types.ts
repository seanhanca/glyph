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
  BrandAccessibilitySchema,
  BrandKitSchema,
  BrandPaletteSchema,
  BrandSpacingSchema,
  BrandSurfaceSchema,
  BrandTypographySchema,
  ChannelSchema,
  CoordinatesSchema,
  DataSourceSchema,
  EncodingSchema,
  GlyphSpecSchema,
  InteractiveSchema,
  LayerSchema,
  MarkSchema,
  ProjectionSchema,
  ProvenanceConfigSchema,
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

/**
 * Moat PR3 — `data.onMissing` policy for null / undefined / NaN y values.
 * See `DataSourceSchema.onMissing` in `./schemas.ts` for semantics. Mirrored
 * here as a named type so the compiler / renderer can import a stable
 * symbol rather than re-deriving the union from the schema each time.
 */
export type MissingPolicy = "skip" | "callout" | "interpolate";

/** One drawing layer: mark + encoding (+ optional stat/position). */
export type Layer = z.infer<typeof LayerSchema>;

/**
 * E2 — `traveler` layer config. A dot that traces a sibling's polyline
 * (or its own) via SMIL `<animateMotion>`. Mirrors the Zod shape in
 * `./schemas.ts`; surfaced here so the compiler can import a named
 * type rather than infer it ad-hoc at every use site.
 */
export interface TravelerConfig {
  readonly follow: "self" | { readonly layerId: string };
  readonly duration_ms?: number;
  readonly trail?: {
    readonly length: number;
    readonly fade: boolean;
  };
  readonly radius: number;
  readonly color?: string;
  readonly id?: string;
}

/** The mark type — what shape gets drawn for each row. */
export type Mark = z.infer<typeof MarkSchema>;

/**
 * Joy of Math PR E1 — annotation callout config. The shape inferred from
 * `LayerSchema.annotation` (a labeled callout anchored to a row index or
 * a fixed data-space coord). Surfaced as a named type so the compiler /
 * tests can import a stable symbol rather than re-deriving it from the
 * layer shape.
 */
export type Annotation = NonNullable<Layer["annotation"]>;

/**
 * Math Phase 2 Track A PR A3 — config for `mark: "streamline"`. The
 * layer-level schema attaches this block under `layer.streamline`.
 * `kind: "grid"` auto-seeds an evenly-spaced grid across the
 * integration domain; `kind: "array"` lets the caller pin specific
 * seeds. The `step` / `maxSteps` knobs cap RK4 work. `domain`
 * defaults to the resolved x/y scale domains.
 */
export interface StreamlineConfig {
  readonly dxdt: string;
  readonly dydt: string;
  readonly seeds:
    | { readonly kind: "grid"; readonly rows: number; readonly cols: number }
    | {
        readonly kind: "array";
        readonly points: ReadonlyArray<{ readonly x: number; readonly y: number }>;
      };
  readonly step: number;
  readonly maxSteps: number;
  readonly domain?: {
    readonly x: readonly [number, number];
    readonly y: readonly [number, number];
  };
}

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

/**
 * Moat 5/5 — declarative crossfilter config. Resolved sub-shape of
 * `InteractiveConfig.crossfilter`. Two charts that share `group`
 * participate in the same crossfilter group; the renderer emits
 * `data-crossfilter-group` + `data-crossfilter-key` on each mark.
 */
export type CrossfilterConfig = NonNullable<InteractiveConfig["crossfilter"]>;

/**
 * Track A4 — one entry in `interactive.sliders`. Resolved sub-shape of
 * `InteractiveConfig.sliders[number]`. The static SVG renderer ignores
 * this metadata; `@glyph/live`'s `bootSlidersFromSpec()` is the only
 * consumer.
 */
export type SliderConfig = NonNullable<InteractiveConfig["sliders"]>[number];

/** Moat PR1 — cryptographic provenance seal config (see ProvenanceConfigSchema). */
export type ProvenanceConfig = z.infer<typeof ProvenanceConfigSchema>;

/** PR66 — polar-coordinate config (see CoordinatesSchema). */
export type Coordinates = z.infer<typeof CoordinatesSchema>;

/**
 * PR67 (D3 Gap 2) — recursive hierarchy node. Inline JSON tree consumed
 * by treemap / sunburst / partition layouts.
 */
export interface HierarchyNode {
  readonly name: string;
  readonly value?: number;
  readonly children?: ReadonlyArray<HierarchyNode>;
}

/** PR75 (D3 Gap 4) — inline 2D scalar-field grid for contour viz. */
export interface GridData {
  readonly rows: number;
  readonly cols: number;
  /** Row-major: cell (r, c) = values[r * cols + c]. */
  readonly values: ReadonlyArray<number>;
}

/** PR68 (D3 Gap 5) — inline graph data for force-directed layouts. */
export interface GraphData {
  readonly nodes: ReadonlyArray<{
    readonly id: string;
    readonly x?: number;
    readonly y?: number;
    readonly r?: number;
    readonly group?: string;
  }>;
  readonly edges?: ReadonlyArray<{
    readonly source: string;
    readonly target: string;
    readonly distance?: number;
  }>;
}

/**
 * Tier-2 — sankey flow data. DAG of named nodes + weighted links.
 * Cycles reject at compile time. Used by `mark: "sankey"`.
 */
export interface FlowData {
  readonly nodes: ReadonlyArray<{
    readonly id: string;
    readonly name?: string;
    readonly group?: string;
  }>;
  readonly links: ReadonlyArray<{
    readonly source: string;
    readonly target: string;
    readonly value: number;
  }>;
}

/**
 * Math PR1 — `data.shape: "function"` scalar form. The materializer
 * samples `expr` at `x.samples` evenly-spaced points across
 * `[x.min, x.max]` and routes the resulting rows through the normal
 * compile pipeline.
 */
export interface ScalarFunctionData {
  readonly shape: "function";
  readonly x: {
    readonly min: number;
    readonly max: number;
    readonly samples: number;
  };
  readonly expr: string;
  /** Optional 3D z-coordinate; today's 2D renderer ignores it. */
  readonly zExpr?: string;
}

/**
 * Math PR2 — `data.shape: "function"` parametric form. Traces a curve
 * `(xExpr(t), yExpr(t))` for `t` stepping evenly across
 * `[parameter.min, parameter.max]`. The materialized rows carry the
 * parameter value under its declared name so `animation.frame_field`
 * can reference it (`animation.kind: "scrub" | "race"` then animates
 * the curve without compiler changes).
 */
export interface ParametricFunctionData {
  readonly shape: "function";
  readonly parameter: {
    /** Identifier for the free parameter; also the column name in the rows. */
    readonly name: string;
    readonly min: number;
    readonly max: number;
    readonly samples: number;
  };
  readonly xExpr: string;
  readonly yExpr: string;
  /** Optional z-coordinate expression; today's 2D renderer ignores it. */
  readonly zExpr?: string;
}

/**
 * `data.shape: "function"` — scalar (PR1) or parametric (PR2). Both
 * variants share the same `shape: "function"` literal; presence of
 * `parameter` vs `x` discriminates between them.
 */
export type FunctionData = ScalarFunctionData | ParametricFunctionData;

/**
 * Math Phase 2 Track A PR A1 — `data.shape: "trajectory"`. Describes
 * a 2D ODE system `dx/dt = f(x, y, t)`, `dy/dt = g(x, y, t)`
 * integrated by RK4 from `time.min` to `time.max` in `time.samples`
 * evenly-spaced grid points. The materialized rows are `{t, x, y}`
 * in time (insertion) order. `mark: "line"` traces the trajectory;
 * `animation.kind: "scrub"` with `frame_field: "t"` composes on top
 * with zero compiler changes.
 */
export interface TrajectoryData {
  readonly shape: "trajectory";
  /** Expression for dx/dt; identifiers `x`, `y`, `t` plus the standard math fns. */
  readonly dxdt: string;
  /** Expression for dy/dt; identifiers `x`, `y`, `t` plus the standard math fns. */
  readonly dydt: string;
  /** Initial state at `t = time.min`. */
  readonly initial: {
    readonly x: number;
    readonly y: number;
  };
  /** Time grid. `samples` is the output row count (>= 2). */
  readonly time: {
    readonly min: number;
    readonly max: number;
    readonly samples: number;
  };
}

/**
 * Full theme tokens. Spec.theme accepts this OR one of the built-in
 * preset names: `"light"` / `"dark"` / `"playground"` / `"3b1b"`. The
 * Joy of Math presets (`playground`, `3b1b`) resolve to BrandKits at
 * compile time; an inline ThemeConfig is the per-spec override path.
 */
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
 * Moat PR4 — compositional BrandKit. Bundles palette + typography +
 * spacing + a11y tokens so designers and agents declare a brand once
 * and every chart inherits it. Dark mode is one swap of
 * `palette.surface`.
 *
 * When a spec sets both `brand:` and `theme:`, brand wins for the
 * surface + categorical palette; `theme:` keys merge on top as
 * explicit overrides.
 */
export type BrandKit = z.infer<typeof BrandKitSchema>;
export type BrandPalette = z.infer<typeof BrandPaletteSchema>;
export type BrandSurface = z.infer<typeof BrandSurfaceSchema>;
export type BrandTypography = z.infer<typeof BrandTypographySchema>;
export type BrandSpacing = z.infer<typeof BrandSpacingSchema>;
export type BrandAccessibility = z.infer<typeof BrandAccessibilitySchema>;

/**
 * Helper to build a BrandKit. Pure identity at runtime; gives callers
 * TS inference and a discoverable API, mirroring `defineTheme`.
 *
 *   const acme = defineBrandKit({
 *     format: "glyph-brand/1",
 *     palette: {
 *       categorical: ["#1d4ed8", "#f59e0b", "#10b981"],
 *       surface: { fg: "#0f172a", bg: "#ffffff",
 *                  muted: "#64748b", border: "#e2e8f0" },
 *     },
 *     typography: { fontFamily: "Inter, sans-serif",
 *                   fontSize: 13, titleScale: 1.2 },
 *     spacing: { unit: 4, plotMargin: 4 },
 *     accessibility: { minContrastRatio: 4.5, colorBlindSafe: true },
 *   });
 *   const acmeDark = { ...acme,
 *     palette: { ...acme.palette,
 *       surface: { fg: "#f1f5f9", bg: "#0b1220",
 *                  muted: "#94a3b8", border: "#1e293b" } } };
 */
export function defineBrandKit(config: BrandKit): BrandKit {
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
