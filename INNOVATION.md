# INNOVATION.md — agent-workflow gaps + emerging viz ideas

> 57 PRs merged, 421 tests green. Glyph leads on 7 of 8 axes of the public scoreboard. This doc is the next-horizon read: **what's still in the way of agents producing human-actionable insights**, and **eight emerging-viz innovations** that could change the field.
>
> Written from the perspective of an agent on Claude Code, Codex, Hermes, or OpenClaw using Glyph to drive an analysis — what works today, what doesn't, and what we should build next.

---

## 1. Remaining agent-workflow gaps — without over-engineering

Glyph's architecture is done. Every gap below is a *workflow* gap, not an *architectural* one. Each could ship in a single small-to-medium PR.

### 1.1 The planner is heuristic, not LLM-driven

`glyph_story_plan` builds a DAG from schema heuristics: temporal column → forecast; categorical → decompose; numeric → anomaly. This works on the median analysis question, but misses **intent**.

The user asks *"why are enterprise customers churning faster in EU than US?"* — the heuristic planner sees `customer × tier × region × cohort` and builds the generic 4-branch tree. An LLM-driven planner would write *"This is a comparative cohort question: filter to enterprise, decompose by region × cohort_month, drift A→B."*

**Cost to close**: ~150 LOC. The planner is already a single pure function (`planStoryHeuristic`). Swap it for a function that calls the host LLM via an injectable callback. Glyph stays LLM-agnostic; the user supplies the model.

**Why it matters**: the difference between a heuristic explorer and an analyst.

### 1.2 No streaming partial results

`glyph_render` / `glyph_explain` / `glyph_whyboard` are all *block-then-return*. A 100k-row chart blocks the agent's turn for 800ms; a Whyboard with 4 branches blocks for ~3s.

For interactive agents this is fine. For autonomous agents running 20-deep diagnostic trees, every node is a serial round-trip. There's no way to peek at intermediate state, no way to abort early when the first branch already answered the question.

**What's needed**: a streaming verb pattern. `glyph_story_execute` already has `await_checkpoint`, but only emits node-level events. Stream *row* batches (every 1000 rows of a query), *intermediate explain bullets* (top-line before compositional finishes), and *partial mark counts* (renderer can paint 10k of 50k marks immediately).

**Cost to close**: medium. The MCP transport needs streaming-by-default (MCP supports streaming responses). The renderer + diagnostics need progressive-emit modes.

### 1.3 No context-window budget management

When `glyph_query` returns 10,000 rows, the agent's context fills up. The agent has to manually `LIMIT` queries. Worse, when the rows ARE the answer (top-100 outliers), there's no easy way to spend just the budget you have.

**What's needed**: a `budget_tokens` argument on every row-returning verb. The server samples / truncates to fit. Returns a sentinel `{ truncated: true, total: N, returned: K, sample: 'top' | 'bottom' | 'representative' }`.

**Cost to close**: small. Add the parameter to glyph_query / glyph_drill / glyph_anomaly / glyph_drift / glyph_decompose. The MCP server samples in DuckDB before returning.

### 1.4 Disambiguation on ambiguous intents

User: *"show me the busy ones"*. The Story Agent has no way to ask back: *"by ride count? by fare? by hour?"*. It picks one, often wrong.

**What's needed**: a `glyph_story_clarify(intent, sources)` verb that returns a **disambiguation prompt** — `{ ambiguities: [{ field, question, options[] }] }`. The host agent renders this as a quick multiple-choice and feeds the user's choices back into `glyph_story_plan`.

Or simpler: the planner emits `confidence: 0..1` per chosen field. Below 0.7 the host agent asks the user before executing the plan.

**Cost to close**: small. Heuristic v0 ships in a single PR.

### 1.5 No engagement signals

Glyph doesn't know which charts the human actually looked at. A great agent learns: *if the user always skips the forecast panel and lingers on the drift panel, weight drift higher next time.* Today there's no signal at all.

**What's needed**: optional opt-in telemetry. When a chart is rendered in the preview server, log `viewed_at`, `time_in_focus_ms`, `clicked_rows[]`, `subscribed_uri`. Store locally (never phoned home — Glyph's no-telemetry commitment stays). The Story Agent reads engagement signals from prior sessions as a planner bias.

**Cost to close**: small for the recording side; the *learning* side is the planner extension above.

### 1.6 Result-handle hygiene

A 30-minute exploration session creates 50+ derived handles. `glyph_handles` lists them all. Nothing tracks which are still useful vs orphaned. Nothing cleans them up. Memory leaks aren't an issue (DuckDB is fast); cognitive clutter is.

**What's needed**: handle TTL + auto-GC. Each handle gains a `last_accessed_at`; handles older than N minutes with no children are auto-evicted (with the data going to `memory.duckdb` first if requested).

