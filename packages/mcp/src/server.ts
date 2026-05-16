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
import { z } from "zod";
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
] as const;

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

  return { server, state };
}
