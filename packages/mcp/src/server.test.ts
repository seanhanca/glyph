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

  it("lists the nine tools", async () => {
    const r = await client.listTools();
    const names = r.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "glyph_await_interaction",
      "glyph_capabilities",
      "glyph_close_preview",
      "glyph_describe",
      "glyph_drill",
      "glyph_import",
      "glyph_preview",
      "glyph_query",
      "glyph_render",
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
      "glyph_import",
      "glyph_preview",
      "glyph_query",
      "glyph_render",
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
});
