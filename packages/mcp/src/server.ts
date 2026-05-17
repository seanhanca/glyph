/**
 * Glyph MCP server.
 *
 * Thirteen tools — the library surface:
 *   Phase 0/1 (9):
 *     - glyph_capabilities()              → feature detection
 *     - glyph_describe(source)            → schema + suggested encodings
 *     - glyph_render(spec)                → SVG + PNG + DataHandle
 *     - glyph_query(handle_id, where?)    → follow-up rows
 *     - glyph_drill(handle_id, …)         → selection → SQL predicate + rows
 *     - glyph_import(payload)             → cross-MCP data bridge
 *     - glyph_preview(handle_id?)         → interactive 127.0.0.1 chart
 *     - glyph_await_interaction(handle)   → long-poll for clicks/brushes
 *     - glyph_close_preview()             → stop preview server
 *   Phase 3 Tier A (4, PR33):
 *     - glyph_publish(handle_id)          → publish as gdf:// URI
 *     - glyph_subscribe(uri)              → resolve URI to DataHandle
 *     - glyph_lineage(uri, depth?)        → lineage tree walk
 *     - glyph_handles()                   → list all session handles
 *
 * Total tool-definition payload is intentionally small (<1000 tokens) so an
 * agent burns minimal context on the API surface itself.
 */

import {
  compileSpec,
  getCapabilities,
  isTranslateError,
  renderSvg,
  safeParseSpec,
  vegaLiteToGlyph,
} from "@glyph/core";
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
  { name: "glyph_preview", since: "0.0.2" },
  { name: "glyph_await_interaction", since: "0.0.2" },
  { name: "glyph_close_preview", since: "0.0.2" },
  // ---- Phase 3 Tier A: the four GDF verbs (PR33) -----------------------
  { name: "glyph_publish", since: "0.0.3" },
  { name: "glyph_subscribe", since: "0.0.3" },
  { name: "glyph_lineage", since: "0.0.3" },
  { name: "glyph_handles", since: "0.0.3" },
] as const;