**Cost to close**: small. Pure server-side bookkeeping.

### 1.7 No "what changed since" between two specs

The user wrote one spec, got an answer, modified the spec, got a different answer. Why? Was it the new filter, the new metric, the new color encoding?

`glyph_spec_diff(spec_a, spec_b)` would emit a structured diff: `{ removed: [...], added: [...], changed: [...] }` and a tiny narrative `"Filter changed from rides > 100 to rides > 200; rows dropped from 12 to 5."`

**Cost to close**: small. Pure-function spec walker.

### 1.8 Authoring round-trip is one-shot

Today: agent emits a full spec, server renders. There's no incremental edit verb (`glyph_spec_patch(handle_id, { encoding: { color: ... } })`). The agent regenerates the entire spec on every refinement, which burns tokens and risks introducing unrelated changes.

**What's needed**: `glyph_spec_patch(handle_id, json_patch)` applying RFC 6902 JSON Patch (or a structural diff) to the spec, re-rendering with the change.

**Cost to close**: small-to-medium.

### What's *not* on this list — but tempting

- **A full LLM agent runtime inside `@glyph/mcp`**. Don't. Glyph is the substrate; the agent runtime is the host. We provide deterministic verbs; the host's LLM decides which to call. Crossing that line couples Glyph to a model vendor.
- **A vector store of past charts**. Tempting for "did I render this before?" but adds an embedding dep + a search index. Wait until engagement signals justify it.
- **OAuth / multi-tenant ACLs**. Glyph is intentionally local-first. Multi-tenant ships when there's a hosted Glyph product, not before.

---

## 2. Emerging viz innovations — eight high-impact ideas

For each: what it is, why it matters for agent workflows, why other tools can't do it easily, and a rough cost estimate.

### 2.1 Conversational drill + multi-modal sync

**The idea**: every chart is rendered three ways simultaneously — visual, tabular, narrative — and a user click in any modality updates the other two. Type "show me April" in the chat box; the SVG re-filters, the table re-filters, the narrative regenerates. Click a bar; the same.

**Why for agents**: the agent's output today is *one modality at a time*. A chart OR a table OR a paragraph. Real analyst work crosses freely between all three. If Glyph emits all three from one `glyph_render` call, the agent never has to pick — the human picks.

**Why other tools can't**: Tableau/Power BI lock you into the visual modality (sidecar tables exist but feel grafted on). Vega-Lite has no narrative output. ChatGPT-style assistants produce great narratives but no live chart you can click. **Glyph already produces all three** (SVG + rows + `glyph_explain`) — the missing piece is a *cross-modal selection context* that propagates a click through all three views. Builds on **PR46's `link_group`**.

**Cost**: medium. Mostly UI work in `@glyph/preview-server` + a small new verb `glyph_modality_sync(group, selection)`. The substrate is shipped.

**Impact**: ⭐⭐⭐⭐⭐ — closes the "agent gave me a chart, but I want to interrogate it" gap that every analyst hits in real workflows.

---

### 2.2 Adversarial chart auditing

**The idea**: a separate agent (or a built-in check) inspects every spec for known visual manipulations *before* it renders. Truncated y-axes that exaggerate change. Cherry-picked color palettes that align with conclusions. Dual-axis charts that imply false correlation. Logarithmic-without-disclosure. Misleading aggregation. Like a linter for charts.

The audit produces `{ severity: "high" | "medium" | "low", issue: "y-axis starts at 80 instead of 0", suggestion: "set scale.domain = [0, 100]" }`. The agent can choose to ignore (logged in audit), revise, or surface to the user.

**Why for agents**: AI agents don't have an instinct for visual ethics. They'll cheerfully build a chart that lies. A human analyst trained at the FT or Bloomberg has internalized 50 visual ethics rules; an LLM has, at best, read a blog post about chart-junk.

**Why other tools can't**: D3 / Vega-Lite are too low-level to catch this — they just draw what you tell them. Tableau has style guidelines but no programmatic enforcement. Glyph is the first viz tool with a *deterministic, machine-readable spec* AND an *agent-driven render loop* — the audit hooks in between.

**Cost**: medium. New module `@glyph/audit` with 10–15 rules. Wires into the materializer; emits warnings or hard-errors based on a `strictness` spec field.

**Impact**: ⭐⭐⭐⭐⭐ — the *one* thing every enterprise legal team will want before deploying agent-driven analytics.

---

### 2.3 Embedded uncertainty rendering

**The idea**: every chart automatically renders confidence bands / error bars / sample-size flags **as a default**, not an opt-in. Glyph already knows `provenance.sampleRows` per handle. The renderer extends to:

- Bar widths shaded by sample-size (50-row bars: solid; 5-row bars: hatched).
- Line charts: automatic 95% CI ribbons computed from per-group variance.
- Point charts: marker opacity proportional to confidence.
- A small "uncertainty badge" in the corner: `confidence: high | medium | low`.

