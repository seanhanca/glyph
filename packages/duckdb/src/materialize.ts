/**
 * materializeSpec — bind a parsed GlyphSpec to a DuckDB view and return a
 * QueryHandle plus the rows that back the chart.
 *
 * This is the bridge between the spec module and the renderer. The renderer
 * never touches the engine directly — it consumes the rows + schema this
 * function produces.
 *
 * **Phase 3 (PR34):** when `data.source` (or a layer's `data.source`) is a
 * `gdf://` URI, the materializer resolves it against the caller-supplied
 * `resolveHandleByUri` and aliases the resolved view as the source name —
 * no file is registered. This is how a downstream agent renders against a
 * handle published by an upstream agent.
 */

import {
  applyStat,
  buildMetricViewSql,
  collectGroupByFields,
  collectMetricNames,
  isGeoMark,
  isStatError,
  rewriteMetricChannels,
} from "@glyph/core";
import type {
  ColumnInfo,
  ComputeEngine,
  DataHandle,
  DataSource,
  GlyphSpec,
  Layer,
  LineageRelation,
  MetricDefinition,
  MetricResolver,
  Projection,
  QueryHandle,
  QueryResult,
} from "@glyph/core";

const SOURCE_REGISTRY_PREFIX = "glyph_src_";
const GDF_PREFIX = "gdf://";

/**
 * Lookup callback the materializer uses to resolve `gdf://` URIs in a spec's
 * `data.source` field. The MCP server wires this to its session-scoped
 * handle registry; CLI/library callers can pass undefined when no URI
 * resolution is desired (the resolver returning undefined surfaces as a
 * clear error rather than a silent file-system lookup).
 */
export type HandleResolver = (uri: string) => DataHandle | undefined;

export interface MaterializedSpec {
  /**
   * The materialized DataHandle (richer Phase 3 type). For back-compat,
   * `handle` still satisfies the QueryHandle shape — callers that read
   * only `id` / `viewName` / `schema` continue to work.
   */
  readonly handle: DataHandle;
  readonly result: QueryResult;
  /**
   * The spec the compiler should consume. Equal to the input spec when no
   * metric channels were present; otherwise a deep clone with each
   * `metric: <name>` rewritten to `field: _metric_<name>` so the
   * compiler can resolve plain field references.
   */
  readonly effectiveSpec: GlyphSpec;
}

/**
 * Compose GDF fields onto a Phase-0 QueryHandle. The base handle from the
 * engine has `id`, `viewName`, `schema`; this attaches `uri`, `version`,
 * `lineage`, `provenance`, and `binding` for Phase 3 consumers.
 *
 * The `parents` are stored verbatim — callers control the lineage relation
 * (transform / filter / agg / join). For specs that came from a file, the
 * caller passes an empty array.
 */
function enrichHandle(
  base: QueryHandle,
  args: {
    readonly sessionId: string;
    readonly sql: string;
    readonly producerTool: string;
    /** Parents as {uri, relation} so diagnostic verbs can record filter/agg/etc. */
    readonly parents: ReadonlyArray<{ uri: string; relation: LineageRelation }>;
    readonly sampleRows: number;
    readonly filteredOut: number;
  },
): DataHandle {
  const now = new Date().toISOString();
  return {
    ...base,
    uri: `gdf://${args.sessionId}/${base.id}`,
    version: 1,
    lineage: {
      parents: args.parents,
      sql: args.sql,
      producer: {
        agent: "glyph",
        tool: args.producerTool,
        sessionId: args.sessionId,
        at: now,
      },
    },
    provenance: {
      freshness: now,
      sampleRows: args.sampleRows,
      filteredOut: args.filteredOut,
      confidence: "high",
    },
    binding: { kind: "duckdb-view", location: base.viewName },
    subscribable: false,
  };
}

/**
 * Register a data source under `sourceName`, transparently resolving any
 * `gdf://` URI through the caller-supplied resolver. Returns the parent
 * handle URI when the source was a gdf:// URI — the materializer threads
 * that through to the produced handle's lineage.
 */
