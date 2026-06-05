# Newsletter pitches — week 3 (0.3.0)

Status: DRAFTED, NOT SENT. `RESEND_API_KEY` is empty and `RESEND_FROM` is a
placeholder, so unattended email is impossible. Each pitch is queued in
`chrome_queue.json` as `newsletter_pitch` (pending_approval) with its
submission route. Lead angle everywhere: the audit-regression gate, not the
changelog.

---

## 1. Latent Space (swyx & Alessio)
Route: reply-able tip — editor@latent.space, or @swyx DM (he has been
pitched 3x on X already this cycle; email is the fresher surface).

Subject: A chart library that refuses to be patched into a misleading chart

swyx — one-paragraph tip for the agent-tooling beat.

Agents that analyze data eventually hand a human a chart, and that hand-off
layer is unowned. Glyph 0.3.0 is an MCP-native chart compiler whose
refinement verb (`glyph_spec_patch`) rejects any RFC-6902 edit that would
introduce a new HIGH-severity finding from a 16-rule misleading-chart
auditor — and the refusal comes back as structured JSON the planner routes
on, not prose. Rendering is byte-deterministic (same spec + rows → same SVG
bytes), so chart output is snapshot-testable like code. The meta-angle your
audience may enjoy: every PR in the release was authored, reviewed, and
merged by Claude.

Essay with live demos: https://seanhanca.github.io/glyph/math/agentic-0.3.0.html
Repo: https://github.com/seanhanca/glyph — Qiang

## 2. TLDR AI
Route: https://tldr.tech/ai — "suggest a link" form (no email needed).

Suggested blurb (their format, ~40 words):
Glyph 0.3.0 (GitHub Repo) — an MCP-native chart library for AI agents where
the patch verb refuses edits that would make a chart misleading, returning
the audit regression as structured JSON. Deterministic SVG output;
AI-built and AI-maintained.
Link: https://github.com/seanhanca/glyph

## 3. Last Week in AI
Route: tips via their Substack contact / hello@lastweekin.ai.

Subject: Tool tip: audit-gated chart refinement for agent stacks (OSS)

Short version for your tools roundup: Glyph 0.3.0 is an open-source,
MCP-native chart compiler built for agent pipelines. Its headline feature
is an audit-regression gate — agent-proposed spec patches are statically
audited against 16 misleading-chart rules and refused (as structured JSON)
if they'd introduce a HIGH-severity regression like silent axis truncation.
Plus SHA-256 provenance seals over (spec, rows, schema) for
content-addressable caching. Apache 2.0, 1,022 tests, every PR authored and
merged by an AI. Essay: https://seanhanca.github.io/glyph/math/agentic-0.3.0.html

## 4. AI Tinkerers
Route: local chapter talk proposal via aitinkerers.org (form), pitch a
10-min demo.

Title: Two agents, one chart, and a gate that says no

Demo pitch: live 10-minute walkthrough where an Analyst agent proposes a
deceptive "improvement" (truncated y-axis), Glyph's `glyph_spec_patch`
refuses it with a structured `audit_regression`, and an Auditor agent
routes on the JSON to ship a compliant fix — ending with byte-identical
re-renders and a provenance seal. Everything runs over MCP from a stock
Claude/LangChain setup; ~40 LOC. Repo: https://github.com/seanhanca/glyph
