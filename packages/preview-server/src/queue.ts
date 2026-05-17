/**
 * Per-handle interactions queue with long-poll support.
 *
 * Producer (the preview page) calls `enqueue(handle_id, event)` over HTTP.
 * Consumer (the agent, via `glyph_await_interaction` MCP verb) calls
 * `await(handle_id, timeoutMs)`:
 *   - If the queue has events, returns the head immediately.
 *   - Otherwise installs a one-shot waiter; the next `enqueue` resolves it.
 *   - If `timeoutMs` elapses with no event, resolves to `null`.
 *
 * Each queue is bounded to MAX_QUEUED_PER_HANDLE; overflow drops the
 * oldest event so we never grow unbounded for an idle agent.
 */

export const MAX_QUEUED_PER_HANDLE = 32;

/** A user-driven event captured from the preview page. */
export interface InteractionEvent {
  readonly kind: "click" | "hover" | "brush" | "zoom";
  readonly handleId: string;
  readonly at: string; // ISO timestamp
  /** The mark binding read from data-* attrs (when relevant). */
  readonly binding?: {
    readonly key?: string;
    readonly row?: number;
    readonly attrs?: Readonly<Record<string, string>>;
  };
  /** SQL clause derived from the event; empty when no field map is known. */
  readonly whereSql?: string;
  /** Extent (brush/zoom) when relevant. */
  readonly extent?:
    | { readonly kind: "numeric"; readonly min: number; readonly max: number }
    | { readonly kind: "discrete"; readonly values: ReadonlyArray<string> };
}

interface Waiter {
  resolve(event: InteractionEvent | null): void;
  timeout: ReturnType<typeof setTimeout>;
}

export class InteractionQueue {
  private readonly queues = new Map<string, InteractionEvent[]>();
  private readonly waiters = new Map<string, Waiter[]>();

  enqueue(event: InteractionEvent): void {
    // Fast path: a waiter is already parked.
    const waiterList = this.waiters.get(event.handleId);
    if (waiterList && waiterList.length > 0) {
      const w = waiterList.shift();
      if (w) {
        clearTimeout(w.timeout);
        w.resolve(event);
        return;
      }
    }
    // No waiter — buffer the event.
    let q = this.queues.get(event.handleId);
    if (!q) {
      q = [];
      this.queues.set(event.handleId, q);
    }
    q.push(event);
    if (q.length > MAX_QUEUED_PER_HANDLE) {
      q.shift(); // drop oldest
    }
  }

  /** Resolve immediately with a queued event, or wait up to `timeoutMs`. */
  await(handleId: string, timeoutMs: number): Promise<InteractionEvent | null> {
    const q = this.queues.get(handleId);
    if (q && q.length > 0) {
      return Promise.resolve(q.shift() ?? null);
    }
    return new Promise<InteractionEvent | null>((resolve) => {
      const timeout = setTimeout(() => {
        // Best-effort: remove ourselves from the waiter list on timeout.
        const list = this.waiters.get(handleId);
        if (list) {
          const i = list.findIndex((w) => w.resolve === resolve);
          if (i !== -1) list.splice(i, 1);
        }
        resolve(null);
      }, timeoutMs);
      let list = this.waiters.get(handleId);
      if (!list) {
        list = [];
        this.waiters.set(handleId, list);
      }
      list.push({ resolve, timeout });
    });
  }

  /** Drop everything. Called on server stop so waiters don't hang. */
  shutdown(): void {
    for (const list of this.waiters.values()) {
      for (const w of list) {
        clearTimeout(w.timeout);
        w.resolve(null);
      }
    }
    this.waiters.clear();
    this.queues.clear();
  }

  /** Test helper — current queue depth for a handle. */
  pending(handleId: string): number {
    return this.queues.get(handleId)?.length ?? 0;
  }
}