async function registerOrResolve(
  engine: ComputeEngine,
  source: DataSource,
  sourceName: string,
  resolveHandleByUri: HandleResolver | undefined,
): Promise<{ parentUri: string | undefined }> {
  if (source.source.startsWith(GDF_PREFIX)) {
    if (!resolveHandleByUri) {
      throw new Error(
        `Cannot resolve ${source.source}: no handle resolver was supplied to materializeSpec`,
      );
    }
    const parent = resolveHandleByUri(source.source);
    if (!parent) {
      throw new Error(`Unknown gdf:// URI: ${source.source}`);
    }
    const parentViewName = parent.binding?.location ?? parent.viewName;
    // Alias the parent's view as the conventional source name so any
    // user-supplied `data.transform` keeps working unchanged. CREATE OR
    // REPLACE so successive renders against the same session don't trip
    // over an existing alias.
    await engine.query(`CREATE OR REPLACE VIEW ${sourceName} AS SELECT * FROM ${parentViewName}`);
    return { parentUri: parent.uri ?? source.source };
  }
  await engine.register(source, sourceName);
  return { parentUri: undefined };
}

// ---------------------------------------------------------------------------
// Geo viz — PR42 (v0)
// ---------------------------------------------------------------------------

const DEFAULT_CHART_WIDTH = 640;
const DEFAULT_CHART_HEIGHT = 400;
const GEO_X = "_geo_x";
const GEO_Y = "_geo_y";

/** Extract a field name from a Channel value (bare string or object form). */
function fieldOfChannel(c: unknown): string | undefined {
  if (typeof c === "string") return c;
  if (c && typeof c === "object" && "field" in c) {
    const f = (c as { field?: unknown }).field;
    return typeof f === "string" ? f : undefined;
  }
  return undefined;
}

/**
 * Build the SQL that wraps a base query with two computed columns —
 * `_geo_x` and `_geo_y` — by applying the projection's pixel-space math
 * directly in DuckDB. After this, the compiler sees plain x/y in pixel
 * space; we lock the spec's scale.domain so the linear scale is identity.
 */
function buildGeoProjectionSql(args: {
  readonly baseSql: string;
  readonly latField: string;
  readonly lonField: string;
  readonly projection: Projection | undefined;
  readonly width: number;
  readonly height: number;
}): string {
  const proj = args.projection ?? { type: "equirectangular" as const };
  const [cLon, cLat] = proj.center ?? [0, 0];
  const lat = `"${args.latField.replace(/"/g, '""')}"`;
  const lon = `"${args.lonField.replace(/"/g, '""')}"`;
  if (proj.type === "equirectangular") {
    const scale = proj.scale ?? args.width / 360;
    const cx = args.width / 2 - cLon * scale;
    const cy = args.height / 2 + cLat * scale;
    return `SELECT *, (${cx} + ${lon} * ${scale}) AS ${GEO_X}, (${cy} - ${lat} * ${scale}) AS ${GEO_Y} FROM (${args.baseSql})`;
  }
  // Mercator.
  const scale = proj.scale ?? args.width / (2 * Math.PI);
  const DEG2RAD = Math.PI / 180;
  const cxBase = args.width / 2 - cLon * DEG2RAD * scale;
  const cyBase = args.height / 2 + Math.log(Math.tan(Math.PI / 4 + (cLat * DEG2RAD) / 2)) * scale;
  return `SELECT *, (${cxBase} + ${lon} * ${DEG2RAD} * ${scale}) AS ${GEO_X}, (${cyBase} - LN(TAN(PI()/4 + GREATEST(-85, LEAST(85, ${lat})) * ${DEG2RAD} / 2)) * ${scale}) AS ${GEO_Y} FROM (${args.baseSql})`;
}

/**
 * Rewrite a geo-point layer so the compiler sees a plain `point` mark
 * with x/y pointing at the pre-projected columns and explicit
 * scale.domain locking the linear scale to identity in pixel space.
 */
