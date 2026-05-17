# STARTER — paste this into a fresh Claude Code session

> **You are continuing development of Glyph.** Read this file top to bottom and start executing. The user will not re-explain context. If you finish or get blocked, write a one-paragraph status report and stop.

## What Glyph is

> *A chart is a query is a chart.* Glyph is a TypeScript chart-and-compute library where every visualization is a queryable in-memory database — built on DuckDB and the grammar of graphics, designed for AI agents. Apache 2.0. Repo: `https://github.com/seanhanca/glyph`.

## Repository state (as of the last shipped PR)

- **31 PRs merged on `main`.** 254 tests green across Linux/macOS/Windows × Node 20/22.
- Six packages: `@glyph/core`, `@glyph/duckdb`, `@glyph/cli`, `@glyph/mcp` (9 tools), `@glyph/live`, `@glyph/preview-server`.
- Phase 1 grammar complete: `bar` / `point` / `line` / `area` / `rule` marks + `count`/`sum`/`mean` stats + multi-layer + dual y-axis + faceting + legends + grid + ARIA + keyboard nav + tooltip overrides + theme extensibility + locale formatting + Vega-Lite shim + multi-IDE skill manifests (Claude Code / Cursor / Codex / Gemini CLI).
- The cross-MCP scenario is real end-to-end: `glyph_import` + PNG inline + `glyph_preview` + long-poll click → SQL loop.

## Default task — Session A: Phase 3 GDF foundation

**Unless the user named a different Session (B–H), do this one.** It's the highest-leverage remaining work — every Phase 3 §1–§7 innovation gap builds on it.

### What to build

Three PRs, in order. Use the existing PR cycle (branch → implement → `pnpm build / lint / typecheck / test` clean → push → wait for 6-cell CI → squash-merge with `--delete-branch`).

**PR A1 — DataHandle type promotion.** Promote `QueryHandle` in `packages/core/src/spec/types.ts` to a `DataHandle` with these fields, non-breakingly (keep the old `QueryHandle` shape working):

```ts
interface DataHandle {
  uri: string;        // "gdf://<session>/<id>"
  version: number;    // monotonic; bumps when underlying data changes
  schema: ReadonlyArray<{ name: string; type: string; suggested: "quantitative" | "ordinal" | "nominal" | "temporal"; nullable: boolean }>;
  rowCount: number;
  lineage: {
    parents: ReadonlyArray<{ uri: string; relation: "transform" | "filter" | "join" | "agg" }>;
    sql: string;
    producer: { agent: string; tool: string; sessionId: string; at: string };
  };
  provenance: {
    freshness: string;        // ISO timestamp
    sampleRows: number;
    filteredOut: number;
    confidence: "high" | "medium" | "low";
  };
  binding: { kind: "duckdb-view" | "arrow-ipc" | "arrow-flight" | "parquet-uri"; location: string };
  subscribable: boolean;
  subscriptionUri?: string;
}
```

Existing `QueryHandle` users keep working: keep the old `id`/`viewName`/`schema` shape as a type alias.

**PR A2 — Four new MCP verbs in `@glyph/mcp`** (in-process transport only; defer networked Arrow Flight to a later session):

| Verb | Input | Output |
|---|---|---|
| `glyph_publish` | `{ handle_id, scope? }` | `{ uri, version }` |
| `glyph_subscribe` | `{ uri }` | `DataHandle` |
| `glyph_lineage` | `{ uri, depth? }` | tree of `{ uri, sql, producer, at }` |
| `glyph_handles` | `{}` | list of all session handles |

Update `MCP_TOOLS` table + the `glyph_capabilities` test to include the new 4. Total MCP surface stays under ~1000 tokens.

**PR A3 — Spec `data.source` accepts `gdf://` URIs.** The compiler / materializer resolves the URI against the session's handle registry instead of registering a new source from a file path.

### Acceptance criteria (from `phase-3-agent-graph.md` §13 Tier A)

1. `gdf://` URIs resolve transparently in `glyph_render` / `glyph_query` / `glyph_drill` — no API surface change for spec writers.
2. A two-process demo works in the MCP test suite: client A publishes a handle, client B subscribes + renders against it; round-trip < 50 ms on localhost.
3. `glyph_lineage(uri)` returns a tree that walks back to a known source file for every published handle.
4. Snapshot byte-identity still holds for non-interactive specs (no regressions in `packages/duckdb/test-fixtures/snapshots/`).
5. Total MCP surface stays under 1000 tokens of definitions.

### Files to read before you start

- `phase-3-agent-graph.md` — the design spec (§8 GDF protocol, §10 sequencing, §13 gating)
- `packages/core/src/spec/types.ts` — where `QueryHandle` currently lives
- `packages/mcp/src/server.ts` — where the 9 existing tools are registered
- `packages/mcp/src/state.ts` — engine + handle store
- `packages/duckdb/src/materialize.ts` — where handles are created
- `ROADMAP.md` §C — full PR sequencing (the Phase 3 row, PRs 38–52)

## If the user names a different session

Read `NEXT-SESSIONS.md`. It has copy-paste starter prompts for:

| Session | What ships |
|---|---|
| B | Astro docs site + interactive playground + ≥25-example gallery |
| C | `@glyph/canvas` renderer (100k marks < 200 ms) |
| D | `@glyph/webgl` renderer (1M marks < 1 s) |
| E | `@glyph/core-rs` Rust port via napi-rs *(multi-week)* |
| F | `glyph` PyPI via pyo3 *(depends on E)* |
| G | `@glyph/bench` + CI perf gate |
| H × 7 | Phase 3 innovation gaps (semantic / explain / anomaly / drift / decompose / forecast / actions / role-skills / memory / provenance) — one session each |

## Frozen contracts (don't touch unless your session explicitly does)

- **Spec wire format.** Only additive fields allowed; bump `spec.version` if you change semantics.
- **The 9 existing MCP tools' contracts.** Schemas and return shapes are stable.
- **Snapshot byte-identity for non-interactive specs.** The 12 baselines in `packages/duckdb/test-fixtures/snapshots/baselines/` must stay byte-equal unless your change is intentional + documented in the PR description.
- **Apache 2.0 license.** Period.
- **No telemetry.** Default off; explicit opt-in only.

## How to run the cycle

```bash
git pull
git checkout -b feat/<short-name>

# implement…

pnpm install           # if you added a dep
pnpm build
pnpm exec biome check --fix --unsafe .
pnpm -w run typecheck
pnpm run --recursive test    # all packages, 254/254 must stay green

git add -A
git commit -m "feat(…): … (PR<N>)

<detailed body explaining what + why>"

git push -u origin feat/<short-name>
gh pr create --repo seanhanca/glyph --base main --head feat/<short-name> \
   --title "..." --body "..."

# wait for the 6-cell CI matrix to go green:
gh pr checks <N> --repo seanhanca/glyph --watch --fail-fast --interval 10

# then squash-merge:
gh pr merge <N> --repo seanhanca/glyph --squash --delete-branch
```

**GitHub auth:** the user `seanhanca` has a token; if `gh auth status` shows it as inactive, use:

```bash
SEAN_TOKEN=$(gh auth token --user seanhanca) && export GH_TOKEN="$SEAN_TOKEN"
```

before every `gh` and `git push` command.

## When you're done

Write **one paragraph** summarizing what landed (PR numbers, test counts, what's still pending in your session's tier) and stop. Do not start a new session yourself — the user will pick the next one.
