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

import { applyStat, isStatError } from "@glyph/core";
import type {
  ColumnInfo,
  ComputeEngine,
  DataHandle,
  DataSource,
  GlyphSpec,
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
}

/**
 * Compose GDF fields onto a Phase-0 QueryHandle. The base handle from the
 * engine has `id`, `viewName`, `schema`; this attaches `uri`, `version`,
 * `lineage`, `provenance`, and `binding` for Phase 3 consumers.
 */
function enrichHandle(
  base: QueryHandle,
  args: {
    readonly sessionId: string;
    readonly sql: string;
    readonly producerTool: string;
    readonly parentUris: ReadonlyArray<string>;
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
      parents: args.parentUris.map((uri) => ({ uri, relation: "transform" as const })),
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
  } = {},
): Promise<MaterializedSpec> {
  const sourceName = options.registerAs ?? `${SOURCE_REGISTRY_PREFIX}main`;
  // Default session id is "local" — fine for single-process MCP usage.
  // The Phase 3 MCP server passes its real session id for cross-agent
  // handle resolution.
  const sessionId = options.sessionId ?? "local";
  const resolveHandleByUri = options.resolveHandleByUri;

  // Track parent gdf:// URIs that fed this materialization so the produced
  // handle's lineage records the upstream sources. We dedupe in case the
  // top-level and a layer's data reference the same parent URI.
  const parentUris = new Set<string>();

  if (spec.data) {
    const r = await registerOrResolve(engine, spec.data, sourceName, resolveHandleByUri);
    if (r.parentUri) parentUris.add(r.parentUri);
  }

  // Phase 0 limitation: use the first layer's data source / transform.
  // Multi-layer specs with heterogeneous data per layer materialize one view
  // each in a later PR.
  const firstLayer = spec.layers[0];
  if (!firstLayer) {
    throw new Error("Spec has no layers");
  }

  if (firstLayer.data) {
    const r = await registerOrResolve(engine, firstLayer.data, sourceName, resolveHandleByUri);
    if (r.parentUri) parentUris.add(r.parentUri);
  }

  let viewSql = buildLayerSql(spec.data, firstLayer.data, sourceName);

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
    parentUris: [...parentUris],
    sampleRows: result.rowCount,
    filteredOut: 0,
  });
  return { handle, result };
}
