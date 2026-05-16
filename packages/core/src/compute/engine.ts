/**
 * ComputeEngine — interface for the data-side of Glyph.
 *
 * Concrete implementations live in sibling packages:
 *   - @glyph/duckdb   (Node-side DuckDB via @duckdb/node-api)
 *   - @glyph/duckdb-wasm  (browser, planned Phase 1)
 *
 * The interface is intentionally small: register a source, run SQL, get
 * schema, close. The materialize step (which binds a spec to a view and
 * returns a QueryHandle) is built on top of these primitives.
 */

import type { DataSource, QueryHandle } from "../spec/types.js";

/** Column metadata for a registered table / view. */
export interface ColumnInfo {
  readonly name: string;
  /** Engine-reported logical type. Stable enough for LLM consumption. */
  readonly type: string;
  readonly nullable: boolean;
}

/** Result of running an SQL query. */
export interface QueryResult {
  readonly columns: ReadonlyArray<ColumnInfo>;
  readonly rows: ReadonlyArray<ReadonlyArray<unknown>>;
  /** Number of rows in the result. */
  readonly rowCount: number;
}

/** Quick summary of a column, used by `glyph.describe`. */
export interface ColumnSummary {
  readonly name: string;
  readonly type: string;
  readonly nullable: boolean;
  /** Distinct-value count (sampled). */
  readonly distinct: number;
  /**
   * Suggested encoding type when this column is used as a channel. The MCP
   * `describe` tool surfaces this to the agent so the first guess is good.
   */
  readonly suggestedType: "quantitative" | "ordinal" | "nominal" | "temporal";
}

/** Summary of a data source — schema + per-column suggestions. */
export interface DataSummary {
  readonly rowCount: number;
  readonly columns: ReadonlyArray<ColumnSummary>;
}

/**
 * The contract every compute engine must satisfy. Lifecycle: construct
 * (engine-specific), `register` data sources, `query` / `materialize`,
 * `close` to release resources.
 */
export interface ComputeEngine {
  /**
   * Register a data source under the given name. Subsequent SQL can refer to
   * the source as a table. Idempotent for the same name+source pair.
   */
  register(source: DataSource, name: string): Promise<void>;

  /** Execute an arbitrary SQL query and return the materialized result. */
  query(sql: string): Promise<QueryResult>;

  /** Return column metadata for a registered table or view. */
  describe(name: string): Promise<DataSummary>;

  /**
   * Materialize a view that backs a chart and return a QueryHandle. The view
   * persists for the lifetime of the engine and can be queried by handle.
   */
  materialize(viewSql: string, schema: ReadonlyArray<ColumnInfo>): Promise<QueryHandle>;

  /** Run a follow-up query against an existing handle's view. */
  queryHandle(handle: QueryHandle, whereClause?: string): Promise<QueryResult>;

  /** Release all resources. */
  close(): Promise<void>;
}
