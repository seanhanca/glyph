# Framework integrations

Working samples that plug Glyph 0.3.0's audit-aware refinement into the
major agent frameworks. Each example exercises the same core loop: an agent
proposes a chart edit as an RFC-6902 patch via `glyph_spec_patch`, Glyph
refuses any patch that introduces a new HIGH-severity finding from its
16-rule misleading-chart auditor, and the refusal comes back as structured
JSON (`audit_regression`) the framework's planner can route on.

| File | Framework | Pattern |
|---|---|---|
| `langchain_glyph_audit_gate.py` | LangChain | Analyst proposes patch, Auditor routes on structured `audit_regression` JSON (~40 LOC of logic) |
| `crewai_glyph_audit_crew.py` | CrewAI | Analyst + Auditor + Renderer crew with the audit gate between them |
| `llamaindex_glyph_story_template.py` | LlamaIndex | Query engine drops retrieved facts into the `quarterly-review` Story template |

All three talk to the same MCP server:

```bash
npx -y @glyph/mcp
```

Rendering is deterministic — same spec + rows → same SVG bytes — and every
render can be sealed with `glyph_seal` (SHA-256 over spec, rows, schema)
for provenance. These samples are also staged for upstream contribution to
each framework's examples collection.
