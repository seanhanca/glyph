/**
 * Linked-view filter bus — Innovation #4 (PR46).
 *
 * The substrate that makes multiple charts in a storyboard / preview page
 * behave like a single dashboard. Each chart that opts into a
 * `link_group: <name>` joins the same selection context: a click (or
 * brush) in one chart broadcasts a SQL predicate to every other chart in
 * the same group. Subscribers long-poll for events; the MCP server stores
 * a bounded ring per group so subscribers that joined late don't miss
 * recent events.
 *
 * The bus is intentionally simple: events carry { predicate, source_handle,
 * at }. Consumers decide whether to apply the predicate to their own
 * `glyph_query` / `glyph_drill` calls. No engine state changes here.
 */

import { randomUUID } from "node:crypto";

/** A single linked-filter event. */
export interface LinkedEvent {
  readonly id: string;
  readonly group: string;
  readonly predicate: string;
  /** Handle that originated the event (for "don't echo back to me" filtering). */
  readonly source_handle?: string | undefined;
  /** Optional human-friendly summary (for the narrator agent). */
  readonly summary?: string | undefined;
  readonly at: string;
}

type Waiter = (e: LinkedEvent) => void;

/**
 * In-memory broker for linked-view events. One per ServerState. Keeps a
 * bounded ring of recent events per group + a waker list for long-polls.
 */
export class LinkGroupStore {
  private readonly events = new Map<string, LinkedEvent[]>();
  private readonly waiters = new Map<string, Waiter[]>();
  /** Handles that joined a group (for `glyph_linked_handles`). */
  private readonly handlesByGroup = new Map<string, Set<string>>();
  /** Max history per group; oldest events drop off. */
  private readonly ringSize: number;

  constructor(ringSize = 64) {
    this.ringSize = ringSize;
  }

  /** Register a handle as a participant in a group. Idempotent. */
  registerHandle(group: string, handle_id: string): void {
    let set = this.handlesByGroup.get(group);
    if (!set) {
      set = new Set<string>();
      this.handlesByGroup.set(group, set);
    }
    set.add(handle_id);
  }

  /** Handles known in this group, in insertion order. */
  handles(group: string): ReadonlyArray<string> {
    return Array.from(this.handlesByGroup.get(group) ?? []);
  }

  /** Append an event + wake every long-poll waiter on this group. */
  publish(args: {
    readonly group: string;
    readonly predicate: string;
    readonly source_handle?: string | undefined;
    readonly summary?: string | undefined;
  }): LinkedEvent {
    const event: LinkedEvent = {
      id: randomUUID().replace(/-/g, "").slice(0, 16),
      group: args.group,
      predicate: args.predicate,
      ...(args.source_handle !== undefined ? { source_handle: args.source_handle } : {}),
      ...(args.summary !== undefined ? { summary: args.summary } : {}),
      at: new Date().toISOString(),
    };
    let ring = this.events.get(args.group);
    if (!ring) {
      ring = [];
      this.events.set(args.group, ring);
    }
    ring.push(event);
    if (ring.length > this.ringSize) ring.shift();

    const ws = this.waiters.get(args.group);
    if (ws) {
      while (ws.length > 0) {
        const fn = ws.shift();
        if (fn) fn(event);
      }
    }
    return event;
  }

  /**
   * Long-poll for the next event after `sinceIndex` in this group. The
   * `sinceIndex` is the receiver's "last-seen-position" inside the
   * group's ring. Returns undefined on timeout. To replay history,
   * pass sinceIndex=0; to catch up, pass the most recent index seen.
   */
  awaitNext(args: {
    readonly group: string;
    readonly sinceIndex: number;
    readonly timeoutMs: number;
  }): Promise<{ event: LinkedEvent; index: number } | undefined> {
    const ring = this.events.get(args.group) ?? [];
    if (ring.length > args.sinceIndex) {
      const event = ring[args.sinceIndex];
      if (event) return Promise.resolve({ event, index: args.sinceIndex });
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const list = this.waiters.get(args.group);
        if (list) {
          const idx = list.indexOf(waiter);
          if (idx >= 0) list.splice(idx, 1);
        }
        resolve(undefined);
      }, args.timeoutMs);
      const waiter: Waiter = (e) => {
        clearTimeout(timer);
        const newRing = this.events.get(args.group) ?? [];
        resolve({ event: e, index: newRing.length - 1 });
      };
      let list = this.waiters.get(args.group);
      if (!list) {
        list = [];
        this.waiters.set(args.group, list);
      }
      list.push(waiter);
    });
  }

  /** Replay recent events from this group (newest first). */
  recent(group: string, limit = 16): ReadonlyArray<LinkedEvent> {
    const ring = this.events.get(group) ?? [];
    return ring.slice(-limit).reverse();
  }
}
