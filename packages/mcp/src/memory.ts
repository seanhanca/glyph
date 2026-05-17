/**
 * Persistent memory store — Phase 3 §6 (PR39).
 *
 * Saves named DataHandles to `~/.glyph/memory.duckdb` so they survive an
 * MCP server restart. Round-trip is: save copies the handle's rows into a
 * table inside the attached file; recall materializes a fresh in-memory
 * handle that SELECTs from that table. List + forget round out the CRUD.
 *
 * Backing schema (in the attached `gmem` db):
 *   gmem.__glyph_meta (
 *     name VARCHAR PRIMARY KEY,
 *     table_name VARCHAR NOT NULL,
 *     description VARCHAR,
 *     schema_json VARCHAR,
 *     sample_rows BIGINT,
 *     saved_at TIMESTAMP
 *   )
 *   gmem._table_<sanitized_name>(...)  -- one per saved handle
 *
 * The store is created lazily on the first call. The path is configurable
 * (defaults to `~/.glyph/memory.duckdb`). Tests pass a temp path.
 */

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import type { ComputeEngine, DataHandle } from "@glyph/core";
import { materializeViewAsHandle } from "@glyph/duckdb";

const ATTACH_ALIAS = "gmem";
const META_TABLE = `${ATTACH_ALIAS}.__glyph_meta`;
const TABLE_PREFIX = "_table_";

/** Default file path: `~/.glyph/memory.duckdb`. */
export function defaultMemoryPath(): string {
  return resolve(homedir(), ".glyph", "memory.duckdb");
}

/** Sanitize a saved-name into a SQL-safe identifier suffix. */
function safeName(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid memory name "${name}" — must match /^[A-Za-z_][A-Za-z0-9_]*$/`);
  }
  return name;
}

/** Quote a SQL string literal. */
function q(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

export interface SavedHandleMeta {
  readonly name: string;
  readonly description: string | null;
  readonly schema: ReadonlyArray<{ readonly name: string; readonly type: string }>;
  readonly sampleRows: number;
  readonly savedAt: string;
}

export class MemoryStore {
  private attached = false;
  constructor(
    private readonly path: string,
    private readonly attachAs: string = ATTACH_ALIAS,
  ) {}

  /** Idempotently ATTACH the memory db file + ensure the meta table exists. */
  async ensure(engine: ComputeEngine): Promise<void> {
    if (this.attached) return;
    // Make sure the directory exists so DuckDB doesn't refuse to create the
    // file when this is the first session for a user.
    mkdirSync(dirname(this.path), { recursive: true });
    await engine.query(`ATTACH ${q(this.path)} AS ${this.attachAs}`);
    await engine.query(`CREATE TABLE IF NOT EXISTS ${META_TABLE} (
      name VARCHAR PRIMARY KEY,
      table_name VARCHAR NOT NULL,
      description VARCHAR,
      schema_json VARCHAR,
      sample_rows BIGINT,
      saved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    this.attached = true;
  }

  /**
   * Save the rows backing `handle` under a stable `name`. If a save with
   * that name already exists, it is replaced. Returns the row count.
   */
  async save(
    engine: ComputeEngine,
    args: {
      readonly name: string;
      readonly handle: DataHandle;
      readonly description?: string | undefined;
    },
  ): Promise<{ readonly name: string; readonly sampleRows: number }> {
    await this.ensure(engine);
    const id = safeName(args.name);
    const tableName = `${TABLE_PREFIX}${id}`;
    const fqTable = `${this.attachAs}.${tableName}`;

    // Drop any previous content under the same name so save() is idempotent.
    await engine.query(`DELETE FROM ${META_TABLE} WHERE name = ${q(args.name)}`);
    await engine.query(`DROP TABLE IF EXISTS ${fqTable}`);

    // Copy the rows. CTAS so the file owns its own snapshot — the in-memory
    // engine can drop the source view freely afterwards.
    await engine.query(`CREATE TABLE ${fqTable} AS SELECT * FROM ${args.handle.viewName}`);

    // Capture the schema so list() can describe what's saved without re-probing.
    const schemaJson = JSON.stringify(
      args.handle.schema.map((c) => ({ name: c.name, type: c.type })),
    );
    const rowCount = await engine.query(`SELECT COUNT(*)::BIGINT AS n FROM ${fqTable}`);
    const sampleRows = Number((rowCount.rows[0] as ReadonlyArray<unknown>)[0] ?? 0);

    await engine.query(
      `INSERT INTO ${META_TABLE} (name, table_name, description, schema_json, sample_rows) VALUES (${q(args.name)}, ${q(tableName)}, ${args.description !== undefined ? q(args.description) : "NULL"}, ${q(schemaJson)}, ${sampleRows})`,
    );

    return { name: args.name, sampleRows };
  }

  /**
   * Materialize a fresh in-memory DataHandle from a previously-saved name.
   * The returned handle is chained as `relation: "source"` — lineage stops
   * here because the original ancestry lives outside the live session.
   */
  async recall(
    engine: ComputeEngine,
    args: { readonly name: string; readonly sessionId: string },
  ): Promise<DataHandle | undefined> {
    await this.ensure(engine);
    const row = await engine.query(
      `SELECT table_name FROM ${META_TABLE} WHERE name = ${q(args.name)}`,
    );
    if (row.rowCount === 0) return undefined;
    const tableName = String((row.rows[0] as ReadonlyArray<unknown>)[0]);
    const viewSql = `SELECT * FROM ${this.attachAs}.${tableName}`;
    return materializeViewAsHandle(engine, {
      viewSql,
      sessionId: args.sessionId,
      producerTool: "glyph_memory_recall",
      sqlPreview: `-- recalled from gmem.${tableName} (saved as "${args.name}")`,
      parents: [],
    });
  }

  /** List saved entries, optionally filtered by name prefix. */
  async list(engine: ComputeEngine, prefix?: string): Promise<ReadonlyArray<SavedHandleMeta>> {
    await this.ensure(engine);
    const whereClause = prefix !== undefined ? `WHERE name LIKE ${q(`${prefix}%`)}` : "";
    const r = await engine.query(
      `SELECT name, description, schema_json, sample_rows, saved_at FROM ${META_TABLE} ${whereClause} ORDER BY saved_at`,
    );
    return r.rows.map((row) => {
      const r = row as ReadonlyArray<unknown>;
      return {
        name: String(r[0]),
        description: r[1] === null || r[1] === undefined ? null : String(r[1]),
        schema: JSON.parse(String(r[2] ?? "[]")),
        sampleRows: Number(r[3] ?? 0),
        savedAt: r[4] instanceof Date ? r[4].toISOString() : String(r[4] ?? ""),
      };
    });
  }

  /** Drop a saved entry. Returns true if it existed. */
  async forget(engine: ComputeEngine, name: string): Promise<boolean> {
    await this.ensure(engine);
    const lookup = await engine.query(
      `SELECT table_name FROM ${META_TABLE} WHERE name = ${q(name)}`,
    );
    if (lookup.rowCount === 0) return false;
    const tableName = String((lookup.rows[0] as ReadonlyArray<unknown>)[0]);
    await engine.query(`DROP TABLE IF EXISTS ${this.attachAs}.${tableName}`);
    await engine.query(`DELETE FROM ${META_TABLE} WHERE name = ${q(name)}`);
    return true;
  }
}
