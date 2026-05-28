/**
 * Glyph MCP server.
 *
 * Thirty-two tools — the library surface:
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
 *   Story Agent (5, PR41):
 *     - glyph_story_plan(intent, source)        → DAG plan
 *     - glyph_story_execute(plan_id)            → walk DAG + assemble storyboard
 *     - glyph_story_get(plan_id)                → plan + state + storyboard
 *     - glyph_story_list()                      → list plans in this session
 *     - glyph_story_await_checkpoint(plan, …)   → long-poll progress
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
  type JsonPatchOp,
  applyJsonPatch,
  attributeDrift,
  auditSpec,
  buildCausalGraph,
  buildStructuredExplanation,
  compileSpec,
  composeStory,
  decomposeVariance,
  detectAnomalies,
  diffProvenance,
  diffSpecs,
  explainHandle,
  extractProvenanceFromSvg,
  getCapabilities,
  isTranslateError,
  linearRegression,
  morphScenes,
  renderSvg,
  renderTimeAuditFindings,
  safeParseSpec,
  seasonalNaiveForecast,
  suggestScale,
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
import {
  type Macro,
  type MacroReplayStepResult,
  collectMacroParams,
  substituteParams,
  validateMacro,
} from "./macro.js";
import {
  ServerState,
  materializeRowsAsHandle,
  materializeSpec,
  synthesizeInlineDataHandle,
} from "./state.js";
import {
  executeStoryPlan,
  planStoryAwaitingHost,
  planStoryHeuristic,
  validateLLMNodes,
} from "./story.js";
import type { ColumnSummaryLike, StoryNode, StoryPlan } from "./story.js";
import { sendProgress } from "./streaming.js";
import { buildWhyboard, diffWhyboards } from "./whyboard.js";

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
  // ---- Story Agent (PR41) ----------------------------------------------
  { name: "glyph_story_plan", since: "0.0.9" },
  { name: "glyph_story_execute", since: "0.0.9" },
  { name: "glyph_story_get", since: "0.0.9" },
  { name: "glyph_story_list", since: "0.0.9" },
  { name: "glyph_story_await_checkpoint", since: "0.0.9" },
  // ---- Linked-view filters (PR46, Innovation #4) -----------------------
  { name: "glyph_linked_publish", since: "0.0.10" },
  { name: "glyph_linked_await", since: "0.0.10" },
  { name: "glyph_linked_handles", since: "0.0.10" },
  // ---- Whyboard (PR48, Innovation #5) ----------------------------------
  { name: "glyph_whyboard", since: "0.0.11" },
  // ---- PR60 starter batch (PLAN.md items 1.7, 2.6, 1.6) ----------------
  { name: "glyph_spec_diff", since: "0.0.12" },
  { name: "glyph_suggest_scale", since: "0.0.12" },
  { name: "glyph_handles_gc", since: "0.0.12" },
  // ---- PR62 (PLAN.md items 1.8, 1.4, 2.4) ------------------------------
  { name: "glyph_spec_patch", since: "0.0.13" },
  { name: "glyph_story_clarify", since: "0.0.13" },
  { name: "glyph_whyboard_diff", since: "0.0.13" },
  // ---- PR63 (PLAN.md item 2.2) — chart auditor -------------------------
  { name: "glyph_audit_spec", since: "0.0.14" },
  // ---- PR64 (PLAN.md item 2.7) — causal-aware viz ----------------------
  { name: "glyph_causal_graph", since: "0.0.15" },
  // ---- PR65 (D3 fix-ups, no-architecture-change) ----------------------
  { name: "glyph_regression", since: "0.0.16" },
  // ---- PR69 (PLAN 1.1) — LLM-pluggable planner ------------------------
  { name: "glyph_story_provide_plan", since: "0.0.17" },
  // ---- PR70 (PLAN 2.5) — macro capture/replay -------------------------
  { name: "glyph_macro_replay", since: "0.0.18" },
  // ---- PR71 (PLAN 1.5) — local-only engagement signals ----------------
  { name: "glyph_engagement_record", since: "0.0.19" },
  { name: "glyph_engagement_query", since: "0.0.19" },
  // ---- PR74 (D3 Gap 3) — morph transitions ----------------------------
  { name: "glyph_morph_render", since: "0.0.20" },
  // ---- Moat PR1 — cryptographic provenance verification ---------------
  // The one foundational exception to Phase 2's "zero new MCP verbs"
  // rule: closing the agent-facing loop on the provenance seal requires
  // a verify verb. Without it, the seal is opaque — agents can't ask
  // "is this SVG genuinely from this spec + data?" through MCP.
  { name: "glyph_verify", since: "0.0.21" },
  // ---- 0.3.0 — `glyph_seal` standalone-seal companion to glyph_verify --
  { name: "glyph_seal", since: "0.3.0" },
  // ---- Joy of Math PR E5 — natural-language story composer -----------
  // The "bar-raiser" agent-facing endpoint. Same `(intent, audience,
  // theme, duration_ms)` → same JSON; no LLM call. See the
  // `glyph_story` handler block below for the full contract.
  { name: "glyph_story", since: "0.0.22" },
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
        "Compile and render a Glyph spec. Pass `spec` (Glyph) OR `vegaLite` (a Vega-Lite spec to translate first). Returns SVG + PNG + handle_id you can pass to glyph_query / glyph_drill. Marks: bar, point, line, area, rule.\n\nPR73 — Pass `modalities` to multi-modal-bundle the response. Supported entries: 'chart' (default; the SVG) | 'table' (first N rows + columns) | 'narrative' (auto-generated glyph_explain narrative). When set, the result envelope adds a `modalities` field carrying each requested companion artifact alongside the SVG.",
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
        modalities: z
          .array(z.enum(["chart", "table", "narrative"]))
          .optional()
          .describe(
            "PR73 (PLAN 2.1) — multi-modal bundle. Include 'table' to get rows-sample + columns, 'narrative' to get auto-generated explanation. 'chart' is always included.",
          ),
        modality_sample_rows: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .describe("PR73 — when 'table' is in modalities, cap the sample rows. Default 20."),
      },
    },
    async ({ spec, vegaLite, modalities, modality_sample_rows }, extra) =>
      state.serial(async () => {
        // PR72 — progress streaming. When the client requested progress
        // via `_meta.progressToken`, emit milestones at parse / materialize
        // / compile / render boundaries. No-op otherwise (backward-compat).
        await sendProgress(extra, { progress: 0, total: 4, message: "starting" });
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
        await sendProgress(extra, { progress: 1, total: 4, message: "parsed spec" });
        const engine = await state.getEngine();
        let m: Awaited<ReturnType<typeof materializeSpec>>;
        try {
          // PR67 / PR68 — hierarchy and graph data both bypass DuckDB.
          // Use the deterministic synthesizer (no `new Date()`, no fake
          // provenance — see B1 from PR review).
          if (parsed.spec.data?.hierarchy || parsed.spec.data?.graph || parsed.spec.data?.grid) {
            m = synthesizeInlineDataHandle(
              state.sessionId,
              state.nextInlineDataCounter(),
              parsed.spec,
            );
          } else {
            m = await materializeSpec(engine, parsed.spec, {
              sessionId: state.sessionId,
              resolveHandleByUri: (uri) => state.getHandleByUri(uri),
              metricResolver: (name) => state.getMetric(name),
            });
          }
        } catch (err) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: (err as Error).message ?? String(err) }],
          };
        }
        await sendProgress(extra, { progress: 2, total: 4, message: "materialized data" });
        state.storeHandle(m.handle);
        // PR62 (PLAN 1.8) — remember the originating spec so glyph_spec_patch
        // can re-run the pipeline with RFC 6902 edits applied.
        state.storeSpec(m.handle.id, parsed.spec);
        // Record the spec's declarative actions so glyph_act can resolve them.
        if (parsed.spec.actions && parsed.spec.actions.length > 0) {
          state.setActionsForHandle(m.handle.id, parsed.spec.actions);
        }
        // PR46: register the handle in its link_group if set.
        if (parsed.spec.link_group) {
          state.links.registerHandle(parsed.spec.link_group, m.handle.id);
        }
        const scene = compileSpec({
          // Use the materializer's effectiveSpec — for metric channels this
          // has `{ metric: <name> }` rewritten to `{ field: _metric_<name> }`
          // so the compiler resolves to the synthetic columns the engine
          // actually produced.
          spec: m.effectiveSpec,
          rows: m.result.rows,
          schema: m.handle.schema,
          // PR61 (PLAN 2.3) — let the compiler emit an uncertainty overlay
          // when the underlying handle's confidence is not "high" or its
          // sample is small. Opt-out via spec.interactive.uncertainty=false.
          ...(m.handle.provenance ? { provenance: m.handle.provenance } : {}),
        });
        await sendProgress(extra, { progress: 3, total: 4, message: "compiled scene" });
        const svg = renderSvg(scene);
        // Cache the SVG so a later `glyph_preview` deep-link can serve it.
        state.storeSvg(m.handle.id, svg);
        // Rasterize once so hosts that render `image/*` content inline can
        // display the chart directly (Claude Code, Cursor, IDE previews).
        const pngB64 = svgToPngBase64(svg);
        await sendProgress(extra, { progress: 4, total: 4, message: "rendered svg" });

        // PR73 (PLAN 2.1) — multi-modal companion artifacts. The chart
        // (SVG) is always returned; agents that opt into "table" or
        // "narrative" get those alongside in one envelope.
        const requestedModalities = new Set(modalities ?? ["chart"]);
        const modalityBundle: Record<string, unknown> = {};
        if (requestedModalities.has("table")) {
          const cap = modality_sample_rows ?? 20;
          modalityBundle.table = {
            columns: m.handle.schema.map((c) => c.name),
            rowCount: m.result.rowCount,
            rows: jsonSafe(m.result.rows.slice(0, cap)),
            truncated: m.result.rows.length > cap,
          };
        }
        if (requestedModalities.has("narrative")) {
          try {
            // explainHandle takes { schema, rows } — same shape glyph_explain
            // wires up internally.
            const narrative = explainHandle({
              schema: m.handle.schema.map((c) => ({
                name: c.name,
                type: c.type,
                ...(c.suggested !== undefined ? { suggested: c.suggested } : {}),
              })),
              rows: m.result.rows,
            });
            modalityBundle.narrative = jsonSafe(narrative);
          } catch (err) {
            // Narrative is a nice-to-have; failing it shouldn't fail the
            // render. Report the error in-band so the caller can see why.
            modalityBundle.narrative_error = (err as Error).message ?? String(err);
          }
        }

        const textBlock = {
          type: "text" as const,
          text: JSON.stringify(
            jsonSafe({
              svg,
              handle_id: m.handle.id,
              view_name: m.handle.viewName,
              schema: m.handle.schema,
              row_count: m.result.rowCount,
              ...(Object.keys(modalityBundle).length > 0 ? { modalities: modalityBundle } : {}),
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
        "Run follow-up SQL against the view that backs a previously rendered chart. Pass the handle_id from glyph_render's result. The `where` argument is appended verbatim (e.g. 'WHERE rides > 1000 ORDER BY rides DESC LIMIT 5'). Use `limit_rows` to cap returned rows when the result set is large — the response carries a `truncated: true` sentinel + the full `total` count.",
      inputSchema: {
        handle_id: z.string().describe("The handle_id returned by glyph_render."),
        where: z
          .string()
          .optional()
          .describe(
            "Optional SQL clause appended to SELECT * FROM <view>. Typically starts with WHERE.",
          ),
        limit_rows: z
          .number()
          .int()
          .min(1)
          .max(100_000)
          .optional()
          .describe(
            "PR60 item 1.3 — cap returned rows for context-budget safety. Default unlimited.",
          ),
      },
    },
    async ({ handle_id, where, limit_rows }, extra) =>
      state.serial(async () => {
        await sendProgress(extra, { progress: 0, total: 2, message: "resolving handle" });
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
        await sendProgress(extra, { progress: 1, total: 2, message: "query complete" });
        // PR60 item 1.3: truncate in JS post-query so we can return the
        // truthful total. SQL-level pushdown is a follow-up optimization.
        const truncated = limit_rows !== undefined && result.rows.length > limit_rows;
        const returnedRows = truncated ? result.rows.slice(0, limit_rows) : result.rows;
        await sendProgress(extra, { progress: 2, total: 2, message: "serialized" });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                jsonSafe({
                  columns: result.columns.map((c) => c.name),
                  rowCount: result.rowCount,
                  rows: returnedRows,
                  ...(truncated
                    ? { truncated: true, total: result.rowCount, returned: returnedRows.length }
                    : {}),
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

  // ----- glyph_explain (PR35 / Phase 3 §2; Moat PR 2) ---------------------
  // Self-explaining charts. Runs a deterministic four-stage pipeline
  // (top-line / compositional / anomaly / temporal) against the rows that
  // back a rendered chart and returns { headline, highlights, questions }.
  //
  // Moat PR 2 — opt-in `format: "structured"` swaps the flat prose envelope
  // for a typed Explanation object: { headline, keyInsights[],
  // potentialMisreadings[], dataSources[], chartTypeRationale,
  // suggestedFollowups[], format: "glyph-explanation/1" }. The
  // `suggestedFollowups[].suggestedVerb` + `suggestedArgs` fields let an
  // agent chain to a follow-up MCP call without re-parsing prose. Default
  // stays "legacy" for back-compat.
  server.registerTool(
    "glyph_explain",
    {
      title: "Generate a deterministic explanation of a chart",
      description:
        "Run the explain pipeline against a previously rendered chart. By default returns the legacy `{ headline, highlights[], questions[] }` envelope. Pass `format: 'structured'` for a typed `Explanation/1` envelope (agent-consumable, includes keyInsights, potentialMisreadings sourced from the audit pass, dataSources, chartTypeRationale, and suggestedFollowups[].suggestedVerb/suggestedArgs you can call directly). Output is deterministic — same chart + same Glyph version always yields the same explanation.",
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
        format: z
          .enum(["legacy", "structured"])
          .optional()
          .describe(
            "Output envelope. Default 'legacy' for back-compat ({ headline, highlights[], questions[] }); 'structured' returns the typed Explanation/1 object — see glyph_explain description for the schema.",
          ),
      },
    },
    async ({ handle_id, hints, format }) =>
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

        if (format === "structured") {
          // Reach for the spec we remembered at glyph_render time. If the
          // handle was produced by a verb that didn't store a spec (chained
          // diagnostic), we synthesize a minimal spec from the schema so
          // the structured envelope can still be built.
          const storedSpec = state.getSpec(handle_id);
          const parsed = storedSpec ? safeParseSpec(storedSpec) : undefined;
          let spec: import("@glyph/core").GlyphSpec;
          if (parsed?.ok) {
            spec = parsed.spec;
          } else {
            // Best-effort synthetic spec — a single bar layer over the first
            // two schema columns is enough for chartTypeRationale to land
            // somewhere reasonable.
            const cols = handle.schema;
            const x = cols[0]?.name;
            const y = cols[1]?.name ?? cols[0]?.name;
            spec = {
              layers: [
                {
                  mark: "bar",
                  ...(x && y ? { encoding: { x: { field: x }, y: { field: y } } } : {}),
                },
              ],
            } as unknown as import("@glyph/core").GlyphSpec;
          }
          // Moat 3 review BLOCKER B1: structured-explain sees AUDIT-10
          // (and any future render-time rules) via the same path the
          // glyph_audit_spec handler uses. yField comes from the
          // explicit hint when supplied, else falls back to the spec's
          // layer-0 y encoding. Without this, structured-explain's
          // potentialMisreadings would silently miss missing-data
          // findings — the moat's "tell you why" half.
          const schemaMeta = handle.schema.map((c) => ({ name: c.name, type: c.type }));
          const structuralFindings = auditSpec({ spec, rowCount: result.rows.length });
          const yForAudit =
            hints?.yField ??
            (() => {
              const y = spec.layers?.[0]?.encoding?.y;
              if (typeof y === "string") return y;
              if (y && typeof y === "object" && "field" in y && typeof y.field === "string") {
                return y.field;
              }
              return undefined;
            })();
          const renderTime =
            yForAudit !== undefined
              ? renderTimeAuditFindings(spec, result.rows, yForAudit, schemaMeta)
              : [];
          const auditFindings = [...structuralFindings, ...renderTime];
          const structured = buildStructuredExplanation({
            spec,
            rows: result.rows,
            schema: schemaMeta,
            auditFindings,
            ...(hints ? { hints } : {}),
          });
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(jsonSafe(structured), null, 2),
              },
            ],
          };
        }

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
                causal_of: z
                  .array(z.string())
                  .optional()
                  .describe(
                    "PR64 (PLAN 2.7) — upstream metric/column names that causally drive this metric. Used by glyph_causal_graph to build the DAG, and (in a follow-up) by the renderer to emit a '→ causal' badge in legends.",
                  ),
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

  // ====== Story Agent (PR41) ===============================================
  //
  // glyph_story_plan + _execute + _await_checkpoint + _get + _list. The
  // planner is heuristic v0 (no LLM); the executor is a DAG walker that
  // calls the existing render/explain/anomaly/forecast logic via the
  // internal helpers below. Plans live in `state.stories` (in-process).
  //
  // The five verbs split intent like this:
  //   _plan(intent, source) → returns plan_id + an unexecuted DAG
  //   _execute(plan_id)     → runs the DAG end-to-end (sync)
  //   _await_checkpoint(plan_id, since?, timeout_ms?) → long-poll updates
  //   _get(plan_id)         → fetch the plan + storyboard
  //   _list()               → list all plans in this session

  /** Internal: run a render spec via the same path glyph_render uses. */
  async function runRenderInternal(spec: unknown): Promise<Record<string, unknown>> {
    const parsed = safeParseSpec(spec);
    if (!parsed.ok) throw new Error(parsed.error.message);
    const engine = await state.getEngine();
    const m = await materializeSpec(engine, parsed.spec, {
      sessionId: state.sessionId,
      resolveHandleByUri: (uri) => state.getHandleByUri(uri),
      metricResolver: (name) => state.getMetric(name),
    });
    state.storeHandle(m.handle);
    state.storeSpec(m.handle.id, parsed.spec);
    if (parsed.spec.actions && parsed.spec.actions.length > 0) {
      state.setActionsForHandle(m.handle.id, parsed.spec.actions);
    }
    const scene = compileSpec({
      spec: m.effectiveSpec,
      rows: m.result.rows,
      schema: m.handle.schema,
      ...(m.handle.provenance ? { provenance: m.handle.provenance } : {}),
    });
    const svg = renderSvg(scene);
    state.storeSvg(m.handle.id, svg);
    return {
      handle_id: m.handle.id,
      uri: m.handle.uri,
      view_name: m.handle.viewName,
      row_count: m.result.rowCount,
      title: scene.title,
    };
  }

  /** Internal: glyph_describe equivalent, returns DataSummary. */
  async function runDescribeInternal(source: string): Promise<Record<string, unknown>> {
    const engine = await state.getEngine();
    const handle = `desc_story_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await engine.register({ source }, handle);
    const summary = await engine.describe(handle);
    return jsonSafe(summary) as Record<string, unknown>;
  }

  /**
   * Internal: glyph_query equivalent. Used by macro replay (PR70) and
   * potentially by other internal verbs that need to drill into a
   * stored handle without going through the full MCP roundtrip.
   */
  async function runQueryInternal(
    handle_id: string,
    where?: string,
    limit_rows?: number,
  ): Promise<Record<string, unknown>> {
    const handle = state.getHandle(handle_id);
    if (!handle) throw new Error(`Unknown handle_id ${handle_id}`);
    const engine = await state.getEngine();
    const sql = where !== undefined ? where : "";
    const result = await engine.queryHandle(handle, sql);
    // Mirror the main glyph_query handler: compare against rows.length,
    // not rowCount. They can diverge when the engine has already applied
    // its own cap, in which case reporting `truncated: true` would be a
    // lie (review finding on PR70).
    const total = result.rows.length;
    const truncated = limit_rows !== undefined && total > limit_rows;
    const rows = truncated ? result.rows.slice(0, limit_rows) : result.rows;
    return jsonSafe({
      handle_id,
      total,
      returned: rows.length,
      ...(truncated ? { truncated: true } : {}),
      columns: result.columns.map((c) => c.name),
      rows,
    }) as Record<string, unknown>;
  }

  server.registerTool(
    "glyph_story_plan",
    {
      title: "Plan a multi-chart analytic storyboard from natural-language intent",
      description:
        "Inspect `source` and emit a DAG-shaped StoryPlan tailored to the schema: render → explain → anomaly (+ forecast when temporal) → annotate. The planner is heuristic v0 (no LLM); the LLM-driven planner is the v1 extension point. Returns { plan_id, intent, nodes[], status: 'planned' }.",
      inputSchema: {
        intent: z
          .string()
          .min(1)
          .describe("Natural-language description of what the user wants to learn."),
        source: z
          .string()
          .min(1)
          .describe("Data file path / URL / glyph_import name / gdf:// URI."),
        format: z
          .enum(["csv", "parquet", "json"])
          .optional()
          .describe("File format hint passed through to glyph_render."),
        domain: z
          .string()
          .optional()
          .describe(
            "Optional domain bias for the planner (e.g. 'saas-mrr', 'logistics'). Heuristic v0 records it; LLM-v1 would use it.",
          ),
        planner_hint: z
          .enum(["heuristic", "llm"])
          .optional()
          .describe(
            "PR69 (PLAN 1.1) — when 'llm', skip the heuristic planner. The server returns a placeholder plan with status='awaiting_planner' plus the schema + intent context; the host LLM fulfills the plan by calling glyph_story_provide_plan(plan_id, nodes). Default: 'heuristic'.",
          ),
      },
    },
    async ({ intent, source, format, domain, planner_hint }) =>
      state.serial(async () => {
        try {
          // Inspect the source so the planner (or the host LLM) knows the schema.
          const summary = (await runDescribeInternal(source)) as {
            columns?: ReadonlyArray<ColumnSummaryLike>;
          };
          const plan =
            planner_hint === "llm"
              ? planStoryAwaitingHost({
                  intent,
                  source,
                  sourceFormat: format,
                  schema: summary.columns ?? [],
                  domain,
                })
              : planStoryHeuristic({
                  intent,
                  source,
                  sourceFormat: format,
                  schema: summary.columns ?? [],
                  domain,
                });
          state.stories.set(plan);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    id: plan.id,
                    plan_id: plan.id,
                    intent: plan.intent,
                    domain: plan.domain ?? null,
                    nodes: plan.nodes.map((n) => ({
                      id: n.id,
                      kind: n.kind,
                      label: n.label,
                      dependsOn: n.dependsOn,
                      status: n.status,
                    })),
                    status: plan.status,
                    // PR62 (PLAN 1.4) — surface disambiguation questions.
                    ...(plan.clarification_questions
                      ? { clarification_questions: plan.clarification_questions }
                      : {}),
                    // PR69 (PLAN 1.1) — schema context for the host LLM
                    // (only when awaiting). Empty otherwise.
                    ...(plan.status === "awaiting_planner"
                      ? {
                          schema: summary.columns ?? [],
                          hint: "Call glyph_story_provide_plan(plan_id, nodes) with the LLM's plan.",
                        }
                      : {}),
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

  // ----- glyph_story_provide_plan (PR69 / PLAN 1.1) -------------------------
  server.registerTool(
    "glyph_story_provide_plan",
    {
      title: "Supply LLM-derived plan nodes for an awaiting story plan",
      description:
        "When `glyph_story_plan` was called with `planner_hint: 'llm'`, the plan starts in `awaiting_planner` state. The host LLM (which has just been handed the schema + intent) generates a node list and submits it here. The server validates the node shape, attaches the nodes to the plan, and flips status to 'planned' so `glyph_story_execute` will proceed.",
      inputSchema: {
        plan_id: z
          .string()
          .min(1)
          .describe("The plan_id returned by glyph_story_plan with planner_hint='llm'."),
        nodes: z
          .array(z.unknown())
          .min(1)
          .describe(
            "Array of StoryNode objects. Each must have { id, kind, label, args, dependsOn }. Allowed kinds: describe, render, explain, anomaly, drift, forecast, annotate. dependsOn references previously-listed node ids in topological order.",
          ),
      },
    },
    async ({ plan_id, nodes }) => {
      const plan = state.stories.get(plan_id);
      if (!plan) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Unknown plan_id: ${plan_id}` }],
        };
      }
      if (plan.status !== "awaiting_planner") {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Plan ${plan_id} is not awaiting a planner (status: ${plan.status}). Use glyph_story_plan with planner_hint='llm' to enter awaiting state.`,
            },
          ],
        };
      }
      const err = validateLLMNodes(nodes);
      if (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Invalid nodes: ${err}` }],
        };
      }
      // Fill nodes with default status="pending" if not provided.
      const fulfilled: StoryNode[] = (nodes as ReadonlyArray<Record<string, unknown>>).map((n) => ({
        id: n.id as string,
        kind: n.kind as StoryNode["kind"],
        label: n.label as string,
        args: (n.args as Record<string, unknown>) ?? {},
        dependsOn: (n.dependsOn as ReadonlyArray<string>) ?? [],
        status: (n.status as StoryNode["status"]) ?? "pending",
      }));
      const updated: StoryPlan = {
        ...plan,
        nodes: fulfilled,
        status: "planned",
      };
      state.stories.set(updated);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                plan_id,
                status: "planned",
                nodes: fulfilled.map((n) => ({
                  id: n.id,
                  kind: n.kind,
                  label: n.label,
                  dependsOn: n.dependsOn,
                })),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    "glyph_story_execute",
    {
      title: "Execute a previously-planned story DAG",
      description:
        "Walk the StoryPlan's DAG in topological order, dispatching to the underlying MCP verbs. Sibling nodes run in parallel. Pushes a checkpoint per node start/end; consume them via glyph_story_await_checkpoint. Returns the assembled storyboard on completion.",
      inputSchema: {
        plan_id: z.string().describe("Plan id from glyph_story_plan."),
      },
    },
    async ({ plan_id }) => {
      const plan = state.stories.get(plan_id);
      if (!plan) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Unknown plan_id: ${plan_id}` }],
        };
      }
      // PR69 (PLAN 1.1) — refuse to execute a plan still awaiting host
      // fulfillment via glyph_story_provide_plan.
      if (plan.status === "awaiting_planner") {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Plan ${plan_id} is awaiting host-supplied nodes — call glyph_story_provide_plan(plan_id, nodes) first.`,
            },
          ],
        };
      }
      try {
        await executeStoryPlan({
          plan,
          store: state.stories,
          verbs: {
            // Each verb is wrapped in state.serial so sibling DAG nodes
            // don't race on the single-writer DuckDB connection.
            describe: ({ source }) => state.serial(() => runDescribeInternal(source)),
            render: ({ spec }) => state.serial(() => runRenderInternal(spec)),
            explain: ({ handle_id }) =>
              state.serial(async () => {
                const h = state.getHandle(handle_id);
                if (!h) throw new Error(`Unknown handle_id: ${handle_id}`);
                const engine = await state.getEngine();
                const result = await engine.queryHandle(h);
                return jsonSafe(explainHandle({ schema: h.schema, rows: result.rows })) as Record<
                  string,
                  unknown
                >;
              }),
            anomaly: ({ handle_id, valueField, groupField, labelField }) =>
              state.serial(async () => {
                const h = state.getHandle(handle_id);
                if (!h) throw new Error(`Unknown handle_id: ${handle_id}`);
                const engine = await state.getEngine();
                const queried = await engine.queryHandle(h);
                const result = detectAnomalies({
                  schema: h.schema,
                  rows: queried.rows,
                  valueField,
                  ...(groupField !== undefined ? { groupField } : {}),
                  ...(labelField !== undefined ? { labelField } : {}),
                });
                const columns = result.schema.map((c) => c.name);
                const rowsArr = result.rows.map((a) => [...a.row, a.z]);
                const derived = await materializeRowsAsHandle(engine, {
                  rows: rowsArr,
                  columns,
                  sessionId: state.sessionId,
                  parent: h,
                  relation: "filter",
                  producerTool: "glyph_story_anomaly",
                });
                state.storeHandle(derived);
                return jsonSafe({
                  handle_id: derived.id,
                  uri: derived.uri,
                  rows: rowsArr,
                  explanation: result.explanation,
                }) as Record<string, unknown>;
              }),
            forecast: ({ handle_id, xField, yField }) =>
              state.serial(async () => {
                const h = state.getHandle(handle_id);
                if (!h) throw new Error(`Unknown handle_id: ${handle_id}`);
                const engine = await state.getEngine();
                const queried = await engine.queryHandle(h);
                const result = seasonalNaiveForecast({
                  schema: h.schema,
                  rows: queried.rows,
                  xField,
                  yField,
                });
                const columns = result.schema.map((c) => c.name);
                const rowsArr = result.rows.map((fr) => [
                  fr.x instanceof Date ? fr.x.toISOString() : fr.x,
                  fr.actual,
                  fr.forecast,
                  fr.lo,
                  fr.hi,
                  fr.isHorizon,
                ]);
                const derived = await materializeRowsAsHandle(engine, {
                  rows: rowsArr,
                  columns,
                  sessionId: state.sessionId,
                  parent: h,
                  relation: "transform",
                  producerTool: "glyph_story_forecast",
                });
                state.storeHandle(derived);
                return jsonSafe({
                  handle_id: derived.id,
                  uri: derived.uri,
                  season: result.season,
                  explanation: result.explanation,
                }) as Record<string, unknown>;
              }),
          },
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
              jsonSafe({
                plan_id: plan.id,
                status: plan.status,
                storyboard: plan.storyboard ?? null,
                failed_nodes: plan.nodes
                  .filter((n) => n.status === "failed")
                  .map((n) => ({ id: n.id, kind: n.kind, error: n.error })),
              }),
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    "glyph_story_get",
    {
      title: "Fetch a story plan + its current state",
      description:
        "Return the plan's nodes (status / result summary / timing), the storyboard if execution is complete, and the latest checkpoint count.",
      inputSchema: {
        plan_id: z.string(),
      },
    },
    async ({ plan_id }) => {
      const plan = state.stories.get(plan_id);
      if (!plan) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Unknown plan_id: ${plan_id}` }],
        };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              jsonSafe({
                plan_id: plan.id,
                intent: plan.intent,
                status: plan.status,
                createdAt: plan.createdAt,
                domain: plan.domain ?? null,
                nodes: plan.nodes.map((n) => ({
                  id: n.id,
                  kind: n.kind,
                  label: n.label,
                  status: n.status,
                  startedAt: n.startedAt ?? null,
                  endedAt: n.endedAt ?? null,
                  error: n.error ?? null,
                  handle_id: typeof n.result?.handle_id === "string" ? n.result.handle_id : null,
                })),
                checkpointCount: plan.checkpoints.length,
                storyboard: plan.storyboard ?? null,
              }),
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    "glyph_story_list",
    {
      title: "List all story plans in this session",
      description:
        "Return a compact list of plans: id, intent (truncated), status, createdAt, panel count when complete.",
      inputSchema: {},
    },
    async () => {
      const plans = state.stories.all().map((p) => ({
        plan_id: p.id,
        intent: p.intent.length > 80 ? `${p.intent.slice(0, 80)}…` : p.intent,
        status: p.status,
        createdAt: p.createdAt,
        nodeCount: p.nodes.length,
        panels: p.storyboard?.panels.length ?? null,
      }));
      return {
        content: [
          { type: "text" as const, text: JSON.stringify({ count: plans.length, plans }, null, 2) },
        ],
      };
    },
  );

  server.registerTool(
    "glyph_story_await_checkpoint",
    {
      title: "Long-poll for the next story-plan checkpoint",
      description:
        "Wait for the next checkpoint after index `since` (default 0). Returns { checkpoint: {...}, index } on arrival, or { checkpoint: null } on timeout. Use in a loop while glyph_story_execute is running to stream intermediate updates to the user.",
      inputSchema: {
        plan_id: z.string(),
        since: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Return only checkpoints whose index >= this value."),
        timeout_ms: z
          .number()
          .int()
          .min(0)
          .max(60_000)
          .optional()
          .describe("Max wait. Default 5000."),
      },
    },
    async ({ plan_id, since, timeout_ms }) => {
      const sinceIdx = since ?? 0;
      const cp = await state.stories.awaitCheckpoint(plan_id, sinceIdx, timeout_ms ?? 5000);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              cp ? { checkpoint: cp, index: sinceIdx } : { checkpoint: null, index: sinceIdx },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // ====== Linked-view filters (PR46, Innovation #4) =======================
  //
  // Charts that share `spec.link_group` participate in the same selection
  // bus. A click in chart A broadcasts a SQL predicate via
  // `glyph_linked_publish`; chart B picks it up via `glyph_linked_await`
  // and applies it to its own glyph_query / glyph_drill.

  server.registerTool(
    "glyph_linked_publish",
    {
      title: "Broadcast a SQL predicate to a linked-view group",
      description:
        "Append a filter event to the named link_group's bus. All charts in the same group can consume it via glyph_linked_await. Use this when a user click in chart A should narrow chart B (e.g. clicking a region filters every other chart on the page).\n\nPR73 (PLAN 2.1) — pass optional `modality` ('chart' | 'table' | 'narrative' | host-defined) to tag the event with its originating surface. Subscribers can then filter out events from their own modality (echo filter) when multi-pane UIs would otherwise loop user gestures.",
      inputSchema: {
        group: z.string().min(1).describe("The shared link_group name from spec.link_group."),
        predicate: z
          .string()
          .min(1)
          .describe("SQL predicate (e.g. 'region = \\'us\\''). Consumed verbatim by glyph_query."),
        source_handle: z
          .string()
          .optional()
          .describe("Handle that originated the event (lets consumers skip echo)."),
        summary: z
          .string()
          .optional()
          .describe("Human-readable summary, e.g. 'Region: us' — for the narrator."),
        modality: z
          .string()
          .min(1)
          .optional()
          .describe(
            "PR73 (PLAN 2.1) — originating modality. Convention: 'chart' | 'table' | 'narrative'. Subscribers compare event.modality to their own to skip echoes.",
          ),
      },
    },
    async ({ group, predicate, source_handle, summary, modality }) => {
      const event = state.links.publish({
        group,
        predicate,
        ...(source_handle !== undefined ? { source_handle } : {}),
        ...(summary !== undefined ? { summary } : {}),
        ...(modality !== undefined ? { modality } : {}),
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(event, null, 2) }],
      };
    },
  );

  server.registerTool(
    "glyph_linked_await",
    {
      title: "Long-poll the next linked-view filter event",
      description:
        "Wait for the next event after index `since` (default 0) on a link_group. Returns { event, index } on arrival or { event: null } on timeout. Loop on the returned index to stream events.",
      inputSchema: {
        group: z.string().min(1),
        since: z.number().int().min(0).optional(),
        timeout_ms: z.number().int().min(0).max(60_000).optional(),
      },
    },
    async ({ group, since, timeout_ms }) => {
      const r = await state.links.awaitNext({
        group,
        sinceIndex: since ?? 0,
        timeoutMs: timeout_ms ?? 5000,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(r ? r : { event: null, index: since ?? 0 }, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "glyph_linked_handles",
    {
      title: "List handles registered in a link_group",
      description:
        "Return every handle_id that mounted into this link_group via spec.link_group at glyph_render time. Useful for inspecting which charts in the storyboard share a selection context.",
      inputSchema: {
        group: z.string().min(1),
      },
    },
    async ({ group }) => {
      const handles = state.links.handles(group);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                group,
                count: handles.length,
                handles,
                recent_events: state.links.recent(group, 8),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // ====== Whyboard (PR48, Innovation #5) ==================================
  //
  // Returns a tree of diagnostics rooted at a chart handle. v0 emits
  // depth-1 (root + anomaly + decompose + forecast + drift children); the
  // consumer renders the tree as clickable cards. Each diagnostic
  // materializes a derived handle so `glyph_lineage(uri)` walks every
  // branch back to the source — full audit.

  server.registerTool(
    "glyph_whyboard",
    {
      title: "Build an interactive 'why' tree from a rendered chart",
      description:
        "Given a starting handle_id, runs explain + anomaly + decompose + forecast + drift (where applicable) and returns a tree rooted at the handle. Each branch is a derived DataHandle so the consumer can drill into the rows behind any node. Pair with `link_group` to wire cross-branch filters via the linked-view bus.",
      inputSchema: {
        handle_id: z.string().describe("The handle the user is asking 'why' about."),
        question: z
          .string()
          .optional()
          .describe("Optional natural-language question — stored on the result for narrators."),
        depth: z
          .number()
          .int()
          .min(1)
          .max(3)
          .optional()
          .describe(
            "Branch depth. v0 honors 1 (root + direct children); deeper recursion lands in a follow-up.",
          ),
        factors: z
          .array(z.string().min(1))
          .optional()
          .describe(
            "Override the auto-detected categorical fields for the decompose branch (e.g. ['region','plan_tier']).",
          ),
        link_group: z
          .string()
          .optional()
          .describe(
            "Optional link_group name; recorded on the result so the consumer can wire cross-branch filters.",
          ),
        sample_rows: z
          .number()
          .int()
          .min(0)
          .max(64)
          .optional()
          .describe("Rows to preview per node (default 8)."),
      },
    },
    async ({ handle_id, question, depth, factors, link_group, sample_rows }) =>
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
          const board = await buildWhyboard({
            state,
            engine,
            handle_id,
            ...(question !== undefined ? { question } : {}),
            ...(depth !== undefined ? { depth } : {}),
            ...(factors !== undefined ? { factors } : {}),
            ...(link_group !== undefined ? { link_group } : {}),
            ...(sample_rows !== undefined ? { sample_rows } : {}),
          });
          return {
            content: [{ type: "text" as const, text: JSON.stringify(jsonSafe(board), null, 2) }],
          };
        } catch (err) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: (err as Error).message ?? String(err) }],
          };
        }
      }),
  );

  // ====== PR60 starter batch (PLAN.md) ====================================

  // ----- glyph_spec_diff (PLAN.md item 1.7) -------------------------------
  server.registerTool(
    "glyph_spec_diff",
    {
      title: "Structural diff between two specs",
      description:
        "Pure-fn diff between two Glyph specs. Returns { added, removed, changed, summary } where the summary is a one-sentence narrative naming the most impactful diff. Use before glyph_render to preview what your edit will change, or after to audit what the agent actually modified.",
      inputSchema: {
        spec_a: z.unknown().describe("The before spec."),
        spec_b: z.unknown().describe("The after spec."),
      },
    },
    async ({ spec_a, spec_b }) => {
      const diff = diffSpecs(spec_a, spec_b);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(diff, null, 2) }],
      };
    },
  );

  // ----- glyph_suggest_scale (PLAN.md item 2.6) ---------------------------
  server.registerTool(
    "glyph_suggest_scale",
    {
      title: "Suggest scale-type changes for a chart",
      description:
        "Inspect a handle's rows for distribution shape (multi-order-of-magnitude ratios, sign-crossing values, long tails) and return scale-type suggestions ranked by confidence. Use after glyph_render when a chart 'looks wrong' — log scale for $100→$10M, diverging for ±50 around 0, sqrt for long tails.",
      inputSchema: {
        handle_id: z.string().describe("Handle from glyph_render."),
        field: z
          .string()
          .optional()
          .describe(
            "Limit to a single field (usually the y channel). Default: every quantitative column.",
          ),
      },
    },
    async ({ handle_id, field }) =>
      state.serial(async () => {
        const h = state.getHandle(handle_id);
        if (!h) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: `Unknown handle_id: ${handle_id}` }],
          };
        }
        const engine = await state.getEngine();
        const result = await engine.queryHandle(h);
        const suggestions = suggestScale({
          schema: h.schema,
          rows: result.rows,
          ...(field !== undefined ? { field } : {}),
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ count: suggestions.length, suggestions }, null, 2),
            },
          ],
        };
      }),
  );

  // ----- glyph_handles_gc (PLAN.md item 1.6) ------------------------------
  server.registerTool(
    "glyph_handles_gc",
    {
      title: "Reap stale handles (TTL auto-GC)",
      description:
        "Drop handles that have been unaccessed past the session's TTL (default 30 min) AND have no descendant handles AND aren't pinned. Returns the evicted ids. Normally called automatically by ServerState; this verb is for manual inspection / forcing during long sessions.",
      inputSchema: {
        force: z
          .boolean()
          .optional()
          .describe(
            "If true, reap regardless of TTL — useful for testing. Pinned handles still survive.",
          ),
      },
    },
    async ({ force }) => {
      // For force=true, set "now" far enough in the future that every
      // handle is past its TTL.
      const now = force ? Date.now() + 365 * 24 * 60 * 60 * 1000 : Date.now();
      const evicted = state.reapStaleHandles(now);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ count: evicted.length, evicted_ids: evicted }, null, 2),
          },
        ],
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

  // ----- glyph_spec_patch (PR62 / PLAN item 1.8) ----------------------------
  // Apply RFC 6902 JSON patches to the spec that produced an existing handle
  // and re-run the pipeline. Returns the new handle id + SVG. Lineage marks
  // the relation as "transform" so glyph_lineage walks back to the origin.
  //
  // 0.3.0 — audit-aware gate: after applying patches, re-run auditSpec on the
  // patched spec and diff against the original's findings (keyed by rule_id +
  // path). If the patch INTRODUCES any new HIGH-severity findings, refuse the
  // patch and return them in `regressions`. The caller can override by setting
  // `acknowledged: true` (signals "I've seen the warnings, render anyway").
  server.registerTool(
    "glyph_spec_patch",
    {
      title: "Incrementally edit a spec via JSON Patch (RFC 6902)",
      description:
        "Refine an existing chart without regenerating the full spec. Pass the originating handle_id plus an array of RFC 6902 patches (add/remove/replace/copy/move/test). The server applies the patches to the spec stored at render time, re-runs the pipeline, and returns the new handle. Lineage chains back to the original handle. 0.3.0: blocks patches that INTRODUCE high-severity audit findings unless `acknowledged: true`.",
      inputSchema: {
        handle_id: z.string().min(1).describe("The handle whose spec to patch."),
        patches: z
          .array(z.unknown())
          .min(1)
          .describe(
            "Array of RFC 6902 JSON Patch operations. Each op has { op: 'add'|'remove'|'replace'|'copy'|'move'|'test', path: '/json/pointer', value?: any, from?: '/json/pointer' }.",
          ),
        acknowledged: z
          .boolean()
          .optional()
          .describe(
            "0.3.0 — set true to override the audit-regression gate when the patch introduces new HIGH-severity findings. Without this, such patches are refused with `regressions: [...]` so the agent has to either fix the patch or explicitly accept the misleading rendering.",
          ),
      },
    },
    async ({ handle_id, patches, acknowledged }) => {
      const original = state.getSpec(handle_id);
      if (original === undefined) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Unknown handle_id ${handle_id} — no spec recorded (handle may not have been produced by glyph_render).`,
            },
          ],
        };
      }
      let patched: unknown;
      try {
        patched = applyJsonPatch(original, patches as ReadonlyArray<JsonPatchOp>);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Invalid patch: ${msg}` }],
        };
      }
      const reparse = safeParseSpec(patched);
      if (!reparse.ok) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Patched spec fails validation: ${reparse.error.message}`,
            },
          ],
        };
      }
      // 0.3.0 audit-regression gate. We diff *structural* audit findings only
      // (the pure-fn pass) — render-time AUDIT-10 needs rows we haven't
      // materialized yet. The original spec parses cleanly because it was
      // accepted at render time; if for any reason it doesn't, we skip the
      // diff rather than blocking on a pre-existing bug.
      const originalParsed = safeParseSpec(original);
      if (originalParsed.ok && acknowledged !== true) {
        const beforeFindings = auditSpec({ spec: originalParsed.spec });
        const afterFindings = auditSpec({ spec: reparse.spec });
        const beforeKeys = new Set(beforeFindings.map((f) => `${f.rule_id}@${f.path ?? ""}`));
        const newHigh = afterFindings.filter(
          (f) => f.severity === "high" && !beforeKeys.has(`${f.rule_id}@${f.path ?? ""}`),
        );
        if (newHigh.length > 0) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    error: "audit_regression",
                    message:
                      "Patch would introduce HIGH-severity audit findings the original spec didn't have. Either fix the patch or re-call with `acknowledged: true` to accept the regression.",
                    regressions: newHigh,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }
      }
      const engine = await state.getEngine();
      // PR67 / PR68 — hierarchy and graph patches bypass DuckDB just like
      // their initial render did (B2 from PR review).
      const m =
        reparse.spec.data?.hierarchy || reparse.spec.data?.graph || reparse.spec.data?.grid
          ? synthesizeInlineDataHandle(state.sessionId, state.nextInlineDataCounter(), reparse.spec)
          : await materializeSpec(engine, reparse.spec, {
              sessionId: state.sessionId,
              resolveHandleByUri: (uri: string) => state.getHandleByUri(uri),
              metricResolver: (name: string) => state.getMetric(name),
            });
      state.storeHandle(m.handle);
      state.storeSpec(m.handle.id, reparse.spec);
      const scene = compileSpec({
        spec: m.effectiveSpec,
        rows: m.result.rows,
        schema: m.handle.schema,
        ...(m.handle.provenance ? { provenance: m.handle.provenance } : {}),
      });
      const svg = renderSvg(scene);
      state.storeSvg(m.handle.id, svg);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              jsonSafe({
                handle_id: m.handle.id,
                uri: m.handle.uri,
                view_name: m.handle.viewName,
                row_count: m.result.rowCount,
                svg,
              }),
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // ----- glyph_story_clarify (PR62 / PLAN item 1.4) -------------------------
  // The Story Agent emits `needs_clarification` when its confidence on a
  // chosen field is low. This verb pins the user's answers and re-plans.
  server.registerTool(
    "glyph_story_clarify",
    {
      title: "Answer a Story Agent's clarification questions",
      description:
        "When glyph_story_plan returns { status: 'needs_clarification', questions: [...] }, send back the user's chosen answers via this verb. The server re-plans with the answers pinned and returns the updated plan.",
      inputSchema: {
        plan_id: z.string().min(1),
        answers: z
          .array(
            z.object({
              field: z.string().min(1),
              choice: z.string().min(1),
            }),
          )
          .min(1)
          .describe(
            "One answer per clarification question. `field` matches the question's `field`.",
          ),
      },
    },
    async ({ plan_id, answers }) => {
      const existing = state.stories.get(plan_id);
      if (!existing) {
        return {
          isError: true,
          content: [
            { type: "text" as const, text: `Unknown plan_id ${plan_id} — has it been planned?` },
          ],
        };
      }
      // Validate that each answer corresponds to a real clarification
      // question and the choice is in that question's options. Silently
      // accepting unknown fields would mask agent bugs (H2 from review).
      const questions = existing.clarification_questions ?? [];
      if (questions.length === 0) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Plan ${plan_id} has no clarification_questions to answer.`,
            },
          ],
        };
      }
      const questionByField = new Map(questions.map((q) => [q.field, q]));
      for (const a of answers) {
        const q = questionByField.get(a.field);
        if (!q) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `Unknown clarification field "${a.field}". Expected one of: ${questions.map((x) => x.field).join(", ")}.`,
              },
            ],
          };
        }
        if (!q.options.includes(a.choice)) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `Choice "${a.choice}" for field "${a.field}" is not in the question's options: ${q.options.join(", ")}.`,
              },
            ],
          };
        }
      }
      // Annotate the plan with the answers. The heuristic planner doesn't
      // *yet* consume them (an LLM-callback planner would) — surface that
      // honestly via `status: "clarified_but_not_yet_applied"` so callers
      // know the data is recorded but not acted upon.
      const annotated = {
        ...existing,
        clarification_answers: answers,
      };
      state.stories.set(annotated);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              jsonSafe({ plan_id, status: "clarified_but_not_yet_applied", answers }),
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // ----- glyph_whyboard_diff (PR62 / PLAN item 2.4) -------------------------
  server.registerTool(
    "glyph_whyboard_diff",
    {
      title: "Compare two Whyboards branch-by-branch",
      description:
        "Given two Whyboard JSON objects (e.g. from two agents asked the same question), return per-branch alignment: which branches agreed, which only one agent took, and where they reached conflicting conclusions on the same line of inquiry.",
      inputSchema: {
        board_a: z.unknown().describe("First Whyboard JSON, as returned by glyph_whyboard."),
        board_b: z.unknown().describe("Second Whyboard JSON, as returned by glyph_whyboard."),
      },
    },
    async ({ board_a, board_b }) => {
      // We deliberately do not Zod-validate Whyboard here — its shape is rich
      // and the helper is forgiving about extra fields. We do require root +
      // children to be present, which the diff fn enforces.
      try {
        const a = board_a as Parameters<typeof diffWhyboards>[0];
        const b = board_b as Parameters<typeof diffWhyboards>[1];
        if (!a?.root || !b?.root) throw new Error("each Whyboard needs a `root` node");
        const diff = diffWhyboards(a, b);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(jsonSafe(diff), null, 2),
            },
          ],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Invalid whyboard input: ${msg}` }],
        };
      }
    },
  );

  // ----- glyph_regression (PR65 / D3 fix-ups) -------------------------------
  // Linear OLS regression over a handle's rows. Returns slope + intercept +
  // R² + the two endpoints for plotting an overlay line. Compose via a
  // multi-layer spec: bars + a `mark: "line"` layer driven by the result.
  server.registerTool(
    "glyph_regression",
    {
      title: "Linear-regression fit over a handle's rows (D3 fix-ups, PR65)",
      description:
        "Compute an OLS linear fit (slope, intercept, R²) over the rows of an existing handle. Returns the two endpoint coordinates a `line` layer can render as an overlay. Pure-fn; deterministic.",
      inputSchema: {
        handle_id: z.string().min(1).describe("The handle whose rows to fit."),
        x: z.string().min(1).describe("Column name for the predictor (x)."),
        y: z.string().min(1).describe("Column name for the response (y)."),
      },
    },
    async ({ handle_id, x, y }) =>
      state.serial(async () => {
        const handle = state.getHandle(handle_id);
        if (!handle) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: `Unknown handle_id ${handle_id}` }],
          };
        }
        const engine = await state.getEngine();
        const result = await engine.queryHandle(handle, "");
        const fit = linearRegression(result.rows, handle.schema, x, y);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  slope: fit.slope,
                  intercept: fit.intercept,
                  r2: fit.r2,
                  n: fit.n,
                  line: fit.line(),
                },
                null,
                2,
              ),
            },
          ],
        };
      }),
  );

  // ----- glyph_causal_graph (PR64 / PLAN item 2.7) --------------------------
  server.registerTool(
    "glyph_causal_graph",
    {
      title: "Inspect the causal DAG over registered metrics",
      description:
        "Return the directed graph of `causal_of` links declared by metrics registered via glyph_metrics_register. Each edge is { from: causeName, to: effectName }. Cycles (if any) are detected and reported so consumers can render warnings on circular causal claims.",
      inputSchema: {},
    },
    async () => {
      const graph = buildCausalGraph(state.allMetrics());
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(graph, null, 2),
          },
        ],
      };
    },
  );

  // ----- glyph_audit_spec (PR63 / PLAN item 2.2) ----------------------------
  server.registerTool(
    "glyph_audit_spec",
    {
      title: "Audit a spec for common misleading-chart patterns",
      description:
        "Inspect a Glyph spec and return a sorted list of findings — truncated y-axes on bar charts, undisclosed log scales, dual-axis comparisons, excessive aggregation, diverging palettes without midpoints, etc. Pure-fn; deterministic. Returns [] when the spec passes every rule.",
      inputSchema: {
        spec: z.unknown().describe("The Glyph spec JSON to audit."),
        rowCount: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe("Optional underlying row count (drives AUDIT-04 excessive-aggregation)."),
        colorCardinality: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe("Optional distinct color count (drives AUDIT-06)."),
        // Moat 3 review BLOCKER B1: rows + yField + schema unlock the
        // render-time pass that emits AUDIT-10 (silent dropouts on
        // missing data). Without them, AUDIT-10 is unreachable from any
        // agent — the rule effectively doesn't exist. Caller supplies
        // these when they have the materialized data on hand; the
        // structural rules (AUDIT-01..09, 11) still fire either way.
        rows: z
          .array(z.array(z.unknown()))
          .optional()
          .describe(
            "Optional materialized rows (positional, aligned to `schema`). Required for AUDIT-10 (missing-data detection); structural rules work without it.",
          ),
        yField: z
          .string()
          .optional()
          .describe("Name of the y-encoded field, required when `rows` is set for AUDIT-10."),
        schema: z
          .array(z.object({ name: z.string() }).passthrough())
          .optional()
          .describe(
            "Column metadata (positional, aligned to `rows`). Required when `rows` is set so AUDIT-10 can index into row[i][yIdx].",
          ),
      },
    },
    async ({ spec, rowCount, colorCardinality, rows, yField, schema }) => {
      const parsed = safeParseSpec(spec);
      if (!parsed.ok) {
        return {
          isError: true,
          content: [
            { type: "text" as const, text: `Spec validation failed: ${parsed.error.message}` },
          ],
        };
      }
      const structural = auditSpec({
        spec: parsed.spec,
        ...(rowCount !== undefined ? { rowCount } : {}),
        ...(colorCardinality !== undefined ? { colorCardinality } : {}),
      });
      // Run the render-time pass when caller supplied data. The two
      // passes don't overlap: structural reads spec only, render-time
      // reads rows + spec.data.onMissing. Concatenated findings stay
      // sorted by severity (since both passes already sort internally
      // and severity ordering is deterministic).
      const renderTime =
        rows !== undefined && yField !== undefined && schema !== undefined
          ? renderTimeAuditFindings(
              parsed.spec,
              rows as ReadonlyArray<ReadonlyArray<unknown>>,
              yField,
              schema as ReadonlyArray<{ readonly name: string }>,
            )
          : [];
      const findings = [...structural, ...renderTime];
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                count: findings.length,
                highSeverity: findings.filter((f) => f.severity === "high").length,
                mediumSeverity: findings.filter((f) => f.severity === "medium").length,
                lowSeverity: findings.filter((f) => f.severity === "low").length,
                findings,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // ----- glyph_morph_render (PR74 / D3 Gap 3) -------------------------------
  server.registerTool(
    "glyph_morph_render",
    {
      title: "Render a smooth morph transition between two related Glyph specs",
      description:
        "Compile both specs to scenes and emit a single SVG that animates from spec_a's marks to spec_b's marks over duration_ms. v0 supports rect / circle / line marks; both ends must have the same mark count + types per index (typically the same source data with a different aggregation or stack offset). Returns SVG + new handle_id.",
      inputSchema: {
        spec_a: z.unknown().describe("The 'from' Glyph spec."),
        spec_b: z.unknown().describe("The 'to' Glyph spec."),
        duration_ms: z
          .number()
          .int()
          .min(50)
          .max(60_000)
          .optional()
          .describe("Transition duration in ms. Default 600."),
      },
    },
    async ({ spec_a, spec_b, duration_ms }) =>
      state.serial(async () => {
        const parsedA = safeParseSpec(spec_a);
        if (!parsedA.ok) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: `spec_a invalid: ${parsedA.error.message}` }],
          };
        }
        const parsedB = safeParseSpec(spec_b);
        if (!parsedB.ok) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: `spec_b invalid: ${parsedB.error.message}` }],
          };
        }
        try {
          const engine = await state.getEngine();
          // Both specs must materialize independently. Hierarchy/graph
          // specs use the synthesizer (same code path as glyph_render).
          const mA =
            parsedA.spec.data?.hierarchy || parsedA.spec.data?.graph || parsedA.spec.data?.grid
              ? synthesizeInlineDataHandle(
                  state.sessionId,
                  state.nextInlineDataCounter(),
                  parsedA.spec,
                )
              : await materializeSpec(engine, parsedA.spec, {
                  sessionId: state.sessionId,
                  resolveHandleByUri: (uri) => state.getHandleByUri(uri),
                  metricResolver: (name) => state.getMetric(name),
                });
          const mB =
            parsedB.spec.data?.hierarchy || parsedB.spec.data?.graph || parsedB.spec.data?.grid
              ? synthesizeInlineDataHandle(
                  state.sessionId,
                  state.nextInlineDataCounter(),
                  parsedB.spec,
                )
              : await materializeSpec(engine, parsedB.spec, {
                  sessionId: state.sessionId,
                  resolveHandleByUri: (uri) => state.getHandleByUri(uri),
                  metricResolver: (name) => state.getMetric(name),
                });
          const sceneA = compileSpec({
            spec: mA.effectiveSpec,
            rows: mA.result.rows,
            schema: mA.handle.schema,
          });
          const sceneB = compileSpec({
            spec: mB.effectiveSpec,
            rows: mB.result.rows,
            schema: mB.handle.schema,
          });
          const morphed = morphScenes(sceneA, sceneB, {
            ...(duration_ms !== undefined ? { duration_ms } : {}),
          });
          const svg = renderSvg(morphed);
          // Store the destination handle as the canonical one. The morph
          // is animation-only; the resting state is sceneB.
          state.storeHandle(mB.handle);
          state.storeSvg(mB.handle.id, svg);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  jsonSafe({
                    svg,
                    handle_id: mB.handle.id,
                    morphed_marks: morphed.marks.length,
                    duration_ms: (morphed.animation as { duration_ms?: number })?.duration_ms,
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
            content: [{ type: "text" as const, text: (err as Error).message ?? String(err) }],
          };
        }
      }),
  );

  // ----- glyph_seal (0.3.0) ------------------------------------------------
  // Emit the provenance seal as a standalone JSON object — without
  // requiring (or producing) an SVG. The companion to glyph_verify:
  // store the seal next to your audit log, then later prove the SVG you
  // received matches by re-computing the seal from (spec, rows, schema)
  // and comparing. Useful in pipelines where the SVG is rendered
  // downstream (e.g. by a separate worker) and the seal must travel
  // independently for compliance / audit-trail purposes.
  //
  // Pure function — same (spec, rows, schema) → byte-identical seal.
  // Same hash inputs as the seal embedded in renderSvg's output, so a
  // standalone-sealed JSON object verifies cleanly against the SVG
  // returned by glyph_render against the same inputs.
  server.registerTool(
    "glyph_seal",
    {
      title: "Compute the cryptographic provenance seal for a chart",
      description:
        "0.3.0 — emit the provenance seal for a (spec, rows, schema) tuple as JSON, without producing an SVG. Returns `{ format, specHash, dataHash, libraryVersion, rowCount, scaleDigest }` — the same block embedded in `glyph_render`'s SVG `<metadata>`. Use this when you want to store the seal alongside an audit log, sign it with an external key, or send it through a pipeline where the SVG is rendered downstream.",
      inputSchema: {
        spec: z.unknown().describe("The Glyph spec to seal."),
        rows: z
          .array(z.array(z.unknown()))
          .default([])
          .describe(
            "Positional rows matching `schema`. Pass an empty array for self-contained specs (compose, function-data, hierarchy, …) where the spec carries its own inputs.",
          ),
        schema: z
          .array(z.object({ name: z.string(), type: z.string() }))
          .default([])
          .describe(
            "Column schema (name + DuckDB type) for the rows. Empty for self-contained specs.",
          ),
      },
    },
    async ({ spec, rows, schema }) =>
      state.serial(async () => {
        const parsed = safeParseSpec(spec);
        if (!parsed.ok) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `glyph_seal: spec invalid: ${parsed.error.message}`,
              },
            ],
          };
        }
        try {
          const scene = compileSpec({ spec: parsed.spec, rows, schema });
          const prov = scene.provenance;
          if (!prov) {
            return {
              isError: true,
              content: [
                {
                  type: "text" as const,
                  text: "glyph_seal: compiler produced a scene without provenance (regression)",
                },
              ],
            };
          }
          return {
            content: [{ type: "text" as const, text: JSON.stringify(prov, null, 2) }],
          };
        } catch (err) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `glyph_seal: compile failed: ${(err as Error).message ?? String(err)}`,
              },
            ],
          };
        }
      }),
  );

  // ----- glyph_verify (Moat PR1) -------------------------------------------
  // Cryptographic provenance verification. Closes the loop on the seal
  // every renderSvg attaches: an agent passes a spec + the data it
  // believes the SVG was rendered against + the SVG itself, and gets
  // back a clear yes/no plus the list of mismatched fields when no.
  //
  // The seal is a pure-fn of (spec, rows, schema, scales,
  // libraryVersion). Re-rendering on the same inputs produces the same
  // seal. The verb extracts the embedded seal, re-renders, and diffs.
  server.registerTool(
    "glyph_verify",
    {
      title: "Verify an SVG's cryptographic provenance seal",
      description:
        "Moat PR1 — cryptographic provenance verification. Pass a Glyph `spec`, the `rows` + `schema` you believe the SVG was rendered against, and the rendered `svg` string. The server re-renders against the same inputs and compares the embedded provenance block byte-for-byte. Returns `{ valid: boolean, mismatches: Array<{ field, expected, actual }> }`. Use this to prove that a chart attached to a message was generated from the spec + data the agent thinks it was — foundational for AI-generated content trust.",
      inputSchema: {
        spec: z.unknown().describe("The Glyph spec the SVG should hash against."),
        rows: z
          .array(z.array(z.unknown()))
          .describe("Positional rows matching `schema` (parallel to glyph_render's materializer)."),
        schema: z
          .array(z.object({ name: z.string(), type: z.string() }))
          .describe("Column schema (name + DuckDB type string) for the rows."),
        svg: z.string().min(1).describe("The rendered SVG bytes to verify."),
      },
    },
    async ({ spec, rows, schema, svg }) =>
      state.serial(async () => {
        const parsed = safeParseSpec(spec);
        if (!parsed.ok) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `glyph_verify: spec invalid: ${parsed.error.message}`,
              },
            ],
          };
        }
        const embedded = extractProvenanceFromSvg(svg);
        if (!embedded) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    valid: false,
                    mismatches: [
                      {
                        field: "(missing seal)",
                        expected: "glyph-provenance/1 metadata block",
                        actual: 'no <metadata id="glyph-provenance"> element in SVG',
                      },
                    ],
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }
        try {
          const recomputed = compileSpec({
            spec: parsed.spec,
            rows,
            schema,
          }).provenance;
          if (!recomputed) {
            // Shouldn't happen — compileSpec always seals — but guard
            // anyway so a future regression surfaces here, not in a NPE.
            return {
              isError: true,
              content: [
                {
                  type: "text" as const,
                  text: "glyph_verify: compiler produced a scene without provenance (regression)",
                },
              ],
            };
          }
          const mismatches = diffProvenance(recomputed, embedded);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ valid: mismatches.length === 0, mismatches }, null, 2),
              },
            ],
          };
        } catch (err) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `glyph_verify: re-render failed: ${(err as Error).message ?? String(err)}`,
              },
            ],
          };
        }
      }),
  );

  // ----- glyph_engagement_record + _query (PR71 / PLAN 1.5) -----------------
  server.registerTool(
    "glyph_engagement_record",
    {
      title: "Record an engagement event for a handle (local-only telemetry)",
      description:
        "Append one engagement event (view / click / focus / host-defined) to the LOCAL ~/.glyph/memory.duckdb file. Never transmitted off the user's machine — there is no network path. Useful for the host UI to record what the user actually looked at, so future plans can bias toward what got engagement.",
      inputSchema: {
        handle_id: z.string().min(1).describe("The handle the event pertains to."),
        kind: z
          .string()
          .min(1)
          .describe(
            "Event kind. v0 conventions: 'view', 'click', 'focus'. Hosts may define their own.",
          ),
        value: z
          .number()
          .optional()
          .describe("Optional numeric value (e.g. focus duration in ms). Stored as DOUBLE."),
        detail: z
          .string()
          .optional()
          .describe("Optional free-form detail (e.g. a clicked-row key)."),
      },
    },
    async ({ handle_id, kind, value, detail }) =>
      state.serial(async () => {
        const engine = await state.getEngine();
        const id = randomActionId();
        await state.memory.recordEngagement(engine, {
          id,
          handleId: handle_id,
          kind,
          ...(value !== undefined ? { value } : {}),
          ...(detail !== undefined ? { detail } : {}),
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ recorded: true, id, handle_id, kind }, null, 2),
            },
          ],
        };
      }),
  );

  server.registerTool(
    "glyph_engagement_query",
    {
      title: "Query local engagement signals",
      description:
        "Read engagement events from the local ~/.glyph/memory.duckdb file. Supports filtering by handle_id, by kind, or aggregating per-handle counts. Always local — no network surface.\n\nRow limit defaults to 200 and caps at 10_000. The cap is intentionally larger than the audit log's 500 because engagement events fire on every user gesture and accumulate ~10× faster; serializing 10_000 rows as JSON stays under typical MCP message limits (~1 MB).",
      inputSchema: {
        handle_id: z
          .string()
          .optional()
          .describe(
            "Filter to events for this handle. Omit to query all handles. Ignored when aggregate=true (use the result's per-handle rows instead).",
          ),
        kind: z
          .string()
          .optional()
          .describe(
            "Filter to events of this kind ('view' | 'click' | 'focus' | ...). Ignored when aggregate=true.",
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(10_000)
          .optional()
          .describe("Cap on returned rows. Default 200, max 10_000."),
        aggregate: z
          .boolean()
          .optional()
          .describe(
            "When true, return one row per handle with view/click counts + total focus ms. When false (default), return individual events.",
          ),
      },
    },
    async ({ handle_id, kind, limit, aggregate }) =>
      state.serial(async () => {
        const engine = await state.getEngine();
        if (aggregate) {
          // Reject filters under aggregate=true rather than silently dropping
          // them — would otherwise look like the filter applied when it didn't
          // (PR71 review nit).
          if (handle_id !== undefined || kind !== undefined || limit !== undefined) {
            return {
              isError: true,
              content: [
                {
                  type: "text" as const,
                  text: "glyph_engagement_query: aggregate=true does not support handle_id / kind / limit filters yet. Drop those args, or set aggregate=false to use them.",
                },
              ],
            };
          }
          const rows = await state.memory.aggregateEngagement(engine);
          return {
            content: [
              { type: "text" as const, text: JSON.stringify({ aggregate: true, rows }, null, 2) },
            ],
          };
        }
        const rows = await state.memory.listEngagement(engine, {
          ...(handle_id !== undefined ? { handleId: handle_id } : {}),
          ...(kind !== undefined ? { kind } : {}),
          ...(limit !== undefined ? { limit } : {}),
        });
        return {
          content: [
            { type: "text" as const, text: JSON.stringify({ count: rows.length, rows }, null, 2) },
          ],
        };
      }),
  );

  // ----- glyph_macro_replay (PR70 / PLAN item 2.5) --------------------------
  server.registerTool(
    "glyph_macro_replay",
    {
      title: "Replay a captured macro against new data",
      description:
        "Walk a Macro JSON document's steps in order, substituting `{{params.X}}` placeholders in each step's args with the provided params. Each step dispatches to its corresponding internal verb. Returns a per-step result array.\n\nv0 supports verbs: glyph_render, glyph_describe, glyph_query. Mutating verbs (memory_save, metrics_register, act) are intentionally excluded — their side effects shouldn't auto-replay.\n\nMacros are author-supplied JSON; future work: glyph_macro_capture to assemble them from the audit log.",
      inputSchema: {
        macro: z
          .unknown()
          .describe("Macro JSON: { name, version: 1, steps: [{ verb, args, note? }, ...] }"),
        params: z
          .record(z.unknown())
          .optional()
          .describe(
            "Optional substitution params. A step's arg containing exactly the string `{{params.foo}}` will be replaced with `params.foo`. Embedded placeholders inside larger strings are NOT expanded (avoids SQL/path footguns).",
          ),
      },
    },
    async ({ macro, params }) =>
      state.serial(async () => {
        const err = validateMacro(macro);
        if (err) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: `Invalid macro: ${err}` }],
          };
        }
        const m = macro as Macro;
        const ps = (params ?? {}) as Record<string, unknown>;
        // Pre-flight: every referenced param must be supplied.
        const referenced = collectMacroParams(m);
        const missing = referenced.filter((p) => !(p in ps));
        if (missing.length > 0) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `Macro references params not supplied: ${missing.join(", ")}. Pass them in the \`params\` arg.`,
              },
            ],
          };
        }

        const stepResults: MacroReplayStepResult[] = [];
        let completed = 0;
        for (let i = 0; i < m.steps.length; i++) {
          const step = m.steps[i];
          if (!step) continue;
          // The pre-flight check above guarantees every referenced param
          // is supplied, so substituteParams cannot throw here. No need
          // for a try/catch (review nit on PR70).
          const resolved = substituteParams(step.args, ps) as Record<string, unknown>;
          try {
            let result: unknown;
            switch (step.verb) {
              case "glyph_render":
                result = await runRenderInternal(resolved.spec);
                break;
              case "glyph_describe":
                if (typeof resolved.source !== "string") {
                  throw new Error("glyph_describe requires args.source: string");
                }
                result = await runDescribeInternal(resolved.source);
                break;
              case "glyph_query":
                if (typeof resolved.handle_id !== "string") {
                  throw new Error("glyph_query requires args.handle_id: string");
                }
                result = await runQueryInternal(
                  resolved.handle_id,
                  typeof resolved.where === "string" ? resolved.where : undefined,
                  typeof resolved.limit_rows === "number" ? resolved.limit_rows : undefined,
                );
                break;
              default:
                throw new Error(
                  `Macro replay does not support verb "${step.verb}" yet. Allowed in v0: glyph_render, glyph_describe, glyph_query.`,
                );
            }
            stepResults.push({ step_index: i, verb: step.verb, ok: true, result });
            completed += 1;
          } catch (stepErr) {
            stepResults.push({
              step_index: i,
              verb: step.verb,
              ok: false,
              error: (stepErr as Error).message ?? String(stepErr),
            });
            // Fail-fast: subsequent steps may depend on this one (especially
            // glyph_query on a handle produced by an upstream glyph_render).
            break;
          }
        }
        const allOk = completed === m.steps.length;
        return {
          ...(allOk ? {} : { isError: true }),
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  name: m.name,
                  total_steps: m.steps.length,
                  completed_steps: completed,
                  steps: stepResults,
                },
                null,
                2,
              ),
            },
          ],
        };
      }),
  );

  // ----- glyph_story (Joy of Math PR E5) -----------------------------------
  // The bar-raiser endpoint. Takes natural-language intent (e.g. "show me a
  // sine wave for an 8-year-old") and returns a multi-scene Glyph spec
  // ready to render — composed via a deterministic recipe registry, no LLM
  // in the loop. Resolves to:
  //   - spec: Glyph spec embedding M4 BrandKit (E4 preset), E1 annotations,
  //     E2 traveler, E3 timeline animation
  //   - explanation: M2 structured Explanation envelope
  //   - caption_sequence: flat scene→text→at_ms array the UI can subscribe to
  //
  // Unrecognized intents return an empty spec + an Explanation whose
  // suggestedFollowups list the available recipes verbatim, so an agent
  // (or a kid) can pick the next prompt without guessing.
  //
  // No new top-level deps; no LLM; same `(intent, audience, theme,
  // duration_ms)` → same bytes. Recipe set: sine, cosine, circle, parabola,
  // vector field (and growing — adding a recipe is one object literal in
  // `packages/core/src/story/compose.ts`).
  server.registerTool(
    "glyph_story",
    {
      title: "Compose a kid-persona math story from natural-language intent",
      description:
        'Compose a multi-scene Glyph spec from a natural-language intent. Recipe-driven (no LLM call); same inputs → same JSON. Pass `intent` (e.g. "show me a sine wave"); the composer returns `{ spec, explanation, caption_sequence }`. Render the spec via glyph_render; subscribe to caption_sequence to drive any UI text overlay; use explanation.suggestedFollowups to chain to a follow-up prompt. When the intent does not match a known recipe the result is an empty spec + an explanation listing the available recipes. Recipes today: sine, cosine, circle, parabola, vector field.',
      inputSchema: {
        intent: z
          .string()
          .min(1)
          .max(512)
          .describe(
            'Natural-language phrase. "show me a sine wave", "draw a circle and explain pi", "what is a parabola".',
          ),
        audience: z
          .enum(["kid", "high-school", "adult"])
          .optional()
          .describe(
            "Reader persona. Default 'kid' — playground theme, larger fonts, simpler captions. 'high-school' uses the light theme with mathematical captions; 'adult' is minimal text.",
          ),
        theme: z
          .enum(["light", "dark", "playground", "3b1b"])
          .optional()
          .describe(
            "BrandKit preset. Defaults: 'playground' for kid audiences, 'light' otherwise.",
          ),
        duration_ms: z
          .number()
          .int()
          .positive()
          .max(60_000)
          .optional()
          .describe("Total animation duration in ms. Default 8000."),
      },
    },
    async ({ intent, audience, theme, duration_ms }) =>
      state.serial(async () => {
        const result = composeStory({
          intent,
          ...(audience !== undefined ? { audience } : {}),
          ...(theme !== undefined ? { theme } : {}),
          ...(duration_ms !== undefined ? { duration_ms } : {}),
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  spec: result.spec,
                  explanation: result.explanation,
                  caption_sequence: result.caption_sequence,
                },
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
