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

import { compileSpec, renderSvg, safeParseSpec } from "@glyph/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ServerState, materializeSpec } from "./state.js";

export const SERVER_NAME = "glyph-mcp";
export const SERVER_VERSION = "0.0.0";

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
        return {
          content: [
            {
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
            },
          ],
        };
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

  return { server, state };
}
