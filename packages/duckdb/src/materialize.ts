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
  DataSource,
  GlyphSpec,
  QueryHandle,
  QueryResult,
} from "@glyph/core";

const SOURCE_REGISTRY_PREFIX = "glyph_src_";

export interface MaterializedSpec {
  readonly handle: QueryHandle;
  readonly result: QueryResult;
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
  options: { registerAs?: string } = {},
): Promise<MaterializedSpec> {
  const sourceName = options.registerAs ?? `${SOURCE_REGISTRY_PREFIX}main`;

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

  const handle = await engine.materialize(viewSql, schema);
  const result = await engine.queryHandle(handle);
  return { handle, result };
}
