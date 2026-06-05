# DuckDB Discord — #showcase post (retargeted from week-2 Reddit draft)

Channel: #showcase in the DuckDB Discord. Tone: builder-to-builder, DuckDB
angle first, no launch-speak. Post as Qiang.

---

**Glyph — a deterministic chart compiler with DuckDB inside the renderer**

I've been building Glyph, an open-source chart library for AI agent stacks, and the part this channel might find interesting is where DuckDB sits: *inside* the renderer. Chart specs carry their SQL transforms; the renderer materializes them through an embedded DuckDB engine, so the same JSON spec + rows produce byte-identical SVG on Ubuntu/macOS/Windows × Node 20/22.

Two DuckDB-adjacent bits from the 0.3.0 release:

`glyph_seal` — hashes (spec, rows, schema) into a SHA-256 provenance seal *without rendering*. Since the DuckDB transform is part of the spec, the seal covers query + data identity, which makes content-addressable chart caches possible: dedupe before any SVG work happens.

Audit-aware patching — `glyph_spec_patch` re-runs a 16-rule misleading-chart audit on every proposed edit and refuses (as structured JSON) any patch that introduces a new HIGH-severity finding, e.g. a silently truncated y-axis.

Playground (browser-only, 72 examples, DuckDB-WASM under the hood): https://seanhanca.github.io/glyph/play/
Repo (Apache 2.0): https://github.com/seanhanca/glyph

Happy to answer anything about embedding DuckDB in a renderer — the schema-inference and determinism corners were the fun part.