/** Best-effort browser launcher. Returns true on success. */
async function launchBrowser(url: string): Promise<boolean> {
  try {
    const { spawn } = await import("node:child_process");
    const cmd =
      process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
    const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

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
        "Compile and render a Glyph spec. Pass `spec` (Glyph) OR `vegaLite` (a Vega-Lite spec to translate first). Returns SVG + PNG + handle_id you can pass to glyph_query / glyph_drill. Marks: bar, point, line, area, rule.",
      inputSchema: {
        spec: z
          .unknown()
          .optional()
          .describe(
            "A Glyph spec (JSON object). See https://github.com/seanhanca/glyph/blob/main/mvp.md for the schema. Mutually exclusive with `vegaLite`.",
          ),
        vegaLite: z
          .unknown()
          .optional()
          .describe(
            "A Vega-Lite spec — the server translates it to Glyph and renders. Use this when you already know VL.",
          ),
      },
    },
    async ({ spec, vegaLite }) =>
      state.serial(async () => {
        // Either spec OR vegaLite, not both.
        if (spec === undefined && vegaLite === undefined) {
          return {
            isError: true,
            content: [
              { type: "text" as const, text: "glyph_render: provide `spec` or `vegaLite`." },
            ],
          };
        }
        if (spec !== undefined && vegaLite !== undefined) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: "glyph_render: pass `spec` or `vegaLite`, not both.",
              },
            ],
          };
        }
        let inputSpec: unknown = spec;
        if (vegaLite !== undefined) {
          const translated = vegaLiteToGlyph(vegaLite);
          if (isTranslateError(translated)) {
            return {
              isError: true,
              content: [
                {
                  type: "text" as const,
                  text: `Vega-Lite translation failed: ${translated.error} (path: ${translated.path.join(".") || "<root>"})`,
                },
              ],
            };
          }
          inputSpec = translated.spec;
        }
        const parsed = safeParseSpec(inputSpec);
        if (!parsed.ok) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: parsed.error.message }],
          };
        }
        const engine = await state.getEngine();
        const m = await materializeSpec(engine, parsed.spec, { sessionId: state.sessionId });
        state.storeHandle(m.handle);
        const scene = compileSpec({
          spec: parsed.spec,
          rows: m.result.rows,
          schema: m.handle.schema,
        });
        const svg = renderSvg(scene);
        // Cache the SVG so a later `glyph_preview` deep-link can serve it.
        state.storeSvg(m.handle.id, svg);
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

  // ----- glyph_preview (B9f) ----------------------------------------------
  // Lazily starts the embedded preview server and returns a deep-link URL
  // the user can open in a browser. The page hydrates the rendered SVG and
  // routes click/brush/hover events back to `glyph_await_interaction`.
  server.registerTool(
    "glyph_preview",
    {
      title: "Open an interactive preview of a rendered chart",
      description:
        "Lazily starts a 127.0.0.1-only HTTP server that hosts an interactive Glyph chart preview. Returns { url, token, port }. Pass `open: true` to also launch the user's default browser. The page hydrates the rendered SVG with click + hover + brush handlers and POSTs interactions back; use glyph_await_interaction to receive them.",
      inputSchema: {
        handle_id: z
          .string()
          .optional()
          .describe("Optional handle to deep-link to. Without it, the page asks for one."),
        open: z
          .boolean()
          .optional()
          .describe(
            "If true, try to launch the user's default browser at the returned URL. Best-effort; never throws.",
          ),
      },
    },
    async ({ handle_id, open }) =>
      state.serial(async () => {
        try {
          const preview = await state.getPreview();
          const url = preview.urlFor(handle_id);
          let opened = false;
          if (open) {
            opened = await launchBrowser(url.url);
          }
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    url: url.url,
                    port: url.port,
                    token: url.token,
                    opened,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (err) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: (err as Error).message ?? String(err) }],
          };
        }
      }),
  );

  // ----- glyph_await_interaction (B9g) ------------------------------------
  // Long-poll for the next user interaction on a chart preview. Returns
  // immediately if an interaction is queued; otherwise waits up to
  // `timeout_ms` (default 30 s, max 60 s).
  server.registerTool(
    "glyph_await_interaction",
    {
      title: "Wait for the user to interact with a preview",
      description:
        "Long-poll for the next user interaction (click / hover / brush / zoom) on the preview chart for the given handle. Returns the event or {} on timeout. Default timeout 30 000 ms, max 60 000 ms.",
      inputSchema: {
        handle_id: z.string().describe("The handle returned by glyph_render."),
        timeout_ms: z
          .number()
          .int()
          .min(0)
          .max(60_000)
          .optional()
          .describe("Max wait in milliseconds. Default 30 000."),
      },
    },
    async ({ handle_id, timeout_ms }) => {
      const preview = state.getPreviewIfRunning();
      if (!preview) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "Preview server is not running. Call glyph_preview first.",
            },
          ],
        };
      }
      const event = await preview.awaitInteraction(handle_id, timeout_ms ?? 30_000);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(event ?? {}, null, 2),
          },
        ],
      };
    },
  );

  // ----- glyph_close_preview (B9f cont'd) ---------------------------------
  server.registerTool(
    "glyph_close_preview",
    {
      title: "Stop the interactive preview server",
      description:
        "Idempotently stop the preview HTTP server. Any parked glyph_await_interaction calls resolve to {}. The server also stops automatically on MCP exit.",
      inputSchema: {},
    },
    async () => {
      const preview = state.getPreviewIfRunning();
      if (!preview) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ stopped: false }) }],
        };
      }
      await preview.stop();
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ stopped: true }) }],
      };
    },
  );

  // ----- glyph_publish (PR33 / Phase 3 Tier A) ----------------------------
  // Promote a session-local handle to a globally addressable gdf:// URI so
  // other agents / sessions can subscribe to it. In the in-process Tier A
  // build the handle already carries its URI (minted in materializeSpec) —
  // this verb returns it plus the current version so the caller can hand
  // the URI off as a cross-agent reference. Tier B/C will wire networked
  // Arrow Flight transport behind the same signature.
  server.registerTool(
    "glyph_publish",
    {
      title: "Publish a handle as a gdf:// URI",
      description:
        "Promote a session-local handle to a globally addressable gdf:// URI. Returns { uri, version }. Other agents (or other sessions) can pass the URI to glyph_subscribe to access the same DataHandle. In Phase 3 Tier A the transport is in-process; networked Arrow Flight lands in a later tier.",
      inputSchema: {
        handle_id: z.string().describe("The local handle id from glyph_render."),
        scope: z
          .enum(["session", "process"])
          .optional()
          .describe(
            "Visibility scope. 'session' (default) — visible to this MCP session. 'process' — visible to any session in this process (Tier A).",
          ),
      },
    },
    async ({ handle_id, scope: _scope }) => {
      const handle = state.getHandle(handle_id);
      if (!handle) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Unknown handle_id: ${handle_id}` }],
        };
      }
      if (!handle.uri) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Handle ${handle_id} has no gdf:// URI (pre-Phase-3 handle).`,
            },
          ],
        };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                uri: handle.uri,
                version: handle.version ?? 1,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // ----- glyph_subscribe (PR33 / Phase 3 Tier A) --------------------------
  // Resolve a gdf:// URI back to its DataHandle. In Tier A this is a local
  // lookup against the session's handle registry. The handle returned is
  // the same one glyph_render produced — schema, lineage, provenance,
  // binding, version — so the subscriber can immediately glyph_query /
  // glyph_drill / glyph_render against it.
  server.registerTool(
    "glyph_subscribe",
    {
      title: "Subscribe to a published gdf:// URI",
      description:
        "Look up a previously-published gdf:// URI and return the full DataHandle (id, viewName, schema, lineage, provenance, binding, version). The returned handle id is usable with glyph_query / glyph_drill / glyph_render's `data.source` (Phase 3).",
      inputSchema: {
        uri: z.string().describe("A gdf:// URI returned by glyph_publish."),
      },
    },
    async ({ uri }) => {
      const handle = state.getHandleByUri(uri);
      if (!handle) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Unknown gdf:// URI: ${uri}` }],
        };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(jsonSafe(handle), null, 2),
          },
        ],
      };
    },
  );

  // ----- glyph_lineage (PR33 / Phase 3 Tier A) ----------------------------
  // Walk the lineage chain of a handle. Returns a tree rooted at `uri` with
  // each node carrying { uri, sql, producer, at } and a children[] array.
  // Walks at most `depth` levels (default 8) and stops at handles whose
  // parents aren't resolvable in this session (typically source files).
  server.registerTool(
    "glyph_lineage",
    {
      title: "Walk a handle's lineage tree",
      description:
        "Return the lineage tree of a published handle as { uri, sql, producer, at, children: [...] }. The tree walks parent URIs up to `depth` levels (default 8). Leaves are either handles with no parents (sources) or parents not present in this session.",
      inputSchema: {
        uri: z.string().describe("A gdf:// URI returned by glyph_publish."),
        depth: z
          .number()
          .int()
          .min(1)
          .max(32)
          .optional()
          .describe("Maximum walk depth. Default 8."),
      },
    },
    async ({ uri, depth }) => {
      const maxDepth = depth ?? 8;
      interface LineageNode {
        uri: string;
        sql: string;
        producer: { agent: string; tool: string; sessionId: string; at: string };
        at: string;
        children: LineageNode[];
      }
      const visited = new Set<string>();
      function walk(currentUri: string, remaining: number): LineageNode | null {
        if (visited.has(currentUri)) return null; // cycle guard
        visited.add(currentUri);
        const h = state.getHandleByUri(currentUri);
        if (!h || !h.lineage) return null;
        const parents = h.lineage.parents ?? [];
        const children: LineageNode[] =
          remaining > 0
            ? parents
                .map((p) => walk(p.uri, remaining - 1))
                .filter((n): n is LineageNode => n !== null)
            : [];
        return {
          uri: currentUri,
          sql: h.lineage.sql,
          producer: h.lineage.producer,
          at: h.lineage.producer.at,
          children,
        };
      }
      const root = walk(uri, maxDepth);
      if (!root) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Unknown or lineage-less gdf:// URI: ${uri}`,
            },
          ],
        };
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify(root, null, 2) }],
      };
    },
  );

  // ----- glyph_handles (PR33 / Phase 3 Tier A) ----------------------------
  // List every DataHandle in the current session. Useful for an agent that
  // joined a session mid-flight, or for debugging via the inspector.
  server.registerTool(
    "glyph_handles",
    {
      title: "List all session DataHandles",
      description:
        "Return every DataHandle currently registered in this MCP session, in insertion order. Each entry includes the id, gdf:// uri (if present), version, schema column names, and the producing tool. Use this to discover what's queryable without re-rendering.",
      inputSchema: {},
    },
    async () => {
      const handles = state.allHandles().map((h) => ({
        id: h.id,
        uri: h.uri,
        version: h.version,
        viewName: h.viewName,
        columns: h.schema.map((c) => c.name),
        producer: h.lineage?.producer,
        confidence: h.provenance?.confidence,
      }));
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                sessionId: state.sessionId,
                count: handles.length,
                handles,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  return { server, state };
}