function rewriteGeoLayer(layer: Layer, width: number, height: number): Layer {
  if (layer.mark !== "geo-point") return layer;
  return {
    ...layer,
    mark: "point" as const,
    encoding: {
      ...layer.encoding,
      x: {
        field: GEO_X,
        type: "quantitative" as const,
        scale: { domain: [0, width] as [number, number] },
      },
      y: {
        field: GEO_Y,
        type: "quantitative" as const,
        // y is inverted: domain [height, 0] so smaller y = higher on screen.
        scale: { domain: [0, height] as [number, number] },
      },
    },
  };
}

/**
 * For a single layer, build the SQL that produces its rows. For Phase 0 we
 * support: top-level data source + optional transform; per-layer data
 * override; no facet/stat compilation yet (those land with the renderer PRs).
 */
function buildLayerSql(
  topData: DataSource | undefined,
  layerData: DataSource | undefined,
  sourceName: string,
): string {
  const source = layerData ?? topData;
  if (!source) {
    throw new Error("No data source for layer (top-level or per-layer)");
  }
  if (source.transform) {
    return source.transform;
  }
  // SELECT * against the registered source view.
  return `SELECT * FROM ${sourceName}`;
}

/**
 * Materialize the first layer of a spec. Multi-layer materialization is a
 * follow-up — for Phase 0 we materialize one view per spec and accept that
 * layered specs with per-layer data overrides will land in a later PR.
 *
 * Pass `resolveHandleByUri` to enable `data.source: "gdf://..."` resolution
 * against an external handle registry (the MCP server wires this to its
 * session-scoped store).
 */
