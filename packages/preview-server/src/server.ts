/**
 * @glyph/preview-server — opt-in, localhost-only HTTP server.
 *
 * Hosts a single page that renders interactive Glyph charts. The MCP server
 * registers SVGs via `registerChart(handle, svg)`; the browser fetches them
 * via `/api/charts/<handle>.svg`. User interactions POST to
 * `/api/interactions/<handle>` and are surfaced to the agent via the
 * `awaitInteraction(handle, timeoutMs)` method on this object (which the
 * MCP `glyph_await_interaction` verb wraps).
 *
 * Hard guarantees:
 *   - Binds only to 127.0.0.1.
 *   - All `/api/*` routes require a matching `X-Glyph-Token` header.
 *   - Constant-time token compare.
 *   - Bounded per-handle interaction queue (DROP_OLDEST overflow).
 *   - `stop()` resolves any parked long-pollers with `null` so callers don't hang.
 */

import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { type AuthState, newAuth, verifyToken } from "./auth.js";
import { renderPage } from "./page.js";
import { type InteractionEvent, InteractionQueue } from "./queue.js";

export interface PreviewServerOptions {
  /** Override host (defaults to 127.0.0.1; do not change unless you know why). */
  readonly host?: string;
  /** Pin a port for tests; default 0 (ephemeral). */
  readonly port?: number;
}

export interface PreviewUrl {
  readonly url: string;
  readonly port: number;
  readonly token: string;
}

export interface PreviewServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  /** Register the SVG for a chart handle. Replaces any prior entry. */
  registerChart(handleId: string, svg: string): void;
  /** Long-poll for the next interaction on a handle. Resolves to null on timeout. */
  awaitInteraction(handleId: string, timeoutMs: number): Promise<InteractionEvent | null>;
  /** Build a deep-link URL pointing at a specific chart. */
  urlFor(handleId?: string): PreviewUrl;
  /** Test helper. */
  pendingInteractions(handleId: string): number;
}

export function createPreviewServer(options: PreviewServerOptions = {}): PreviewServer {
  const host = options.host ?? "127.0.0.1";
  const requestedPort = options.port ?? 0;
  let auth: AuthState | undefined;
  let server: Server | undefined;
  let listening = false;
  const queue = new InteractionQueue();
  const charts = new Map<string, string>();

  function sendJson(res: ServerResponse, status: number, body: unknown): void {
    const text = JSON.stringify(body);
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(text);
  }

  function sendText(res: ServerResponse, status: number, mime: string, body: string): void {
    res.writeHead(status, {
      "content-type": mime,
      "cache-control": "no-store",
    });
    res.end(body);
  }

  function requireToken(req: IncomingMessage, res: ServerResponse): boolean {
    if (!auth) {
      sendJson(res, 503, { error: "server not started" });
      return false;
    }
    const supplied = req.headers["x-glyph-token"];
    const value = Array.isArray(supplied) ? supplied[0] : supplied;
    if (!verifyToken(auth, value)) {
      sendJson(res, 401, { error: "unauthorized" });
      return false;
    }
    return true;
  }

  async function readJson(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
      // Cap body size at 64 KiB; interaction payloads are tiny.
      if (chunks.reduce((acc, b) => acc + b.length, 0) > 64 * 1024) {
        throw new Error("request body too large");
      }
    }
    const body = Buffer.concat(chunks).toString("utf8");
    if (body.length === 0) return {};
    return JSON.parse(body);
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${host}`);
    const path = url.pathname;
    const method = req.method ?? "GET";

    // Page request — token is in the URL, not header. Validate so a wrong
    // token returns 401 rather than serving the page with a bad t param
    // baked into the JS.
    if (method === "GET" && (path === "/" || path === "/index.html")) {
      const t = url.searchParams.get("t");
      if (!auth || !verifyToken(auth, t ?? undefined)) {
        sendJson(res, 401, { error: "unauthorized" });
        return;
      }
      sendText(res, 200, "text/html; charset=utf-8", renderPage());
      return;
    }

    if (path === "/healthz") {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (!path.startsWith("/api/")) {
      sendJson(res, 404, { error: "not found" });
      return;
    }

    if (!requireToken(req, res)) return;

    // GET /api/charts/<handle>.svg
    const chartMatch = /^\/api\/charts\/([^/]+)\.svg$/.exec(path);
    if (method === "GET" && chartMatch) {
      const handleId = decodeURIComponent(chartMatch[1] ?? "");
      const svg = charts.get(handleId);
      if (!svg) {
        sendJson(res, 404, { error: "no such chart" });
        return;
      }
      sendText(res, 200, "image/svg+xml; charset=utf-8", svg);
      return;
    }

    // POST /api/interactions/<handle>
    const interMatch = /^\/api\/interactions\/([^/]+)$/.exec(path);
    if (method === "POST" && interMatch) {
      const handleId = decodeURIComponent(interMatch[1] ?? "");
      try {
        const body = (await readJson(req)) as Partial<InteractionEvent>;
        const kind = body.kind;
        if (kind !== "click" && kind !== "hover" && kind !== "brush" && kind !== "zoom") {
          sendJson(res, 400, { error: "invalid kind" });
          return;
        }
        const event: InteractionEvent = {
          kind,
          handleId,
          at: new Date().toISOString(),
          ...(body.binding ? { binding: body.binding } : {}),
          ...(body.whereSql ? { whereSql: body.whereSql } : {}),
          ...(body.extent ? { extent: body.extent } : {}),
        };
        queue.enqueue(event);
        sendJson(res, 202, { ok: true });
      } catch (err) {
        sendJson(res, 400, { error: (err as Error).message });
      }
      return;
    }

    sendJson(res, 404, { error: "not found" });
  }

  return {
    async start(): Promise<void> {
      if (listening) return;
      auth = newAuth();
      server = createServer((req, res) => {
        handle(req, res).catch((err) => {
          try {
            sendJson(res, 500, { error: (err as Error).message ?? String(err) });
          } catch {
            res.end();
          }
        });
      });
      await new Promise<void>((resolve, reject) => {
        const s = server;
        if (!s) return reject(new Error("no server"));
        s.once("error", reject);
        s.listen(requestedPort, host, () => {
          s.off("error", reject);
          resolve();
        });
      });
      listening = true;
    },

    async stop(): Promise<void> {
      if (!server) return;
      queue.shutdown();
      const s = server;
      server = undefined;
      auth = undefined;
      listening = false;
      charts.clear();
      await new Promise<void>((resolve) => {
        s.close(() => resolve());
      });
    },

    isRunning(): boolean {
      return listening;
    },

    registerChart(handleId: string, svg: string): void {
      charts.set(handleId, svg);
    },

    awaitInteraction(handleId: string, timeoutMs: number): Promise<InteractionEvent | null> {
      const clamped = Math.max(0, Math.min(60_000, timeoutMs));
      return queue.await(handleId, clamped);
    },

    urlFor(handleId?: string): PreviewUrl {
      if (!server || !auth) throw new Error("preview server not started");
      const addr = server.address() as AddressInfo | null;
      if (!addr) throw new Error("no address");
      const params = new URLSearchParams();
      params.set("t", auth.token);
      if (handleId) params.set("h", handleId);
      return {
        url: `http://${host}:${addr.port}/?${params.toString()}`,
        port: addr.port,
        token: auth.token,
      };
    },

    pendingInteractions(handleId: string): number {
      return queue.pending(handleId);
    },
  };
}