The user can hide it with `interactive.uncertainty: false`, but the *default* is to show.

**Why for agents**: humans systematically over-trust precision in agent output. When the agent says "MRR is $4,237,182", they read four significant figures of certainty. When the underlying data is a 14-row sample, that's wildly wrong. Embedded uncertainty makes the calibration visible by default.

**Why other tools can't**: most viz tools strip uncertainty for "clean" presentation. Domain-specific tools (R's ggplot, Python's seaborn) have CI ribbons but only as opt-ins. Glyph already tracks `DataHandle.provenance.sampleRows` + `.confidence` — the data is there; the renderer just needs to use it.

**Cost**: small-to-medium. Renderer extension; new compiler pass.

**Impact**: ⭐⭐⭐⭐⭐ — the single biggest thing we can do for *calibrated* agent output.

---

### 2.4 Multi-agent answer comparison (side-by-side Whyboards)

**The idea**: when the user asks a contested question, two agents (Claude + Codex, or two Claude calls with different prompting) produce independent Whyboards. The UI shows them side-by-side with the disagreement highlighted: *"Claude says churn is driven by region; Codex says it's driven by tier. Both agents agree it's NOT driven by acquisition channel."*

The human picks the more credible answer (or asks both to refine). Disagreement is information.

**Why for agents**: single-agent answers feel authoritative even when they're wrong. Forcing two independent agents to compare reveals the model's uncertainty by showing where they disagree. This is the *visual* analogue of self-consistency sampling.

**Why other tools can't**: this needs the substrate Glyph already ships — agents producing structured, auditable trees of diagnostics. Comparing two arbitrary chat outputs side-by-side is meaningless. Comparing two Whyboards (which have the same node-kind vocabulary) lets the UI compute the actual disagreement set.

**Cost**: small. A `glyph_whyboard_diff(board_a, board_b)` verb + a side-by-side preview UI.

**Impact**: ⭐⭐⭐⭐ — high in adversarial / regulated settings (finance, healthcare, legal); medium in everyday analytics.

---

### 2.5 Workflow capture & replay

**The idea**: the user's analytic session is a sequence of MCP calls — `glyph_render(spec_A) → glyph_drill(...) → glyph_explain(...) → glyph_drift(...)`. Capture that sequence as a **macro file** (`.glyph-macro.json`); replay it next month with new data. Adjustable parameters become flags (`--start-date 2024-01-01`).

It's the spreadsheet equivalent of "save as template" — but for *the entire analysis workflow*, not just one chart.

**Why for agents**: every agent today re-discovers the same analysis from scratch. *"Monthly revenue review"* runs every month — the agent does the same 12-step exploration each time. A captured macro turns that into one MCP call.

**Why other tools can't**: BI tools have saved-dashboards but no captured exploration. dbt has data lineage but no UI sequence. Glyph already records every step in the handle lineage — replay just walks that recording forward against new rows.

**Cost**: small. The substrate is shipped (lineage + handles + audit log). The macro player is ~100 LOC: walk the audit log, replay each verb call with parameter substitution.

**Impact**: ⭐⭐⭐⭐ — turns one-shot analyst work into recurring, agent-runnable jobs.

---

### 2.6 LLM-assisted scale tuning

**The idea**: when an agent renders a chart with a skewed distribution, Glyph auto-suggests `scale.type: "log"` (or `sqrt`, or a custom diverging color ramp). The suggestion appears as a small button next to the chart: *"Try log scale →"*. Click it: the chart re-renders.

This composes with the audit pass (§2.2): some suggestions are protective ("don't truncate y-axis"), others are pedagogical ("you have 4 orders of magnitude here; log scale would help").

**Why for agents**: agents pick the wrong scale all the time. They'll render a chart of revenue ranging $100 to $10M on a linear axis where 99% of bars are invisible. A simple heuristic ("max/min > 100? suggest log") closes 80% of the issue.

**Why other tools can't**: Vega-Lite's scale inference is rule-based but doesn't *suggest alternatives mid-flight*. Glyph can: it already inspects every handle's distribution for the explain pipeline.

**Cost**: tiny. The math is in `@glyph/core/explain` already. New verb `glyph_suggest_scale(handle_id)` returns suggestions.

**Impact**: ⭐⭐⭐ — a comfortable UX improvement; not category-changing.

---

### 2.7 Causal-aware viz (visualizing the DAG behind the data)

**The idea**: when the data carries a known causal structure (specified in the metric layer, e.g. `mrr ← (new_customers × avg_price) − churn`), Glyph renders charts that *visually distinguish* correlated from causal relationships. A line chart of `mrr` against `new_customers` carries a small "→ causal" badge; a line of `mrr` against `weekday` (correlated, not causal) carries a "↔ correlated" badge.

