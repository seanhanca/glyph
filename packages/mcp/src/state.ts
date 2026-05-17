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

import type { ComputeEngine, QueryHandle } from "@glyph/core";
import { createDuckDBEngine, materializeSpec } from "@glyph/duckdb";
import {
  type PreviewServer,
  type PreviewServerOptions,
  createPreviewServer,
} from "@glyph/preview-server";

export class ServerState {
  private engine: ComputeEngine | undefined;
  private readonly handles = new Map<string, QueryHandle>();
  private readonly svgsByHandle = new Map<string, string>();
  private chain: Promise<unknown> = Promise.resolve();
  private preview: PreviewServer | undefined;
  private readonly previewOptions: PreviewServerOptions;

  constructor(options: { preview?: PreviewServerOptions } = {}) {
    this.previewOptions = options.preview ?? {};
  }

  async getEngine(): Promise<ComputeEngine> {
    if (!this.engine) {
      this.engine = await createDuckDBEngine();
    }
    return this.engine;
  }

  storeHandle(handle: QueryHandle): void {
    this.handles.set(handle.id, handle);
  }

  getHandle(id: string): QueryHandle | undefined {
    return this.handles.get(id);
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

export { materializeSpec };
