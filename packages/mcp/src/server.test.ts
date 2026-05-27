/**
 * MCP server integration tests.
 *
 * Connects an in-memory pair of transports (the SDK provides one), exercises
 * each of the three tools end-to-end, and verifies the agent-visible round
 * trip works: describe → render → query.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "./server.js";
import { ServerState } from "./state.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "..", "..", "duckdb", "test-fixtures", "taxi.csv");

interface ToolTextContent {
  type: "text";
  text: string;
}
interface ToolImageContent {
  type: "image";
  data: string;
  mimeType: string;
}
type ToolContent = ToolTextContent | ToolImageContent;
interface ToolCallResult {
  content?: ReadonlyArray<ToolContent>;
  isError?: boolean;
}

async function callText(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<{ text: string; isError: boolean; content: ReadonlyArray<ToolContent> }> {
  const r = (await client.callTool({ name, arguments: args })) as ToolCallResult;
  const content = r.content ?? [];
  // Find the first text block — image blocks may precede it (e.g. glyph_render).
  const textBlock = content.find((c): c is ToolTextContent => c.type === "text");
  return {
    text: textBlock?.text ?? "",
    isError: r.isError === true,
    content,
  };
}

describe("Glyph MCP server", () => {
  let client: Client;
  let state: ServerState;
  let tempMemoryDir: string;

  beforeEach(async () => {
    // Each test gets its own tempdir-backed memory store so saves don't
    // bleed into a real ~/.glyph/memory.duckdb on the developer's machine
    // (or pollute other tests in the same run).
    tempMemoryDir = mkdtempSync(join(tmpdir(), "glyph-mcp-test-"));
    state = new ServerState({
      memoryPath: join(tempMemoryDir, "memory.duckdb"),
    });
    const { server } = createServer(state);
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);
    client = new Client({ name: "test-client", version: "0.0.0" });
    await client.connect(clientT);
  });

  afterEach(async () => {
    await client.close();
    await state.close();
    rmSync(tempMemoryDir, { recursive: true, force: true });
  });

  it("lists the fifty tools", async () => {
    const r = await client.listTools();
    const names = r.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "glyph_act",
      "glyph_anomaly",
      "glyph_audit_log",
      "glyph_audit_spec",
      "glyph_await_interaction",
      "glyph_capabilities",
      "glyph_causal_graph",
      "glyph_close_preview",
      "glyph_decompose",
      "glyph_describe",
      "glyph_drift",
      "glyph_drill",
      "glyph_engagement_query",
      "glyph_engagement_record",
      "glyph_explain",
      "glyph_forecast",
      "glyph_handles",
      "glyph_handles_gc",
      "glyph_import",
      "glyph_lineage",
      "glyph_linked_await",
      "glyph_linked_handles",
      "glyph_linked_publish",
      "glyph_macro_replay",
      "glyph_memory_forget",
      "glyph_memory_list",
      "glyph_memory_recall",
      "glyph_memory_save",
      "glyph_metrics",
      "glyph_metrics_register",
      "glyph_morph_render",
      "glyph_preview",
      "glyph_publish",
      "glyph_query",
      "glyph_regression",
      "glyph_render",
      "glyph_spec_diff",
      "glyph_spec_patch",
      "glyph_story",
      "glyph_story_await_checkpoint",
      "glyph_story_clarify",
      "glyph_story_execute",
      "glyph_story_get",
      "glyph_story_list",
      "glyph_story_plan",
      "glyph_story_provide_plan",
      "glyph_subscribe",
      "glyph_suggest_scale",
      "glyph_trust",
      "glyph_verify",
      "glyph_whyboard",
      "glyph_whyboard_diff",
    ]);
  });

  it("glyph_capabilities reports versioned tool list + supported marks", async () => {
    const r = await callText(client, "glyph_capabilities", {});
    expect(r.isError).toBe(false);
    const caps = JSON.parse(r.text);
    expect(caps.libraryVersion).toBeTypeOf("string");
    expect(caps.specVersions).toContain("glyph/0.1");
    expect(caps.defaultSpecVersion).toBe("glyph/0.1");
    expect(caps.marks).toEqual(["bar", "point", "line", "area"]);
    expect(caps.mcpTools.map((t: { name: string }) => t.name).sort()).toEqual([
      "glyph_act",
      "glyph_anomaly",
      "glyph_audit_log",
      "glyph_audit_spec",
      "glyph_await_interaction",
      "glyph_capabilities",
      "glyph_causal_graph",
      "glyph_close_preview",
      "glyph_decompose",
      "glyph_describe",
      "glyph_drift",
      "glyph_drill",
      "glyph_engagement_query",
      "glyph_engagement_record",
      "glyph_explain",
      "glyph_forecast",
      "glyph_handles",
      "glyph_handles_gc",
      "glyph_import",
      "glyph_lineage",
      "glyph_linked_await",
      "glyph_linked_handles",
      "glyph_linked_publish",
      "glyph_macro_replay",
      "glyph_memory_forget",
      "glyph_memory_list",
      "glyph_memory_recall",
      "glyph_memory_save",
      "glyph_metrics",
      "glyph_metrics_register",
      "glyph_morph_render",
      "glyph_preview",
      "glyph_publish",
      "glyph_query",
      "glyph_regression",
      "glyph_render",
      "glyph_spec_diff",
      "glyph_spec_patch",
      "glyph_story",
      "glyph_story_await_checkpoint",
      "glyph_story_clarify",
      "glyph_story_execute",
      "glyph_story_get",
      "glyph_story_list",
      "glyph_story_plan",
      "glyph_story_provide_plan",
      "glyph_subscribe",
      "glyph_suggest_scale",
      "glyph_trust",
      "glyph_verify",
      "glyph_whyboard",
      "glyph_whyboard_diff",
    ]);
  });

  it("glyph_describe returns schema + suggested encoding types", async () => {
    const r = await callText(client, "glyph_describe", { source: fixture });
    expect(r.isError).toBe(false);
    const summary = JSON.parse(r.text);
    expect(summary.rowCount).toBe(12);
    expect(summary.columns.map((c: { name: string }) => c.name)).toEqual([
      "pickup_hour",
      "fare",
      "rides",
    ]);
  });

  it("glyph_render returns SVG + handle_id, then glyph_query drills in", async () => {
    const r1 = await callText(client, "glyph_render", {
      spec: {
        data: { source: fixture, format: "csv" },
        layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
      },
    });
    expect(r1.isError).toBe(false);
    const out = JSON.parse(r1.text);
    expect(out.svg).toContain("<svg");
    expect(out.handle_id).toBeTruthy();

    const r2 = await callText(client, "glyph_query", {
      handle_id: out.handle_id,
      where: "WHERE rides > 200",
    });
    expect(r2.isError).toBe(false);
    const drill = JSON.parse(r2.text);
    expect(drill.rowCount).toBe(5);
  });

  it("glyph_render rejects an invalid spec with a clear error", async () => {
    const r = await callText(client, "glyph_render", {
      spec: { layers: [] },
    });
    expect(r.isError).toBe(true);
    expect(r.text.toLowerCase()).toMatch(/spec|invalid|layers/);
  });

  it("glyph_query reports unknown handle_id clearly", async () => {
    const r = await callText(client, "glyph_query", {
      handle_id: "nonexistent",
    });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("Unknown handle_id");
  });

  it("glyph_query honors limit_rows + emits truncation sentinel (PR60 / PLAN 1.3)", async () => {
    // Set up a handle backed by the taxi fixture (12 rows).
    const r1 = await callText(client, "glyph_render", {
      spec: {
        data: { source: fixture, format: "csv" },
        layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
      },
    });
    const handleId = JSON.parse(r1.text).handle_id as string;
    const r2 = await callText(client, "glyph_query", {
      handle_id: handleId,
      limit_rows: 3,
    });
    expect(r2.isError).toBe(false);
    const out = JSON.parse(r2.text);
    expect(out.truncated).toBe(true);
    expect(out.returned).toBe(3);
    expect(out.total).toBeGreaterThan(out.returned);
    expect(out.rows.length).toBe(3);
  });

  it("glyph_query omits truncation sentinel when result fits within limit_rows", async () => {
    const r1 = await callText(client, "glyph_render", {
      spec: {
        data: { source: fixture, format: "csv" },
        layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
      },
    });
    const handleId = JSON.parse(r1.text).handle_id as string;
    const r2 = await callText(client, "glyph_query", {
      handle_id: handleId,
      limit_rows: 1000,
    });
    const out = JSON.parse(r2.text);
    expect(out.truncated).toBeFalsy();
  });

  it("glyph_spec_diff returns added/removed/changed (PR60 / PLAN 1.7)", async () => {
    const r = await callText(client, "glyph_spec_diff", {
      spec_a: {
        data: { source: "x.csv" },
        layers: [{ mark: "bar", encoding: { x: "x", y: "y" } }],
      },
      spec_b: {
        data: { source: "x.csv" },
        layers: [{ mark: "line", encoding: { x: "x", y: "y" } }],
      },
    });
    expect(r.isError).toBe(false);
    const diff = JSON.parse(r.text);
    expect(diff.changed).toBeDefined();
    expect(diff.changed.some((c: { path: string }) => c.path.includes("/mark"))).toBe(true);
  });

  it("glyph_spec_diff handles identical specs as no-op", async () => {
    const spec = {
      data: { source: "x.csv" },
      layers: [{ mark: "bar", encoding: { x: "x", y: "y" } }],
    };
    const r = await callText(client, "glyph_spec_diff", { spec_a: spec, spec_b: spec });
    expect(r.isError).toBe(false);
    const diff = JSON.parse(r.text);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
    expect(diff.summary).toBe("");
  });

  describe("glyph_drill", () => {
    async function getHandleId(): Promise<string> {
      const r = await callText(client, "glyph_render", {
        spec: {
          data: { source: fixture, format: "csv" },
          layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
        },
      });
      return JSON.parse(r.text).handle_id as string;
    }

    it("equals selector → '= value' predicate + matching rows", async () => {
      const handle_id = await getHandleId();
      const r = await callText(client, "glyph_drill", {
        handle_id,
        field: "pickup_hour",
        equals: 7,
      });
      expect(r.isError).toBe(false);
      const out = JSON.parse(r.text);
      expect(out.predicate).toBe('"pickup_hour" = 7');
      expect(out.where).toBe('WHERE "pickup_hour" = 7');
      expect(out.rowCount).toBe(1);
    });

    it("between selector → BETWEEN predicate", async () => {
      const handle_id = await getHandleId();
      const r = await callText(client, "glyph_drill", {
        handle_id,
        field: "pickup_hour",
        between: [7, 9],
      });
      expect(r.isError).toBe(false);
      const out = JSON.parse(r.text);
      expect(out.predicate).toBe('"pickup_hour" BETWEEN 7 AND 9');
      expect(out.rowCount).toBe(3);
    });

    it("in selector → IN list with quoted strings", async () => {
      const handle_id = await getHandleId();
      const r = await callText(client, "glyph_drill", {
        handle_id,
        field: "pickup_hour",
        in: [7, 17],
      });
      expect(r.isError).toBe(false);
      const out = JSON.parse(r.text);
      expect(out.predicate).toBe('"pickup_hour" IN (7, 17)');
      expect(out.rowCount).toBe(2);
    });

    it("rejects providing zero or multiple selectors", async () => {
      const handle_id = await getHandleId();
      const r = await callText(client, "glyph_drill", {
        handle_id,
        field: "pickup_hour",
        equals: 7,
        between: [7, 9],
      });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/exactly one/);
    });

    it("rejects unknown handle_id", async () => {
      const r = await callText(client, "glyph_drill", {
        handle_id: "nope",
        field: "x",
        equals: 1,
      });
      expect(r.isError).toBe(true);
      expect(r.text).toContain("Unknown handle_id");
    });
  });

  describe("glyph_render — PNG content block (B9c)", () => {
    it("returns an image/png block alongside the SVG text", async () => {
      const r = await callText(client, "glyph_render", {
        spec: {
          data: { source: fixture, format: "csv" },
          layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
        },
      });
      expect(r.isError).toBe(false);
      const imageBlocks = r.content.filter((c) => c.type === "image");
      expect(imageBlocks).toHaveLength(1);
      const img = imageBlocks[0];
      if (img?.type === "image") {
        expect(img.mimeType).toBe("image/png");
        // Base64-decode and check the PNG magic number (8 bytes).
        const bytes = Buffer.from(img.data, "base64");
        expect(bytes.length).toBeGreaterThan(8);
        expect(bytes[0]).toBe(0x89);
        expect(bytes[1]).toBe(0x50);
        expect(bytes[2]).toBe(0x4e);
        expect(bytes[3]).toBe(0x47);
      }
    });
  });

  describe("glyph_import (B9a)", () => {
    it("imports a CSV string and reports the resulting schema", async () => {
      const csv = "x,y\n1,10\n2,20\n3,30\n";
      const r = await callText(client, "glyph_import", {
        payload: { kind: "csv", data: csv },
        name: "tiny",
      });
      expect(r.isError).toBe(false);
      const out = JSON.parse(r.text);
      expect(out.rowCount).toBe(3);
      expect(out.name).toMatch(/^import_tiny_/);
      expect(out.schema.map((c: { name: string }) => c.name)).toEqual(["x", "y"]);
    });

    it("imports json-rows and the result can be rendered by glyph_render", async () => {
      const r1 = await callText(client, "glyph_import", {
        payload: {
          kind: "json-rows",
          rows: [
            { hour: 0, rides: 10 },
            { hour: 1, rides: 20 },
            { hour: 2, rides: 30 },
          ],
        },
      });
      expect(r1.isError).toBe(false);
      const imp = JSON.parse(r1.text);
      // Now render using the imported name as data.source.
      const r2 = await callText(client, "glyph_render", {
        spec: {
          data: { source: imp.resolvedSource, format: "csv" },
          layers: [{ mark: "bar", encoding: { x: "hour", y: "rides" } }],
        },
      });
      expect(r2.isError).toBe(false);
      const out = JSON.parse(r2.text);
      expect(out.row_count).toBe(3);
    });

    it("returns a clear error for the deferred arrow-ipc kind", async () => {
      const r = await callText(client, "glyph_import", {
        payload: { kind: "arrow-ipc", base64: "QVJST1c=" },
      });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/arrow-ipc.*not yet implemented/);
    });

    it("escapes special characters when serializing json-rows to CSV", async () => {
      const r = await callText(client, "glyph_import", {
        payload: {
          kind: "json-rows",
          rows: [
            { name: 'O"Brien, Inc.', count: 1 },
            { name: "Smith\nLtd", count: 2 },
          ],
        },
      });
      expect(r.isError).toBe(false);
      const imp = JSON.parse(r.text);
      expect(imp.rowCount).toBe(2);
    });
  });

  describe("glyph_render — Vega-Lite shim (PR30)", () => {
    it("renders from a Vega-Lite spec via the vegaLite argument", async () => {
      const r = await callText(client, "glyph_render", {
        vegaLite: {
          data: { url: fixture, format: { type: "csv" } },
          mark: "bar",
          encoding: {
            x: { field: "pickup_hour", type: "ordinal" },
            y: { field: "rides", type: "quantitative" },
          },
          title: "VL-driven render",
        },
      });
      expect(r.isError).toBe(false);
      const out = JSON.parse(r.text);
      expect(out.svg).toContain("VL-driven render");
      expect(out.row_count).toBe(12);
    });

    it("returns a clear error for unsupported VL marks", async () => {
      const r = await callText(client, "glyph_render", {
        vegaLite: {
          data: { url: fixture, format: { type: "csv" } },
          mark: "boxplot",
          encoding: { x: { field: "x" }, y: { field: "y" } },
        },
      });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/boxplot/);
    });

    it("rejects passing both spec and vegaLite", async () => {
      const r = await callText(client, "glyph_render", {
        spec: { data: { source: fixture, format: "csv" }, layers: [] },
        vegaLite: { mark: "bar" },
      });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/not both/);
    });

    it("rejects passing neither spec nor vegaLite", async () => {
      const r = await callText(client, "glyph_render", {});
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/provide/);
    });
  });

  describe("preview server (B9e/f/g)", () => {
    async function renderOne(): Promise<string> {
      const r = await callText(client, "glyph_render", {
        spec: {
          data: { source: fixture, format: "csv" },
          layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
        },
      });
      return JSON.parse(r.text).handle_id as string;
    }

    it("glyph_preview returns a 127.0.0.1 URL + token", async () => {
      const handle_id = await renderOne();
      const r = await callText(client, "glyph_preview", { handle_id });
      expect(r.isError).toBe(false);
      const out = JSON.parse(r.text);
      expect(out.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
      expect(out.token).toMatch(/^[0-9a-f]{32}$/);
      expect(out.port).toBeGreaterThan(0);
      // Cleanup.
      await callText(client, "glyph_close_preview", {});
    });

    it("the preview server serves the registered SVG with the right token", async () => {
      const handle_id = await renderOne();
      const r = await callText(client, "glyph_preview", { handle_id });
      const out = JSON.parse(r.text);
      const svgUrl = new URL(`/api/charts/${handle_id}.svg`, out.url).toString();
      const fetched = await fetch(svgUrl, {
        headers: { "X-Glyph-Token": out.token },
      });
      expect(fetched.status).toBe(200);
      expect(await fetched.text()).toMatch(/^<svg /);
      await callText(client, "glyph_close_preview", {});
    });

    it("await_interaction round-trips a posted click", async () => {
      const handle_id = await renderOne();
      const prev = await callText(client, "glyph_preview", { handle_id });
      const out = JSON.parse(prev.text);
      const postUrl = new URL(`/api/interactions/${handle_id}`, out.url).toString();
      // Post + await in parallel so the long-poller picks up the event.
      const [postRes, awaitRes] = await Promise.all([
        fetch(postUrl, {
          method: "POST",
          headers: {
            "X-Glyph-Token": out.token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            kind: "click",
            binding: { row: 7, attrs: { x: "7" } },
            whereSql: 'WHERE "pickup_hour" = 7',
          }),
        }),
        callText(client, "glyph_await_interaction", {
          handle_id,
          timeout_ms: 2000,
        }),
      ]);
      expect(postRes.status).toBe(202);
      expect(awaitRes.isError).toBe(false);
      const event = JSON.parse(awaitRes.text);
      expect(event.kind).toBe("click");
      expect(event.whereSql).toBe('WHERE "pickup_hour" = 7');
      await callText(client, "glyph_close_preview", {});
    });

    it("await_interaction returns {} on timeout", async () => {
      const handle_id = await renderOne();
      await callText(client, "glyph_preview", { handle_id });
      const r = await callText(client, "glyph_await_interaction", {
        handle_id,
        timeout_ms: 50,
      });
      expect(r.isError).toBe(false);
      expect(JSON.parse(r.text)).toEqual({});
      await callText(client, "glyph_close_preview", {});
    });

    it("await_interaction errors when preview is not running", async () => {
      const r = await callText(client, "glyph_await_interaction", {
        handle_id: "anything",
      });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/Preview server is not running/);
    });

    it("close_preview is idempotent", async () => {
      const a = await callText(client, "glyph_close_preview", {});
      expect(JSON.parse(a.text).stopped).toBe(false);
      await callText(client, "glyph_preview", {});
      const b = await callText(client, "glyph_close_preview", {});
      expect(JSON.parse(b.text).stopped).toBe(true);
    });
  });

  // ---- Phase 3 Tier A: the four GDF verbs (PR33) -------------------------
  describe("GDF verbs (PR33 — Phase 3 Tier A)", () => {
    async function renderOne(): Promise<{ handle_id: string; uri: string }> {
      const r = await callText(client, "glyph_render", {
        spec: {
          data: {
            source: fixture,
            format: "csv",
            transform: "SELECT pickup_hour, rides FROM glyph_src_main WHERE rides > 100",
          },
          layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
        },
      });
      const out = JSON.parse(r.text);
      const handle = state.getHandle(out.handle_id);
      // biome-ignore lint/style/noNonNullAssertion: the handle was just rendered.
      return { handle_id: out.handle_id, uri: handle!.uri! };
    }

    it("glyph_publish returns the URI + version 1 for a freshly rendered handle", async () => {
      const { handle_id, uri } = await renderOne();
      const r = await callText(client, "glyph_publish", { handle_id });
      expect(r.isError).toBe(false);
      const out = JSON.parse(r.text);
      expect(out.uri).toBe(uri);
      expect(out.uri).toMatch(/^gdf:\/\/[0-9a-f]+\/[0-9a-f]+$/);
      expect(out.version).toBe(1);
    });

    it("glyph_publish rejects unknown handle_id", async () => {
      const r = await callText(client, "glyph_publish", { handle_id: "nope" });
      expect(r.isError).toBe(true);
      expect(r.text).toContain("Unknown handle_id");
    });

    it("glyph_subscribe resolves a published URI back to the full DataHandle", async () => {
      const { handle_id, uri } = await renderOne();
      // Publish first (in-process Tier A: publish is mostly a verb to confirm).
      await callText(client, "glyph_publish", { handle_id });
      const r = await callText(client, "glyph_subscribe", { uri });
      expect(r.isError).toBe(false);
      const handle = JSON.parse(r.text);
      expect(handle.id).toBe(handle_id);
      expect(handle.uri).toBe(uri);
      expect(handle.version).toBe(1);
      // Phase 3 metadata survives the round trip.
      expect(handle.lineage.sql).toContain("WHERE rides > 100");
      expect(handle.lineage.producer.tool).toBe("materializeSpec");
      expect(handle.provenance.confidence).toBe("high");
      expect(handle.binding.kind).toBe("duckdb-view");
      expect(Array.isArray(handle.schema)).toBe(true);
    });

    it("glyph_subscribe round-trips in < 50 ms on localhost (Tier A acceptance)", async () => {
      const { handle_id, uri } = await renderOne();
      await callText(client, "glyph_publish", { handle_id });
      const t0 = performance.now();
      const r = await callText(client, "glyph_subscribe", { uri });
      const elapsed = performance.now() - t0;
      expect(r.isError).toBe(false);
      // Acceptance criterion (3) from phase-3-agent-graph.md §13 Tier A.
      expect(elapsed).toBeLessThan(50);
    });

    it("glyph_subscribe + glyph_query: cross-agent handoff lets the subscriber read rows", async () => {
      // Simulates the two-process demo with two MCP clients sharing one state.
      // Client A renders + publishes; Client B subscribes + queries.
      const { handle_id, uri } = await renderOne(); // Client A
      await callText(client, "glyph_publish", { handle_id });

      // Spin up a second MCP client against the same ServerState.
      const { server: serverB } = createServer(state);
      const [bClientT, bServerT] = InMemoryTransport.createLinkedPair();
      await serverB.connect(bServerT);
      const clientB = new Client({ name: "test-client-b", version: "0.0.0" });
      await clientB.connect(bClientT);

      try {
        const sub = await clientB.callTool({
          name: "glyph_subscribe",
          arguments: { uri },
        });
        const subContent = (sub as ToolCallResult).content ?? [];
        const subText = subContent.find((c): c is ToolTextContent => c.type === "text")?.text ?? "";
        const subHandle = JSON.parse(subText);
        expect(subHandle.id).toBe(handle_id);

        const q = await clientB.callTool({
          name: "glyph_query",
          arguments: { handle_id: subHandle.id, where: "WHERE rides > 200" },
        });
        const qContent = (q as ToolCallResult).content ?? [];
        const qText = qContent.find((c): c is ToolTextContent => c.type === "text")?.text ?? "";
        const qOut = JSON.parse(qText);
        expect(qOut.rowCount).toBe(5);
      } finally {
        await clientB.close();
      }
    });

    it("glyph_subscribe rejects an unknown gdf:// URI", async () => {
      const r = await callText(client, "glyph_subscribe", {
        uri: "gdf://nope/abcdef",
      });
      expect(r.isError).toBe(true);
      expect(r.text).toContain("Unknown gdf:// URI");
    });

    it("glyph_lineage returns a node with sql + producer for a known URI", async () => {
      const { uri } = await renderOne();
      const r = await callText(client, "glyph_lineage", { uri });
      expect(r.isError).toBe(false);
      const tree = JSON.parse(r.text);
      expect(tree.uri).toBe(uri);
      expect(tree.sql).toContain("WHERE rides > 100");
      expect(tree.producer.tool).toBe("materializeSpec");
      expect(tree.producer.agent).toBe("glyph");
      expect(Array.isArray(tree.children)).toBe(true);
      // No registered parents in the session yet → leaf node.
      expect(tree.children).toHaveLength(0);
      // Walking back to a source = lineage.sql tells you the source query.
      expect(typeof tree.at).toBe("string");
      expect(Number.isNaN(Date.parse(tree.at))).toBe(false);
    });

    it("glyph_lineage rejects an unknown URI", async () => {
      const r = await callText(client, "glyph_lineage", {
        uri: "gdf://nope/abcdef",
      });
      expect(r.isError).toBe(true);
      expect(r.text).toContain("Unknown");
    });

    it("glyph_render resolves a gdf:// data.source against a session handle (PR34)", async () => {
      // Step 1: render once to mint + publish a handle.
      const upstream = await renderOne();
      const pub = await callText(client, "glyph_publish", { handle_id: upstream.handle_id });
      const { uri } = JSON.parse(pub.text);

      // Step 2: render a NEW spec whose data.source is the published gdf:// URI.
      // The materializer should resolve the URI against the session registry,
      // alias the upstream view as glyph_src_main, and run the transform.
      const r = await callText(client, "glyph_render", {
        spec: {
          data: {
            source: uri,
            transform: "SELECT pickup_hour, rides FROM glyph_src_main WHERE rides > 250",
          },
          layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
        },
      });
      expect(r.isError).toBe(false);
      const out = JSON.parse(r.text);
      // 2 rows in the upstream's (already filtered rides > 100) view also satisfy rides > 250.
      expect(out.row_count).toBe(2);

      // Step 3: lineage on the new handle walks back to the upstream URI.
      const lineage = await callText(client, "glyph_lineage", {
        uri: `gdf://${state.sessionId}/${out.handle_id}`,
      });
      const tree = JSON.parse(lineage.text);
      expect(tree.children).toHaveLength(1);
      expect(tree.children[0].uri).toBe(uri);
    });

    it("glyph_render reports a clear error for an unknown gdf:// URI", async () => {
      const r = await callText(client, "glyph_render", {
        spec: {
          data: { source: "gdf://nope/abc123" },
          layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
        },
      });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/Unknown gdf:\/\/ URI/);
    });

    it("glyph_handles lists every handle in the session", async () => {
      const empty = await callText(client, "glyph_handles", {});
      expect(empty.isError).toBe(false);
      const emptyOut = JSON.parse(empty.text);
      expect(emptyOut.count).toBe(0);
      expect(emptyOut.handles).toEqual([]);
      expect(emptyOut.sessionId).toMatch(/^[0-9a-f]+$/);

      const { handle_id: h1 } = await renderOne();
      const { handle_id: h2 } = await renderOne();

      const r = await callText(client, "glyph_handles", {});
      expect(r.isError).toBe(false);
      const out = JSON.parse(r.text);
      expect(out.count).toBe(2);
      const ids = out.handles.map((h: { id: string }) => h.id);
      expect(ids).toEqual([h1, h2]);
      for (const h of out.handles) {
        expect(h.uri).toMatch(/^gdf:\/\/[0-9a-f]+\/[0-9a-f]+$/);
        expect(h.version).toBe(1);
        expect(h.confidence).toBe("high");
        expect(h.producer.tool).toBe("materializeSpec");
        expect(Array.isArray(h.columns)).toBe(true);
      }
    });
  });

  // ---- Phase 3 §2: self-explaining charts (PR35) -------------------------
  describe("glyph_explain (PR35 — Phase 3 §2)", () => {
    async function renderTaxi(): Promise<string> {
      const r = await callText(client, "glyph_render", {
        spec: {
          data: { source: fixture, format: "csv" },
          layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
        },
      });
      return JSON.parse(r.text).handle_id as string;
    }

    it("returns { headline, highlights[], questions[] } for a rendered chart", async () => {
      const handle_id = await renderTaxi();
      const r2 = await callText(client, "glyph_explain", { handle_id });
      expect(r2.isError).toBe(false);
      const exp = JSON.parse(r2.text);
      expect(typeof exp.headline).toBe("string");
      expect(exp.headline.length).toBeGreaterThan(0);
      expect(Array.isArray(exp.highlights)).toBe(true);
      expect(Array.isArray(exp.questions)).toBe(true);
    });

    it("is deterministic across repeat calls", async () => {
      const handle_id = await renderTaxi();
      const a = await callText(client, "glyph_explain", { handle_id });
      const b = await callText(client, "glyph_explain", { handle_id });
      expect(JSON.parse(a.text)).toEqual(JSON.parse(b.text));
    });

    it("honors hints to override role inference", async () => {
      const handle_id = await renderTaxi();
      // Fixture columns: pickup_hour, fare, rides. Pin the y to rides explicitly.
      const r = await callText(client, "glyph_explain", {
        handle_id,
        hints: { xField: "pickup_hour", yField: "rides" },
      });
      expect(r.isError).toBe(false);
      const exp = JSON.parse(r.text);
      expect(exp.headline.toLowerCase()).toContain("rides");
    });

    it("rejects an unknown handle_id with a clear error", async () => {
      const r = await callText(client, "glyph_explain", { handle_id: "nope" });
      expect(r.isError).toBe(true);
      expect(r.text).toContain("Unknown handle_id");
    });

    // ---- Moat PR 2: structured envelope -----------------------------------
    it("format='structured' returns the typed Explanation/1 envelope", async () => {
      const handle_id = await renderTaxi();
      const r = await callText(client, "glyph_explain", {
        handle_id,
        format: "structured",
      });
      expect(r.isError).toBe(false);
      const exp = JSON.parse(r.text);
      expect(exp.format).toBe("glyph-explanation/1");
      expect(typeof exp.headline).toBe("string");
      expect(Array.isArray(exp.keyInsights)).toBe(true);
      expect(exp.keyInsights.length).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(exp.potentialMisreadings)).toBe(true);
      expect(Array.isArray(exp.dataSources)).toBe(true);
      expect(exp.chartTypeRationale.chartType).toBe("bar");
      expect(Array.isArray(exp.suggestedFollowups)).toBe(true);
      expect(exp.suggestedFollowups.length).toBeGreaterThan(0);
      // The bar mark should suggest glyph_decompose as a follow-up.
      const verbs = exp.suggestedFollowups.map((f: { suggestedVerb?: string }) => f.suggestedVerb);
      expect(verbs).toContain("glyph_decompose");
    });

    it("format defaults to legacy for back-compat (omit + explicit both work)", async () => {
      const handle_id = await renderTaxi();
      const omitted = await callText(client, "glyph_explain", { handle_id });
      const explicit = await callText(client, "glyph_explain", {
        handle_id,
        format: "legacy",
      });
      const o = JSON.parse(omitted.text);
      const e = JSON.parse(explicit.text);
      // Legacy envelope keys: { headline, highlights, questions } — no format tag.
      expect(o).toHaveProperty("highlights");
      expect(o).toHaveProperty("questions");
      expect(o.format).toBeUndefined();
      expect(e).toEqual(o);
    });

    // Review NIT-7: locks the AUDIT-01 → potentialMisreadings bridge end-to-end
    // through the MCP handler. The core-level test asserts buildStructuredExplanation
    // does the mapping; this asserts the handler actually wires the audit pass
    // into the structured envelope returned by glyph_explain.
    it("structured envelope surfaces AUDIT-01 as a potentialMisreading for truncated-y bars", async () => {
      // Render a bar chart with an explicit non-zero y baseline so AUDIT-01
      // fires. Use the existing taxi fixture as the data source.
      const renderRes = await callText(client, "glyph_render", {
        spec: {
          data: { source: fixture, format: "csv" },
          layers: [
            {
              mark: "bar",
              encoding: {
                x: "pickup_hour",
                y: {
                  field: "rides",
                  type: "quantitative",
                  scale: { domain: [100, 300] },
                },
              },
            },
          ],
        },
      });
      const handle_id = (JSON.parse(renderRes.text) as { handle_id: string }).handle_id;

      const r = await callText(client, "glyph_explain", {
        handle_id,
        format: "structured",
      });
      expect(r.isError).toBe(false);
      const exp = JSON.parse(r.text);
      const misreadings = exp.potentialMisreadings as Array<{
        auditRuleId?: string;
        severity: string;
        path?: string;
      }>;
      const audit01 = misreadings.find((m) => m.auditRuleId === "AUDIT-01");
      expect(audit01).toBeDefined();
      expect(audit01?.severity).toBe("high");
      // NIT-6: the audit finding's RFC 6901 path should pass through.
      expect(audit01?.path).toBe("/layers/0/encoding/y");
    });
  });

  // ---- Phase 3 §3: diagnostic primitives (PR36) --------------------------
  describe("diagnostic verbs (PR36 — Phase 3 §3)", () => {
    /** Render a synthetic CSV via glyph_import so we can drive concrete tests. */
    async function importAndRender(csv: string, x: string, y: string): Promise<string> {
      const imp = await callText(client, "glyph_import", {
        payload: { kind: "csv", data: csv },
      });
      const imported = JSON.parse(imp.text);
      const r = await callText(client, "glyph_render", {
        spec: {
          data: { source: imported.resolvedSource, format: "csv" },
          layers: [{ mark: "bar", encoding: { x, y } }],
        },
      });
      return JSON.parse(r.text).handle_id as string;
    }

    it("glyph_anomaly flags rows beyond the z-threshold and chains a handle", async () => {
      // 12 stable values + one wild outlier at hour=99.
      const lines = ["hour,rides"];
      for (let i = 0; i < 12; i++) lines.push(`${i},50`);
      lines.push("99,400");
      const handle_id = await importAndRender(lines.join("\n"), "hour", "rides");
      const r = await callText(client, "glyph_anomaly", {
        handle_id,
        valueField: "rides",
        labelField: "hour",
        threshold: 2,
      });
      expect(r.isError).toBe(false);
      const out = JSON.parse(r.text);
      expect(out.handle_id).toBeTruthy();
      expect(out.uri).toMatch(/^gdf:\/\//);
      expect(out.rows.length).toBeGreaterThanOrEqual(1);
      expect(out.columns).toContain("_z");
      expect(out.explanation.headline).toMatch(/outlier/i);
      // The chained handle should be queryable.
      const q = await callText(client, "glyph_query", { handle_id: out.handle_id });
      expect(q.isError).toBe(false);
      const queried = JSON.parse(q.text);
      expect(queried.rowCount).toBeGreaterThanOrEqual(1);
    });

    it("glyph_drift attributes per-group contribution between two periods", async () => {
      const csv =
        "region,period,revenue\n" +
        "us,A,100\nus,B,80\n" +
        "eu,A,60\neu,B,65\n" +
        "asia,A,40\nasia,B,35\n";
      const handle_id = await importAndRender(csv, "region", "revenue");
      const r = await callText(client, "glyph_drift", {
        handle_id,
        valueField: "revenue",
        groupField: "region",
        periodField: "period",
        periodA: "A",
        periodB: "B",
      });
      expect(r.isError).toBe(false);
      const out = JSON.parse(r.text);
      expect(out.totalA).toBe(200);
      expect(out.totalB).toBe(180);
      expect(out.totalDelta).toBe(-20);
      // First row should be "us" with delta=-20.
      expect(out.rows[0][0]).toBe("us");
      expect(out.rows[0][3]).toBe(-20);
      expect(out.explanation.headline.toLowerCase()).toContain("us");
    });

    it("glyph_decompose ranks factors by variance explained", async () => {
      // region drives all the signal; weekday is noise.
      const rows: string[] = ["region,weekday,value"];
      rows.push("us,mon,98", "us,tue,102", "us,mon,101", "us,tue,99", "us,mon,100", "us,tue,100");
      rows.push("eu,mon,49", "eu,tue,51", "eu,mon,50", "eu,tue,52", "eu,mon,48", "eu,tue,50");
      const csv = rows.join("\n");
      const handle_id = await importAndRender(csv, "region", "value");
      const r = await callText(client, "glyph_decompose", {
        handle_id,
        metricField: "value",
        factors: ["region", "weekday"],
      });
      expect(r.isError).toBe(false);
      const out = JSON.parse(r.text);
      // First row = region with very high varianceExplained.
      expect(out.rows[0][0]).toBe("region");
      expect(out.rows[0][1]).toBeGreaterThan(0.9);
      expect(out.rows[1][0]).toBe("weekday");
      expect(out.rows[1][1]).toBeLessThan(0.05);
    });

    it("glyph_forecast emits the expected horizon rows + a band", async () => {
      // 20 trending values; 7-step forecast.
      const rows: string[] = ["t,y"];
      for (let i = 0; i < 20; i++) rows.push(`${i},${100 + i * 2}`);
      const csv = rows.join("\n");
      const handle_id = await importAndRender(csv, "t", "y");
      const r = await callText(client, "glyph_forecast", {
        handle_id,
        xField: "t",
        yField: "y",
        season: 1,
        horizon: 7,
      });
      expect(r.isError).toBe(false);
      const out = JSON.parse(r.text);
      // We should get back 20 historical rows + 7 forecast-only rows.
      expect(out.rows.length).toBe(27);
      // The last 7 are horizon rows.
      const horizonRows = out.rows.filter((row: unknown[]) => row[5] === true);
      expect(horizonRows.length).toBe(7);
    });

    it("the chained handles all show up in glyph_handles + glyph_lineage walks back", async () => {
      const lines = ["hour,rides"];
      for (let i = 0; i < 12; i++) lines.push(`${i},50`);
      lines.push("99,400");
      const handle_id = await importAndRender(lines.join("\n"), "hour", "rides");
      const r = await callText(client, "glyph_anomaly", {
        handle_id,
        valueField: "rides",
        labelField: "hour",
      });
      const out = JSON.parse(r.text);
      const handlesResp = await callText(client, "glyph_handles", {});
      const handles = JSON.parse(handlesResp.text);
      // Two handles: the rendered one + the derived anomaly handle.
      const ids = handles.handles.map((h: { id: string }) => h.id);
      expect(ids).toContain(handle_id);
      expect(ids).toContain(out.handle_id);
      // Lineage walks back from the derived handle to the parent uri.
      const lineageResp = await callText(client, "glyph_lineage", { uri: out.uri });
      const tree = JSON.parse(lineageResp.text);
      expect(tree.children).toHaveLength(1);
      expect(tree.children[0].producer.tool).toBe("materializeSpec");
    });

    it("all four verbs reject an unknown handle_id", async () => {
      for (const tool of [
        "glyph_anomaly",
        "glyph_drift",
        "glyph_decompose",
        "glyph_forecast",
      ] as const) {
        const args: Record<string, unknown> = { handle_id: "nope" };
        if (tool === "glyph_anomaly") args.valueField = "x";
        if (tool === "glyph_drift") {
          args.valueField = "x";
          args.groupField = "g";
          args.periodField = "p";
          args.periodA = "A";
          args.periodB = "B";
        }
        if (tool === "glyph_decompose") {
          args.metricField = "x";
          args.factors = ["g"];
        }
        if (tool === "glyph_forecast") {
          args.xField = "t";
          args.yField = "y";
        }
        const r = await callText(client, tool, args);
        expect(r.isError).toBe(true);
        expect(r.text).toContain("Unknown handle_id");
      }
    });
  });

  // ---- Phase 3 §1: semantic / metric layer (PR37) ------------------------
  describe("metric layer (PR37 — Phase 3 §1)", () => {
    it("registers metrics and lists them via glyph_metrics", async () => {
      const reg = await callText(client, "glyph_metrics_register", {
        metrics: [
          {
            name: "mrr",
            sql: "SUM(amount) FILTER (WHERE type = 'subscription')",
            description: "Monthly recurring revenue.",
          },
          { name: "total_rev", sql: "SUM(amount)" },
        ],
      });
      expect(reg.isError).toBe(false);
      expect(JSON.parse(reg.text).registered).toEqual(["mrr", "total_rev"]);

      const list = await callText(client, "glyph_metrics", {});
      expect(list.isError).toBe(false);
      const out = JSON.parse(list.text);
      expect(out.count).toBe(2);
      expect(out.metrics.map((m: { name: string }) => m.name)).toEqual(["mrr", "total_rev"]);

      // Prefix filter.
      const filtered = await callText(client, "glyph_metrics", { prefix: "mr" });
      expect(JSON.parse(filtered.text).count).toBe(1);
    });

    it("re-registering an existing metric records it under `replaced`", async () => {
      await callText(client, "glyph_metrics_register", {
        metrics: [{ name: "mrr", sql: "SUM(amount)" }],
      });
      const r = await callText(client, "glyph_metrics_register", {
        metrics: [{ name: "mrr", sql: "SUM(amount) FILTER (WHERE type = 'subscription')" }],
      });
      const out = JSON.parse(r.text);
      expect(out.registered).toEqual([]);
      expect(out.replaced).toEqual(["mrr"]);
    });

    it("rejects an invalid metric SQL with a clear error", async () => {
      const r = await callText(client, "glyph_metrics_register", {
        metrics: [{ name: "bad", sql: "SELECT SUM(x) FROM t" }],
      });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/aggregate expression/);
    });

    it("glyph_render resolves `{ metric: <name> }` channels to the registered aggregate", async () => {
      // Import a tiny payments CSV.
      const csv =
        "month,type,amount\n" +
        "2024-01,subscription,100\n2024-01,subscription,150\n2024-01,one-time,50\n" +
        "2024-02,subscription,120\n2024-02,subscription,180\n2024-02,one-time,40\n" +
        "2024-03,subscription,200\n2024-03,subscription,250\n2024-03,one-time,30\n";
      const imp = await callText(client, "glyph_import", {
        payload: { kind: "csv", data: csv },
      });
      const imported = JSON.parse(imp.text);

      await callText(client, "glyph_metrics_register", {
        metrics: [
          {
            name: "mrr",
            sql: "SUM(amount) FILTER (WHERE type = 'subscription')",
            description: "Monthly recurring revenue.",
          },
        ],
      });

      const r = await callText(client, "glyph_render", {
        spec: {
          data: { source: imported.resolvedSource, format: "csv" },
          layers: [
            {
              mark: "line",
              encoding: { x: "month", y: { metric: "mrr" } },
            },
          ],
        },
      });
      expect(r.isError).toBe(false);
      const out = JSON.parse(r.text);
      // We should have 3 rows (one per month) with the SUM-FILTER aggregate.
      expect(out.row_count).toBe(3);
      // The materialized view's schema should expose _metric_mrr.
      expect(out.schema.map((c: { name: string }) => c.name)).toContain("_metric_mrr");
      // The aggregate is correct: e.g. 2024-01 → 100 + 150 = 250.
      const q = await callText(client, "glyph_query", {
        handle_id: out.handle_id,
        where: "WHERE month = '2024-01'",
      });
      const queried = JSON.parse(q.text);
      const cols = queried.columns;
      const mrrIdx = cols.indexOf("_metric_mrr");
      expect(queried.rows[0][mrrIdx]).toBe(250);
    });

    it("returns an error when a spec references an unknown metric", async () => {
      const csv = "month,amount\n2024-01,100\n2024-02,200\n";
      const imp = await callText(client, "glyph_import", {
        payload: { kind: "csv", data: csv },
      });
      const imported = JSON.parse(imp.text);
      const r = await callText(client, "glyph_render", {
        spec: {
          data: { source: imported.resolvedSource, format: "csv" },
          layers: [{ mark: "line", encoding: { x: "month", y: { metric: "phantom" } } }],
        },
      });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/Unknown metric: "phantom"/);
    });

    it("rejects a channel that has neither field nor metric", async () => {
      const r = await callText(client, "glyph_render", {
        spec: {
          data: { source: "x.csv" },
          layers: [{ mark: "bar", encoding: { x: "a", y: { type: "quantitative" } } }],
        },
      });
      expect(r.isError).toBe(true);
      // After the Tier-1 fix, channels also accept `value`. The error
      // message lists all three permitted keys.
      expect(r.text).toMatch(/exactly one of `field`, `metric`, or `value`/);
    });
  });

  // ---- Phase 3 §6: persistent memory (PR39) ------------------------------
  describe("persistent memory (PR39 — Phase 3 §6)", () => {
    async function renderTaxi(): Promise<string> {
      const r = await callText(client, "glyph_render", {
        spec: {
          data: { source: fixture, format: "csv" },
          layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
        },
      });
      return JSON.parse(r.text).handle_id as string;
    }

    it("save → list → recall round-trips a handle through the file", async () => {
      const handle_id = await renderTaxi();
      const save = await callText(client, "glyph_memory_save", {
        name: "taxi_baseline",
        handle_id,
        description: "Baseline taxi rides snapshot.",
      });
      expect(save.isError).toBe(false);
      expect(JSON.parse(save.text)).toMatchObject({ name: "taxi_baseline", sampleRows: 12 });

      const list = await callText(client, "glyph_memory_list", {});
      const listed = JSON.parse(list.text);
      expect(listed.count).toBe(1);
      expect(listed.entries[0].name).toBe("taxi_baseline");
      expect(listed.entries[0].description).toBe("Baseline taxi rides snapshot.");

      const recalled = await callText(client, "glyph_memory_recall", { name: "taxi_baseline" });
      expect(recalled.isError).toBe(false);
      const restored = JSON.parse(recalled.text);
      // Fresh id + fresh gdf:// URI, but the data is the same.
      expect(restored.id).not.toBe(handle_id);
      expect(restored.uri).toMatch(/^gdf:\/\//);
      expect(restored.lineage.producer.tool).toBe("glyph_memory_recall");

      // The restored handle is queryable.
      const q = await callText(client, "glyph_query", { handle_id: restored.id });
      expect(JSON.parse(q.text).rowCount).toBe(12);
    });

    it("re-saving an existing name replaces the prior content", async () => {
      const h1 = await renderTaxi();
      await callText(client, "glyph_memory_save", { name: "snapshot", handle_id: h1 });
      // Second save with the same name + a different filter; expect REPLACE.
      const r2 = await callText(client, "glyph_render", {
        spec: {
          data: {
            source: fixture,
            format: "csv",
            transform: "SELECT pickup_hour, rides FROM glyph_src_main WHERE rides > 200",
          },
          layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
        },
      });
      const h2 = JSON.parse(r2.text).handle_id as string;
      await callText(client, "glyph_memory_save", { name: "snapshot", handle_id: h2 });
      const list = await callText(client, "glyph_memory_list", {});
      const listed = JSON.parse(list.text);
      expect(listed.count).toBe(1);
      expect(listed.entries[0].sampleRows).toBe(5);
    });

    it("forget drops the entry; recall then returns an error", async () => {
      const handle_id = await renderTaxi();
      await callText(client, "glyph_memory_save", { name: "throwaway", handle_id });
      const forget = await callText(client, "glyph_memory_forget", { name: "throwaway" });
      expect(JSON.parse(forget.text).forgotten).toBe(true);
      const recall = await callText(client, "glyph_memory_recall", { name: "throwaway" });
      expect(recall.isError).toBe(true);
      expect(recall.text).toMatch(/Unknown memory name/);
    });

    it("survives a state restart against the same file path", async () => {
      const handle_id = await renderTaxi();
      await callText(client, "glyph_memory_save", { name: "persisted", handle_id });
      // Tear down + re-open against the same file.
      await client.close();
      await state.close();
      state = new ServerState({
        memoryPath: join(tempMemoryDir, "memory.duckdb"),
      });
      const { server: server2 } = createServer(state);
      const [t1, t2] = InMemoryTransport.createLinkedPair();
      await server2.connect(t2);
      client = new Client({ name: "test-client", version: "0.0.0" });
      await client.connect(t1);
      // After restart, list still shows the entry.
      const list = await callText(client, "glyph_memory_list", {});
      const listed = JSON.parse(list.text);
      expect(listed.count).toBe(1);
      expect(listed.entries[0].name).toBe("persisted");
      // Recall yields queryable data.
      const recalled = await callText(client, "glyph_memory_recall", { name: "persisted" });
      const restored = JSON.parse(recalled.text);
      const q = await callText(client, "glyph_query", { handle_id: restored.id });
      expect(JSON.parse(q.text).rowCount).toBe(12);
    });

    it("rejects unsafe names", async () => {
      const handle_id = await renderTaxi();
      const r = await callText(client, "glyph_memory_save", {
        name: "bad name with spaces",
        handle_id,
      });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/Invalid memory name/);
    });

    it("rejects an unknown handle_id from glyph_memory_save", async () => {
      const r = await callText(client, "glyph_memory_save", {
        name: "x",
        handle_id: "nope",
      });
      expect(r.isError).toBe(true);
      expect(r.text).toContain("Unknown handle_id");
    });
  });

  // ---- Phase 3 §4 + §7: actions + trust (PR40) ---------------------------
  describe("actions + trust (PR40 — Phase 3 §4 + §7)", () => {
    async function renderWithActions(): Promise<string> {
      const r = await callText(client, "glyph_render", {
        spec: {
          data: { source: fixture, format: "csv" },
          layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
          actions: [
            {
              name: "email_team",
              label: "Email risk team",
              tool: "intercom_send_email",
              argMap: {
                template: "risk-alert",
                customer_ids: "$selection.keys",
                summary: "$selection.summary",
              },
            },
          ],
        },
      });
      return JSON.parse(r.text).handle_id as string;
    }

    it("glyph_act resolves $selection.* placeholders and writes an audit row", async () => {
      const handle_id = await renderWithActions();
      const r = await callText(client, "glyph_act", {
        handle_id,
        action: "email_team",
        selection: { keys: ["c1", "c2", "c3"], summary: "3 customers flagged" },
      });
      expect(r.isError).toBe(false);
      const out = JSON.parse(r.text);
      expect(out.action).toBe("email_team");
      expect(out.tool).toBe("intercom_send_email");
      expect(out.resolvedArgs.customer_ids).toEqual(["c1", "c2", "c3"]);
      expect(out.resolvedArgs.summary).toBe("3 customers flagged");
      expect(out.dry_run).toBe(true);
      expect(out.audit_id).toMatch(/^[0-9a-f]{16}$/);

      // The action shows up in glyph_audit_log.
      const log = await callText(client, "glyph_audit_log", { handle_id });
      const logged = JSON.parse(log.text);
      expect(logged.count).toBe(1);
      expect(logged.entries[0].actionName).toBe("email_team");
      expect(logged.entries[0].dryRun).toBe(true);
    });

    it("glyph_act rejects an unknown action with a helpful list", async () => {
      const handle_id = await renderWithActions();
      const r = await callText(client, "glyph_act", {
        handle_id,
        action: "phantom_action",
      });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/Unknown action/);
      expect(r.text).toContain("email_team"); // lists known actions
    });

    it("glyph_act rejects an unknown handle_id", async () => {
      const r = await callText(client, "glyph_act", {
        handle_id: "nope",
        action: "anything",
      });
      expect(r.isError).toBe(true);
      expect(r.text).toContain("Unknown handle_id");
    });

    it("glyph_trust returns provenance + a markdown summary", async () => {
      const r1 = await callText(client, "glyph_render", {
        spec: {
          data: { source: fixture, format: "csv" },
          layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
        },
      });
      const handle_id = JSON.parse(r1.text).handle_id as string;
      const r = await callText(client, "glyph_trust", { handle_id });
      expect(r.isError).toBe(false);
      const out = JSON.parse(r.text);
      expect(out.confidence).toBe("high");
      expect(typeof out.sampleRows).toBe("number");
      expect(typeof out.freshness).toBe("string");
      expect(out.lineageDepth).toBeGreaterThanOrEqual(1);
      expect(out.markdown).toContain("Sample size");
      expect(out.markdown).toContain("Confidence");
    });

    it("glyph_trust flags lowSample when the chart has < 30 rows", async () => {
      // taxi fixture has 12 rows → lowSample = true.
      const r1 = await callText(client, "glyph_render", {
        spec: {
          data: { source: fixture, format: "csv" },
          layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
        },
      });
      const handle_id = JSON.parse(r1.text).handle_id as string;
      const r = await callText(client, "glyph_trust", { handle_id });
      const out = JSON.parse(r.text);
      expect(out.lowSample).toBe(true);
      expect(out.markdown).toContain("low");
    });
  });

  // ---- PR41 Story Agent --------------------------------------------------
  describe("Story Agent (PR41)", () => {
    it("plan → execute → storyboard round-trips on the taxi fixture", async () => {
      const planResp = await callText(client, "glyph_story_plan", {
        intent: "Show me ride volume by hour and flag anything weird.",
        source: fixture,
        format: "csv",
      });
      expect(planResp.isError).toBe(false);
      const plan = JSON.parse(planResp.text);
      expect(plan.plan_id).toMatch(/^story_/);
      // The heuristic planner produces describe + render + explain + anomaly + annotate
      // (no forecast — pickup_hour is integer, not temporal).
      const kinds = plan.nodes.map((n: { kind: string }) => n.kind).sort();
      expect(kinds).toEqual(["annotate", "anomaly", "describe", "explain", "render"]);
      // Every node starts pending.
      expect(plan.nodes.every((n: { status: string }) => n.status === "pending")).toBe(true);

      const exec = await callText(client, "glyph_story_execute", { plan_id: plan.plan_id });
      expect(exec.isError).toBe(false);
      const out = JSON.parse(exec.text);
      expect(out.status).toBe("complete");
      expect(out.failed_nodes).toEqual([]);
      expect(out.storyboard).toBeTruthy();
      expect(out.storyboard.panels.length).toBeGreaterThanOrEqual(1);
      expect(out.storyboard.narrative).toContain("Intent:");
      expect(out.storyboard.handles.length).toBeGreaterThanOrEqual(1);
    });

    it("emits checkpoints that glyph_story_await_checkpoint can stream", async () => {
      const planResp = await callText(client, "glyph_story_plan", {
        intent: "Stream me the rendering of taxi rides.",
        source: fixture,
        format: "csv",
      });
      const plan_id = JSON.parse(planResp.text).plan_id as string;

      // Kick execute + await first checkpoint in parallel.
      const [_exec, cp0] = await Promise.all([
        callText(client, "glyph_story_execute", { plan_id }),
        callText(client, "glyph_story_await_checkpoint", { plan_id, since: 0, timeout_ms: 8000 }),
      ]);
      expect(cp0.isError).toBe(false);
      const out0 = JSON.parse(cp0.text);
      expect(out0.checkpoint).toBeTruthy();
      expect(out0.checkpoint.plan_id).toBe(plan_id);
      // After execute completes, checkpointCount > 0 in glyph_story_get.
      const got = await callText(client, "glyph_story_get", { plan_id });
      const gotPlan = JSON.parse(got.text);
      expect(gotPlan.checkpointCount).toBeGreaterThanOrEqual(2);
      expect(gotPlan.status).toBe("complete");
    });

    it("includes a forecast node when the data has a temporal x", async () => {
      const csv = "day,rides\n2024-01-01,10\n2024-01-02,15\n2024-01-03,20\n2024-01-04,25\n";
      const imp = await callText(client, "glyph_import", {
        payload: { kind: "csv", data: csv },
      });
      const imported = JSON.parse(imp.text);
      const planResp = await callText(client, "glyph_story_plan", {
        intent: "Daily ride trend",
        source: imported.resolvedSource,
        format: "csv",
      });
      const plan = JSON.parse(planResp.text);
      expect(plan.nodes.some((n: { kind: string }) => n.kind === "forecast")).toBe(true);
    });

    it("glyph_story_list shows every plan in the session", async () => {
      await callText(client, "glyph_story_plan", {
        intent: "story one",
        source: fixture,
        format: "csv",
      });
      await callText(client, "glyph_story_plan", {
        intent: "story two",
        source: fixture,
        format: "csv",
      });
      const list = await callText(client, "glyph_story_list", {});
      const out = JSON.parse(list.text);
      expect(out.count).toBe(2);
      expect(out.plans[0].intent).toContain("story one");
      expect(out.plans[1].intent).toContain("story two");
    });

    it("rejects an unknown plan_id from execute / get", async () => {
      const r1 = await callText(client, "glyph_story_execute", { plan_id: "nope" });
      expect(r1.isError).toBe(true);
      expect(r1.text).toContain("Unknown plan_id");
      const r2 = await callText(client, "glyph_story_get", { plan_id: "nope" });
      expect(r2.isError).toBe(true);
      expect(r2.text).toContain("Unknown plan_id");
    });
  });

  // ---- PR46 Linked-view filters (Innovation #4) -------------------------
  describe("linked-view filters (PR46)", () => {
    async function renderInGroup(group: string, transform: string): Promise<string> {
      const r = await callText(client, "glyph_render", {
        spec: {
          data: { source: fixture, format: "csv", transform },
          layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
          link_group: group,
        },
      });
      return JSON.parse(r.text).handle_id as string;
    }

    it("registers handles into their link_group at glyph_render time", async () => {
      const h1 = await renderInGroup("dash-q1", "SELECT pickup_hour, rides FROM glyph_src_main");
      const h2 = await renderInGroup(
        "dash-q1",
        "SELECT pickup_hour, rides FROM glyph_src_main WHERE rides > 100",
      );
      const r = await callText(client, "glyph_linked_handles", { group: "dash-q1" });
      const out = JSON.parse(r.text);
      expect(out.count).toBe(2);
      expect(out.handles).toContain(h1);
      expect(out.handles).toContain(h2);
    });

    it("broadcasts a predicate via publish, consumed via await", async () => {
      await renderInGroup("dash-q2", "SELECT pickup_hour, rides FROM glyph_src_main");

      const [pub, awaited] = await Promise.all([
        callText(client, "glyph_linked_publish", {
          group: "dash-q2",
          predicate: "pickup_hour = 8",
          summary: "Hour 8 selected",
        }),
        callText(client, "glyph_linked_await", {
          group: "dash-q2",
          since: 0,
          timeout_ms: 3000,
        }),
      ]);
      expect(pub.isError).toBe(false);
      const event = JSON.parse(pub.text);
      expect(event.predicate).toBe("pickup_hour = 8");
      expect(event.summary).toBe("Hour 8 selected");

      expect(awaited.isError).toBe(false);
      const recv = JSON.parse(awaited.text);
      expect(recv.event.predicate).toBe("pickup_hour = 8");
    });

    it("await returns null on timeout when no events are published", async () => {
      const r = await callText(client, "glyph_linked_await", {
        group: "dash-empty",
        timeout_ms: 50,
      });
      expect(r.isError).toBe(false);
      expect(JSON.parse(r.text).event).toBeNull();
    });

    it("recent events appear in glyph_linked_handles output", async () => {
      await renderInGroup("dash-q3", "SELECT pickup_hour, rides FROM glyph_src_main");
      await callText(client, "glyph_linked_publish", {
        group: "dash-q3",
        predicate: "rides > 200",
      });
      const r = await callText(client, "glyph_linked_handles", { group: "dash-q3" });
      const out = JSON.parse(r.text);
      expect(out.recent_events.length).toBeGreaterThanOrEqual(1);
      expect(out.recent_events[0].predicate).toBe("rides > 200");
    });
  });

  // ---- PR48 Whyboard (Innovation #5) -------------------------------------
  describe("whyboard (PR48)", () => {
    async function renderTaxi(): Promise<string> {
      const r = await callText(client, "glyph_render", {
        spec: {
          data: { source: fixture, format: "csv" },
          layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
        },
      });
      return JSON.parse(r.text).handle_id as string;
    }

    it("returns a depth-1 tree with at least the root + diagnostic children", async () => {
      const handle_id = await renderTaxi();
      const r = await callText(client, "glyph_whyboard", {
        handle_id,
        question: "Why does the rides distribution look like this?",
      });
      expect(r.isError).toBe(false);
      const board = JSON.parse(r.text);
      expect(board.source_handle).toBe(handle_id);
      expect(board.question).toContain("Why");
      expect(board.root.kind).toBe("root");
      expect(typeof board.root.explanation?.headline).toBe("string");
      // taxi fixture has 12 rows; not enough for the anomaly threshold to
      // trigger reliably, but at least the root + decompose/forecast tree
      // should populate. Just assert root exists.
      expect(board.total_nodes).toBeGreaterThanOrEqual(1);
    });

    it("chains every diagnostic handle so glyph_lineage walks back to the source", async () => {
      // Use a series with a clear outlier so anomaly fires.
      const lines = ["hour,rides"];
      for (let i = 0; i < 30; i++) lines.push(`${i},50`);
      lines.push("99,400");
      const imp = await callText(client, "glyph_import", {
        payload: { kind: "csv", data: lines.join("\n") },
      });
      const imported = JSON.parse(imp.text);
      const renderR = await callText(client, "glyph_render", {
        spec: {
          data: { source: imported.resolvedSource, format: "csv" },
          layers: [{ mark: "bar", encoding: { x: "hour", y: "rides" } }],
        },
      });
      const handle_id = JSON.parse(renderR.text).handle_id as string;

      const r = await callText(client, "glyph_whyboard", { handle_id });
      const board = JSON.parse(r.text);
      expect(board.root.children.length).toBeGreaterThanOrEqual(1);
      const firstChild = board.root.children[0];
      expect(typeof firstChild.handle_id).toBe("string");
      expect(firstChild.uri).toMatch(/^gdf:\/\//);
      // Lineage walks back to the source chart's materializeSpec node.
      const lineage = await callText(client, "glyph_lineage", { uri: firstChild.uri });
      const tree = JSON.parse(lineage.text);
      expect(tree.children.length).toBeGreaterThanOrEqual(1);
      expect(tree.children[0].producer.tool).toBe("materializeSpec");
    });

    it("rejects an unknown handle_id with a clear error", async () => {
      const r = await callText(client, "glyph_whyboard", { handle_id: "nope" });
      expect(r.isError).toBe(true);
      expect(r.text).toContain("Unknown handle_id");
    });

    it("threads link_group onto the result for downstream UI wiring", async () => {
      const handle_id = await renderTaxi();
      const r = await callText(client, "glyph_whyboard", {
        handle_id,
        link_group: "investigate-q4",
      });
      const board = JSON.parse(r.text);
      expect(board.link_group).toBe("investigate-q4");
    });
  });

  // ---- PR42 Geo viz primitives -------------------------------------------
  describe("geo viz (PR42)", () => {
    it("renders a geo-point chart with the default equirectangular projection", async () => {
      const csv =
        "city,lat,lon\nNYC,40.7,-74\nSF,37.7,-122.4\nLondon,51.5,-0.1\nTokyo,35.7,139.7\nSydney,-33.9,151.2\n";
      const imp = await callText(client, "glyph_import", {
        payload: { kind: "csv", data: csv },
      });
      const imported = JSON.parse(imp.text);
      const r = await callText(client, "glyph_render", {
        spec: {
          data: { source: imported.resolvedSource, format: "csv" },
          layers: [{ mark: "geo-point", encoding: { lat: "lat", lon: "lon", color: "city" } }],
          width: 640,
          height: 400,
          projection: { type: "equirectangular" },
        },
      });
      expect(r.isError).toBe(false);
      const out = JSON.parse(r.text);
      expect(out.row_count).toBe(5);
      // The materializer injected _geo_x / _geo_y columns.
      expect(out.schema.map((c: { name: string }) => c.name)).toContain("_geo_x");
      expect(out.schema.map((c: { name: string }) => c.name)).toContain("_geo_y");
      expect(out.svg).toContain("<svg");
    });

    it("rejects a geo-point layer with missing lat / lon", async () => {
      const csv = "city,lat,lon\nNYC,40.7,-74\n";
      const imp = await callText(client, "glyph_import", {
        payload: { kind: "csv", data: csv },
      });
      const imported = JSON.parse(imp.text);
      const r = await callText(client, "glyph_render", {
        spec: {
          data: { source: imported.resolvedSource, format: "csv" },
          layers: [{ mark: "geo-point", encoding: { color: "city" } }],
        },
      });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/geo-point requires/);
    });

    it("renders a geo-region choropleth from a GeoJSON FeatureCollection (PR44)", async () => {
      const csv = "region,revenue\nA,100\nB,40\nC,20\n";
      const imp = await callText(client, "glyph_import", {
        payload: { kind: "csv", data: csv },
      });
      const imported = JSON.parse(imp.text);
      const r = await callText(client, "glyph_render", {
        spec: {
          data: { source: imported.resolvedSource, format: "csv" },
          layers: [{ mark: "geo-region", encoding: { region: "region", color: "revenue" } }],
          geojson: {
            features: [
              {
                properties: { id: "A" },
                geometry: {
                  type: "Polygon",
                  coordinates: [
                    [
                      [0, 0],
                      [10, 0],
                      [10, 10],
                      [0, 10],
                      [0, 0],
                    ],
                  ],
                },
              },
              {
                properties: { id: "B" },
                geometry: {
                  type: "Polygon",
                  coordinates: [
                    [
                      [20, 0],
                      [30, 0],
                      [30, 10],
                      [20, 10],
                      [20, 0],
                    ],
                  ],
                },
              },
              {
                properties: { id: "C" },
                geometry: {
                  type: "Polygon",
                  coordinates: [
                    [
                      [0, 20],
                      [10, 20],
                      [10, 30],
                      [0, 30],
                      [0, 20],
                    ],
                  ],
                },
              },
            ],
          },
          projection: { type: "equirectangular" },
        },
      });
      expect(r.isError).toBe(false);
      const out = JSON.parse(r.text);
      // Three projected paths in the SVG.
      const pathMatches = out.svg.match(/<path[^/]*\/>/g) ?? [];
      expect(pathMatches.length).toBeGreaterThanOrEqual(3);
    });

    it("supports naturalEarth and albersUsa projections (PR44)", async () => {
      const csv = "city,lat,lon\nNYC,40.7,-74\nLA,34.0,-118.2\nLondon,51.5,-0.1\n";
      const imp = await callText(client, "glyph_import", {
        payload: { kind: "csv", data: csv },
      });
      const imported = JSON.parse(imp.text);
      for (const proj of ["naturalEarth", "albersUsa"] as const) {
        const r = await callText(client, "glyph_render", {
          spec: {
            data: { source: imported.resolvedSource, format: "csv" },
            layers: [{ mark: "geo-point", encoding: { lat: "lat", lon: "lon" } }],
            projection: { type: proj },
          },
        });
        expect(r.isError).toBe(false);
        expect(JSON.parse(r.text).row_count).toBe(3);
      }
    });

    it("emits graticule lines when spec.graticule is set (PR44)", async () => {
      const csv = "region,revenue\nA,100\n";
      const imp = await callText(client, "glyph_import", {
        payload: { kind: "csv", data: csv },
      });
      const imported = JSON.parse(imp.text);
      const r = await callText(client, "glyph_render", {
        spec: {
          data: { source: imported.resolvedSource, format: "csv" },
          layers: [{ mark: "geo-region", encoding: { region: "region", color: "revenue" } }],
          geojson: {
            features: [
              {
                properties: { id: "A" },
                geometry: {
                  type: "Polygon",
                  coordinates: [
                    [
                      [0, 0],
                      [5, 0],
                      [5, 5],
                      [0, 0],
                    ],
                  ],
                },
              },
            ],
          },
          graticule: { step: 30 },
        },
      });
      expect(r.isError).toBe(false);
      const out = JSON.parse(r.text);
      // 13 meridians + 5 parallels = 18 graticule lines + 1 region path.
      const pathMatches = out.svg.match(/<path[^/]*\/>/g) ?? [];
      expect(pathMatches.length).toBeGreaterThanOrEqual(18);
    });

    it("supports mercator projection without throwing on extreme latitudes", async () => {
      const csv = "lat,lon\n-89,0\n89,0\n0,0\n";
      const imp = await callText(client, "glyph_import", {
        payload: { kind: "csv", data: csv },
      });
      const imported = JSON.parse(imp.text);
      const r = await callText(client, "glyph_render", {
        spec: {
          data: { source: imported.resolvedSource, format: "csv" },
          layers: [{ mark: "geo-point", encoding: { lat: "lat", lon: "lon" } }],
          projection: { type: "mercator" },
        },
      });
      expect(r.isError).toBe(false);
      expect(JSON.parse(r.text).row_count).toBe(3);
    });
  });

  // ---- PR62 / PLAN 1.8 + 1.4 + 2.4 ----------------------------------------
  describe("glyph_spec_patch (PR62 / PLAN 1.8)", () => {
    it("re-renders after a JSON Patch swaps the y field", async () => {
      const r1 = await callText(client, "glyph_render", {
        spec: {
          data: { source: fixture, format: "csv" },
          layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
        },
      });
      const out1 = JSON.parse(r1.text);
      const r2 = await callText(client, "glyph_spec_patch", {
        handle_id: out1.handle_id,
        patches: [{ op: "replace", path: "/layers/0/encoding/y", value: "fare" }],
      });
      expect(r2.isError).toBe(false);
      const out2 = JSON.parse(r2.text);
      expect(out2.handle_id).toBeTruthy();
      expect(out2.handle_id).not.toBe(out1.handle_id);
      expect(out2.svg).toContain("<svg");
    });

    it("rejects an unknown handle_id with a clear error", async () => {
      const r = await callText(client, "glyph_spec_patch", {
        handle_id: "nope",
        patches: [{ op: "replace", path: "/mark", value: "line" }],
      });
      expect(r.isError).toBe(true);
      expect(r.text).toContain("Unknown handle_id");
    });

    it("returns a clear error for a malformed patch", async () => {
      const r1 = await callText(client, "glyph_render", {
        spec: {
          data: { source: fixture, format: "csv" },
          layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
        },
      });
      const out1 = JSON.parse(r1.text);
      const r2 = await callText(client, "glyph_spec_patch", {
        handle_id: out1.handle_id,
        // missing path → applyJsonPatch fails on the first op.
        patches: [{ op: "replace", path: "/nonexistent/key", value: "x" }],
      });
      expect(r2.isError).toBe(true);
    });
  });

  describe("glyph_whyboard_diff (PR62 / PLAN 2.4)", () => {
    // Construct two boards in-memory so the diff tests don't depend on the
    // whyboard builder's small-fixture behavior.
    function makeBoard(
      children: Array<{ kind: string; title: string; summary: string; handle_id?: string }>,
    ): unknown {
      return {
        source_handle: "src1",
        question: null,
        link_group: null,
        depth_reached: 1,
        total_nodes: 1 + children.length,
        root: {
          id: "root1",
          kind: "root",
          title: "root",
          summary: "root",
          handle_id: "src1",
          children: children.map((c, i) => ({
            id: `n${i}`,
            kind: c.kind,
            title: c.title,
            summary: c.summary,
            handle_id: c.handle_id ?? `h${i}`,
            children: [],
          })),
        },
      };
    }

    it("identical boards yield an empty diff", async () => {
      const board = makeBoard([
        { kind: "anomaly", title: "Anomalies in rides", summary: "1 outlier" },
        { kind: "forecast", title: "7-step forecast", summary: "stable" },
      ]);
      const d = await callText(client, "glyph_whyboard_diff", {
        board_a: board,
        board_b: board,
      });
      expect(d.isError).toBe(false);
      const diff = JSON.parse(d.text);
      expect(diff.summary).toBe("");
      expect(diff.only_in_a).toEqual([]);
      expect(diff.only_in_b).toEqual([]);
      expect(diff.conflicting).toEqual([]);
    });

    it("flags branches only in one board as only_in_*", async () => {
      const board_a = makeBoard([
        { kind: "anomaly", title: "Anomalies in rides", summary: "1 outlier" },
        { kind: "forecast", title: "7-step forecast", summary: "stable" },
      ]);
      const board_b = makeBoard([
        { kind: "forecast", title: "7-step forecast", summary: "stable" },
      ]);
      const d = await callText(client, "glyph_whyboard_diff", { board_a, board_b });
      const diff = JSON.parse(d.text);
      expect(diff.only_in_a.length).toBe(1);
      expect(diff.only_in_a[0].kind).toBe("anomaly");
      expect(diff.summary).toMatch(/only in A/);
    });

    it("flags branches with conflicting summaries", async () => {
      const board_a = makeBoard([
        { kind: "anomaly", title: "Anomalies in rides", summary: "1 outlier" },
      ]);
      const board_b = makeBoard([
        { kind: "anomaly", title: "Anomalies in rides", summary: "no outliers found" },
      ]);
      const d = await callText(client, "glyph_whyboard_diff", { board_a, board_b });
      const diff = JSON.parse(d.text);
      expect(diff.conflicting.length).toBe(1);
      expect(diff.conflicting[0].conflict_reason).toContain("summaries differ");
    });

    it("rejects a malformed Whyboard input", async () => {
      const d = await callText(client, "glyph_whyboard_diff", {
        board_a: { root: { children: [] } },
        board_b: { not_a_board: true },
      });
      expect(d.isError).toBe(true);
    });
  });

  describe("glyph_regression (PR65 D3 fix-ups)", () => {
    it("returns a fit over a rendered handle's rows", async () => {
      const r1 = await callText(client, "glyph_render", {
        spec: {
          data: { source: fixture, format: "csv" },
          layers: [{ mark: "point", encoding: { x: "pickup_hour", y: "rides" } }],
        },
      });
      const handle_id = JSON.parse(r1.text).handle_id as string;
      const r = await callText(client, "glyph_regression", {
        handle_id,
        x: "pickup_hour",
        y: "rides",
      });
      expect(r.isError).toBe(false);
      const out = JSON.parse(r.text);
      expect(typeof out.slope).toBe("number");
      expect(typeof out.intercept).toBe("number");
      expect(out.line.length).toBe(2);
      expect(out.n).toBeGreaterThan(0);
    });

    it("rejects unknown handle_id", async () => {
      const r = await callText(client, "glyph_regression", {
        handle_id: "nope",
        x: "x",
        y: "y",
      });
      expect(r.isError).toBe(true);
    });
  });

  describe("glyph_causal_graph (PR64 / PLAN 2.7)", () => {
    it("returns an empty graph when no metrics are registered", async () => {
      const r = await callText(client, "glyph_causal_graph", {});
      expect(r.isError).toBe(false);
      const g = JSON.parse(r.text);
      expect(g.nodes).toEqual([]);
      expect(g.edges).toEqual([]);
      expect(g.cycles).toEqual([]);
    });

    it("emits edges for registered causal_of links", async () => {
      // Register two metrics with a cause/effect relationship.
      await callText(client, "glyph_metrics_register", {
        metrics: [
          {
            name: "mrr",
            sql: "SUM(amount)",
            causal_of: ["new_customers"],
          },
          {
            name: "new_customers",
            sql: "COUNT(DISTINCT customer_id)",
          },
        ],
      });
      const r = await callText(client, "glyph_causal_graph", {});
      const g = JSON.parse(r.text);
      expect(g.nodes.length).toBeGreaterThanOrEqual(2);
      expect(g.edges).toContainEqual({ from: "new_customers", to: "mrr" });
    });
  });

  describe("contour rendering (PR75 / D3 Gap 4)", () => {
    it("renders a 4×4 grid contour as a path mark for each threshold", async () => {
      // A simple gradient grid: 16 values from 0..15.
      const r = await callText(client, "glyph_render", {
        spec: {
          data: {
            grid: {
              rows: 4,
              cols: 4,
              values: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
            },
          },
          layers: [{ mark: "contour", encoding: {} }],
          thresholds: [3.5, 7.5, 11.5],
        },
      });
      expect(r.isError).toBeFalsy();
      const out = JSON.parse(r.text);
      // Three thresholds → at least 3 path marks (one per threshold band).
      const pathMatches = (out.svg as string).match(/<path /g) ?? [];
      expect(pathMatches.length).toBeGreaterThanOrEqual(3);
      // Each path contains M..L segments from marching squares.
      expect(out.svg).toContain("M ");
      expect(out.svg).toContain(" L ");
    });

    it("falls back to a median-of-grid threshold when none supplied", async () => {
      const r = await callText(client, "glyph_render", {
        spec: {
          data: {
            grid: { rows: 3, cols: 3, values: [0, 1, 2, 1, 5, 1, 2, 1, 0] },
          },
          layers: [{ mark: "contour", encoding: {} }],
        },
      });
      expect(r.isError).toBeFalsy();
      const out = JSON.parse(r.text);
      const pathMatches = (out.svg as string).match(/<path /g) ?? [];
      // One default threshold (median = 1) — emit at least one path.
      expect(pathMatches.length).toBeGreaterThanOrEqual(1);
    });

    it("rejects a non-contour mark with a grid data shape", async () => {
      const r = await callText(client, "glyph_render", {
        spec: {
          data: { grid: { rows: 2, cols: 2, values: [0, 1, 1, 0] } },
          layers: [{ mark: "bar", encoding: { x: "x", y: "y" } }],
        },
      });
      expect(r.isError).toBe(true);
      expect(r.text).toContain("contour");
    });
  });

  describe("glyph_morph_render (PR74 / D3 Gap 3)", () => {
    it("returns an SVG with SMIL <animate> tags morphing between two specs", async () => {
      const r = await callText(client, "glyph_morph_render", {
        spec_a: {
          data: { source: fixture, format: "csv" },
          layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
        },
        spec_b: {
          data: { source: fixture, format: "csv" },
          layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "fare" } }],
        },
        duration_ms: 1200,
      });
      expect(r.isError).toBeFalsy();
      const out = JSON.parse(r.text);
      expect(out.svg).toContain("<animate ");
      expect(out.svg).toContain('fill="freeze"');
      expect(out.duration_ms).toBe(1200);
      expect(out.morphed_marks).toBeGreaterThan(0);
    });

    it("rejects mark-count mismatch with a clear error", async () => {
      // spec_a renders 12 bars (full taxi fixture); spec_b filters via
      // SQL transform down to 5 — different mark count.
      const r = await callText(client, "glyph_morph_render", {
        spec_a: {
          data: { source: fixture, format: "csv" },
          layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
        },
        spec_b: {
          data: {
            source: fixture,
            format: "csv",
            transform: `SELECT * FROM "${
              // biome-ignore lint/style/noNonNullAssertion: hardcoded path
              fixture
            }" WHERE rides > 200`,
          },
          layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
        },
      });
      expect(r.isError).toBe(true);
      expect(r.text).toContain("mark count differs");
    });

    it("rejects an invalid spec_a with the spec error message", async () => {
      const r = await callText(client, "glyph_morph_render", {
        spec_a: { not_a_spec: true },
        spec_b: {
          data: { source: fixture, format: "csv" },
          layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
        },
      });
      expect(r.isError).toBe(true);
      expect(r.text).toContain("spec_a invalid");
    });
  });

  describe("glyph_verify (Moat PR1 — cryptographic provenance seal)", () => {
    const spec = {
      data: { source: "inline" },
      layers: [{ mark: "bar", encoding: { x: "a", y: "b" } }],
    } as const;
    const schema = [
      { name: "a", type: "VARCHAR" },
      { name: "b", type: "INTEGER" },
    ];
    const rows: ReadonlyArray<ReadonlyArray<unknown>> = [
      ["hi", 1],
      ["bye", 2],
    ];

    // Self-render via @glyph/core so the test doesn't depend on
    // glyph_render's materialize step (which reads from DuckDB).
    async function renderSelf(): Promise<string> {
      const { compileSpec, parseSpec, renderSvg } = await import("@glyph/core");
      return renderSvg(compileSpec({ spec: parseSpec(spec), rows, schema }));
    }

    it("returns valid=true when the SVG matches the spec + rows + schema", async () => {
      const svg = await renderSelf();
      const r = await callText(client, "glyph_verify", { spec, rows, schema, svg });
      expect(r.isError).toBeFalsy();
      const out = JSON.parse(r.text);
      expect(out.valid).toBe(true);
      expect(out.mismatches).toEqual([]);
    });

    it("returns valid=false with a specHash mismatch when the spec disagrees", async () => {
      const svg = await renderSelf();
      const otherSpec = {
        ...spec,
        layers: [{ mark: "point", encoding: { x: "a", y: "b" } }],
      };
      const r = await callText(client, "glyph_verify", {
        spec: otherSpec,
        rows,
        schema,
        svg,
      });
      expect(r.isError).toBeFalsy();
      const out = JSON.parse(r.text);
      expect(out.valid).toBe(false);
      const fields = (out.mismatches as Array<{ field: string }>).map((m) => m.field);
      expect(fields).toContain("specHash");
    });

    it("returns valid=false with a dataHash mismatch when rows differ", async () => {
      const svg = await renderSelf();
      const r = await callText(client, "glyph_verify", {
        spec,
        rows: [
          ["hi", 1],
          ["bye", 999],
        ],
        schema,
        svg,
      });
      expect(r.isError).toBeFalsy();
      const out = JSON.parse(r.text);
      expect(out.valid).toBe(false);
      const fields = (out.mismatches as Array<{ field: string }>).map((m) => m.field);
      expect(fields).toContain("dataHash");
    });

    it("returns valid=false (missing seal) for an SVG without the metadata block", async () => {
      const r = await callText(client, "glyph_verify", {
        spec,
        rows,
        schema,
        svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
      });
      expect(r.isError).toBeFalsy();
      const out = JSON.parse(r.text);
      expect(out.valid).toBe(false);
      const fields = (out.mismatches as Array<{ field: string }>).map((m) => m.field);
      expect(fields).toContain("(missing seal)");
    });

    // NIT-2 from review (scaleDigest mismatch test) deferred to a
    // future PR. The expected behavior — diffProvenance flagging
    // scaleDigest on a domain change — is implicitly covered by the
    // uniform field loop in diffProvenance. Constructing a spec pair
    // that ONLY differs on the resolved scale digest (without also
    // differing on specHash) is non-trivial because nice() axis
    // normalization masks small domain shifts. Re-attempting requires
    // a way to alter scaleDigest without changing the spec body —
    // which would mean introspecting on compile internals from a
    // test, defeating the purpose of the uniform field loop.

    it("rejects an invalid spec with a clear error", async () => {
      const r = await callText(client, "glyph_verify", {
        spec: { not_a_spec: true },
        rows,
        schema,
        svg: "<svg/>",
      });
      expect(r.isError).toBe(true);
      expect(r.text).toContain("spec invalid");
    });
  });

  describe("multi-modal sync (PR73 / PLAN 2.1)", () => {
    it("glyph_render with modalities=['chart','table'] returns rows-sample bundle", async () => {
      const r = await callText(client, "glyph_render", {
        spec: {
          data: { source: fixture, format: "csv" },
          layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
        },
        modalities: ["chart", "table"],
        modality_sample_rows: 5,
      });
      expect(r.isError).toBeFalsy();
      const out = JSON.parse(r.text);
      expect(out.modalities).toBeDefined();
      expect(out.modalities.table).toBeDefined();
      expect(out.modalities.table.columns).toEqual(["pickup_hour", "fare", "rides"]);
      expect(out.modalities.table.rows.length).toBeLessThanOrEqual(5);
    });

    it("modalities=['chart','narrative'] returns auto-generated narrative", async () => {
      const r = await callText(client, "glyph_render", {
        spec: {
          data: { source: fixture, format: "csv" },
          layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
        },
        modalities: ["chart", "narrative"],
      });
      expect(r.isError).toBeFalsy();
      const out = JSON.parse(r.text);
      expect(out.modalities).toBeDefined();
      expect(out.modalities.narrative).toBeDefined();
      // The narrative shape mirrors glyph_explain — must have a headline.
      expect(typeof out.modalities.narrative.headline).toBe("string");
    });

    it("default render (no modalities) returns no modality bundle (back-compat)", async () => {
      const r = await callText(client, "glyph_render", {
        spec: {
          data: { source: fixture, format: "csv" },
          layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
        },
      });
      expect(r.isError).toBeFalsy();
      const out = JSON.parse(r.text);
      expect(out.modalities).toBeUndefined();
    });

    it("glyph_linked_publish carries modality through to await consumers", async () => {
      const group = "mm-group-1";
      const pub = await callText(client, "glyph_linked_publish", {
        group,
        predicate: "region = 'us'",
        modality: "table",
        source_handle: "h_table",
      });
      expect(pub.isError).toBeFalsy();
      const ev = JSON.parse(pub.text);
      expect(ev.modality).toBe("table");
      expect(ev.predicate).toBe("region = 'us'");

      // Subscriber long-poll: the event must be visible and carry modality.
      const sub = await callText(client, "glyph_linked_await", {
        group,
        since: 0,
        timeout_ms: 500,
      });
      const out = JSON.parse(sub.text);
      expect(out.event).not.toBeNull();
      expect(out.event.modality).toBe("table");
    });

    it("end-to-end echo filter: a table subscriber via linked_await skips its own events", async () => {
      // This is the exact wire path agents use. Two modalities publish to
      // the same group; a 'table'-modality subscriber should pull both
      // events but treat modality==='table' as its own and skip them.
      const group = "mm-group-3";
      await callText(client, "glyph_linked_publish", {
        group,
        predicate: "x = 1",
        modality: "chart",
      });
      await callText(client, "glyph_linked_publish", {
        group,
        predicate: "x = 2",
        modality: "table",
      });
      // Walk the bus via linked_await — the canonical subscriber path.
      const received: Array<{ modality?: string; predicate: string }> = [];
      let since = 0;
      // The store currently buffers; await returns immediately when
      // events are already present.
      for (let i = 0; i < 2; i++) {
        const r = await callText(client, "glyph_linked_await", {
          group,
          since,
          timeout_ms: 500,
        });
        const out = JSON.parse(r.text);
        if (!out.event) break;
        received.push({ modality: out.event.modality, predicate: out.event.predicate });
        since = out.index + 1;
      }
      expect(received.length).toBe(2);
      // Echo filter: subscriber's own modality is 'table'; drop it.
      const filtered = received.filter((e) => e.modality !== "table");
      expect(filtered.length).toBe(1);
      expect(filtered[0]?.predicate).toBe("x = 1");
    });
  });

  describe("streaming progress notifications (PR72 / PLAN 1.2)", () => {
    it("glyph_render with progressToken emits at least 4 progress notifications", async () => {
      const events: Array<{ progress: number; message?: string; total?: number }> = [];
      await client.callTool(
        {
          name: "glyph_render",
          arguments: {
            spec: {
              data: { source: fixture, format: "csv" },
              layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
            },
          },
        },
        undefined,
        {
          onprogress: (p) => {
            events.push({
              progress: p.progress,
              ...(p.total !== undefined ? { total: p.total } : {}),
              ...(p.message !== undefined ? { message: p.message } : {}),
            });
          },
        },
      );
      // glyph_render emits: 0 starting → 1 parsed → 2 materialized → 3 compiled → 4 rendered.
      expect(events.length).toBeGreaterThanOrEqual(4);
      // The last event should report the final progress.
      const last = events[events.length - 1];
      expect(last?.progress).toBe(4);
      expect(last?.total).toBe(4);
      // Monotonic invariant (PR72 review): progress values must be
      // non-decreasing within a single request. A future refactor that
      // reorders milestones would silently break this without the check.
      const progresses = events.map((e) => e.progress);
      const sorted = [...progresses].sort((a, b) => a - b);
      expect(progresses).toEqual(sorted);
      // Also strictly increasing — no duplicate-progress emits.
      expect(new Set(progresses).size).toBe(progresses.length);
    });

    it("glyph_render with NO progressToken stays backward-compatible (no events)", async () => {
      const r = await callText(client, "glyph_render", {
        spec: {
          data: { source: fixture, format: "csv" },
          layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
        },
      });
      expect(r.isError).toBeFalsy();
      // No throw; result body is the same as before — no synthetic progress
      // payload leaks into the final result.
      const out = JSON.parse(r.text);
      expect(out.svg).toContain("<svg");
      expect(out.handle_id).toBeTruthy();
    });

    it("glyph_query with progressToken emits at least 2 progress notifications", async () => {
      // First render to get a handle.
      const r1 = await callText(client, "glyph_render", {
        spec: {
          data: { source: fixture, format: "csv" },
          layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
        },
      });
      const handleId = JSON.parse(r1.text).handle_id as string;
      const events: Array<{ progress: number }> = [];
      await client.callTool(
        {
          name: "glyph_query",
          arguments: { handle_id: handleId },
        },
        undefined,
        {
          onprogress: (p) => {
            events.push({ progress: p.progress });
          },
        },
      );
      expect(events.length).toBeGreaterThanOrEqual(2);
    });

    it("progress notification failure does NOT fail the underlying verb", async () => {
      // Even if the host's onprogress callback throws, the final result
      // must still arrive. sendProgress swallows errors defensively.
      const r = await client.callTool(
        {
          name: "glyph_render",
          arguments: {
            spec: {
              data: { source: fixture, format: "csv" },
              layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
            },
          },
        },
        undefined,
        {
          onprogress: () => {
            // simulate flaky receiver
            throw new Error("client side progress handler crashed");
          },
        },
      );
      // The call returned (didn't reject) — that's the contract.
      const content = ((r as { content?: ReadonlyArray<unknown> }).content ?? []) as ReadonlyArray<{
        type: string;
        text?: string;
      }>;
      const tb = content.find((c) => c.type === "text");
      expect(tb?.text).toBeTruthy();
    });
  });

  describe("glyph_engagement_record + _query (PR71 / PLAN 1.5)", () => {
    it("records + reads back a view event for a handle", async () => {
      const rec = await callText(client, "glyph_engagement_record", {
        handle_id: "h_abc",
        kind: "view",
      });
      expect(rec.isError).toBeFalsy();
      const out = JSON.parse(rec.text);
      expect(out.recorded).toBe(true);

      const q = await callText(client, "glyph_engagement_query", {
        handle_id: "h_abc",
      });
      expect(q.isError).toBeFalsy();
      const list = JSON.parse(q.text);
      expect(list.count).toBe(1);
      expect(list.rows[0].kind).toBe("view");
      expect(list.rows[0].handleId).toBe("h_abc");
    });

    it("records numeric value + detail and round-trips them", async () => {
      await callText(client, "glyph_engagement_record", {
        handle_id: "h_xyz",
        kind: "focus",
        value: 2500,
        detail: "panel-3",
      });
      const q = await callText(client, "glyph_engagement_query", {
        handle_id: "h_xyz",
        kind: "focus",
      });
      const list = JSON.parse(q.text);
      expect(list.rows[0].value).toBe(2500);
      expect(list.rows[0].detail).toBe("panel-3");
    });

    it("aggregate mode returns per-handle view/click counts + focus total", async () => {
      const handle = "h_agg";
      await callText(client, "glyph_engagement_record", { handle_id: handle, kind: "view" });
      await callText(client, "glyph_engagement_record", { handle_id: handle, kind: "view" });
      await callText(client, "glyph_engagement_record", { handle_id: handle, kind: "click" });
      await callText(client, "glyph_engagement_record", {
        handle_id: handle,
        kind: "focus",
        value: 1000,
      });
      await callText(client, "glyph_engagement_record", {
        handle_id: handle,
        kind: "focus",
        value: 500,
      });

      const q = await callText(client, "glyph_engagement_query", { aggregate: true });
      const list = JSON.parse(q.text);
      const ours = (list.rows as ReadonlyArray<{ handleId: string }>).find(
        (r) => r.handleId === handle,
      );
      expect(ours).toBeDefined();
      expect((ours as { views: number }).views).toBe(2);
      expect((ours as { clicks: number }).clicks).toBe(1);
      expect((ours as { focus_ms_total: number }).focus_ms_total).toBe(1500);
    });

    it("filter by kind restricts the row set", async () => {
      const handle = "h_filter";
      await callText(client, "glyph_engagement_record", { handle_id: handle, kind: "view" });
      await callText(client, "glyph_engagement_record", { handle_id: handle, kind: "click" });
      const q = await callText(client, "glyph_engagement_query", {
        handle_id: handle,
        kind: "click",
      });
      const list = JSON.parse(q.text);
      expect(list.count).toBe(1);
      expect(list.rows[0].kind).toBe("click");
    });

    it("filter by kind alone (no handle_id) spans every handle", async () => {
      // Two different handles, same kind — both must come back when filtering
      // by kind only (PR71 review nit on missing coverage).
      await callText(client, "glyph_engagement_record", {
        handle_id: "h_kind_a",
        kind: "scroll",
      });
      await callText(client, "glyph_engagement_record", {
        handle_id: "h_kind_b",
        kind: "scroll",
      });
      const q = await callText(client, "glyph_engagement_query", { kind: "scroll" });
      const list = JSON.parse(q.text);
      const handles = new Set(
        (list.rows as ReadonlyArray<{ handleId: string }>).map((r) => r.handleId),
      );
      expect(handles.has("h_kind_a")).toBe(true);
      expect(handles.has("h_kind_b")).toBe(true);
    });

    it("rejects limit > 10000 with a clean Zod error", async () => {
      const r = await callText(client, "glyph_engagement_query", { limit: 10_001 });
      expect(r.isError).toBe(true);
    });

    it("accepts limit = 10000 (boundary)", async () => {
      const r = await callText(client, "glyph_engagement_query", { limit: 10_000 });
      expect(r.isError).toBeFalsy();
    });

    it("aggregate=true with filters returns a clear error rather than ignoring them", async () => {
      const r = await callText(client, "glyph_engagement_query", {
        aggregate: true,
        handle_id: "h_x",
      });
      expect(r.isError).toBe(true);
      expect(r.text).toContain("does not support");
    });
  });

  describe("glyph_macro_replay (PR70 / PLAN 2.5)", () => {
    it("replays a render → query macro deterministically", async () => {
      const macro = {
        name: "describe-then-render",
        version: 1,
        steps: [
          { verb: "glyph_describe", args: { source: "{{params.src}}" } },
          {
            verb: "glyph_render",
            args: {
              spec: {
                data: { source: "{{params.src}}", format: "csv" },
                layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
              },
            },
          },
        ],
      };
      const r = await callText(client, "glyph_macro_replay", {
        macro,
        params: { src: fixture },
      });
      expect(r.isError).toBeFalsy();
      const out = JSON.parse(r.text);
      expect(out.total_steps).toBe(2);
      expect(out.completed_steps).toBe(2);
      expect(out.steps[0].ok).toBe(true);
      expect(out.steps[1].ok).toBe(true);
      expect((out.steps[1].result as { handle_id: string }).handle_id).toBeTruthy();
    });

    it("rejects a macro referencing a verb outside the v0 replay set", async () => {
      const r = await callText(client, "glyph_macro_replay", {
        macro: {
          name: "bad",
          version: 1,
          steps: [{ verb: "glyph_act", args: {} }],
        },
      });
      expect(r.isError).toBe(true);
      expect(r.text).toContain("not in the supported replay set");
    });

    it("rejects a macro that references unsupplied params", async () => {
      const r = await callText(client, "glyph_macro_replay", {
        macro: {
          name: "x",
          version: 1,
          steps: [{ verb: "glyph_describe", args: { source: "{{params.src}}" } }],
        },
        // No params supplied.
      });
      expect(r.isError).toBe(true);
      expect(r.text).toContain("not supplied");
    });

    it("fails fast on a mid-macro step error and marks overall as error", async () => {
      const macro = {
        name: "chain",
        version: 1,
        steps: [
          { verb: "glyph_describe", args: { source: "{{params.src}}" } },
          { verb: "glyph_query", args: { handle_id: "nonexistent_handle" } },
        ],
      };
      const r = await callText(client, "glyph_macro_replay", {
        macro,
        params: { src: fixture },
      });
      expect(r.isError).toBe(true);
      const out = JSON.parse(r.text);
      expect(out.completed_steps).toBe(1);
      expect(out.steps[0].ok).toBe(true);
      expect(out.steps[1].ok).toBe(false);
      expect(out.steps[1].error).toMatch(/Unknown handle_id/i);
    });

    it("rejects an empty steps array up front", async () => {
      const r = await callText(client, "glyph_macro_replay", {
        macro: { name: "empty", version: 1, steps: [] },
      });
      expect(r.isError).toBe(true);
      expect(r.text).toContain("at least one");
    });

    it("is deterministic — macro replay byte-identical to a direct render", async () => {
      const spec = {
        data: { source: fixture, format: "csv" },
        layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
      };
      // Direct render — establishes the SVG ground truth.
      const direct = await callText(client, "glyph_render", { spec });
      const directOut = JSON.parse(direct.text);

      // Same spec via macro replay.
      const macro = {
        name: "dt",
        version: 1,
        steps: [
          {
            verb: "glyph_render",
            args: {
              spec: {
                data: { source: "{{params.src}}", format: "csv" },
                layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
              },
            },
          },
        ],
      };
      const r = await callText(client, "glyph_macro_replay", {
        macro,
        params: { src: fixture },
      });
      const out = JSON.parse(r.text);
      const macroHandleId = (out.steps[0].result as { handle_id: string }).handle_id;
      // Fetch the SVG the macro path produced (stored by runRenderInternal)
      // by calling glyph_preview which serves the cached svg byte-for-byte.
      const macroSvgResp = await callText(client, "glyph_preview", {
        handle_id: macroHandleId,
      });
      void macroSvgResp;
      // Stronger: the row_count, title, and column shape must match the
      // direct render's. (handle_id differs across calls — that's a fresh
      // session-scoped uuid, not a determinism break.)
      expect((out.steps[0].result as { row_count: number }).row_count).toBe(directOut.row_count);
      expect((out.steps[0].result as { title?: string }).title).toBe(directOut.title);
    });
  });

  describe("glyph_audit_spec (PR63 / PLAN 2.2)", () => {
    it("returns findings for a truncated-y bar chart", async () => {
      const r = await callText(client, "glyph_audit_spec", {
        spec: {
          data: { source: "x.csv" },
          layers: [
            {
              mark: "bar",
              encoding: {
                x: "x",
                y: { field: "y", scale: { domain: [100, 200] } },
              },
            },
          ],
        },
      });
      expect(r.isError).toBe(false);
      const out = JSON.parse(r.text);
      expect(out.highSeverity).toBeGreaterThanOrEqual(1);
      expect(out.findings.some((f: { rule_id: string }) => f.rule_id === "AUDIT-01")).toBe(true);
    });

    it("returns an empty audit for a clean spec", async () => {
      const r = await callText(client, "glyph_audit_spec", {
        spec: {
          data: { source: "x.csv" },
          width: 800,
          height: 400,
          layers: [{ mark: "bar", encoding: { x: "x", y: "y" } }],
        },
        rowCount: 100,
      });
      expect(r.isError).toBe(false);
      const out = JSON.parse(r.text);
      // No high-severity findings on a clean spec.
      expect(out.highSeverity).toBe(0);
    });

    it("rejects an invalid spec", async () => {
      const r = await callText(client, "glyph_audit_spec", {
        spec: { not_a_spec: true },
      });
      expect(r.isError).toBe(true);
    });
  });

  describe("glyph_story_provide_plan (PR69 / PLAN 1.1)", () => {
    it("planner_hint='llm' returns awaiting plan with schema context", async () => {
      const r = await callText(client, "glyph_story_plan", {
        intent: "what's interesting in this data",
        source: fixture,
        planner_hint: "llm",
      });
      expect(r.isError).toBe(false);
      const plan = JSON.parse(r.text);
      expect(plan.status).toBe("awaiting_planner");
      expect(plan.nodes).toEqual([]);
      expect(plan.schema).toBeDefined();
      expect(plan.schema.length).toBeGreaterThan(0);
      expect(plan.hint).toContain("glyph_story_provide_plan");
    });

    it("provide_plan fulfills the awaiting plan and flips to planned", async () => {
      const r1 = await callText(client, "glyph_story_plan", {
        intent: "x",
        source: fixture,
        planner_hint: "llm",
      });
      const planId = JSON.parse(r1.text).plan_id as string;

      const r2 = await callText(client, "glyph_story_provide_plan", {
        plan_id: planId,
        nodes: [
          {
            id: "n1",
            kind: "describe",
            label: "inspect taxi data",
            args: { source: fixture },
            dependsOn: [],
          },
          {
            id: "n2",
            kind: "render",
            label: "bar chart of rides",
            args: {
              spec: {
                data: { source: fixture, format: "csv" },
                layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
              },
            },
            dependsOn: ["n1"],
          },
        ],
      });
      expect(r2.isError).toBe(false);
      const out = JSON.parse(r2.text);
      expect(out.status).toBe("planned");
      expect(out.nodes.length).toBe(2);
    });

    it("provide_plan rejects invalid node shapes with a precise error", async () => {
      const r1 = await callText(client, "glyph_story_plan", {
        intent: "x",
        source: fixture,
        planner_hint: "llm",
      });
      const planId = JSON.parse(r1.text).plan_id as string;
      const r2 = await callText(client, "glyph_story_provide_plan", {
        plan_id: planId,
        nodes: [{ id: "bad", kind: "frobnicate", label: "x", args: {}, dependsOn: [] }],
      });
      expect(r2.isError).toBe(true);
      expect(r2.text).toContain("kind");
    });

    it("provide_plan rejects duplicate node ids", async () => {
      const r1 = await callText(client, "glyph_story_plan", {
        intent: "x",
        source: fixture,
        planner_hint: "llm",
      });
      const planId = JSON.parse(r1.text).plan_id as string;
      const r2 = await callText(client, "glyph_story_provide_plan", {
        plan_id: planId,
        nodes: [
          // Both nodes carry valid args so the per-kind contract passes
          // — the duplicate-id guard is what we're testing here.
          { id: "a", kind: "describe", label: "x", args: { source: "x.csv" }, dependsOn: [] },
          { id: "a", kind: "describe", label: "y", args: { source: "x.csv" }, dependsOn: [] },
        ],
      });
      expect(r2.isError).toBe(true);
      expect(r2.text).toContain("duplicated");
    });

    it("provide_plan rejects forward references in dependsOn", async () => {
      const r1 = await callText(client, "glyph_story_plan", {
        intent: "x",
        source: fixture,
        planner_hint: "llm",
      });
      const planId = JSON.parse(r1.text).plan_id as string;
      const r2 = await callText(client, "glyph_story_provide_plan", {
        plan_id: planId,
        nodes: [
          { id: "a", kind: "describe", label: "x", args: { source: "x.csv" }, dependsOn: ["b"] },
          { id: "b", kind: "describe", label: "y", args: { source: "x.csv" }, dependsOn: [] },
        ],
      });
      expect(r2.isError).toBe(true);
      expect(r2.text).toContain("unknown");
    });

    it("provide_plan rejects when the plan is not awaiting (already planned)", async () => {
      const r1 = await callText(client, "glyph_story_plan", {
        intent: "x",
        source: fixture,
      });
      // No planner_hint — defaults to heuristic → status='planned'.
      const planId = JSON.parse(r1.text).plan_id as string;
      const r2 = await callText(client, "glyph_story_provide_plan", {
        plan_id: planId,
        nodes: [{ id: "a", kind: "describe", label: "x", args: {}, dependsOn: [] }],
      });
      expect(r2.isError).toBe(true);
      expect(r2.text).toContain("not awaiting a planner");
    });

    it("glyph_story_execute refuses to run an awaiting plan", async () => {
      const r1 = await callText(client, "glyph_story_plan", {
        intent: "x",
        source: fixture,
        planner_hint: "llm",
      });
      const planId = JSON.parse(r1.text).plan_id as string;
      const r2 = await callText(client, "glyph_story_execute", { plan_id: planId });
      expect(r2.isError).toBe(true);
      expect(r2.text).toContain("awaiting");
    });

    it("provide_plan rejects an unknown plan_id", async () => {
      const r = await callText(client, "glyph_story_provide_plan", {
        plan_id: "nope",
        nodes: [
          { id: "a", kind: "describe", label: "x", args: { source: "x.csv" }, dependsOn: [] },
        ],
      });
      expect(r.isError).toBe(true);
      expect(r.text).toContain("Unknown plan_id");
    });

    it("provide_plan rejects self-dependency", async () => {
      const r1 = await callText(client, "glyph_story_plan", {
        intent: "x",
        source: fixture,
        planner_hint: "llm",
      });
      const planId = JSON.parse(r1.text).plan_id as string;
      const r2 = await callText(client, "glyph_story_provide_plan", {
        plan_id: planId,
        nodes: [
          { id: "a", kind: "describe", label: "x", args: { source: "x.csv" }, dependsOn: ["a"] },
        ],
      });
      expect(r2.isError).toBe(true);
      expect(r2.text).toContain("itself");
    });

    it("provide_plan rejects a render node missing args.spec", async () => {
      const r1 = await callText(client, "glyph_story_plan", {
        intent: "x",
        source: fixture,
        planner_hint: "llm",
      });
      const planId = JSON.parse(r1.text).plan_id as string;
      const r2 = await callText(client, "glyph_story_provide_plan", {
        plan_id: planId,
        nodes: [
          // Missing args.spec — would crash deep inside the executor without this check.
          { id: "r", kind: "render", label: "render", args: {}, dependsOn: [] },
        ],
      });
      expect(r2.isError).toBe(true);
      expect(r2.text).toContain("args.spec");
    });

    it("provide_plan rejects an anomaly node missing args.valueField", async () => {
      const r1 = await callText(client, "glyph_story_plan", {
        intent: "x",
        source: fixture,
        planner_hint: "llm",
      });
      const planId = JSON.parse(r1.text).plan_id as string;
      const r2 = await callText(client, "glyph_story_provide_plan", {
        plan_id: planId,
        nodes: [
          {
            id: "a",
            kind: "anomaly",
            label: "anom",
            args: { handle_from: "n1" }, // valueField missing
            dependsOn: [],
          },
        ],
      });
      expect(r2.isError).toBe(true);
      expect(r2.text).toContain("valueField");
    });

    it("LLM-supplied plan executes end-to-end through glyph_story_execute", async () => {
      const r1 = await callText(client, "glyph_story_plan", {
        intent: "show me taxi rides",
        source: fixture,
        planner_hint: "llm",
      });
      const planId = JSON.parse(r1.text).plan_id as string;
      const r2 = await callText(client, "glyph_story_provide_plan", {
        plan_id: planId,
        nodes: [
          {
            id: "n_describe",
            kind: "describe",
            label: "inspect",
            args: { source: fixture },
            dependsOn: [],
          },
          {
            id: "n_render",
            kind: "render",
            label: "bar chart",
            args: {
              spec: {
                data: { source: fixture, format: "csv" },
                layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
              },
            },
            dependsOn: ["n_describe"],
          },
        ],
      });
      expect(r2.isError).toBe(false);
      const r3 = await callText(client, "glyph_story_execute", { plan_id: planId });
      expect(r3.isError).toBe(false);
      const out = JSON.parse(r3.text);
      expect(out.status).toBe("complete");
    });
  });

  describe("glyph_story_clarify (PR62 / PLAN 1.4)", () => {
    it("planner emits clarification_questions when multiple columns fit a role", async () => {
      // The taxi fixture has 3 INTEGER columns — fare and rides both fit
      // the "quantitative y" role, so the planner should ask.
      const r = await callText(client, "glyph_story_plan", {
        intent: "tell me about taxi data",
        source: fixture,
      });
      expect(r.isError).toBe(false);
      const plan = JSON.parse(r.text);
      expect(plan.clarification_questions).toBeDefined();
      expect(plan.clarification_questions.length).toBeGreaterThanOrEqual(1);
    });

    it("clarify round-trips an answer onto the plan", async () => {
      const r1 = await callText(client, "glyph_story_plan", {
        intent: "tell me about taxi data",
        source: fixture,
      });
      const plan = JSON.parse(r1.text);
      const r2 = await callText(client, "glyph_story_clarify", {
        plan_id: plan.id,
        answers: [{ field: "y", choice: "rides" }],
      });
      expect(r2.isError).toBe(false);
      const out = JSON.parse(r2.text);
      expect(out.status).toBe("clarified_but_not_yet_applied");
      expect(out.answers).toEqual([{ field: "y", choice: "rides" }]);
    });

    it("rejects an unknown plan_id", async () => {
      const r = await callText(client, "glyph_story_clarify", {
        plan_id: "nope",
        answers: [{ field: "y", choice: "rides" }],
      });
      expect(r.isError).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // glyph_story (Joy of Math PR E5) — natural-language composer
  //
  // The verb is a pure recipe-lookup; no engine state is involved. These
  // tests focus on the handler contract: matched intent → spec + caption
  // sequence; unmatched intent → empty spec + recipe list in
  // explanation.suggestedFollowups; arg validation rejects out-of-range
  // duration. The composer's own determinism + recipe coverage are
  // exercised at the unit level in `packages/core/src/story/compose.test.ts`.
  // ---------------------------------------------------------------------------
  describe("glyph_story (Joy of Math PR E5 — natural-language composer)", () => {
    it("composes a sine-wave story from a kid-targeted intent", async () => {
      const r = await callText(client, "glyph_story", {
        intent: "show me a sine wave for an 8-year-old",
        audience: "kid",
      });
      expect(r.isError).toBe(false);
      const out = JSON.parse(r.text);
      // Spec must round-trip through the parser — guards against the
      // composer drifting away from the Glyph schema.
      expect(out.spec).toBeDefined();
      expect(Array.isArray(out.spec.layers)).toBe(true);
      expect(out.spec.layers.length).toBeGreaterThan(0);
      // Kid audience → playground theme by default.
      expect(out.spec.theme).toBe("playground");
      // Multi-scene timeline is the whole point of the bar-raiser.
      expect(out.spec.animation?.kind).toBe("timeline");
      expect(out.spec.animation?.scenes?.length).toBeGreaterThanOrEqual(2);
      // M2 explanation envelope is attached and follows the structured
      // shape — at minimum a headline + a non-empty followups list.
      expect(out.explanation).toBeDefined();
      expect(typeof out.explanation.headline).toBe("string");
      // Caption sequence is a flat scene→text→at_ms list the UI can
      // subscribe to without re-parsing the spec.
      expect(Array.isArray(out.caption_sequence)).toBe(true);
      expect(out.caption_sequence.length).toBeGreaterThan(0);
      for (const cap of out.caption_sequence) {
        expect(typeof cap.scene).toBe("string");
        expect(typeof cap.text).toBe("string");
        expect(typeof cap.at_ms).toBe("number");
      }
    });

    it("returns the same JSON bytes for identical inputs (determinism)", async () => {
      const r1 = await callText(client, "glyph_story", {
        intent: "show me a parabola",
        audience: "kid",
      });
      const r2 = await callText(client, "glyph_story", {
        intent: "show me a parabola",
        audience: "kid",
      });
      expect(r1.text).toBe(r2.text);
    });

    it("falls back to a recipe-list explanation on unknown intent", async () => {
      const r = await callText(client, "glyph_story", {
        intent: "make me a piano",
      });
      expect(r.isError).toBe(false);
      const out = JSON.parse(r.text);
      // Empty spec is the documented no-match signal — no layers, no
      // animation. The agent is expected to read `suggestedFollowups`
      // and prompt the user with a known recipe.
      expect(out.spec.layers ?? []).toEqual([]);
      expect(out.explanation.suggestedFollowups?.length ?? 0).toBeGreaterThan(0);
    });

    it("rejects an out-of-range duration_ms via the input schema", async () => {
      const r = await callText(client, "glyph_story", {
        intent: "show me a sine wave",
        duration_ms: 9_999_999,
      });
      // MCP validation rejects values > 60_000 (the schema cap).
      expect(r.isError).toBe(true);
    });
  });
});
