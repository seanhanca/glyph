# Contributing to Glyph

Welcome! Glyph is a deterministic chart-and-compute library — every PR
either preserves that property or extends it. Most of this doc is about
how to keep determinism intact while you add the thing you want to add.

If you're here for **community discussion**, jump to [Discussions](https://github.com/seanhanca/glyph/discussions)
instead. If you're here to **report a bug or suggest a feature**, use
the [Issue templates](https://github.com/seanhanca/glyph/issues/new/choose) —
they ask the questions a maintainer would ask anyway.

If you're here to **send code**, read on.

---

## AI-maintained

This repository is maintained by **Cowork** (an instance of Claude) on
behalf of the human owner. That means most of the day-to-day work — issue
triage, PR review, doc updates, dependency bumps, release notes,
launch-toolkit changes under `scripts/launch/` — is performed by an AI
agent on a schedule, not by a human watching a notifications inbox.

What that means for you as a contributor:

- **Acknowledgement within minutes.** When you open an issue or PR, the
  [`cowork-triage`](./.github/workflows/cowork-triage.yml) workflow posts
  an acknowledgement immediately. That comment is from Cowork, not a
  human, and explains what happens next.
- **Triage within 24 hours.** Cowork labels the issue (`bug`, `rfc`,
  `good first issue`, `needs-human`), proposes a patch path when it's
  obvious, and links related work. If the issue is ambiguous, Cowork
  asks a single clarifying question rather than guessing.
- **Routine PRs reviewed automatically.** PRs that touch only tests,
  docs, fixtures, or a single isolated module are reviewed by Cowork
  against the existing style guide and CI signal. Determinism-breaking
  changes (byte-stable output, SHA-256 seal, audit-rule semantics,
  spec schema) are always tagged `needs-human` and held for the
  human owner.
- **Humans tagged for the things that need them.** Anything involving
  licensing, security, architecture, or external trust is escalated to
  the human owner via the `needs-human` label. Cowork will not merge
  PRs with that label.
- **Everything is auditable.** Cowork's comments are signed with
  `— Cowork (AI maintainer)`. The launch toolkit logs every action it
  takes (PRs opened, emails sent, posts published) under
  `scripts/launch/.influencer-emails.json` and similar files so the
  human owner can audit at any time.
- **You can always ask for a human.** Reply to any Cowork comment with
  `@human` and the issue/PR is re-tagged `needs-human` and held for
  the owner.

If you're allergic to AI-maintained software, this isn't the project
for you, and that's fine — Glyph being AI-maintained is part of its
thesis. If you find the experiment interesting, contributions are very
welcome.

---

## Tl;dr

```bash
git clone https://github.com/seanhanca/glyph
cd glyph
pnpm install
pnpm build
pnpm test     # 1022 tests
pnpm lint     # 0 errors
```

A green local test run is the floor. CI runs the same commands on
Ubuntu / macOS / Windows × Node 20 / Node 22, and snapshots are
byte-asserted, so platform-flakiness gets caught fast.

---

## The four contributor paths

Pick whichever matches your interest — each has its own front door.

### 1. "I want to ship a `glyph_story` recipe" — easiest

The lowest-friction PR you can send. `glyph_story` is the natural-
language composer (`"show me a sine wave"` → animated SVG). Adding a
recipe is **one object literal** in [`packages/core/src/story/compose.ts`](./packages/core/src/story/compose.ts).

1. File a [recipe idea Issue](https://github.com/seanhanca/glyph/issues/new?template=recipe_idea.yml)
   with the prompt + the picture you want. A maintainer will tag it
   `good-first-issue` and confirm the shape.
2. Open the file, scroll to `RECIPES`, add your entry alphabetically.
3. Add a snapshot test under `packages/core/__fixtures__/story/<your-recipe>.test.ts`
   following the `sine-wave-for-an-8yo.test.ts` shape.
4. `pnpm test -- -u` to write the initial snapshot, eyeball the SVG,
   `pnpm test` again to confirm byte-stable.
5. Send a PR.

Five Joy of Math recipes ship in 0.2.0 (sine, cosine, circle, parabola,
vector field). Twenty would be reasonable for 1.0.0. We need help.

### 2. "I want to add a new mark" — medium

Vector field arrows, hexbin, sankey, chord, sunburst — all marks not
yet in the library. Same architectural pattern as the existing ones:

1. File a [feature request](https://github.com/seanhanca/glyph/issues/new?template=feature_request.yml)
   with the proposed spec shape.
2. Implement under `packages/core/src/compiler/marks/<your-mark>.ts`
   using `registerMark({...})`. The `streamline.ts` and `bezier.ts`
   marks are the cleanest precedents.
3. Add 8–15 unit tests in `<your-mark>.test.ts` covering compile
   correctness + determinism.
4. Add a fixture under `packages/core/__fixtures__/math/<your-mark>-<flavor>.{json,test.ts}`.
5. Extend the `MarkSchema` enum in `packages/core/src/spec/schemas.ts`.

Expect one round of review covering: snapshot stability, audit rules
that should flag misuse, the JSON-Schema shape, and whether the mark
lets you simplify anything elsewhere (DRY wins).

### 3. "I want to add an MCP verb" — medium-large

New agent-facing verbs are the most carefully reviewed surface — each
one shows up in `glyph_capabilities` forever and can't be removed without
breaking agents that depend on it. The bar: **an agent can't already do
this by chaining 2–3 existing verbs**.

Use the [MCP verb idea](https://github.com/seanhanca/glyph/issues/new?template=mcp_verb_idea.yml)
template. The proposal + a maintainer's response usually take a few
back-and-forths before code starts. That's by design.

Once the shape is locked, implementation is a handler in
`packages/mcp/src/server.ts` (look at `glyph_story` for the closest
precedent) + 3–5 handler tests in `server.test.ts`.

### 4. "I want to add an audit rule" — small

Audit rules are the chart-correctness gates. AUDIT-1..AUDIT-11 ship in
0.2.0 (axis truncation, low-sample alarms, double-encoding, color-blind
safety, …). A new rule:

1. File a [feature request](https://github.com/seanhanca/glyph/issues/new?template=feature_request.yml)
   describing the chart pattern the rule should flag, with a fixture
   that triggers it.
2. Implement under `packages/core/src/audit/<rule-name>.ts`.
3. Add a fixture under `packages/core/__fixtures__/audit/<rule-name>.test.ts`.
4. Wire into the audit registry in `packages/core/src/audit/index.ts`.

Audit rules compose with `glyph_audit_spec` automatically, so agents that
consume the audit envelope pick up your rule for free.

---

## The determinism contract

Glyph's most important property is **same spec → same SVG bytes, every
platform, every run.** Three pieces enforce this:

1. **`pnpm test`** asserts byte-identity via `toMatchFileSnapshot` against
   the committed `__fixtures__/*.svg` files. Drift surfaces as a snapshot
   diff before merge.
2. **CI runs the matrix** (Ubuntu / macOS / Windows × Node 20 / 22). Any
   cell that produces different bytes fails the build.
3. **`canonicalStringify`** in [`packages/core/src/render/provenance.ts`](./packages/core/src/render/provenance.ts)
   clamps floating-point numbers to 14 significant digits before hashing,
   so transcendental drift (libm's `sin`/`cos`/`exp` differ in the last
   2–3 bits across platforms) doesn't leak into the provenance seal.

When you add code, ask:
- Does this introduce new floating-point arithmetic? → Use `roundPx` at
  the renderer boundary; the determinism contract holds.
- Does this introduce a new hash input? → It already goes through
  `canonicalStringify`; you're fine.
- Does this introduce a file path / timestamp / env var read? → That's
  a determinism leak. Document it and gate it behind an explicit opt-in.

---

## Local setup

### Prerequisites

- **Node 20 or 22** — we test on both, pick either. `nvm use` if you have nvm.
- **pnpm 9.12+** — the repo uses pnpm workspaces. `npm i -g pnpm` if missing.

### One-time setup

```bash
git clone https://github.com/seanhanca/glyph
cd glyph
pnpm install --frozen-lockfile
pnpm build    # builds @glyph/core's dist/, which other packages import
```

### Day-to-day

```bash
pnpm test         # full workspace (~30 sec)
pnpm lint         # biome — fast
pnpm typecheck    # tsc --noEmit
pnpm format       # biome format --write (run before committing)
```

To run just the tests for the package you're working on:

```bash
pnpm --filter @glyph/core test
pnpm --filter @glyph/mcp test
pnpm --filter @glyph/core test:watch    # watch mode
```

### Regenerating snapshots after an intentional change

```bash
pnpm --filter @glyph/core test -- -u
git diff packages/core/__fixtures__/    # eyeball
```

The `@glyph/duckdb` snapshot test uses an env var instead:

```bash
UPDATE_SNAPSHOTS=1 pnpm --filter @glyph/duckdb test
```

---

## Codespaces

The repo is Codespaces-friendly. Click **Code → Codespaces → Create new
codespace on main** on the GitHub UI. Two minutes later you're in a
hosted VS Code with Node, pnpm, and the workspace ready. This is the
lowest-friction way to try a recipe idea without installing anything
locally.

---

## Commit + PR style

We loosely follow conventional commits (`feat(scope): …`, `fix(scope): …`,
`docs(scope): …`, `chore: …`, `test(scope): …`). Follow the existing log
style and reviewers will thank you. Squash-merge is the default.

PR template in `.github/PULL_REQUEST_TEMPLATE.md` asks the questions a
reviewer would ask anyway. Tick the snapshot-stability checkbox honestly.

---

## Code style

- **TypeScript**: strict mode. No `any` without a comment justifying it.
- **Imports**: `biome organize-imports` handles ordering; run `pnpm format`.
- **Comments**: explain WHY, not WHAT. JSDoc on every exported function /
  class / type — short summary + a longer note when there's a non-obvious
  invariant.
- **Tests**: `describe` for the unit, `it` for the behavior. Test names
  should read like sentences ("compiles a sine spec deterministically").

The biome ruleset is in `biome.json`. Lint errors block CI; warnings
don't but reviewers may ask you to address them.

---

## Releasing the MCP server + workspace packages

Glyph publishes 5 npm packages that move together: `@glyph/core`,
`@glyph/duckdb`, `@glyph/preview-server`, `@glyph/mcp`, `@glyph/live`.
The other workspace packages (`@glyph/cli`, `@glyph/canvas`) are marked
`"private": true` and are NOT published until they're intentionally
released — this keeps an accidental `pnpm publish -r` from pushing them
at `0.0.0`.

### Version policy

- The 5 publishable packages share the same major + minor. Patches may
  diverge.
- The `version` in `server.json` (repo root) must match `@glyph/mcp`'s
  `package.json` `version` byte-identical.
- `mcpName` in `packages/mcp/package.json` must match `name` in
  `server.json` byte-identical.

### One-time setup (per package, in the npmjs.com UI)

For each of `@glyph/core`, `@glyph/duckdb`, `@glyph/preview-server`,
`@glyph/mcp`, `@glyph/live`:

1. Visit the package settings on npmjs.com
2. Publishing → "Add trusted publisher"
3. Publisher: GitHub Actions
4. Organization: `seanhanca`
5. Repository: `glyph`
6. Workflow file: `.github/workflows/publish-mcp.yml`
7. Environment: `release`

Once configured, no `NPM_TOKEN` secret is required — the publish workflow
authenticates via OIDC.

### Cutting a release

```bash
# 1. Bump the 5 publishable packages + server.json to the same new version
# 2. Update CHANGELOG.md with the new version section
# 3. Commit, push, get the PR merged
# 4. Tag the umbrella release + the MCP-specific publish tag
git tag -a v0.2.0 -m "0.2.0 — short summary"
git tag mcp-v0.2.0 v0.2.0
git push origin v0.2.0 mcp-v0.2.0
# 5. Watch the publish workflow
gh run watch
# 6. Refresh the MCP Registry entry (requires GitHub device-flow auth)
brew install mcp-publisher    # one-time
mcp-publisher login github
mcp-publisher publish
# 7. Cut a GitHub Release at https://github.com/seanhanca/glyph/releases/new
#    pasting the new CHANGELOG section as the release body.
```

---

## Code of Conduct

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md).
Be kind. Assume good intent. Ask before assuming.

---

## License

By contributing, you agree your contribution is licensed under the
[Apache 2.0 License](./LICENSE), the same terms as the rest of the
codebase.