export async function materializeSpec(
  engine: ComputeEngine,
  spec: GlyphSpec,
  options: {
    registerAs?: string;
    sessionId?: string;
    resolveHandleByUri?: HandleResolver;
    /**
     * Resolve a `{ metric: <name> }` channel to a registered MetricDefinition.
     * The materializer rewrites such channels to `_metric_<name>` field
     * references and pre-aggregates the metric's SQL into the view.
     */
    metricResolver?: MetricResolver;
  } = {},
): Promise<MaterializedSpec> {
  const sourceName = options.registerAs ?? `${SOURCE_REGISTRY_PREFIX}main`;
  // Default session id is "local" — fine for single-process MCP usage.
  // The Phase 3 MCP server passes its real session id for cross-agent
  // handle resolution.
  const sessionId = options.sessionId ?? "local";
  const resolveHandleByUri = options.resolveHandleByUri;
  const metricResolver = options.metricResolver;

  // Track parent gdf:// URIs that fed this materialization so the produced
  // handle's lineage records the upstream sources. We dedupe in case the
  // top-level and a layer's data reference the same parent URI.
  const parentUris = new Set<string>();

  if (spec.data) {
    const r = await registerOrResolve(engine, spec.data, sourceName, resolveHandleByUri);
    if (r.parentUri) parentUris.add(r.parentUri);
  }

  // Resolve metric channels up-front. A spec like
  //   encoding: { x: "month", y: { metric: "mrr" } }
  // gets two transformations applied here:
  //   1. The view SQL is wrapped so `_metric_mrr` is a column.
  //   2. The spec is deep-cloned with `metric:` rewritten to `field:`.
  // After both, the compiler sees plain field references — no special case.
  const metricNames = collectMetricNames(spec);
  let workingSpec: GlyphSpec = spec;
  let resolvedMetrics: ReadonlyArray<MetricDefinition> = [];
  if (metricNames.length > 0) {
    if (!metricResolver) {
      throw new Error(
        `Spec references metric(s) [${metricNames.join(", ")}] but no metricResolver was supplied to materializeSpec`,
      );
    }
    const resolved: MetricDefinition[] = [];
    for (const n of metricNames) {
      const m = metricResolver(n);
      if (!m) throw new Error(`Unknown metric: "${n}"`);
      resolved.push(m);
    }
    resolvedMetrics = resolved;
    workingSpec = rewriteMetricChannels(spec);
  }

  // Phase 0 limitation: use the first layer's data source / transform.
  // Multi-layer specs with heterogeneous data per layer materialize one view
  // each in a later PR.
  const firstLayer = workingSpec.layers[0];
  if (!firstLayer) {
    throw new Error("Spec has no layers");
  }

  if (firstLayer.data) {
    const r = await registerOrResolve(engine, firstLayer.data, sourceName, resolveHandleByUri);
    if (r.parentUri) parentUris.add(r.parentUri);
  }

  let viewSql = buildLayerSql(workingSpec.data, firstLayer.data, sourceName);

  // Wrap with the metric pre-aggregation if any metric was referenced.
  if (resolvedMetrics.length > 0) {
    const groupFields = collectGroupByFields(workingSpec).filter((f) => !f.startsWith("_metric_"));
    viewSql = buildMetricViewSql({
      baseSql: viewSql,
      groupFields,
      metrics: resolvedMetrics,
    });
  }

  // Geo viz — PR42. Detect a geo-point layer; project lat/lon → pixel space
  // at the engine level + rewrite the layer to a plain `point` with
  // identity-locked scales. The compiler then needs no awareness of geo.
  if (isGeoMark(firstLayer.mark)) {
    const latField = fieldOfChannel(firstLayer.encoding.lat);
    const lonField = fieldOfChannel(firstLayer.encoding.lon);
    if (!latField || !lonField) {
      throw new Error("geo-point requires encoding.lat and encoding.lon as field references");
    }
    const width = workingSpec.width ?? DEFAULT_CHART_WIDTH;
    const height = workingSpec.height ?? DEFAULT_CHART_HEIGHT;
    viewSql = buildGeoProjectionSql({
      baseSql: viewSql,
      latField,
      lonField,
      projection: workingSpec.projection,
      width,
      height,
    });
    workingSpec = {
      ...workingSpec,
      layers: workingSpec.layers.map((l) => rewriteGeoLayer(l, width, height)),
    };
  }

  // Apply the first layer's stat (count / sum / mean) by SQL rewrite before
  // we materialize. Multi-layer specs with mixed stats are deferred — same
  // limitation as per-layer data overrides.
  if (firstLayer.stat) {
    const stat = applyStat(firstLayer, viewSql);
    if (isStatError(stat)) {
      throw new Error(`Stat compilation failed: ${stat.message}`);
    }
    viewSql = stat.sql;
  }

  // Run once to capture the schema for the handle. Cheap (LIMIT 0).
  const probeResult = await engine.query(`SELECT * FROM (${viewSql}) LIMIT 0`);
  const schema: ReadonlyArray<ColumnInfo> = probeResult.columns;

  const baseHandle = await engine.materialize(viewSql, schema);
  const result = await engine.queryHandle(baseHandle);
  const handle = enrichHandle(baseHandle, {
    sessionId,
    sql: viewSql,
    producerTool: "materializeSpec",
    parents: [...parentUris].map((uri) => ({ uri, relation: "transform" as const })),
    sampleRows: result.rowCount,
    filteredOut: 0,
  });
  return { handle, result, effectiveSpec: workingSpec };
}

// ---------------------------------------------------------------------------
// materializeRowsAsHandle — derived handles from in-memory rows
// ---------------------------------------------------------------------------

/**
 * Quote a SQL identifier (double quotes; embedded quotes doubled).
 */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Convert a JS value to a SQL literal safe for inclusion in a VALUES clause.
 * Strings use single-quote escaping; Dates render as ISO TIMESTAMP literals;
 * BigInt becomes a bare integer; null/undefined → NULL.
 */
function toSqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (v instanceof Date) return `CAST('${v.toISOString()}' AS TIMESTAMP)`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

/**
 * Build a SQL view expression that reproduces an in-memory rows array as a
 * SELECT statement. Used by diagnostic verbs (anomaly / drift / decompose /
 * forecast) to materialize their result rows into a derived DataHandle that
 * downstream verbs can `glyph_query` against. Bounded to small result sets;
 * not a substitute for an engine-pushed transform.
 */
