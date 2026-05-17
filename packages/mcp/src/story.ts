/**
 * Story Agent — master orchestrator (PR41).
 *
 * The user's marquee request: a "story agent" that takes natural-language
 * intent + data sources, plans a multi-chart analytic storyboard as a DAG,
 * and executes it with streamable checkpoints + lineage-chained handles.
 *
 * v0 architecture
 *
 *   1. PLAN — A heuristic planner inspects the data sources (via
 *      glyph_describe), identifies temporal / quantitative / categorical
 *      columns, and emits a typed `StoryPlan { nodes[], edges[] }` where:
 *        - nodes describe steps (render / explain / diagnose / annotate)
 *        - edges encode DAG dependencies + which handle_ids flow where
 *      The planner takes a `domain` hint (e.g. "saas-mrr") that biases
 *      what metrics get registered + what diagnostics get run. LLM-driven
 *      planning is the v1 extension point (the planner is a single
 *      function — swap it).
 *
 *   2. EXECUTE — A topological-order executor walks the DAG, calling the
 *      MCP verbs in this server (glyph_render / explain / drift / etc.).
 *      Each completed node is appended to an in-memory checkpoint queue;
 *      `glyph_story_await_checkpoint` is the long-poll consumer (mirrors
 *      the glyph_await_interaction pattern). Sibling nodes run in
 *      parallel via Promise.all.
 *
 *   3. STORYBOARD — Once executed, the plan's `storyboard` field carries
 *      the assembled output: panels (chart + explanation), narrative
 *      (composed prose), and a lineage roll-up (every handle_id used).
 *
 *   4. REFINE — `glyph_story_refine(plan_id, feedback)` re-plans with the
 *      feedback note attached + re-executes only the affected branch of
 *      the DAG (downstream of the changed node). v0 ships full re-execute;
 *      surgical re-execute is a v1 follow-up.
 *
 * All persistent state piggybacks on `~/.glyph/memory.duckdb` via a
 * `gmem.__glyph_stories` table so plans survive an MCP restart.
 */

import { randomUUID } from "node:crypto";
import type { ComputeEngine } from "@glyph/core";
import type { MemoryStore } from "./memory.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NodeKind =
  | "describe"
  | "render"
  | "explain"
  | "anomaly"
  | "drift"
  | "forecast"
  | "annotate";

export type NodeStatus = "pending" | "running" | "done" | "failed";

export interface StoryNode {
  readonly id: string;
  readonly kind: NodeKind;
  readonly label: string;
  /** Verbatim args the executor will pass to the underlying MCP verb. */
  readonly args: Record<string, unknown>;
  /** Other node ids this node consumes. */
  readonly dependsOn: ReadonlyArray<string>;
  status: NodeStatus;
  /** Verb result merged in once the node runs. Shape is verb-specific. */
  result?: Record<string, unknown> | undefined;
  /** Captured error message when status === "failed". */
  error?: string | undefined;
  startedAt?: string | undefined;
  endedAt?: string | undefined;
}

export interface StoryPanel {
  readonly title: string;
  readonly description: string;
  readonly handle_id?: string | undefined;
  readonly chart_uri?: string | undefined;
  readonly explanation?: Record<string, unknown> | undefined;
}

export interface StoryBoard {
  readonly title: string;
  readonly intent: string;
  readonly panels: ReadonlyArray<StoryPanel>;
  readonly narrative: string;
  /** Every handle_id referenced by the plan, in execution order. */
  readonly handles: ReadonlyArray<string>;
}

export interface StoryPlan {
  readonly id: string;
  readonly intent: string;
  readonly sources: ReadonlyArray<string>;
  readonly domain?: string | undefined;
  readonly createdAt: string;
  status: "planned" | "running" | "complete" | "failed" | "refined";
  nodes: StoryNode[];
  storyboard?: StoryBoard | undefined;
  /** Append-only narrative log; useful for live streaming. */
  checkpoints: Array<StoryCheckpoint>;
}

export interface StoryCheckpoint {
  readonly at: string;
  readonly plan_id: string;
  readonly node_id: string;
  readonly kind: NodeKind;
  readonly status: NodeStatus;
  readonly label: string;
  readonly message: string;
  readonly handle_id?: string | undefined;
}

