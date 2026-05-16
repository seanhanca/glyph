/**
 * Glyph MCP server.
 *
 * Three tools — the entire library surface:
 *   - glyph_describe(source)           → schema + suggested encodings
 *   - glyph_render(spec)               → SVG + QueryHandle
 *   - glyph_query(handle_id, where?)   → follow-up rows
 *
 * Total tool-definition payload is intentionally small (<600 tokens) so an
 * agent burns minimal context on the API surface itself.
 */

import { compileSpec, getCapabilities, renderSvg, safeParseSpec } from "@glyph/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Resvg } from "@resvg/resvg-js";
import { z } from "zod";
import { importPayload } from "./import.js";
import { ServerState, materializeSpec } from "./state.js";

export const SERVER_NAME = "glyph-mcp";
export const SERVER_VERSION = "0.0.0";

/** Tools this MCP build exposes; surfaced via `glyph_capabilities`. */
const MCP_TOOLS = [
  { name: "glyph_describe", since: "0.0.0" },
  { name: "glyph_render", since: "0.0.0" },
  { name: "glyph_query", since: "0.0.0" },
  { name: "glyph_drill", since: "0.0.0" },
  { name: "glyph_capabilities", since: "0.0.0" },
  { name: "glyph_import", since: "0.0.1" },
] as const;

/** Rasterize SVG → base64 PNG. Used by `glyph_render` so hosts that render
 *  images inline (Claude Code, Cursor, etc.) can show the chart directly.
 *  Hosts that don't fall back to the SVG text in the same response. */
function svgToPngBase64(svg: string): string | undefined {
  try {
    const resvg = new Resvg(svg, { background: "white" });
    return resvg.render().asPng().toString("base64");
  } catch {
    // Best-effort; if rasterization fails, return undefined so the response
    // still carries the SVG text.
    return undefined;
  }
}

/** Convert any BigInt values to numbers for JSON-safe serialization. */
function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return Number(value);
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = jsonSafe(v);
    return out;
  }
  return value;
}

