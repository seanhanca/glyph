# Glyph — Phase 3: Agent Graph & Data Flow

> **What Phase 3 adds.** Where Phase 0 (PR1–9) proved the wedge and `post-mvp.md` plans Phase 1 (grammar fill-in) + Phase 2 (reach), Phase 3 turns Glyph into a *data-understanding substrate* for analysts, business users, and multi-agent systems. Two halves:
>
> 1. Seven innovation gaps (§1–§7) — features that move Glyph from "chart library" to "decision substrate".
> 2. The GDF protocol (§8) — the wire format that makes agents share data natively, not via JSON-stringified blobs.

Audience for this doc: people building agent workflows on top of Glyph; people asking "can a non-analyst use this?"; people designing multi-agent systems.

---

## Table of contents

- [§0 What changes vs Phase 0/1/2](#0-what-changes-vs-phase-012)
- [§1 Gap — Semantic / metric layer](#1-gap--semantic--metric-layer)
- [§2 Gap — Self-explaining charts](#2-gap--self-explaining-charts)
- [§3 Gap — Diagnostic primitives](#3-gap--diagnostic-primitives)
- [§4 Gap — Action surfaces](#4-gap--action-surfaces)
- [§5 Gap — Agent-graph roles](#5-gap--agent-graph-roles)
- [§6 Gap — Persistent memory + named views](#6-gap--persistent-memory--named-views)
- [§7 Gap — Trust signals + row-level provenance](#7-gap--trust-signals--row-level-provenance)
- [§8 Protocol — GDF (Glyph Data Flow)](#8-protocol--gdf-glyph-data-flow)
- [§9 Agent-graph topology](#9-agent-graph-topology)
- [§10 Sequencing](#10-sequencing)
- [§11 Non-goals](#11-non-goals)
- [§12 North-star metrics](#12-north-star-metrics)
- [§13 Gating criteria](#13-gating-criteria)

---

## §0 What changes vs Phase 0/1/2

Phase 0 (shipped) and the Phase 1/2 plan in `post-mvp.md` answer:

- *Can an LLM write a Glyph spec that renders a useful chart?* (Phase 0 ✓)
- *Does the grammar cover the standard chart taxonomy?* (Phase 1)
- *Does it reach Python and high-mark-count rendering?* (Phase 2)

Phase 3 answers a fundamentally different question:

> *Can a small team of agents — and the analyst or business user driving them — go from raw data to a defensible decision and an executed action, without leaving Glyph?*

To make that real, Glyph needs primitives that today only exist in scattered BI products, dbt, observability tools, and bespoke notebooks. We pull them together under one declarative substrate. **Crucially: every Phase 3 addition is built on the existing `QueryHandle` primitive.** Nothing new at the bottom; everything new at the surface.

---

## §1 Gap — Semantic / metric layer

### Problem
Today an agent learns the schema fresh on every `glyph_describe` call. `revenue` is just a column; *MRR*, *churn rate*, *active customer* exist only in the analyst's head. Each new agent (or new turn) re-derives them, often subtly differently. This is the single biggest reason business users distrust agent-driven analysis.

### User story (S16)
> *As an analyst, I want to define our company's metrics once — MRR, churn rate, "active customer" — so every agent and every chart uses the same definitions, automatically. When the finance team updates the MRR formula, every dashboard updates.*

### Proposal

A `glyph.metrics.yaml` at the repo (or workspace) root, optionally registered via MCP:

```yaml
metrics:
  mrr:
    description: "Monthly recurring revenue, excluding one-time charges."
    sql: "SUM(amount) FILTER (WHERE type = 'subscription')"
    grain: monthly
    dimensions: [plan_tier, region, month]
  churn_rate:
    description: "% of customers who cancelled in a period."
    sql: "COUNT(*) FILTER (WHERE status = 'cancelled') / NULLIF(COUNT(*), 0)"
    requires: [cohort_month]
  active_customer:
    description: "Customer with any event in last 30 days."
    sql: "EXISTS (SELECT 1 FROM events WHERE customer_id = c.id AND ts > now() - INTERVAL '30 days')"
```

Spec extensions:

```json
{
  "data": { "source": "warehouse.customers" },
  "layers": [{
    "mark": "line",
    "encoding": { "x": "month", "y": { "metric": "mrr" } }
  }]
}
```

Plus a new MCP verb `glyph_metrics(prefix?)` returning the available metric registry. The compiler rewrites `{ "metric": "mrr" }` → the SQL expression at materialize time.

### Why analysts + business users care
- Analyst writes the definition once; agent never reinvents it.
- Business user trusts the number because it traces back to a named, governed definition.
- Mirrors the dbt / Cube / LookML semantic layer pattern that BI tools have proven, but bound to a chart spec instead of a separate config product.

### Why it matters for agent graphs
Every agent in the graph consults the same registry. A diagnostician agent's `glyph_drill` and a decision agent's `glyph_act` agree on what "MRR" means. No metric drift between agents.

---

## §2 Gap — Self-explaining charts

### Problem
Business users don't read charts well. Today the agent renders a chart and then *separately* describes it in prose. Two passes, both costly. Charts forwarded to non-analyst stakeholders get read wrong.

### User story (S17)
> *As a business user, when an agent shows me a chart, I want the salient observations in plain English right beside it. I don't want to squint at axes; I want to know what to act on.*

### Proposal

A new MCP verb `glyph_explain(handle_id)` that runs a fixed pipeline against the rendered view:

| Step | What it computes |
|---|---|
| 1. Top-line | extent, max value + label, min value + label, recent direction |
| 2. Compositional | top-3 contributing groups by share (uses `color` / facet) |
| 3. Anomaly | marks > 2σ from their segment mean — surface inline |
| 4. Temporal | if x is temporal: period-over-period delta + trend strength |

Returns structured text:

```json
{
  "headline": "Rides peaked at 8am (260/hr), 6× the 3am low.",
  "highlights": [
    "Weekday 7–9am contributes 30% of daily volume.",
    "Hour 17 is an outlier: 240 rides (+2.4σ vs the weekday baseline)."
  ],
  "questions": [
    "Why does hour 17 spike on weekdays specifically?",
    "Is the 11pm tail (60 rides) driven by airport pickups?"
  ]
}
```

The `questions` array is the secret weapon for agent graphs — it's the next prompt the next agent picks up.

### Why analysts + business users care
- For non-analyst users this is the highest-leverage feature in Phase 3.
- Stops the agent from being a charting tool; starts it being a reading assistant.
- Adds an audit trail: the highlights are deterministic from the rendered view, so the same chart + same Glyph version always yields the same insights.

### Why it matters for agent graphs
The `questions` array is structured fuel for the orchestrator: it's where a diagnostician agent gets handed off to next. Pure data → narrative → next question, all inside the protocol.

---

## §3 Gap — Diagnostic primitives

### Problem
*"Revenue dropped 12% this week"* is the question every business user asks first. Today the agent renders another chart and guesses. Real diagnosis is anomaly detection + drift + cohort decomposition — every team rebuilds this from scratch.

### User story (S18)
> *As an analyst handed a "MRR dropped 8%" question, I want a single agent call that decomposes the drop by region, plan tier, and customer cohort, and tells me which contributed most. Today I write five queries by hand.*

### Proposal — four diagnostic MCP verbs

| Verb | What it returns | SQL shape |
|---|---|---|
| `glyph_anomaly(handle_id, threshold?)` | rows > N σ from group mean, ranked | `WHERE ABS(z) > threshold` over windowed mean/stddev |
| `glyph_drift(handle_id, periodA, periodB)` | per-group contribution to the delta between two periods | window functions; ranks descending by abs(contribution) |
| `glyph_decompose(handle_id, metric, factors)` | mix-shift / Simpson decomposition: how much of Δmetric is volume vs rate vs mix | row-of-row totals with weighting |
| `glyph_forecast(handle_id, horizon)` | Holt-Winters or seasonal-naive baseline; flags rendered values that fall outside the predicted band | DuckDB UDF / in-engine math |

Each verb returns:
- `rows` — the diagnostic rows (top-N or full)
- a new `handle_id` (derived; lineage chained — see §8)
- a rendered chart (the diagnosis visualized)
- an `explanation` field — same shape as `glyph_explain`

### Why analysts + business users care
- Analyst's "why did X change?" pipeline collapses from hours to one call.
- Business user gets a *causal* story, not a *descriptive* one.
- All deterministic SQL: same input → same output. Snapshot-testable.

### Why it matters for agent graphs
This is what a **diagnostician agent** specializes in. The verb names map 1:1 to its skill. Hand-off in: `handle_id`. Hand-off out: new `handle_id` with the diagnosis + an explanation. Composes directly with action agents.

---

## §4 Gap — Action surfaces

### Problem
PR9 closed the chart → SQL → chart loop. But the *business* loop is chart → SQL → **action** (email, ticket, CRM update, alert, downstream MCP tool). Today the agent copies 12 customer IDs into a separate prompt and hopes it gets routed.

### User story (S19)
> *As a sales ops user, when an agent surfaces the 12 customers at highest churn risk, I want one click (or one agent call) to email them all, plus a Linear ticket auto-filed with the screenshot. The chart is the input to the action.*

### Proposal — two complementary surfaces

**A. Declarative actions on the spec**

```json
{
  "data": { "source": "warehouse.customers" },
  "layers": [...],
  "interactive": { "key": "customer_id" },
  "actions": [
    {
      "label": "Email risk team",
      "tool": "intercom_send_email",
      "argMap": { "customer_ids": "$selection.keys", "template": "churn-risk" }
    },
    {
      "label": "Create Linear issue",
      "tool": "linear_create_issue",
      "argMap": {
        "title": "Churn risk: $selection.count customers",
        "description": "$selection.summary"
      }
    }
  ]
}
```

`@glyph/live` renders these as buttons next to the chart; the SVG itself carries them as `<metadata>` for offline agents.

**B. MCP verb**

`glyph_act(handle_id, action, selection)` — server-side equivalent. The selection is `{ equals | between | in }` (same shape as `glyph_drill`). The verb invokes the named tool via the host MCP plane, returning the tool's result.

### Why analysts + business users care
- Analyst stops being a relay between chart and CRM.
- Business user gets the shortest path from observation to operation.
- The chart becomes *operational interface*, not a viewer.

### Why it matters for agent graphs
The **operator agent** is the one that calls `glyph_act`. Its skill is small (~100 tokens); it does one thing well. The orchestrator hands a `handle_id` + an action choice; the operator executes. Clean separation of cognition (other agents) from side-effects (operator only).

---

## §5 Gap — Agent-graph roles

### Problem
You named agent graphs. Today each agent that touches Glyph starts a fresh `@glyph/mcp` process — its own DuckDB instance, its own handle store. Handoff between an *exploration agent* → a *diagnosis agent* → an *action agent* loses every `QueryHandle`. State doesn't compound across agents the way it compounds across turns.

### User story (S20)
> *As an orchestrator agent, I want to dispatch sub-tasks to specialised agents (explorer, diagnostician, operator) and have them share data via handles, not by re-uploading rows.*

### Proposal — two changes

**A. Shared session protocol.** `@glyph/mcp` gains a `--session-id <uuid>` flag. Multiple agents pointing at the same session id share one engine + handle registry. The transport is on-disk DuckDB (`ATTACH`) by default; UNIX socket for hot paths. A coordinator agent can hand a `handle_id` to a worker agent and it just works.

**B. Role-aware skills.** Five new skills, small and focused:

| Skill | Role | Specialises in | Skill size |
|---|---|---|---|
| `skills/glyph-explorer/` | Explorer | `glyph_describe`, `glyph_render` (initial questions) | ~150 tokens |
| `skills/glyph-diagnostician/` | Diagnostician | `glyph_anomaly`, `glyph_drift`, `glyph_decompose`, `glyph_forecast` | ~200 tokens |
| `skills/glyph-operator/` | Operator | `glyph_act` + selection consolidation only | ~120 tokens |
| `skills/glyph-narrator/` | Narrator | `glyph_explain`, summary writing, downstream-question generation | ~150 tokens |
| `skills/glyph-orchestrator/` | Orchestrator | dispatching to the above, holding the lineage DAG | ~250 tokens |

Each role-skill is small so agent context stays cheap; the orchestrator's job is mostly to choose which sub-agent to call next based on the previous agent's `questions` output.

### Why analysts + business users care
- Analyst doesn't think about agent topology; they just see a coherent answer.
- Business user gets faster, more accurate answers because each agent does one thing.

### Why it matters for agent graphs
This is the gap that's *unique* to multi-agent — single-agent users don't need it. Without it, multi-agent Glyph workflows have to reconstruct state at every handoff. With it, the agent graph becomes a fan-out of specialists that share a data layer.

---

## §6 Gap — Persistent memory + named views

### Problem
Today every `@glyph/mcp` session starts blank. The user re-explains what "active customer" means, re-builds the same weekly KPI chart, re-derives the same cohorts. Agents have no working memory.

### User story (S21)
> *As an analyst, I want to say "show me the weekly MRR dashboard from last Monday" and have the agent recall it — same spec, same metric definitions, same filters.*

### Proposal — a local memory store

A `~/.glyph/memory.duckdb` file (naturally) holding:

| Table | Purpose |
|---|---|
| `saved_views` | named specs the user wants to recall: `glyph_save("weekly-mrr", spec)`, `glyph_recall("weekly-mrr")` |
| `metric_defs` | overlaps with Gap §1; enables per-user override |
| `phrase_rewrites` | "our customers" → `WHERE tenant_id = 'us-prod' AND status != 'internal'` |
| `column_corrections` | when the user corrects an agent ("`rides` is ordinal, not quantitative"), remember it |

MCP verbs: `glyph_memory_save`, `glyph_memory_recall`, `glyph_memory_list`, `glyph_memory_forget`.

Scope: per-user (or per-project via a `--memory-path` override). Explicitly local-first — no telemetry, no cloud, no shared state across hosts unless the user chooses to commit `memory.duckdb` to their repo.

### Why analysts + business users care
- Knowledge compounds across sessions. The agent learns the user's vocabulary.
- The user stops feeling like they're explaining themselves to a stranger every Monday morning.

### Why it matters for agent graphs
Memory is what turns the orchestrator agent into a *consistent* orchestrator. Without persistent state, every agent graph is a one-shot; with it, the graph remembers the project it's working on.

---

## §7 Gap — Trust signals + row-level provenance

### Problem
A chart shows `MRR = $4.2M`. Business user is about to forward it to the board. Two questions they can't answer:
1. **Is the data fresh?**
2. **Which rows produced this number?**

If the answer is "stale by 6 days" or "filtered out 30% of records because of a join bug," the decision is wrong.

### User story (S22)
> *As an exec reviewing a chart before a board meeting, I want a visible freshness stamp, a confidence rating per mark, and the ability to click a bar and see the underlying rows.*

### Proposal — three signals threaded through the existing scenegraph

**A. Per-mark provenance.** Each `SceneMark` gains an optional `provenance: { sourceRows, filteredOut, freshness, confidence }`. `glyph_describe` returns these for the source; the compiler propagates them through transforms. SVG renderer emits `data-provenance="..."` attrs and an optional `<glyph-trust>` overlay (a small badge in the corner of the chart).

**B. Confidence flags.** When a bar's underlying sample is < 30 rows, the compiler tags it `lowSample: true` and the renderer styles it differently (hatched fill). Agent sees this and surfaces it in `glyph_explain` output.

**C. Lineage walk-through.** `glyph_lineage(handle_id, mark_key)` — MCP verb returning the chain `source file → SQL transform → row IDs → mark`. Click-through to the actual rows that produced a number.

### Why analysts + business users care
- No business user will hand a chart to their CEO without trust signals.
- This is the gap between *technically correct* and *deployable*.

### Why it matters for agent graphs
The decision agent needs the confidence rating before recommending an action; the operator agent needs the provenance walk-through if the action turns out wrong. Without these, the agent graph has nothing to audit.

---

## §8 Protocol — GDF (Glyph Data Flow)

The connective tissue that makes §1–§7 work in a multi-agent setting.

### §8.1 The premise

`QueryHandle` is already the right primitive — it's a *named, schema-described, queryable, deterministic dataset*. Today it lives in one DuckDB process. GDF promotes it to a cross-process, cross-agent **`DataHandle`** addressed by URI.

### §8.2 The wire type

```ts
interface DataHandle {
  // ── Identity ──────────────────────────────────────────────────
  uri: string;        // "gdf://<session>/<id>"  — globally addressable
  version: number;    // bumps when the underlying data changes

  // ── What it is (cheap; agents reason on this first) ──────────
  schema: ReadonlyArray<{
    name: string;
    type: string;
    suggested: "quantitative" | "ordinal" | "nominal" | "temporal";
    nullable: boolean;
  }>;
  rowCount: number;

  // ── Where it came from (lineage; never optional) ─────────────
  lineage: {
    parents: ReadonlyArray<{
      uri: string;
      relation: "transform" | "filter" | "join" | "agg";
    }>;
    sql: string;             // the deterministic SQL that produced it
    producer: {
      agent: string;
      tool: string;
      sessionId: string;
      at: string;            // ISO timestamp
    };
  };

  // ── Whether to trust it (links to Gap §7) ────────────────────
  provenance: {
    freshness: string;        // ISO timestamp of the underlying read
    sampleRows: number;
    filteredOut: number;
    confidence: "high" | "medium" | "low";
  };

  // ── Where the bytes are (multiple transports, same handle) ──
  binding: {
    kind: "duckdb-view" | "arrow-ipc" | "arrow-flight" | "parquet-uri";
    location: string;
  };

  // ── Live? ────────────────────────────────────────────────────
  subscribable: boolean;
  subscriptionUri?: string;
}
```

### §8.3 Three transports, one handle

| Transport | When | Performance |
|---|---|---|
| **In-process** (DuckDB view) | One MCP server, one agent | Zero copy; same as today |
| **Local IPC** (Arrow IPC over UNIX socket / shared `.duckdb` via `ATTACH`) | Multiple agents on one host | Zero-copy via memfd / SharedArrayBuffer; ~µs / row |
| **Networked** (Arrow Flight gRPC) | Distributed agent graph | Streaming columnar; LAN-saturating throughput |

Same wire format. The resolver picks the cheapest transport that works for a given URI.

### §8.4 Six verbs — that's the whole protocol

| Verb | Purpose | Cost |
|---|---|---|
| `gdf.publish(handle)` | Promote a local handle to a peer-visible URI | O(1) |
| `gdf.peek(uri, limit?)` | Schema + N sample rows (defaults to 0) | O(1) for schema, O(N) for rows |
| `gdf.subscribe(uri)` | Bind a remote handle into the local engine; optionally listen for `version` bumps | O(schema); rows on demand |
| `gdf.derive(uri, sql)` | New handle from existing one; lineage auto-chained | O(materialization) |
| `gdf.lineage(uri, depth?)` | Walk the lineage DAG; returns a tree of `{uri, sql, producer, at}` | O(depth) |
| `gdf.unbind(uri)` | Release; refcount-managed so it's safe across agents | O(1) |

Six verbs cover the entire agent-graph data plane.

### §8.5 One-line spec change

A spec's `data.source` is already a string. Add one URI scheme:

```json
{
  "data": { "source": "gdf://prod-session/handle-abc123" },
  "layers": [{ "mark": "bar", "encoding": { "x": "hour", "y": "rides" } }]
}
```

An analyst-agent's spec points at what a data-agent already materialised. No re-upload, no re-derivation.

### §8.6 MCP integration — four new tools

| Tool | Replaces / extends | Approx tokens |
|---|---|---|
| `glyph_publish(handle_id, scope?)` | promotes a local handle | ~80 |
| `glyph_subscribe(uri)` | binds an external handle locally | ~80 |
| `glyph_lineage(uri, depth?)` | provenance walk | ~100 |
| `glyph_handles()` | list all visible handles in the session | ~60 |

Existing `glyph_render` / `glyph_query` / `glyph_drill` work unchanged because spec's `data.source` is just a string — they don't care if it's a file path or a `gdf://` URI.

**Total agent-graph protocol surface stays under 1,000 tokens.**

### §8.7 Why this is *native and high-performing*

Three deliberate choices:

1. **DuckDB is the substrate.** It speaks Arrow IPC natively, supports `ATTACH` across files, has views as first-class objects. We don't add a layer; we expose what's there.
2. **Schema travels separately from bytes.** Agents reason about handles cheaply (~200 bytes); they materialise only when they actually need to render or query.
3. **Lineage is *computed*, not stored elsewhere.** Each handle records its immediate parent SQL; walking the DAG is read-only joins on a small in-engine table.

Order-of-magnitude estimates (single host, ~1 M-row table):

| Operation | Today (stringified content) | With GDF |
|---|---:|---:|
| Pass dataset between agents | ~12 MB JSON, 2–5 s | ~2 KB URI handle, < 10 ms |
| Derive a filtered view | re-materialize via SQL | O(predicate), same DuckDB plan |
| Display a chart in a downstream agent | re-parse JSON | direct view binding |

Token cost vs the "stringify the data into tool output" pattern: ~200× cheaper for a 1 k-row result, ~10,000× cheaper for 100 k rows.

### §8.8 Why this is *natural for agents to use*

1. **URIs > IDs.** `gdf://session-xyz/sales-by-region` is self-describing; an LLM can infer scope from the path.
2. **Schema-first.** Every handle has a schema the agent reads *before* requesting data — same pattern as `glyph_describe`, generalised.
3. **Errors are crisp.** `handle not found` / `schema drift` / `lineage broken` are clear failure modes; recovery is mechanical.
4. **No new mental model.** `glyph_render(spec)` just learned to accept a `gdf://` source.
5. **Inspectable.** `glyph_lineage` lets the agent (or the human) ask "where did this number come from?" — debugging an agent graph stops being a black box.
6. **State sharing is *only* via handles.** Agents pass URIs, not blobs. The temptation to stuff data into tool arguments evaporates.

### §8.9 Three things deliberately out of scope

These would over-engineer the protocol:

- **No federation of compute.** GDF moves *handles* and small data; if you need cross-org joins, that's a warehouse problem (Iceberg / Trino).
- **No CRDT / conflict resolution.** Handles are immutable after publish; mutation is by `derive` (new handle). `version` monotonically increases.
- **No mandatory networking.** In-process is the fast path; local IPC is the multi-agent path; network is only when an agent literally lives on another host.

---

## §9 Agent-graph topology

GDF makes the role distinction crisp and operational:

| Role | Publishes | Subscribes to | Key verbs |
|---|---|---|---|
| **Data agent** | Raw source handles (`gdf://session/customers`, `gdf://session/events`) | — | `glyph_describe`, `glyph_publish` |
| **Transform agent** | Derived handles (`gdf://session/weekly-mrr`) | Raw source handles | `gdf.derive`, `glyph_publish` |
| **Explorer agent** | — (read-only) | Derived handles; renders charts | `glyph_render`, `gdf.peek` |
| **Diagnostician agent** | Diagnostic handles | Derived handles | `glyph_anomaly`, `glyph_drift`, `glyph_decompose`, `glyph_forecast` |
| **Narrator agent** | Text bundles (insights, questions) | Any handle | `glyph_explain` |
| **Decision agent** | Action candidates | Diagnostic handles + narrator output | `glyph_drill` + reasoning |
| **Operator agent** | Action results | Decision-agent outputs | `glyph_act` |
| **Orchestrator** | Lineage DAG of the whole conversation | All of the above | `glyph_handles`, `glyph_lineage` |

The orchestrator holds the **lineage DAG** of all live handles. Asking "why did this decision happen?" walks the DAG back to source rows. Total auditability without log diving.

### A typical run

```
┌──────────────────────────────────────────────────────────────────┐
│ User: "MRR dropped 8% this week. Why? Who should we email?"      │
└──────────────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────────────┐
│ Orchestrator                                                      │
│ → Data agent: publish customers, events, subscriptions            │
│ → Transform agent: derive weekly_mrr (gdf://.../weekly-mrr)       │
└──────────────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────────────┐
│ Diagnostician                                                     │
│ glyph_decompose(weekly-mrr, metric=mrr, factors=[region, tier])   │
│ → handle: gdf://.../decomp-abc  (volume × rate × mix)             │
└──────────────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────────────┐
│ Explorer                                                          │
│ glyph_render({ source: decomp-abc, ... interactive: ...})         │
│ Narrator: glyph_explain(handle) → "Drop driven by tier=ENT,       │
│   region=US; 8 of 12 churned accounts share rep_id=42"            │
└──────────────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────────────┐
│ Decision                                                          │
│ glyph_drill(handle, field=customer_id, in=[the 12]) → rows        │
└──────────────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────────────┐
│ Operator                                                          │
│ glyph_act(handle, "email_risk_team", selection)                   │
│ → 12 emails sent · Linear issue OPS-1234 filed                    │
└──────────────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────────────┐
│ Orchestrator publishes the final lineage DAG; user sees the       │
│ chart + narrative + the audit trail of the action.                │
└──────────────────────────────────────────────────────────────────┘
```

Every arrow above is a `gdf://` URI. Every box knows nothing about the others' internals — only schemas + URIs.

---

## §10 Sequencing

Each ships as one PR using the cycle PR1–10 used.

**Tier A — GDF foundation (must land before everything else in Phase 3):**

| PR | Scope | Approx LOC |
|---|---|---:|
| 11 | `DataHandle` type (URI, version, lineage, provenance fields); promote `QueryHandle` → `DataHandle` non-breakingly | ~250 |
| 12 | MCP verbs: `glyph_publish`, `glyph_subscribe`, `glyph_lineage`, `glyph_handles` — in-process transport only | ~350 |
| 13 | `data.source: "gdf://..."` URI resolution in the compiler + materializer | ~150 |
| 14 | Local IPC transport (shared DuckDB file via `ATTACH`; Arrow IPC over UNIX socket) | ~400 |

**Tier B — Innovation gaps built on GDF:**

| PR | Scope | Depends on |
|---|---|---|
| 15 | Gap §1 — semantic / metric layer (`glyph.metrics.yaml` + `metric: "mrr"` encoding + `glyph_metrics` MCP verb) | 11–13 |
| 16 | Gap §2 — `glyph_explain` MCP verb (top-line / compositional / anomaly / temporal pipelines) | 11–13 |
| 17 | Gap §3a — `glyph_anomaly`, `glyph_drift` | 11–13 |
| 18 | Gap §3b — `glyph_decompose`, `glyph_forecast` | 17 |
| 19 | Gap §4 — `actions[]` on spec + `glyph_act` MCP verb | 11–13 |
| 20 | Gap §5 — role-aware skills (explorer / diagnostician / narrator / operator / orchestrator) | 14, 16–19 |
| 21 | Gap §6 — `~/.glyph/memory.duckdb` + `glyph_memory_*` MCP verbs | 11–13 |
| 22 | Gap §7 — per-mark provenance + `<glyph-trust>` overlay + `glyph_lineage` UI walk-through | 11–13 |

**Tier C — Networked transport (demand-gated):**

| PR | Scope |
|---|---|
| 23 | Arrow Flight gRPC transport for distributed agent graphs |
| 24 | Auth + per-handle ACLs (signed URIs, scoped tokens) |

Total: ~14 PRs across Phase 3. Each ~200–500 LOC, 30-min CI cycle, same six-cell matrix.

---

## §11 Non-goals

These dilute the wedge; **explicit non-goals for Phase 3**:

- A managed cloud — Glyph is local-first. Hosts run their own MCP servers.
- Federated joins across orgs — that's a warehouse problem (Trino, Iceberg, DataFusion). GDF moves handles, not federation.
- A workflow-engine product à la Airflow / Dagster — these are orchestrators of *jobs*; Phase 3 is for orchestration of *agents reasoning about data*, a different concern.
- Real-time / sub-second streaming — Perspective owns that lane; GDF's subscriptions are coarse (seconds-to-minutes).
- A no-code dashboard builder — the agent surface *is* the builder.
- Vector / embedding-based "semantic search" of metrics — overlaps with Gap §1 if mis-scoped. Stay declarative.

---

## §12 North-star metrics

| Metric | End of Tier A (~week 18) | End of Tier B (~week 26) | Stretch (~9 mo) |
|---|---:|---:|---:|
| GitHub stars | 12,000 | 20,000 | 35,000 |
| Weekly `@glyph/core` downloads | 15,000 | 50,000 | 200,000 |
| MCP installs (all 5 role-skills combined) | 5,000 | 15,000 | 50,000 |
| `gdf://` handles published per active session (P50) | 3 | 8 | 15 |
| `glyph_explain` calls per render (P50) | n/a | 0.8 | 1.0 |
| `glyph_act` calls per session (P75) | n/a | 1 | 3 |
| Snapshot corpus | 50 | 75 | 100 |
| Lineage DAG depth per decision (P50) | 3 | 5 | 7 |

---

## §13 Gating criteria

**Tier A ships if:**

1. `gdf://` URIs resolve transparently in `glyph_render` / `glyph_query` / `glyph_drill` — no API surface change for spec writers.
2. A two-process demo works: agent A publishes a handle; agent B subscribes and renders against it; round-trip < 50 ms on localhost.
3. `glyph_lineage(uri)` returns a tree that walks back to a known source file for every published handle.
4. Snapshot byte-identity still holds for non-interactive specs.
5. Total MCP surface stays under 1,000 tokens.

**Tier B ships if:**

1. The §9 typical run executes end-to-end against a real dataset (≥100 k rows) on a single host in < 5 s.
2. Every diagnostic verb (anomaly / drift / decompose / forecast) has ≥5 snapshot tests + a deterministic explanation.
3. The 5 role-skills are independently installable; combined token cost < 1,000 tokens.
4. `glyph_act` invokes at least one upstream MCP tool (e.g. a stub email tool) end-to-end.
5. `glyph_memory_*` round-trips a saved view across a server restart.

**Tier C ships if:**

1. Arrow Flight benchmarks beat in-process JSON on a 1M-row handle by ≥100× for cross-host transfer.
2. Signed URIs work in a 3-host agent graph with TLS and a per-handle ACL.

---

## Bottom line

Phase 0 proved a chart-and-compute artifact. Phase 1/2 fill in the breadth of grammar and reach. **Phase 3 is the layer that makes Glyph the substrate analysts, business users, and agent graphs reach for when the question is "*what should we do?*", not just "*what does this look like?*".**

Every Phase 3 feature builds on the existing `QueryHandle` primitive. We don't add anything new at the bottom; we name and amplify what's already there.
