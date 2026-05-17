/**
 * materializeSpec — bind a parsed GlyphSpec to a DuckDB view and return a
 * QueryHandle plus the rows that back the chart.
 *
 * This is the bridge between the spec module and the renderer. The renderer
 * never touches the engine directly — it consumes the rows + schema this
 * function produces.
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
    readonly parentUri?: string;
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
      parents: args.parentUri ? [{ uri: args.parentUri, relation: "transform" as const }] : [],
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
 */
export async function materializeSpec(
  engine: ComputeEngine,
  spec: GlyphSpec,
  options: { registerAs?: string; sessionId?: string } = {},
): Promise<MaterializedSpec> {
  const sourceName = options.registerAs ?? `${SOURCE_REGISTRY_PREFIX}main`;
  // Default session id is "local" — fine for single-process MCP usage.
  // The Phase 3 MCP server passes its real session id for cross-agent
  // handle resolution.
  const sessionId = options.sessionId ?? "local";

  if (spec.data) {
    await engine.register(spec.data, sourceName);
  }

  // Phase 0 limitation: use the first layer's data source / transform.
  // Multi-layer specs with heterogeneous data per layer materialize one view
  // each in a later PR.
  const firstLayer = spec.layers[0];
  if (!firstLayer) {
    throw new Error("Spec has no layers");
  }

  if (firstLayer.data) {
    await engine.register(firstLayer.data, sourceName);
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
    sampleRows: result.rowCount,
    filteredOut: 0,
  });
  return { handle, result };
}
