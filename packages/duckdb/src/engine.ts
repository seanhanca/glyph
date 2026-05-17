/**
 * DuckDB-backed ComputeEngine for Node.
 *
 * Wraps @duckdb/node-api and conforms to @glyph/core's ComputeEngine
 * interface. One instance per engine; one connection per engine for Phase 0
 * (Phase 1 may pool when concurrency demands it).
 *
 * View names for QueryHandles are deterministic and namespaced under
 * `glyph_view_` so they don't collide with user tables.
 */

import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import type {
  ColumnInfo,
  ColumnSummary,
  ComputeEngine,
  DataSource,
  DataSummary,
  QueryHandle,
  QueryResult,
} from "@glyph/core";

const VIEW_PREFIX = "glyph_view_";

/** Map DuckDB logical type names to suggested encoding types. */
function suggestEncoding(duckType: string): "quantitative" | "ordinal" | "nominal" | "temporal" {
  const t = duckType.toUpperCase();
  if (/TIMESTAMP|DATE|TIME/.test(t)) return "temporal";
  if (/INT|DECIMAL|DOUBLE|FLOAT|REAL|NUMERIC|HUGEINT/.test(t)) {
    return "quantitative";
  }
  if (/BOOL|VARCHAR|CHAR|TEXT|STRING|UUID/.test(t)) return "nominal";
  return "nominal";
}

/** Infer file format from path extension when caller didn't specify. */
function inferFormat(source: string): "parquet" | "csv" | "json" | undefined {
  const ext = extname(source).toLowerCase();
  if (ext === ".parquet") return "parquet";
  if (ext === ".csv" || ext === ".tsv") return "csv";
  if (ext === ".json" || ext === ".ndjson") return "json";
  return undefined;
}

/** Build the DuckDB read function call for a source file. */
function readerFor(src: DataSource): string {
  const fmt = src.format ?? inferFormat(src.source);
  const path = src.source.replace(/'/g, "''");
  switch (fmt) {
    case "parquet":
      return `read_parquet('${path}')`;
    case "csv":
      return `read_csv_auto('${path}')`;
    case "json":
      return `read_json_auto('${path}')`;
    case "arrow":
      // Arrow files are read via the parquet/csv-like API in newer DuckDB
      // versions; for Phase 0 we treat unknown as a generic read.
      return `read_parquet('${path}')`;
    default:
      // Fall back to letting DuckDB autodetect.
      return `'${path}'`;
  }
}

/** Sanitize an identifier to be safe in an SQL context. */
function safeIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Unsafe identifier: ${JSON.stringify(name)}`);
  }
  return name;
}

export interface DuckDBEngineOptions {
  /** Database path; defaults to ":memory:" (transient, fastest). */
  path?: string;
}

class DuckDBEngine implements ComputeEngine {
  // biome-ignore lint/suspicious/noExplicitAny: third-party DuckDB types
  private readonly instance: any;
  // biome-ignore lint/suspicious/noExplicitAny: third-party DuckDB types
  private readonly conn: any;
  private closed = false;

  // biome-ignore lint/suspicious/noExplicitAny: third-party DuckDB types
  constructor(instance: any, conn: any) {
    this.instance = instance;
    this.conn = conn;
  }

  async register(source: DataSource, name: string): Promise<void> {
    this.assertOpen();
    const ident = safeIdent(name);
    const reader = readerFor(source);
    await this.conn.run(`CREATE OR REPLACE VIEW ${ident} AS SELECT * FROM ${reader}`);
  }

  async query(sql: string): Promise<QueryResult> {
    this.assertOpen();
    const result = await this.conn.run(sql);
    const names: string[] = result.columnNames();
    const types: ReadonlyArray<{ toString(): string }> = result.columnTypes();
    const rows = (await result.getRows()) as ReadonlyArray<ReadonlyArray<unknown>>;
    const columns: ColumnInfo[] = names.map((n, i) => ({
      name: n,
      type: String(types[i]),
      nullable: true,
    }));
    return { columns, rows, rowCount: rows.length };
  }

  async describe(name: string): Promise<DataSummary> {
    this.assertOpen();
    const ident = safeIdent(name);

    // Total rows
    const countResult = await this.conn.run(`SELECT COUNT(*)::BIGINT AS n FROM ${ident}`);
    const countRows = (await countResult.getRows()) as Array<Array<unknown>>;
    const rowCount = Number(countRows[0]?.[0] ?? 0);

    // Schema
    const descResult = await this.conn.run(`DESCRIBE SELECT * FROM ${ident}`);
    const descRows = (await descResult.getRowObjectsJson()) as Array<Record<string, unknown>>;

    // Per-column distinct counts (sampled to LIMIT 10000 for cheapness)
    const columns: ColumnSummary[] = [];
    for (const row of descRows) {
      const colName = String(row.column_name);
      const colType = String(row.column_type);
      const nullable = String(row.null) === "YES";

      // Approximate-distinct is much cheaper than COUNT(DISTINCT) on large tables.
      const dResult = await this.conn.run(
        `SELECT approx_count_distinct(${safeIdent(colName)})::BIGINT AS d FROM ${ident}`,
      );
      const dRows = (await dResult.getRows()) as Array<Array<unknown>>;
      const distinct = Number(dRows[0]?.[0] ?? 0);

      columns.push({
        name: colName,
        type: colType,
        nullable,
        distinct,
        suggestedType: suggestEncoding(colType),
      });
    }

    return { rowCount, columns };
  }

  async materialize(viewSql: string, schema: ReadonlyArray<ColumnInfo>): Promise<QueryHandle> {
    this.assertOpen();
    const id = randomUUID().replace(/-/g, "");
    const viewName = `${VIEW_PREFIX}${id}`;
    // Snapshot the rows into a temp table. CTAS (rather than CREATE VIEW)
    // makes the handle self-contained: a later redefinition of any source
    // view it depended on (e.g. `glyph_src_main` getting re-pointed at a
    // different gdf:// parent during a downstream render) can't reach back
    // and mutate the rows behind this handle. This matches Phase 3's
    // versioned-handle semantics — version 1 is a snapshot of the data
    // that produced it.
    await this.conn.run(`CREATE TEMP TABLE ${viewName} AS ${viewSql}`);
    return { id, viewName, schema };
  }

  async queryHandle(handle: QueryHandle, whereClause?: string): Promise<QueryResult> {
    this.assertOpen();
    const ident = safeIdent(handle.viewName);
    const sql = whereClause ? `SELECT * FROM ${ident} ${whereClause}` : `SELECT * FROM ${ident}`;
    return this.query(sql);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.conn.closeSync?.();
    this.instance.closeSync?.();
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error("DuckDBEngine is closed");
    }
  }
}

/**
 * Create a DuckDB-backed ComputeEngine. Default path is ":memory:" which is
 * what every Phase 0 use case wants (transient, fastest, no persistence).
 */
export async function createDuckDBEngine(
  options: DuckDBEngineOptions = {},
): Promise<ComputeEngine> {
  const path = options.path ?? ":memory:";
  const instance = await DuckDBInstance.create(path);
  const conn = await instance.connect();
  return new DuckDBEngine(instance, conn);
}
