/**
 * MCP server integration tests.
 *
 * Connects an in-memory pair of transports (the SDK provides one), exercises
 * each of the three tools end-to-end, and verifies the agent-visible round
 * trip works: describe → render → query.
 */

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

  beforeEach(async () => {
    state = new ServerState();
    const { server } = createServer(state);
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);
    client = new Client({ name: "test-client", version: "0.0.0" });
    await client.connect(clientT);
  });

  afterEach(async () => {
    await client.close();
    await state.close();
  });

  it("lists the fourteen tools", async () => {
    const r = await client.listTools();
    const names = r.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "glyph_await_interaction",
      "glyph_capabilities",
      "glyph_close_preview",
      "glyph_describe",
      "glyph_drill",
      "glyph_explain",
      "glyph_handles",
      "glyph_import",
      "glyph_lineage",
      "glyph_preview",
      "glyph_publish",
      "glyph_query",
      "glyph_render",
      "glyph_subscribe",
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
      "glyph_await_interaction",
      "glyph_capabilities",
      "glyph_close_preview",
      "glyph_describe",
      "glyph_drill",
      "glyph_explain",
      "glyph_handles",
      "glyph_import",
      "glyph_lineage",
      "glyph_preview",
      "glyph_publish",
      "glyph_query",
      "glyph_render",
      "glyph_subscribe",
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
  });
});