function buildValuesView(
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
  columnNames: ReadonlyArray<string>,
): string {
  const cols = columnNames.map(quoteIdent).join(", ");
  if (rows.length === 0) {
    // Empty result: produce a typed-null SELECT that yields zero rows so
    // the view's schema matches the requested columns.
    const nulls = columnNames.map((n) => `NULL AS ${quoteIdent(n)}`).join(", ");
    return `SELECT ${nulls} WHERE 1=0`;
  }
  const valuesClause = rows
    .map((r) => `(${columnNames.map((_, i) => toSqlLiteral(r[i])).join(", ")})`)
    .join(", ");
  return `SELECT * FROM (VALUES ${valuesClause}) AS t(${cols})`;
}

/**
 * Materialize an arbitrary view SQL string as a DataHandle, optionally
 * chained to a parent. The MCP persistent-memory recall path uses this:
 * it points `viewSql` at an ATTACHed table in `~/.glyph/memory.duckdb`,
 * and the returned handle is indistinguishable from one produced by
 * `materializeSpec`. The "source" relation signals that lineage stops here
 * (no in-session parent).
 */
export async function materializeViewAsHandle(
  engine: ComputeEngine,
  args: {
    readonly viewSql: string;
    readonly sessionId: string;
    readonly producerTool: string;
    /** Caller-supplied lineage parents. Empty array = a "fresh" handle. */
    readonly parents?: ReadonlyArray<{ uri: string; relation: LineageRelation }>;
    /** Override the lineage.sql preview. Defaults to viewSql. */
    readonly sqlPreview?: string | undefined;
  },
): Promise<DataHandle> {
  const probe = await engine.query(`SELECT * FROM (${args.viewSql}) LIMIT 0`);
  const schema: ReadonlyArray<ColumnInfo> = probe.columns;
  const baseHandle = await engine.materialize(args.viewSql, schema);
  const result = await engine.queryHandle(baseHandle);
  return enrichHandle(baseHandle, {
    sessionId: args.sessionId,
    sql: args.sqlPreview ?? args.viewSql,
    producerTool: args.producerTool,
    parents: args.parents ?? [],
    sampleRows: result.rowCount,
    filteredOut: 0,
  });
}

/**
 * Materialize an in-memory rows array as a derived DataHandle, chained to
 * `parent` via the given `relation`. The MCP diagnostic verbs use this so
 * their results become first-class queryable handles (with full lineage)
 * just like a `glyph_render` output.
 *
 * The returned handle is identical in shape to one produced by
 * `materializeSpec`: viewName is a fresh DuckDB temp table, the schema is
 * probed from the engine, and the GDF metadata (uri, version, lineage,
 * provenance, binding) is populated.
 */
export async function materializeRowsAsHandle(
  engine: ComputeEngine,
  args: {
    readonly rows: ReadonlyArray<ReadonlyArray<unknown>>;
    readonly columns: ReadonlyArray<string>;
    readonly sessionId: string;
    readonly parent: DataHandle;
    readonly relation: LineageRelation;
    readonly producerTool: string;
    /** Human-readable sql summary stored in lineage.sql. */
    readonly sqlPreview?: string | undefined;
  },
): Promise<DataHandle> {
  const viewSql = buildValuesView(args.rows, args.columns);
  // Probe DuckDB for the inferred column types — cheap (LIMIT 0).
  const probe = await engine.query(`SELECT * FROM (${viewSql}) LIMIT 0`);
  const schema: ReadonlyArray<ColumnInfo> = probe.columns;
  const baseHandle = await engine.materialize(viewSql, schema);
  const parentUri = args.parent.uri ?? `gdf://${args.sessionId}/${args.parent.id}`;
  return enrichHandle(baseHandle, {
    sessionId: args.sessionId,
    sql: args.sqlPreview ?? viewSql,
    producerTool: args.producerTool,
    parents: [{ uri: parentUri, relation: args.relation }],
    sampleRows: args.rows.length,
    filteredOut: 0,
  });
}