export function createServer(state: ServerState = new ServerState()): {
  server: McpServer;
  state: ServerState;
} {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  // ----- glyph_capabilities -----------------------------------------------
  // Returns the library version, supported spec versions, marks, stats,
  // renderers, engines, and the MCP tool list. Agents call this once at
  // session start to detect feature availability.
  server.registerTool(
    "glyph_capabilities",
    {
      title: "Report Glyph build capabilities",
      description:
        "Return this Glyph build's capabilities: library version, supported spec versions, marks, stats, renderers, engines, and the MCP tool list. Call this once at session start to detect feature availability before invoking newer tools.",
      inputSchema: {},
    },
    async () => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(getCapabilities({ mcpTools: MCP_TOOLS }), null, 2),
        },
      ],
    }),
  );

  // ----- glyph_describe ----------------------------------------------------
  server.registerTool(
    "glyph_describe",
    {
      title: "Describe a data source",
      description:
        "Inspect a Parquet/CSV/JSON file. Returns row count, column types, and a suggested encoding type per column (quantitative, ordinal, nominal, temporal). Call this BEFORE writing a spec so the field names + types are right on the first try.",
      inputSchema: {
        source: z.string().min(1).describe("Path or URL to the data file (parquet/csv/json)."),
      },
    },
    async ({ source }) =>
      state.serial(async () => {
        const engine = await state.getEngine();
        const handle = `desc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        await engine.register({ source }, handle);
        const summary = await engine.describe(handle);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(jsonSafe(summary), null, 2),
            },
          ],
        };
      }),
  );

  // ----- glyph_render ------------------------------------------------------
  server.registerTool(
    "glyph_render",
    {
      title: "Render a Glyph chart",
      description:
        "Compile and render a Glyph spec. Returns the SVG plus a handle_id you can pass to glyph_query for follow-up SQL against the chart's underlying view. Phase 0 supports marks: bar, point.",
      inputSchema: {
        spec: z
          .unknown()
          .describe(
            "A Glyph spec (JSON object). See https://github.com/seanhanca/glyph/blob/main/mvp.md for the schema.",
          ),
      },
    },
    async ({ spec }) =>
      state.serial(async () => {
        const parsed = safeParseSpec(spec);
        if (!parsed.ok) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: parsed.error.message }],
          };
        }
        const engine = await state.getEngine();
        const m = await materializeSpec(engine, parsed.spec);
        state.storeHandle(m.handle);
        const scene = compileSpec({
          spec: parsed.spec,
          rows: m.result.rows,
          schema: m.handle.schema,
        });
        const svg = renderSvg(scene);
        // Rasterize once so hosts that render `image/*` content inline can
        // display the chart directly (Claude Code, Cursor, IDE previews).
        const pngB64 = svgToPngBase64(svg);
        const textBlock = {
          type: "text" as const,
          text: JSON.stringify(
            jsonSafe({
              svg,
              handle_id: m.handle.id,
              view_name: m.handle.viewName,
              schema: m.handle.schema,
              row_count: m.result.rowCount,
            }),
            null,
            2,
          ),
        };
        const content = pngB64
          ? [{ type: "image" as const, data: pngB64, mimeType: "image/png" }, textBlock]
          : [textBlock];
        return { content };
      }),
  );

  // ----- glyph_query -------------------------------------------------------
  server.registerTool(
    "glyph_query",
    {
      title: "Query a rendered chart",
      description:
        "Run follow-up SQL against the view that backs a previously rendered chart. Pass the handle_id from glyph_render's result. The `where` argument is appended verbatim (e.g. 'WHERE rides > 1000 ORDER BY rides DESC LIMIT 5').",
      inputSchema: {
        handle_id: z.string().describe("The handle_id returned by glyph_render."),
        where: z
          .string()
          .optional()
          .describe(
            "Optional SQL clause appended to SELECT * FROM <view>. Typically starts with WHERE.",
          ),
      },
    },
    async ({ handle_id, where }) =>
      state.serial(async () => {
        const handle = state.getHandle(handle_id);
        if (!handle) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `Unknown handle_id: ${handle_id}`,
              },
            ],
          };
        }
        const engine = await state.getEngine();
        const result = await engine.queryHandle(handle, where);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                jsonSafe({
                  columns: result.columns.map((c) => c.name),
                  rowCount: result.rowCount,
                  rows: result.rows,
                }),
                null,
                2,
              ),
            },
          ],
        };
      }),
  );

  // ----- glyph_drill -------------------------------------------------------
  // Closes the chart → click/brush → SQL loop on the agent side. The IDE or
  // user surfaces a selection from a rendered chart (mark click, brush
  // extent, or zoom range); the agent passes it here and gets back both a
  // SQL predicate and the matching rows. Mirrors @glyph/live's whereFor /
  // whereForExtent / whereForZoom.
  server.registerTool(
    "glyph_drill",
    {
      title: "Drill into a rendered chart via a selection",
      description:
        "Given a handle_id and a selection (single value, range, or discrete list), return a SQL WHERE predicate plus the matching rows from the chart's underlying view. Use after glyph_render when the user clicks a bar, brushes a range, or zooms an axis.",
      inputSchema: {
        handle_id: z.string().describe("The handle_id returned by glyph_render."),
        field: z
          .string()
          .describe("Source field to filter on (a column name from the chart's schema)."),
        equals: z
          .union([z.string(), z.number()])
          .optional()
          .describe("Single-value equality filter — analog of a mark click."),
        between: z
          .tuple([z.number(), z.number()])
          .optional()
          .describe("[min, max] inclusive — analog of a brush extent or axis zoom."),
        in: z
          .array(z.union([z.string(), z.number()]))
          .optional()
          .describe("Discrete value list — analog of a discrete brush selection."),
      },
    },
    async ({ handle_id, field, equals, between, in: inList }) =>
      state.serial(async () => {
        const handle = state.getHandle(handle_id);
        if (!handle) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: `Unknown handle_id: ${handle_id}` }],
          };
        }
        const selectorCount =
          (equals !== undefined ? 1 : 0) +
          (between !== undefined ? 1 : 0) +
          (inList !== undefined ? 1 : 0);
        if (selectorCount !== 1) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: "glyph_drill: provide exactly one of { equals, between, in }.",
              },
            ],
          };
        }
        const quotedField = `"${field.replace(/"/g, '""')}"`;
        let predicate: string;
        if (equals !== undefined) {
          predicate =
            typeof equals === "number"
              ? `${quotedField} = ${equals}`
              : `${quotedField} = '${equals.replace(/'/g, "''")}'`;
        } else if (between !== undefined) {
          predicate = `${quotedField} BETWEEN ${between[0]} AND ${between[1]}`;
        } else {
          // inList is defined (the selector-count check above guarantees it).
          const list = (inList ?? [])
            .map((v) => (typeof v === "number" ? String(v) : `'${v.replace(/'/g, "''")}'`))
            .join(", ");
          predicate = `${quotedField} IN (${list})`;
        }
        const where = `WHERE ${predicate}`;
        const engine = await state.getEngine();
        const result = await engine.queryHandle(handle, where);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                jsonSafe({
                  predicate,
                  where,
                  columns: result.columns.map((c) => c.name),
                  rowCount: result.rowCount,
                  rows: result.rows,
                }),
                null,
                2,
              ),
            },
          ],
        };
      }),
  );

  // ----- glyph_import (B9a) -----------------------------------------------
  // Cross-MCP data ingestion. Another MCP tool produced rows / CSV text /
  // a URL; this verb registers it as a DuckDB view so subsequent specs can
  // chart it via data.source: "<returned name>".
  //
  // See ROADMAP §B9 for the broader cross-MCP scenario. The 'data_handle'
  // convention (B9b) is documented in the Claude Code skill: agents detect
  // a tool result's `data_handle: { kind, ... }` block and forward it here.
  server.registerTool(
    "glyph_import",
    {
      title: "Import data from another source",
      description:
        "Register an inline dataset as a Glyph data source. Returns a name the agent passes as `data.source` in subsequent glyph_render calls. Use this when another MCP tool returned rows/CSV/URL and you want to chart it without re-uploading. Supported kinds: 'csv', 'json-rows', 'url'. 'arrow-ipc' is reserved for a follow-up.",
      inputSchema: {
        payload: z
          .union([
            z.object({ kind: z.literal("csv"), data: z.string() }).strict(),
            z
              .object({
                kind: z.literal("json-rows"),
                rows: z.array(z.record(z.unknown())),
                schema: z
                  .array(z.object({ name: z.string(), type: z.string().optional() }))
                  .optional(),
              })
              .strict(),
            z
              .object({
                kind: z.literal("url"),
                url: z.string().url(),
                format: z.enum(["csv", "parquet", "json"]).optional(),
              })
              .strict(),
            z.object({ kind: z.literal("arrow-ipc"), base64: z.string() }).strict(),
          ])
          .describe(
            "The data to import. Pick the kind that matches what the upstream MCP tool returned.",
          ),
        name: z
          .string()
          .optional()
          .describe(
            "Optional friendly name suffix; the actual registered name is prefixed and randomized.",
          ),
      },
    },
    async ({ payload, name }) =>
      state.serial(async () => {
        try {
          const engine = await state.getEngine();
          const result = await importPayload(engine, payload, name);
          const summary = await engine.describe(result.name);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  jsonSafe({
                    name: result.name,
                    resolvedSource: result.resolvedSource,
                    schema: summary.columns,
                    rowCount: summary.rowCount,
                  }),
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (err) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: (err as Error).message ?? String(err),
              },
            ],
          };
        }
      }),
  );

  return { server, state };
}
