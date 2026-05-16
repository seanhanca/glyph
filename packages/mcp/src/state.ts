/**
 * Process-lifetime state for the MCP server.
 *
 * One engine, a handle store keyed by handle id, and a serial mutex so async
 * tool calls don't race on the DuckDB connection. (DuckDB's connection model
 * is single-writer; serializing here is simpler than pooling for Phase 0.)
 */

import type { ComputeEngine, QueryHandle } from "@glyph/core";
import { createDuckDBEngine, materializeSpec } from "@glyph/duckdb";

export class ServerState {
  private engine: ComputeEngine | undefined;
  private readonly handles = new Map<string, QueryHandle>();
  private chain: Promise<unknown> = Promise.resolve();

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

  /** Serialize all engine-touching async work. */
  serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next;
  }

  async close(): Promise<void> {
    await this.chain.catch(() => undefined);
    if (this.engine) {
      await this.engine.close();
      this.engine = undefined;
    }
  }
}

export { materializeSpec };
