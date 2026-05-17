/**
 * Process-lifetime state for the MCP server.
 *
 * One engine, a handle store keyed by handle id, and a serial mutex so async
 * tool calls don't race on the DuckDB connection. (DuckDB's connection model
 * is single-writer; serializing here is simpler than pooling for Phase 0.)
 *
 * Also owns the optional preview server (lazy-started on first
 * `glyph_preview` call; stopped on close).
 */

import { randomUUID } from "node:crypto";
import type { ComputeEngine, DataHandle, QueryHandle } from "@glyph/core";
import { createDuckDBEngine, materializeRowsAsHandle, materializeSpec } from "@glyph/duckdb";
import {
  type PreviewServer,
  type PreviewServerOptions,
  createPreviewServer,
} from "@glyph/preview-server";

export class ServerState {
  private engine: ComputeEngine | undefined;
  private readonly handles = new Map<string, DataHandle>();
  /** Secondary index: gdf:// uri → handle id. Populated when handles are stored. */
  private readonly handlesByUri = new Map<string, string>();
  /** Per-session id for minted URIs. Random per ServerState instance. */
  readonly sessionId: string;
  private readonly svgsByHandle = new Map<string, string>();
  private chain: Promise<unknown> = Promise.resolve();
  private preview: PreviewServer | undefined;
  private readonly previewOptions: PreviewServerOptions;

  constructor(options: { preview?: PreviewServerOptions; sessionId?: string } = {}) {
    this.previewOptions = options.preview ?? {};
    this.sessionId = options.sessionId ?? randomUUID().replace(/-/g, "").slice(0, 16);
  }

  async getEngine(): Promise<ComputeEngine> {
    if (!this.engine) {
      this.engine = await createDuckDBEngine();
    }
    return this.engine;
  }

  /** Store a handle and (if it carries a URI) index it by URI as well. */
  storeHandle(handle: QueryHandle): void {
    this.handles.set(handle.id, handle as DataHandle);
    const h = handle as DataHandle;
    if (h.uri) {
      this.handlesByUri.set(h.uri, h.id);
    }
  }

  getHandle(id: string): DataHandle | undefined {
    return this.handles.get(id);
  }

  /** Lookup a handle by its gdf:// URI. */
  getHandleByUri(uri: string): DataHandle | undefined {
    const id = this.handlesByUri.get(uri);
    return id ? this.handles.get(id) : undefined;
  }

  /** All handles in this session (insertion order). */
  allHandles(): ReadonlyArray<DataHandle> {
    return Array.from(this.handles.values());
  }

  /** Cache the rendered SVG for a handle so the preview server can serve it. */
  storeSvg(handleId: string, svg: string): void {
    this.svgsByHandle.set(handleId, svg);
    // If the preview server is already up, register the chart eagerly so a
    // subsequent `glyph_preview` deep-link doesn't 404.
    if (this.preview?.isRunning()) {
      this.preview.registerChart(handleId, svg);
    }
  }

  /** Lazy-start the preview server; idempotent. */
  async getPreview(): Promise<PreviewServer> {
    if (this.preview?.isRunning()) return this.preview;
    if (!this.preview) {
      this.preview = createPreviewServer(this.previewOptions);
    }
    await this.preview.start();
    // Backfill any SVGs we've cached before the server existed.
    for (const [handleId, svg] of this.svgsByHandle) {
      this.preview.registerChart(handleId, svg);
    }
    return this.preview;
  }

  /** Returns the preview server if running, otherwise undefined. */
  getPreviewIfRunning(): PreviewServer | undefined {
    return this.preview?.isRunning() ? this.preview : undefined;
  }

  /** Serialize all engine-touching async work. */
  serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next;
  }

  async close(): Promise<void> {
    await this.chain.catch(() => undefined);
    if (this.preview) {
      await this.preview.stop();
      this.preview = undefined;
    }
    if (this.engine) {
      await this.engine.close();
      this.engine = undefined;
    }
  }
}

export { materializeSpec, materializeRowsAsHandle };