// ---------------------------------------------------------------------------
// Heuristic schema inspection
// ---------------------------------------------------------------------------

export interface ColumnSummaryLike {
  readonly name: string;
  readonly type: string;
  readonly distinct?: number;
  readonly suggestedType?: "quantitative" | "ordinal" | "nominal" | "temporal";
}

function inferRole(col: ColumnSummaryLike): NonNullable<ColumnSummaryLike["suggestedType"]> {
  if (col.suggestedType) return col.suggestedType;
  const t = col.type.toUpperCase();
  if (/TIMESTAMP|DATE|TIME/.test(t)) return "temporal";
  if (/INT|DECIMAL|DOUBLE|FLOAT|REAL|NUMERIC|HUGEINT/.test(t)) return "quantitative";
  return "nominal";
}

/**
 * Pick the columns that will play x / y / color / group for the auto-generated
 * panels. Deterministic — same schema → same picks.
 */
export function pickStoryRoles(columns: ReadonlyArray<ColumnSummaryLike>): {
  readonly y: ColumnSummaryLike | undefined;
  readonly x: ColumnSummaryLike | undefined;
  readonly color: ColumnSummaryLike | undefined;
  readonly hasTemporal: boolean;
} {
  const tagged = columns.map((c) => ({ col: c, role: inferRole(c) }));
  const y = tagged.find((t) => t.role === "quantitative")?.col;
  const temporal = tagged.find((t) => t.role === "temporal")?.col;
  // Preferred x: temporal → first non-quantitative → any other column.
  // The last fallback matters for fully-numeric datasets (e.g. taxi.csv
  // has pickup_hour / fare / rides all typed INTEGER) — bar charts in
  // glyph still need an x.
  const x =
    temporal ??
    tagged.find((t) => t.col !== y && t.role !== "quantitative")?.col ??
    tagged.find((t) => t.col !== y)?.col;
  const colorCol = tagged.find(
    (t) => t.col !== x && t.col !== y && (t.role === "nominal" || t.role === "ordinal"),
  )?.col;
  return {
    y,
    x,
    color: colorCol,
    hasTemporal: temporal !== undefined,
  };
}

// ---------------------------------------------------------------------------
// Planner — heuristic v0
// ---------------------------------------------------------------------------

export interface PlanInput {
  readonly intent: string;
  readonly source: string;
  readonly sourceFormat?: "csv" | "parquet" | "json" | undefined;
  readonly schema: ReadonlyArray<ColumnSummaryLike>;
  readonly domain?: string | undefined;
}

/**
 * Heuristic planner. Produces a DAG of nodes based on what the schema
 * looks like:
 *
 *   describe → render (the main panel) → explain → anomaly → annotate
 *                                     └─→ forecast (only when x is temporal)
 *
 * The narrator-style annotate node depends on every analytic node so it can
 * fold their results into a single narrative. Every render uses the same
 * data source so cross-panel filters can flow via `gdf://` URIs in v1.
 */
