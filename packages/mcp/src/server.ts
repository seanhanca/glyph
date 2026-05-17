/**
 * Glyph MCP server.
 *
 * Twenty-seven tools — the library surface:
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
 *   Phase 3 §2 (1, PR35):
 *     - glyph_explain(handle_id)          → deterministic chart explanation
 *   Phase 3 §3 (4, PR36):
 *     - glyph_anomaly(handle_id, …)       → rows > Nσ from segment mean
 *     - glyph_drift(handle_id, A, B)      → per-group contribution to delta
 *     - glyph_decompose(handle_id, …)     → per-factor variance explained
 *     - glyph_forecast(handle_id, h?)     → seasonal-naive baseline + bands
 *   Phase 3 §1 (2, PR37):
 *     - glyph_metrics_register(metrics[]) → register named aggregates
 *     - glyph_metrics(prefix?)            → list registered metrics
 *   Phase 3 §6 (4, PR39):
 *     - glyph_memory_save(name, handle)   → persist a handle by name
 *     - glyph_memory_recall(name)         → restore as a fresh handle
 *     - glyph_memory_list(prefix?)        → list persisted names
 *     - glyph_memory_forget(name)         → drop a persisted entry
 *   Phase 3 §4 (2, PR40):
 *     - glyph_act(handle, name, sel?)     → resolve + dry-run a spec action
 *     - glyph_audit_log(handle?, limit?)  → read the action audit log
 *   Phase 3 §7 (1, PR40):
 *     - glyph_trust(handle)               → freshness + confidence summary
 *
 * Each diagnostic verb returns { handle_id, rows, explanation } — the new
 * handle_id is a derived DataHandle with chained lineage so the result is
 * queryable via glyph_query / glyph_drill / glyph_render's gdf:// source.
 *
 * Total tool-definition payload is intentionally small (<1500 tokens) so an
 * agent burns minimal context on the API surface itself.
 */

import { randomUUID } from "node:crypto";
import {
  attributeDrift,
  compileSpec,
  decomposeVariance,
  detectAnomalies,
  explainHandle,
  getCapabilities,
  isTranslateError,
  renderSvg,
  safeParseSpec,
  seasonalNaiveForecast,
  validateMetric,
  vegaLiteToGlyph,
} from "@glyph/core";
import type { DataHandle, MetricDefinition } from "@glyph/core";

