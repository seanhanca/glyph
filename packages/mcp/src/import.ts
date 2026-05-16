/**
 * glyph_import — cross-MCP data ingestion (B9a).
 *
 * Accepts a payload from another MCP tool (or the user) and registers it as
 * a DuckDB view that subsequent specs can address by name. The four payload
 * kinds collapse the common cases agents need to chart data that came from
 * elsewhere in the conversation:
 *
 *   - "csv"       — a CSV string body (header row required)
 *   - "json-rows" — an array of row objects + optional schema hint
 *   - "url"       — an http(s)/file URI DuckDB can read directly
 *   - "arrow-ipc" — base64-encoded Arrow IPC (deferred — see follow-up)
 *
 * For csv/json-rows we materialize a temp file the engine can read via the
 * usual `register()` flow. For url we pass through. Arrow IPC is rejected
 * with a clear "deferred" message until a follow-up wires up direct ingestion.
 *
 * All imports get a deterministic `import_<random>` view name; agents can
 * reference that name as `data.source` in subsequent `glyph_render` calls.
 */

import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ComputeEngine } from "@glyph/core";

export type ImportPayload =
  | { kind: "csv"; data: string }
  | {
      kind: "json-rows";
      rows: ReadonlyArray<Readonly<Record<string, unknown>>>;
      schema?: ReadonlyArray<{ name: string; type?: string | undefined }> | undefined;
    }
  | {
      kind: "url";
      url: string;
      format?: "csv" | "parquet" | "json" | undefined;
    }
  | { kind: "arrow-ipc"; base64: string };

export interface ImportResult {
  /** A registered name the agent can use as a spec's `data.source`. */
  readonly name: string;
  /** Local file path or URL the engine resolved the payload to. */
  readonly resolvedSource: string;
}

/** RFC 4180-ish CSV cell escaper. */
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "bigint" ? String(v) : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowsToCsv(
  rows: ReadonlyArray<Readonly<Record<string, unknown>>>,
  schema?: ReadonlyArray<{ name: string }>,
): string {
  // Derive column order from the schema hint when given; otherwise from the
  // first row (insertion order). Empty rows arrays yield a header-only CSV.
  const columns = schema?.map((c) => c.name) ?? Object.keys(rows[0] ?? {});
  const header = columns.map(csvCell).join(",");
  const body = rows.map((r) => columns.map((c) => csvCell(r[c])).join(",")).join("\n");
  return body.length === 0 ? `${header}\n` : `${header}\n${body}\n`;
}

/** Coerce a name to a safe SQL identifier prefix. */
function safeName(input: string | undefined): string {
  const base = (input ?? "").replace(/[^A-Za-z0-9_]/g, "_");
  // Always suffix with a random fragment so imports don't collide across calls.
  const tail = randomUUID().replace(/-/g, "").slice(0, 8);
  return `import_${base ? `${base}_` : ""}${tail}`;
}

/**
 * Import a payload as a named DuckDB view. Returns the name to use in
 * subsequent `data.source` references.
 */
export async function importPayload(
  engine: ComputeEngine,
  payload: ImportPayload,
  hintName: string | undefined,
): Promise<ImportResult> {
  const name = safeName(hintName);

  if (payload.kind === "arrow-ipc") {
    throw new Error("arrow-ipc import is not yet implemented; convert to parquet or csv and retry");
  }

  let resolvedSource: string;
  let format: "csv" | "parquet" | "json";

  switch (payload.kind) {
    case "csv": {
      const dir = mkdtempSync(join(tmpdir(), "glyph-import-"));
      resolvedSource = join(dir, `${name}.csv`);
      writeFileSync(resolvedSource, payload.data, "utf8");
      format = "csv";
      break;
    }
    case "json-rows": {
      const dir = mkdtempSync(join(tmpdir(), "glyph-import-"));
      resolvedSource = join(dir, `${name}.csv`);
      writeFileSync(resolvedSource, rowsToCsv(payload.rows, payload.schema), "utf8");
      format = "csv";
      break;
    }
    case "url": {
      resolvedSource = payload.url;
      // Best-effort format inference; users can pass `format` to override.
      format =
        payload.format ??
        (/\.parquet(\?|$)/i.test(payload.url)
          ? "parquet"
          : /\.json(\?|$)/i.test(payload.url)
            ? "json"
            : "csv");
      break;
    }
  }

  await engine.register({ source: resolvedSource, format }, name);
  return { name, resolvedSource };
}