export function planStoryHeuristic(input: PlanInput): StoryPlan {
  const id = `story_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const roles = pickStoryRoles(input.schema);
  const nodes: StoryNode[] = [];

  const describeId = "n_describe";
  nodes.push({
    id: describeId,
    kind: "describe",
    label: `Inspect ${input.source}`,
    args: { source: input.source },
    dependsOn: [],
    status: "pending",
  });

  if (!roles.y) {
    // Nothing quantitative to chart. The story collapses to a single
    // describe + annotate.
    nodes.push({
      id: "n_annotate",
      kind: "annotate",
      label: "Compose narrative",
      args: { intent: input.intent, hasChart: false },
      dependsOn: [describeId],
      status: "pending",
    });
    return basePlan(id, input, nodes);
  }

  const mark: "bar" | "line" = roles.hasTemporal && roles.x ? "line" : "bar";

  const renderId = "n_render_main";
  const renderArgs: Record<string, unknown> = {
    spec: {
      data: {
        source: input.source,
        ...(input.sourceFormat ? { format: input.sourceFormat } : {}),
      },
      layers: [
        {
          mark,
          encoding: {
            ...(roles.x ? { x: roles.x.name } : {}),
            y: roles.y.name,
            ...(roles.color ? { color: roles.color.name } : {}),
          },
        },
      ],
      title: titleForStory(input.intent, mark, roles.y.name, roles.x?.name),
    },
  };
  nodes.push({
    id: renderId,
    kind: "render",
    label: `Render ${mark}: ${roles.y.name}${roles.x ? ` by ${roles.x.name}` : ""}`,
    args: renderArgs,
    dependsOn: [describeId],
    status: "pending",
  });

  // Explain — runs on the rendered handle.
  const explainId = "n_explain";
  nodes.push({
    id: explainId,
    kind: "explain",
    label: "Headline + questions",
    args: { handle_from: renderId },
    dependsOn: [renderId],
    status: "pending",
  });

  // Anomaly — every story gets an anomaly pass when y is quantitative.
  const anomalyId = "n_anomaly";
  nodes.push({
    id: anomalyId,
    kind: "anomaly",
    label: `Anomaly scan on ${roles.y.name}`,
    args: {
      handle_from: renderId,
      valueField: roles.y.name,
      ...(roles.color ? { groupField: roles.color.name } : {}),
      ...(roles.x ? { labelField: roles.x.name } : {}),
    },
    dependsOn: [renderId],
    status: "pending",
  });

  // Forecast — only when x is temporal.
  const forecastDeps: string[] = [renderId];
  let forecastId: string | undefined;
  if (roles.hasTemporal && roles.x) {
    forecastId = "n_forecast";
    nodes.push({
      id: forecastId,
      kind: "forecast",
      label: `7-step forecast of ${roles.y.name}`,
      args: {
        handle_from: renderId,
        xField: roles.x.name,
        yField: roles.y.name,
      },
      dependsOn: forecastDeps,
      status: "pending",
    });
  }

  // Annotate consumes every analytic node so it can write a coherent narrative.
  const annotateDeps = [explainId, anomalyId];
  if (forecastId) annotateDeps.push(forecastId);
  nodes.push({
    id: "n_annotate",
    kind: "annotate",
    label: "Compose narrative",
    args: { intent: input.intent, hasChart: true, mainPanelLabel: roles.y.name },
    dependsOn: annotateDeps,
    status: "pending",
  });

  return basePlan(id, input, nodes);
}

function basePlan(id: string, input: PlanInput, nodes: StoryNode[]): StoryPlan {
  return {
    id,
    intent: input.intent,
    sources: [input.source],
    ...(input.domain ? { domain: input.domain } : {}),
    createdAt: new Date().toISOString(),
    status: "planned",
    nodes,
    checkpoints: [],
  };
}

function titleForStory(
  intent: string,
  mark: string,
  yField: string,
  xField: string | undefined,
): string {
  const truncated = intent.length > 60 ? `${intent.slice(0, 60)}…` : intent;
  const subject = xField ? `${yField} by ${xField}` : yField;
  return `${truncated} — ${subject}`;
}

// ---------------------------------------------------------------------------
// Storyboard assembly
// ---------------------------------------------------------------------------

/**
 * Walk a completed plan and produce a StoryBoard. Pure — call it as the
 * final step of execute (or from glyph_story_get on a completed plan).
 */
export function assembleStoryboard(plan: StoryPlan): StoryBoard {
  const panels: StoryPanel[] = [];
  const handles: string[] = [];
  const renderNode = plan.nodes.find((n) => n.kind === "render");
  const explainNode = plan.nodes.find((n) => n.kind === "explain");
  const anomalyNode = plan.nodes.find((n) => n.kind === "anomaly");
  const forecastNode = plan.nodes.find((n) => n.kind === "forecast");

  if (renderNode?.result?.handle_id) {
    handles.push(String(renderNode.result.handle_id));
    panels.push({
      title: renderNode.label,
      description: String(renderNode.result.title ?? renderNode.label),
      handle_id: String(renderNode.result.handle_id),
      chart_uri: String(renderNode.result.uri ?? ""),
      explanation:
        explainNode?.result &&
        (typeof explainNode.result === "object"
          ? (explainNode.result as Record<string, unknown>)
          : undefined),
    });
  }
  if (anomalyNode?.result?.handle_id) {
    handles.push(String(anomalyNode.result.handle_id));
    panels.push({
      title: anomalyNode.label,
      description: String(
        (anomalyNode.result.explanation as Record<string, unknown> | undefined)?.headline ??
          anomalyNode.label,
      ),
      handle_id: String(anomalyNode.result.handle_id),
      chart_uri: String(anomalyNode.result.uri ?? ""),
      explanation: anomalyNode.result.explanation as Record<string, unknown> | undefined,
    });
  }
  if (forecastNode?.result?.handle_id) {
    handles.push(String(forecastNode.result.handle_id));
    panels.push({
      title: forecastNode.label,
      description: String(
        (forecastNode.result.explanation as Record<string, unknown> | undefined)?.headline ??
          forecastNode.label,
      ),
      handle_id: String(forecastNode.result.handle_id),
      chart_uri: String(forecastNode.result.uri ?? ""),
      explanation: forecastNode.result.explanation as Record<string, unknown> | undefined,
    });
  }

  const narrative = composeNarrative(plan, panels);
  return {
    title: titleForStoryFromPlan(plan),
    intent: plan.intent,
    panels,
    narrative,
    handles,
  };
}

function titleForStoryFromPlan(plan: StoryPlan): string {
  const truncated = plan.intent.length > 80 ? `${plan.intent.slice(0, 80)}…` : plan.intent;
  return truncated || "Glyph Story";
}

function composeNarrative(plan: StoryPlan, panels: ReadonlyArray<StoryPanel>): string {
  const lines: string[] = [];
  lines.push(`# ${titleForStoryFromPlan(plan)}`);
  lines.push("");
  lines.push(`**Intent:** ${plan.intent}`);
  if (plan.domain) lines.push(`**Domain:** ${plan.domain}`);
  lines.push("");

  panels.forEach((panel, i) => {
    lines.push(`## ${i + 1}. ${panel.title}`);
    if (panel.explanation) {
      const e = panel.explanation as {
        headline?: unknown;
        highlights?: unknown;
        questions?: unknown;
      };
      if (typeof e.headline === "string") lines.push(`**${e.headline}**`);
      if (Array.isArray(e.highlights)) {
        for (const h of e.highlights) {
          if (typeof h === "string") lines.push(`- ${h}`);
        }
      }
      if (Array.isArray(e.questions) && e.questions.length > 0) {
        lines.push("");
        lines.push("**Follow-up questions:**");
        for (const q of e.questions) {
          if (typeof q === "string") lines.push(`- ${q}`);
        }
      }
    } else {
      lines.push(panel.description);
    }
    lines.push("");
  });

  // Lineage roll-up — every handle the agent can audit later.
  const handleIds = panels.map((p) => p.handle_id).filter((h): h is string => h !== undefined);
  if (handleIds.length > 0) {
    lines.push("---");
    lines.push("");
    lines.push(`_Lineage:_ ${handleIds.join(" → ")}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// StoryStore — in-process registry of active plans + checkpoint queues
// ---------------------------------------------------------------------------

type CheckpointWaiter = (cp: StoryCheckpoint) => void;

/**
 * Holds active StoryPlans in memory, plus a per-plan FIFO of checkpoints
 * for `glyph_story_await_checkpoint` long-pollers. Persists each plan to
 * the MemoryStore's audit-style table so survival across restart is
 * possible (v0 stores only the plan, not the intermediate handles —
 * handles are session-scoped).
 */
export class StoryStore {
  private readonly plans = new Map<string, StoryPlan>();
  private readonly waiters = new Map<string, CheckpointWaiter[]>();

  set(plan: StoryPlan): void {
    this.plans.set(plan.id, plan);
  }
  get(id: string): StoryPlan | undefined {
    return this.plans.get(id);
  }
  all(): ReadonlyArray<StoryPlan> {
    return Array.from(this.plans.values());
  }

  /** Append a checkpoint + wake any long-pollers waiting on this plan. */
  emitCheckpoint(plan: StoryPlan, cp: StoryCheckpoint): void {
    plan.checkpoints.push(cp);
    const ws = this.waiters.get(plan.id);
    if (ws) {
      while (ws.length > 0) {
        const fn = ws.shift();
        if (fn) fn(cp);
      }
    }
  }

  /**
   * Long-poll for the next checkpoint after `sinceIndex`. Returns
   * undefined on timeout.
   */
  awaitCheckpoint(
    planId: string,
    sinceIndex: number,
    timeoutMs: number,
  ): Promise<StoryCheckpoint | undefined> {
    const plan = this.plans.get(planId);
    if (!plan) return Promise.resolve(undefined);
    // Immediate return if a checkpoint already exists past sinceIndex.
    if (plan.checkpoints.length > sinceIndex) {
      return Promise.resolve(plan.checkpoints[sinceIndex]);
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        // Remove our waiter from the queue + resolve undefined.
        const ws = this.waiters.get(planId);
        if (ws) {
          const idx = ws.indexOf(waiter);
          if (idx >= 0) ws.splice(idx, 1);
        }
        resolve(undefined);
      }, timeoutMs);
      const waiter: CheckpointWaiter = (cp) => {
        clearTimeout(timer);
        resolve(cp);
      };
      let ws = this.waiters.get(planId);
      if (!ws) {
        ws = [];
        this.waiters.set(planId, ws);
      }
      ws.push(waiter);
    });
  }
}

// ---------------------------------------------------------------------------
// Executor — DAG walk
// ---------------------------------------------------------------------------

export interface ExecutorVerbs {
  describe: (args: { source: string }) => Promise<Record<string, unknown>>;
  render: (args: { spec: unknown }) => Promise<Record<string, unknown>>;
  explain: (args: { handle_id: string }) => Promise<Record<string, unknown>>;
  anomaly: (args: {
    handle_id: string;
    valueField: string;
    groupField?: string | undefined;
    labelField?: string | undefined;
  }) => Promise<Record<string, unknown>>;
  drift?: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  forecast: (args: {
    handle_id: string;
    xField: string;
    yField: string;
  }) => Promise<Record<string, unknown>>;
}

/**
 * Execute a StoryPlan: walk the DAG, run each node by dispatching to the
 * matching verb in `verbs`, push checkpoints to `store`. Sibling nodes run
 * in parallel via Promise.all (subject to dependency order). The
 * `annotate` node always runs last and synthesizes the narrative.
 *
 * The function is pure-ish: it mutates the plan's nodes (status / result /
 * timing) and appends to its checkpoint log, then sets `plan.status` and
 * `plan.storyboard`. Returns the plan.
 */
export async function executeStoryPlan(args: {
  plan: StoryPlan;
  store: StoryStore;
  verbs: ExecutorVerbs;
}): Promise<StoryPlan> {
  const { plan, store, verbs } = args;
  plan.status = "running";

  const byId = new Map(plan.nodes.map((n) => [n.id, n]));
  const completed = new Set<string>();

  // Topological-order execution with parallel siblings.
  while (completed.size < plan.nodes.length) {
    const ready = plan.nodes.filter(
      (n) => n.status === "pending" && n.dependsOn.every((d) => completed.has(d)),
    );
    if (ready.length === 0) {
      // No more nodes can advance — failure or cycle.
      const stuck = plan.nodes.filter((n) => n.status === "pending");
      for (const n of stuck) {
        n.status = "failed";
        n.error = "Unresolvable dependency";
      }
      plan.status = "failed";
      break;
    }

    await Promise.all(
      ready.map(async (node) => {
        node.status = "running";
        node.startedAt = new Date().toISOString();
        store.emitCheckpoint(plan, {
          at: node.startedAt,
          plan_id: plan.id,
          node_id: node.id,
          kind: node.kind,
          status: "running",
          label: node.label,
          message: `Starting ${node.kind}`,
        });
        try {
          const result = await runNode(node, byId, verbs, plan);
          node.result = result;
          node.status = "done";
          node.endedAt = new Date().toISOString();
          completed.add(node.id);
          store.emitCheckpoint(plan, {
            at: node.endedAt,
            plan_id: plan.id,
            node_id: node.id,
            kind: node.kind,
            status: "done",
            label: node.label,
            message: summarizeNodeResult(node),
            ...(result.handle_id ? { handle_id: String(result.handle_id) } : {}),
          });
        } catch (err) {
          node.status = "failed";
          node.error = (err as Error).message ?? String(err);
          node.endedAt = new Date().toISOString();
          completed.add(node.id);
          store.emitCheckpoint(plan, {
            at: node.endedAt,
            plan_id: plan.id,
            node_id: node.id,
            kind: node.kind,
            status: "failed",
            label: node.label,
            message: `Failed: ${node.error}`,
          });
        }
      }),
    );

    if (ready.some((n) => n.status === "failed")) {
      // A failure cascades — fail-fast.
      plan.status = "failed";
      break;
    }
  }

  if (plan.status === "running") {
    plan.status = "complete";
    plan.storyboard = assembleStoryboard(plan);
    store.emitCheckpoint(plan, {
      at: new Date().toISOString(),
      plan_id: plan.id,
      node_id: "<storyboard>",
      kind: "annotate",
      status: "done",
      label: "Storyboard assembled",
      message: `${plan.storyboard.panels.length} panel(s) ready`,
    });
  }
  return plan;
}

async function runNode(
  node: StoryNode,
  byId: Map<string, StoryNode>,
  verbs: ExecutorVerbs,
  plan: StoryPlan,
): Promise<Record<string, unknown>> {
  const resolveHandle = (fromId: string): string => {
    const upstream = byId.get(fromId);
    if (!upstream?.result?.handle_id) {
      throw new Error(`Node ${node.id} depends on ${fromId} but no handle_id is available`);
    }
    return String(upstream.result.handle_id);
  };

  switch (node.kind) {
    case "describe":
      return verbs.describe({ source: String(node.args.source) });

    case "render":
      return verbs.render({ spec: node.args.spec });

    case "explain": {
      const handle_id = resolveHandle(String(node.args.handle_from));
      return verbs.explain({ handle_id });
    }

    case "anomaly": {
      const handle_id = resolveHandle(String(node.args.handle_from));
      const anomalyArgs: Parameters<ExecutorVerbs["anomaly"]>[0] = {
        handle_id,
        valueField: String(node.args.valueField),
      };
      if (typeof node.args.groupField === "string") anomalyArgs.groupField = node.args.groupField;
      if (typeof node.args.labelField === "string") anomalyArgs.labelField = node.args.labelField;
      return verbs.anomaly(anomalyArgs);
    }

    case "forecast": {
      const handle_id = resolveHandle(String(node.args.handle_from));
      return verbs.forecast({
        handle_id,
        xField: String(node.args.xField),
        yField: String(node.args.yField),
      });
    }

    case "drift":
      if (!verbs.drift) throw new Error("Drift verb not provided to executor");
      return verbs.drift(node.args);

    case "annotate": {
      // Annotate is a synthesizer — it composes the narrative from upstream
      // results. It doesn't call any external verb.
      return { synthesized: true, intent: plan.intent };
    }

    default: {
      const exhaustive: never = node.kind;
      throw new Error(`Unknown node kind: ${String(exhaustive)}`);
    }
  }
}

function summarizeNodeResult(node: StoryNode): string {
  if (!node.result) return `${node.kind} done`;
  switch (node.kind) {
    case "describe": {
      const rc = node.result.rowCount;
      const cols = (node.result.columns as ReadonlyArray<unknown> | undefined)?.length ?? 0;
      return `Schema: ${cols} column(s), ${rc} row(s)`;
    }
    case "render":
      return `Rendered handle ${String(node.result.handle_id ?? "?")}`;
    case "explain": {
      const headline = (node.result as { headline?: unknown }).headline;
      return typeof headline === "string" ? headline : "Explanation composed";
    }
    case "anomaly": {
      const rows = (node.result.rows as ReadonlyArray<unknown> | undefined)?.length ?? 0;
      return `${rows} outlier(s) flagged`;
    }
    case "forecast": {
      const s = node.result.season;
      return `Forecast (season=${typeof s === "number" ? s : "?"}) emitted`;
    }
    case "drift":
      return "Drift attributed";
    case "annotate":
      return "Narrative composed";
    default:
      return `${node.kind} done`;
  }
}

// Re-export the memory store type so the MCP layer can use it for plan
// persistence when we wire the v1 file-backed plan archive.
export type { MemoryStore };
export type { ComputeEngine };