function randomActionId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 16);
}
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Resvg } from "@resvg/resvg-js";
import { z } from "zod";
import { importPayload } from "./import.js";
import { ServerState, materializeRowsAsHandle, materializeSpec } from "./state.js";

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
  // ---- Phase 3 §2: self-explaining charts (PR35) -----------------------
  { name: "glyph_explain", since: "0.0.4" },
  // ---- Phase 3 §3: diagnostic primitives (PR36) ------------------------
  { name: "glyph_anomaly", since: "0.0.5" },
  { name: "glyph_drift", since: "0.0.5" },
  { name: "glyph_decompose", since: "0.0.5" },
  { name: "glyph_forecast", since: "0.0.5" },
  // ---- Phase 3 §1: semantic / metric layer (PR37) ----------------------
  { name: "glyph_metrics_register", since: "0.0.6" },
  { name: "glyph_metrics", since: "0.0.6" },
  // ---- Phase 3 §6: persistent memory (PR39) ----------------------------
  { name: "glyph_memory_save", since: "0.0.7" },
  { name: "glyph_memory_recall", since: "0.0.7" },
  { name: "glyph_memory_list", since: "0.0.7" },
  { name: "glyph_memory_forget", since: "0.0.7" },
  // ---- Phase 3 §4: action surfaces (PR40) ------------------------------
  { name: "glyph_act", since: "0.0.8" },
  { name: "glyph_audit_log", since: "0.0.8" },
  // ---- Phase 3 §7: trust signals (PR40) --------------------------------
  { name: "glyph_trust", since: "0.0.8" },
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
        let m: Awaited<ReturnType<typeof materializeSpec>>;
        try {
          m = await materializeSpec(engine, parsed.spec, {
            sessionId: state.sessionId,
            resolveHandleByUri: (uri) => state.getHandleByUri(uri),
            metricResolver: (name) => state.getMetric(name),
          });
        } catch (err) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: (err as Error).message ?? String(err) }],
          };
        }
        state.storeHandle(m.handle);
        // Record the spec's declarative actions so glyph_act can resolve them.
        if (parsed.spec.actions && parsed.spec.actions.length > 0) {
          state.setActionsForHandle(m.handle.id, parsed.spec.actions);
        }
        const scene = compileSpec({
          // Use the materializer's effectiveSpec — for metric channels this
          // has `{ metric: <name> }` rewritten to `{ field: _metric_<name> }`
          // so the compiler resolves to the synthetic columns the engine
          // actually produced.
          spec: m.effectiveSpec,
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

  // ----- glyph_explain (PR35 / Phase 3 §2) --------------------------------
  // Self-explaining charts. Runs a deterministic four-stage pipeline
  // (top-line / compositional / anomaly / temporal) against the rows that
  // back a rendered chart and returns { headline, highlights, questions }.
  // The `questions` array is the next prompt a downstream diagnostician
  // agent picks up.
  server.registerTool(
    "glyph_explain",
    {
      title: "Generate a deterministic plain-English explanation of a chart",
      description:
        "Run the explain pipeline against a previously rendered chart. Returns { headline, highlights[], questions[] } as JSON. The output is deterministic — same chart + same Glyph version always yields the same explanation. Use this instead of asking an LLM to read the SVG.",
      inputSchema: {
        handle_id: z.string().describe("The handle_id returned by glyph_render."),
        hints: z
          .object({
            xField: z.string().optional(),
            yField: z.string().optional(),
            groupField: z.string().optional(),
          })
          .strict()
          .optional()
          .describe(
            "Optional manual role hints. Without hints the pipeline picks x = first temporal-or-categorical column, y = first quantitative column, group = next categorical column.",
          ),
      },
    },
    async ({ handle_id, hints }) =>
      state.serial(async () => {
        const handle = state.getHandle(handle_id);
        if (!handle) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: `Unknown handle_id: ${handle_id}` }],
          };
        }
        const engine = await state.getEngine();
        const result = await engine.queryHandle(handle);
        const explanation = explainHandle({
          schema: handle.schema,
          rows: result.rows,
          hints,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(jsonSafe(explanation), null, 2),
            },
          ],
        };
      }),
  );

  // ====== Phase 3 §3 diagnostic primitives (PR36) =========================
  //
  // Shared pattern for all four verbs:
  //   1. Look up the parent handle by id.
  //   2. Query its rows (the diagnostic operates in memory; bounded by the
  //      pre-aggregated view that glyph_render materialized).
  //   3. Call the pure core function from @glyph/core/diagnostics.
  //   4. Materialize the result rows as a derived DataHandle with chained
  //      lineage (relation = filter/agg/transform per the verb's nature).
  //   5. Return { handle_id, uri, rows, explanation, …verb-specific stats }.
  //
  // The pure-fn return shape lives in @glyph/core; this layer adds only
  // I/O and lineage chaining.

  /** Serialize a typed array of objects to the on-wire row-of-arrays form. */
  function rowsAsArrays<T extends Record<string, unknown>>(
    objs: ReadonlyArray<T>,
    columns: ReadonlyArray<string>,
  ): ReadonlyArray<ReadonlyArray<unknown>> {
    return objs.map((o) => columns.map((c) => o[c]));
  }

  // ----- glyph_anomaly ----------------------------------------------------
  server.registerTool(
    "glyph_anomaly",
    {
      title: "Find rows outside the segment's normal range",
      description:
        "Z-score anomaly detection. Returns rows where |z| > threshold (default 2σ) from their segment mean. Pass `groupField` to segment per-group (e.g. detect per-region outliers). The result is also published as a derived gdf:// handle so you can glyph_query / glyph_drill it.",
      inputSchema: {
        handle_id: z.string().describe("Handle from glyph_render."),
        valueField: z.string().describe("Numeric column to test."),
        groupField: z
          .string()
          .optional()
          .describe("Categorical column to bucket by; without it, the global mean is used."),
        labelField: z
          .string()
          .optional()
          .describe("Column whose value identifies a row in the explanation."),
        threshold: z
          .number()
          .positive()
          .optional()
          .describe("|z| threshold (default 2). 3 ≈ very strong outlier."),
        limit: z.number().int().min(1).optional().describe("Max rows returned. Default 20."),
      },
    },
    async ({ handle_id, valueField, groupField, labelField, threshold, limit }) =>
      state.serial(async () => {
        const parent = state.getHandle(handle_id);
        if (!parent) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: `Unknown handle_id: ${handle_id}` }],
          };
        }
        const engine = await state.getEngine();
        const r = await engine.queryHandle(parent);
        const result = detectAnomalies({
          schema: parent.schema,
          rows: r.rows,
          valueField,
          groupField,
          labelField,
          threshold,
          limit,
        });
        // Project each AnomalyRow to a row-tuple aligned to the derived schema
        // (original columns + _z).
        const columns = result.schema.map((c) => c.name);
        const rowsArr = result.rows.map((a) => [...a.row, a.z]);
        const derived = await materializeRowsAsHandle(engine, {
          rows: rowsArr,
          columns,
          sessionId: state.sessionId,
          parent,
          relation: "filter",
          producerTool: "glyph_anomaly",
          sqlPreview: `-- z-score filter, threshold=${result.threshold} on ${parent.viewName}`,
        });
        state.storeHandle(derived);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                jsonSafe({
                  handle_id: derived.id,
                  uri: derived.uri,
                  threshold: result.threshold,
                  rows: rowsArr,
                  columns,
                  segments: result.segments,
                  explanation: result.explanation,
                }),
                null,
                2,
              ),
            },
          ],
        };
      }),
  );

  // ----- glyph_drift ------------------------------------------------------
  server.registerTool(
    "glyph_drift",
    {
      title: "Attribute period-over-period change to groups",
      description:
        "Compute per-group contribution to the delta between two periods. Pass `periodField` (the column whose value distinguishes the periods) and `periodA` / `periodB` (the literal values or a list). Returns rows {group, valueA, valueB, delta, share} sorted by |delta| descending, plus a derived gdf:// handle.",
      inputSchema: {
        handle_id: z.string().describe("Handle from glyph_render."),
        valueField: z.string().describe("Numeric column summed per group."),
        groupField: z.string().describe("Categorical column to group by."),
        periodField: z.string().describe("Column whose value identifies the period."),
        periodA: z
          .union([z.string(), z.number(), z.array(z.union([z.string(), z.number()])).min(1)])
          .describe("Period-A value(s)."),
        periodB: z
          .union([z.string(), z.number(), z.array(z.union([z.string(), z.number()])).min(1)])
          .describe("Period-B value(s)."),
        limit: z.number().int().min(1).optional().describe("Max rows returned. Default 20."),
      },
    },
    async ({ handle_id, valueField, groupField, periodField, periodA, periodB, limit }) =>
      state.serial(async () => {
        const parent = state.getHandle(handle_id);
        if (!parent) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: `Unknown handle_id: ${handle_id}` }],
          };
        }
        const inSet = (
          spec: string | number | ReadonlyArray<string | number>,
        ): ((v: unknown) => boolean) => {
          const set = new Set(Array.isArray(spec) ? spec.map(String) : [String(spec)]);
          return (v: unknown) => set.has(String(v));
        };
        const engine = await state.getEngine();
        const r = await engine.queryHandle(parent);
        const result = attributeDrift({
          schema: parent.schema,
          rows: r.rows,
          valueField,
          groupField,
          periodField,
          periodA: inSet(periodA),
          periodB: inSet(periodB),
          limit,
        });
        const columns = result.schema.map((c) => c.name);
        const rowsArr = rowsAsArrays(
          result.rows.map((dr) => ({
            [groupField]: dr.group,
            valueA: dr.valueA,
            valueB: dr.valueB,
            delta: dr.delta,
            share: dr.share,
          })),
          columns,
        );
        const derived = await materializeRowsAsHandle(engine, {
          rows: rowsArr,
          columns,
          sessionId: state.sessionId,
          parent,
          relation: "agg",
          producerTool: "glyph_drift",
          sqlPreview: `-- per-group drift across ${periodField} on ${parent.viewName}`,
        });
        state.storeHandle(derived);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                jsonSafe({
                  handle_id: derived.id,
                  uri: derived.uri,
                  totalA: result.totalA,
                  totalB: result.totalB,
                  totalDelta: result.totalDelta,
                  rows: rowsArr,
                  columns,
                  explanation: result.explanation,
                }),
                null,
                2,
              ),
            },
          ],
        };
      }),
  );

  // ----- glyph_decompose --------------------------------------------------
  server.registerTool(
    "glyph_decompose",
    {
      title: "Rank factors by share of variance explained",
      description:
        "For each named factor, compute the fraction of the metric's total variance that's explained by between-group differences (one-way ANOVA's η²). Higher = that factor carries more of the spread. Returns rows {factor, varianceExplained, distinctGroups, topGroup, topGroupMean} ranked descending, plus a derived gdf:// handle.",
      inputSchema: {
        handle_id: z.string().describe("Handle from glyph_render."),
        metricField: z.string().describe("Numeric column whose variance we decompose."),
        factors: z
          .array(z.string().min(1))
          .min(1)
          .describe("Candidate categorical columns to test, ranked in the result by signal."),
      },
    },
    async ({ handle_id, metricField, factors }) =>
      state.serial(async () => {
        const parent = state.getHandle(handle_id);
        if (!parent) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: `Unknown handle_id: ${handle_id}` }],
          };
        }
        const engine = await state.getEngine();
        const r = await engine.queryHandle(parent);
        const result = decomposeVariance({
          schema: parent.schema,
          rows: r.rows,
          metricField,
          factors,
        });
        const columns = result.schema.map((c) => c.name);
        const rowsArr = rowsAsArrays(
          result.rows.map((dr) => ({
            factor: dr.factor,
            varianceExplained: dr.varianceExplained,
            distinctGroups: dr.distinctGroups,
            topGroup: dr.topGroup,
            topGroupMean: dr.topGroupMean,
          })),
          columns,
        );
        const derived = await materializeRowsAsHandle(engine, {
          rows: rowsArr,
          columns,
          sessionId: state.sessionId,
          parent,
          relation: "agg",
          producerTool: "glyph_decompose",
          sqlPreview: `-- variance attribution for ${metricField} across factors=${factors.join(",")}`,
        });
        state.storeHandle(derived);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                jsonSafe({
                  handle_id: derived.id,
                  uri: derived.uri,
                  grandMean: result.grandMean,
                  totalSSE: result.totalSSE,
                  rows: rowsArr,
                  columns,
                  explanation: result.explanation,
                }),
                null,
                2,
              ),
            },
          ],
        };
      }),
  );

  // ----- glyph_forecast ---------------------------------------------------
  server.registerTool(
    "glyph_forecast",
    {
      title: "Seasonal-naive forecast with confidence bands",
      description:
        "Project the last `horizon` periods forward using a seasonal-naive baseline (y_hat[t] = y[t-season]; when season=1 it's one-step-back). The ±2σ band is derived from historical residuals. Flags rendered actuals that fall outside the band. Returns rows {x, actual, forecast, lo, hi, isHorizon} plus a derived gdf:// handle.",
      inputSchema: {
        handle_id: z.string().describe("Handle from glyph_render."),
        xField: z.string().describe("Column to sort by (typically temporal)."),
        yField: z.string().describe("Numeric column to forecast."),
        season: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Season length in periods. Default = min(7, floor(n/2)). 1 = one-step-back."),
        horizon: z.number().int().min(1).optional().describe("Periods to forecast. Default 7."),
      },
    },
    async ({ handle_id, xField, yField, season, horizon }) =>
      state.serial(async () => {
        const parent = state.getHandle(handle_id);
        if (!parent) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: `Unknown handle_id: ${handle_id}` }],
          };
        }
        const engine = await state.getEngine();
        const r = await engine.queryHandle(parent);
        const result = seasonalNaiveForecast({
          schema: parent.schema,
          rows: r.rows,
          xField,
          yField,
          season,
          horizon,
        });
        const columns = result.schema.map((c) => c.name);
        const rowsArr = rowsAsArrays(
          result.rows.map((fr) => ({
            [xField]: fr.x instanceof Date ? fr.x.toISOString() : fr.x,
            actual: fr.actual,
            forecast: fr.forecast,
            lo: fr.lo,
            hi: fr.hi,
            isHorizon: fr.isHorizon,
          })),
          columns,
        );
        const derived = await materializeRowsAsHandle(engine, {
          rows: rowsArr,
          columns,
          sessionId: state.sessionId,
          parent,
          relation: "transform",
          producerTool: "glyph_forecast",
          sqlPreview: `-- seasonal-naive forecast season=${result.season} horizon=${horizon ?? 7} on ${parent.viewName}`,
        });
        state.storeHandle(derived);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                jsonSafe({
                  handle_id: derived.id,
                  uri: derived.uri,
                  season: result.season,
                  residualStd: result.residualStd,
                  rows: rowsArr,
                  columns,
                  explanation: result.explanation,
                }),
                null,
                2,
              ),
            },
          ],
        };
      }),
  );

  // ====== Phase 3 §1 metric layer (PR37) ==================================
  //
  // The "MRR" / "churn rate" / "active customer" registry. Once a metric is
  // registered, any `glyph_render` spec can write `{ metric: "mrr" }` in an
  // encoding channel and the materializer wraps the data SQL with the
  // metric's aggregate. Same definitions across every chart + every agent
  // turn = no metric drift.

  // ----- glyph_metrics_register -------------------------------------------
  server.registerTool(
    "glyph_metrics_register",
    {
      title: "Register named metrics (semantic layer)",
      description:
        'Register one or more named metrics — aggregate SQL expressions reusable across every chart in this session. Subsequent `glyph_render` specs can write `{ metric: "mrr" }` in any encoding channel; the materializer wraps the data SQL with the registered aggregate (GROUP BY the other channel fields). Existing metrics with the same name are replaced.',
      inputSchema: {
        metrics: z
          .array(
            z
              .object({
                name: z
                  .string()
                  .min(1)
                  .describe("SQL-safe identifier; the key used in spec encodings."),
                description: z.string().optional(),
                sql: z
                  .string()
                  .min(1)
                  .describe(
                    "Single aggregate expression — no SELECT / FROM / GROUP BY. E.g. \"SUM(amount) FILTER (WHERE type = 'subscription')\".",
                  ),
                grain: z
                  .string()
                  .optional()
                  .describe("Coarse grain hint — 'daily', 'monthly', etc."),
                dimensions: z.array(z.string()).optional(),
                requires: z.array(z.string()).optional(),
              })
              .strict(),
          )
          .min(1)
          .describe("Metric definitions to register."),
      },
    },
    async ({ metrics }) => {
      const registered: string[] = [];
      const replaced: string[] = [];
      for (const raw of metrics) {
        const err = validateMetric(raw);
        if (err) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `Invalid metric "${raw.name ?? "<unknown>"}": ${err}`,
              },
            ],
          };
        }
        const m = raw as MetricDefinition;
        const isNew = state.registerMetric(m);
        (isNew ? registered : replaced).push(m.name);
      }
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { registered, replaced, total: state.allMetrics().length },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // ----- glyph_metrics ----------------------------------------------------
  server.registerTool(
    "glyph_metrics",
    {
      title: "List registered metrics",
      description:
        'Return the session\'s metric registry. Pass `prefix` to filter by name prefix. Use this to discover what metrics exist before writing `{ metric: "…" }` in a spec.',
      inputSchema: {
        prefix: z
          .string()
          .optional()
          .describe("If set, only metrics whose name starts with this prefix are returned."),
      },
    },
    async ({ prefix }) => {
      const metrics = state.allMetrics(prefix);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ count: metrics.length, metrics }, null, 2),
          },
        ],
      };
    },
  );

  // ====== Phase 3 §6 persistent memory (PR39) =============================
  //
  // Saves named DataHandles to ~/.glyph/memory.duckdb so they survive an
  // MCP restart. The store ATTACHes the file into the in-memory engine; CRUD
  // is plain SQL. See packages/mcp/src/memory.ts for the layout.

  server.registerTool(
    "glyph_memory_save",
    {
      title: "Persist a handle to ~/.glyph/memory.duckdb",
      description:
        "Save the rows backing `handle_id` under a stable `name` so they survive an MCP restart. Re-saving the same name replaces the prior content. The file lives at ~/.glyph/memory.duckdb by default (override via ServerState options).",
      inputSchema: {
        name: z
          .string()
          .min(1)
          .describe("SQL-safe identifier — the key you'll glyph_memory_recall later."),
        handle_id: z.string().describe("The handle to persist."),
        description: z
          .string()
          .optional()
          .describe("Human-readable note shown in glyph_memory_list."),
      },
    },
    async ({ name, handle_id, description }) =>
      state.serial(async () => {
        const handle = state.getHandle(handle_id);
        if (!handle) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: `Unknown handle_id: ${handle_id}` }],
          };
        }
        try {
          const engine = await state.getEngine();
          const r = await state.memory.save(engine, { name, handle, description });
          return {
            content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }],
          };
        } catch (err) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: (err as Error).message ?? String(err) }],
          };
        }
      }),
  );

  server.registerTool(
    "glyph_memory_recall",
    {
      title: "Restore a saved handle by name",
      description:
        "Materialize a fresh in-memory DataHandle from a previously-saved name. The returned handle is queryable + has a new gdf:// URI, but its lineage chain stops at this verb (relation: 'source').",
      inputSchema: {
        name: z.string().min(1).describe("The name passed to glyph_memory_save."),
      },
    },
    async ({ name }) =>
      state.serial(async () => {
        try {
          const engine = await state.getEngine();
          const handle = await state.memory.recall(engine, {
            name,
            sessionId: state.sessionId,
          });
          if (!handle) {
            return {
              isError: true,
              content: [{ type: "text" as const, text: `Unknown memory name: ${name}` }],
            };
          }
          state.storeHandle(handle);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(jsonSafe(handle), null, 2),
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

  server.registerTool(
    "glyph_memory_list",
    {
      title: "List persisted handles",
      description:
        "Return every saved entry in ~/.glyph/memory.duckdb (optionally filtered by name prefix). Each entry includes name, description, schema, sampleRows, savedAt.",
      inputSchema: {
        prefix: z.string().optional().describe("Filter to names starting with this prefix."),
      },
    },
    async ({ prefix }) =>
      state.serial(async () => {
        const engine = await state.getEngine();
        const list = await state.memory.list(engine, prefix);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ count: list.length, entries: list }, null, 2),
            },
          ],
        };
      }),
  );

  server.registerTool(
    "glyph_memory_forget",
    {
      title: "Drop a persisted handle by name",
      description:
        "Remove a previously-saved name from ~/.glyph/memory.duckdb. Returns { forgotten: true } if it existed, { forgotten: false } otherwise.",
      inputSchema: {
        name: z.string().min(1).describe("The name to drop."),
      },
    },
    async ({ name }) =>
      state.serial(async () => {
        const engine = await state.getEngine();
        const ok = await state.memory.forget(engine, name);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ forgotten: ok }, null, 2) }],
        };
      }),
  );

  // ====== Phase 3 §4 action surfaces (PR40) ===============================
  //
  // Declarative actions are attached to a spec via `actions: [{name, label,
  // tool?, argMap?}]`. glyph_act looks the action up by name, substitutes
  // selection placeholders, and writes an audit row to
  // `gmem.__glyph_audit`. v0 is dry-run-only — external tool dispatch is
  // a later PR; agents currently consume the resolved plan and invoke
  // tools themselves via the host MCP plane.

  /** Resolve $selection.* placeholders in a value tree. */
  function resolveSelectionPlaceholders(
    value: unknown,
    selection: {
      readonly keys: ReadonlyArray<unknown>;
      readonly count: number;
      readonly summary: string;
    },
  ): unknown {
    if (value === null || value === undefined) return value;
    if (typeof value === "string") {
      if (value === "$selection.keys") return selection.keys;
      if (value === "$selection.count") return selection.count;
      if (value === "$selection.summary") return selection.summary;
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((v) => resolveSelectionPlaceholders(v, selection));
    }
    if (typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        out[k] = resolveSelectionPlaceholders(v, selection);
      }
      return out;
    }
    return value;
  }

  server.registerTool(
    "glyph_act",
    {
      title: "Dry-run a declarative spec action",
      description:
        "Resolve an action declared in the spec that produced `handle_id`. Substitutes `$selection.keys / .count / .summary` in the action's argMap from the supplied selection. v0 is dry-run-only — the resolved plan is written to ~/.glyph/memory.duckdb's audit table and returned. External MCP tool dispatch lands in a follow-up.",
      inputSchema: {
        handle_id: z.string().describe("Handle from glyph_render."),
        action: z.string().min(1).describe("The action's `name`."),
        selection: z
          .object({
            keys: z.array(z.union([z.string(), z.number()])).optional(),
            summary: z.string().optional(),
          })
          .strict()
          .optional()
          .describe("Selection context for $selection.* substitution."),
        dry_run: z
          .boolean()
          .optional()
          .describe("Default true. v0 ignores `false` — external dispatch is a follow-up."),
      },
    },
    async ({ handle_id, action, selection, dry_run }) =>
      state.serial(async () => {
        const handle = state.getHandle(handle_id);
        if (!handle) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: `Unknown handle_id: ${handle_id}` }],
          };
        }
        const def = state.getAction(handle_id, action);
        if (!def) {
          const known = state.actionsFor(handle_id).map((a) => a.name);
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `Unknown action "${action}" on this handle. Known: [${known.join(", ") || "<none>"}]`,
              },
            ],
          };
        }
        const sel = {
          keys: selection?.keys ?? [],
          count: selection?.keys?.length ?? 0,
          summary: selection?.summary ?? "",
        };
        const resolvedArgs =
          def.argMap !== undefined ? resolveSelectionPlaceholders(def.argMap, sel) : {};
        const id = randomActionId();
        const isDry = dry_run !== false; // v0: dry-run is the only mode
        try {
          const engine = await state.getEngine();
          await state.memory.logAction(engine, {
            id,
            handleId: handle_id,
            actionName: action,
            tool: def.tool,
            resolvedArgs,
            dryRun: isDry,
          });
        } catch (err) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: (err as Error).message ?? String(err) }],
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  audit_id: id,
                  action: def.name,
                  label: def.label,
                  tool: def.tool ?? null,
                  resolvedArgs,
                  dry_run: isDry,
                  description: def.description ?? null,
                },
                null,
                2,
              ),
            },
          ],
        };
      }),
  );

  server.registerTool(
    "glyph_audit_log",
    {
      title: "Read the glyph_act audit log",
      description:
        "Return recent rows from `gmem.__glyph_audit` — the persistent log of every glyph_act invocation. Filter by `handle_id` and cap at `limit` (default 50, newest first).",
      inputSchema: {
        handle_id: z.string().optional().describe("Filter to one handle's audit rows."),
        limit: z.number().int().min(1).max(500).optional(),
      },
    },
    async ({ handle_id, limit }) =>
      state.serial(async () => {
        const engine = await state.getEngine();
        const rows = await state.memory.listAudit(engine, {
          handleId: handle_id,
          limit,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ count: rows.length, entries: rows }, null, 2),
            },
          ],
        };
      }),
  );

  // ====== Phase 3 §7 trust signals (PR40) =================================
  //
  // v0 is a metadata-only verb — returns the handle's provenance + a derived
  // confidence flag + a small markdown summary the narrator agent can paste
  // straight into a deliverable. The per-mark hatched fill + <glyph-trust>
  // overlay lands once we ship the trust-aware renderer.

  server.registerTool(
    "glyph_trust",
    {
      title: "Read trust signals for a handle",
      description:
        "Return freshness, sample size, confidence tier, lineage depth, and a one-line markdown summary the narrator can embed. Use this before forwarding a chart to a non-analyst stakeholder — answers 'is this fresh?' and 'how was it computed?'.",
      inputSchema: {
        handle_id: z.string().describe("Handle from glyph_render."),
      },
    },
    async ({ handle_id }) =>
      state.serial(async () => {
        const handle = state.getHandle(handle_id);
        if (!handle) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: `Unknown handle_id: ${handle_id}` }],
          };
        }
        const sampleRows = handle.provenance?.sampleRows ?? 0;
        const confidence = handle.provenance?.confidence ?? "low";
        const freshness = handle.provenance?.freshness ?? "unknown";
        const filteredOut = handle.provenance?.filteredOut ?? 0;
        const lowSample = sampleRows > 0 && sampleRows < 30;
        // Walk lineage depth (1 = root). Bounded so we never loop on cycles.
        let depth = 1;
        let cur: DataHandle | undefined = handle;
        const visited = new Set<string>();
        while (cur?.lineage?.parents && cur.lineage.parents.length > 0 && depth < 16) {
          const next = cur.lineage.parents[0]?.uri;
          if (!next || visited.has(next)) break;
          visited.add(next);
          cur = state.getHandleByUri(next);
          depth++;
        }
        const summaryParts = [
          `**Sample size**: ${sampleRows}${lowSample ? " ⚠️ low" : ""}`,
          `**Confidence**: ${confidence}`,
          `**Freshness**: ${freshness}`,
          `**Lineage depth**: ${depth} step(s)`,
        ];
        if (filteredOut > 0) summaryParts.push(`**Filtered out**: ${filteredOut} row(s)`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  sampleRows,
                  confidence,
                  freshness,
                  filteredOut,
                  lowSample,
                  lineageDepth: depth,
                  markdown: summaryParts.join(" · "),
                },
                null,
                2,
              ),
            },
          ],
        };
      }),
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
