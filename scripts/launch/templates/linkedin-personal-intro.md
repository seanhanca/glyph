# LinkedIn — personal intro post (replaces missing linkedin-week1.md)

Voice: first person, Qiang's personal profile (real network). Not a product
announcement — a "what I've been building and why" post.

---

For the past few months I've been running an experiment: can an AI build and maintain a production-grade open-source library, end to end? Every PR authored, reviewed, and merged by Claude — I set direction and review the result.

The library is Glyph: a chart compiler designed for AI agents rather than humans typing code. An agent emits a JSON spec; Glyph returns the same SVG bytes every time, on every platform, with a SHA-256 provenance seal so a second agent can verify what the first one drew.

The release I'm most proud of shipped last week (0.3.0). Its headline feature is a refusal gate: when an agent "refines" a chart, the patch verb re-runs a 16-rule misleading-chart audit and refuses any edit that would introduce a new HIGH-severity problem — a truncated y-axis, an undisclosed log scale. The refusal is structured JSON the agent can route on. An audit reports; a gate refuses.

Where it stands: 53 MCP verbs, 24 mark types, 1,022 tests, Apache 2.0, no telemetry.

Two things I'd genuinely value from this network: if you're building agent pipelines that produce charts, I'd love to hear where they break. And if you know someone working on agent tooling, the design essay is the best 10-minute intro: https://seanhanca.github.io/glyph/math/agentic-0.3.0.html

Repo: https://github.com/seanhanca/glyph