Hover the badge: *"This is a known cause from your metric registry."* or *"This relationship is correlated but not asserted causal. Click to add it to the causal DAG."*

**Why for agents**: agents reason about correlation; humans need causation to act. The current state of agent analytics: confident statements about cause that are really just patterns in data. Glyph's metric registry (PR37) is the substrate to attach causal annotations; surface them visually.

**Why other tools can't**: viz tools don't have a place to *store* causal claims. Dedicated tools (DoWhy, EconML) have causal reasoning but no visualization grammar. Glyph's metric registry + the diagnostic verbs are the merge point.

**Cost**: medium. New `causal:` field on each metric definition; new renderer overlay; small DAG-walk module.

**Impact**: ⭐⭐⭐⭐ — under-appreciated; would be category-defining for regulated industries (finance, pharma, public policy).

---

### 2.8 Spec-as-code: diff, review, CI gate

**The idea**: chart specs become first-class repository artifacts. Every PR that changes a spec also changes the *rendered SVG snapshot*. CI runs the same `pnpm test --update-snapshots` check that's already in place. Code reviewers see the chart change as a visual diff (`old.svg vs new.svg`) the way they see code diffs today.

For dashboards / reports / monthly emails: the spec lives in git. The agent updates it. The team reviews the visual change. CI ensures the chart doesn't break when the data shape changes.

**Why for agents**: agents that work on persistent artifacts (vs ephemeral chat) need version control. The current agent flow renders a chart, the user looks at it, the chart vanishes. With spec-as-code, the agent's output is reviewable, mergeable, and revertable.

**Why other tools can't**: Tableau workbooks are XML files; not human-diffable. Power BI files are binary. Vega-Lite specs are JSON but no tool ships visual diff for them. Glyph already has byte-identical SVG snapshots (the determinism guarantee since PR12) — visual diff for free.

**Cost**: tiny on the Glyph side (the snapshot infra is shipped). The unlock is a small CLI tool: `glyph diff spec.json baseline.svg` returns 0 if identical, prints a diff URL otherwise. Then a GitHub Action that renders the diff on every PR.

**Impact**: ⭐⭐⭐⭐ — the prerequisite for shipping agent-authored charts into production workflows.

---

## 3. Sequencing recommendation

If we were planning the next 3 sessions:

| Priority | Session | Pulls |
|---|---|---|
| 1 | **Calibration session** — embedded uncertainty (§2.3) + spec-as-code CI gate (§2.8) | 2 PRs, ~600 LOC |
| 2 | **Workflow session** — workflow capture/replay (§2.5) + LLM-driven planner upgrade (§1.1) + spec patch (§1.8) | 3 PRs, ~700 LOC |
| 3 | **Multi-modal session** — conversational drill sync (§2.1) + multi-agent answer compare (§2.4) | 2 PRs + UI work, ~900 LOC |

That's ~3 sessions of work to close the highest-impact remaining gaps. Adversarial audit (§2.2) and causal-aware viz (§2.7) are bigger and would each be their own session.

---

## 4. What we explicitly should NOT build

These come up in every "agent viz" brainstorm; resist them:

- **A built-in LLM**. Vendor lock-in; commodity layer. Glyph is the substrate.
- **A no-code chart builder UI**. Glyph competes on spec ergonomics, not GUI tooling. Tableau owns that lane.
- **An online dashboard hosting service**. Glyph is a library + agent protocol. Hosting is a separate product.
- **Premium "AI-powered" tier**. Apache 2.0 stays. The entire value is in the open substrate.
- **Telemetry "to improve the product"**. The no-telemetry commitment from day one is part of what makes Glyph trustable as the agent's data tool.

---

## 5. Closing read

Glyph's architecture is done. What's left isn't *building more substrate*; it's *putting the substrate in front of the workflows that need it*. The eight innovations above are workflow-shaped, not architecture-shaped — each one composes from primitives already on `main`.

The biggest single thing we can ship next is **§2.3 embedded uncertainty rendering**. It changes the default behavior of every chart Glyph emits, makes agent output calibrated, and uses substrate that's already there (`DataHandle.provenance.sampleRows`).

The second-biggest is **§2.2 adversarial chart auditing**. Every enterprise legal team will demand it before agent-driven analytics ships to production; we should be the tool that has it before they ask.

After those two, the path to category-defining is clear: spec-as-code in CI (§2.8), then multi-modal sync (§2.1), then captured workflows (§2.5). Each one composes; each one ships in a single session.

---

*Innovation analysis written after PR57. Cross-reference with `AUDIT.md` for the scoreboard, `phase-3-agent-graph.md` for the original architectural design, and `NEXT-SESSIONS.md` for the infrastructure-shaped follow-ups (Astro docs site, WebGL renderer, Rust port, Python wheel).*
