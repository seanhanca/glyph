"""Analyst + Auditor over Glyph's audit-aware patch gate, in LangChain.

Two agents share one MCP server (Glyph, https://github.com/seanhanca/glyph):

* The **Analyst** proposes a chart edit as an RFC-6902 patch via
  ``glyph_spec_patch``.
* Glyph refuses any patch that introduces a new HIGH-severity finding from
  its 16-rule misleading-chart auditor, returning the refusal as
  **structured JSON** (``audit_regression``) — not free text.
* The **Auditor** routes on that JSON: fix the spec, or surface the refusal.

Rendering is deterministic (same spec + rows -> same SVG bytes), so the
final artifact can be snapshot-tested like code.

Requires: ``pip install langchain langchain-anthropic langchain-mcp-adapters``
and Node 20+ (the Glyph MCP server runs via ``npx -y @glyph/mcp``).
"""

import asyncio
import json

from langchain.agents import create_agent
from langchain_mcp_adapters.client import MultiServerMCPClient

GLYPH_SERVER = {
    "glyph": {
        "command": "npx",
        "args": ["-y", "@glyph/mcp"],
        "transport": "stdio",
    }
}

ANALYST_PROMPT = (
    "You are the Analyst. Load rides.csv with glyph_data_load, create a bar "
    "chart of rides by hour, then 'improve' it by patching the y-axis domain "
    "to start at 40 (glyph_spec_patch, RFC-6902). Report the tool's JSON "
    "response verbatim."
)

AUDITOR_PROMPT = (
    "You are the Auditor. You receive a glyph_spec_patch response. If it "
    "contains an 'audit_regression' object, the patch was REFUSED: name the "
    "rule_id and severity, then propose a compliant alternative patch (e.g. "
    "annotate the truncation instead of silently truncating) and apply it "
    "with glyph_spec_patch. Finish with glyph_render and glyph_seal, and "
    "report the seal hash."
)


async def main() -> None:
    client = MultiServerMCPClient(GLYPH_SERVER)
    tools = await client.get_tools()

    analyst = create_agent("anthropic:claude-sonnet-4-6", tools, prompt=ANALYST_PROMPT)
    auditor = create_agent("anthropic:claude-sonnet-4-6", tools, prompt=AUDITOR_PROMPT)

    proposed = await analyst.ainvoke(
        {"messages": [("user", "Propose the truncated-axis 'improvement'.")]}
    )
    handoff = proposed["messages"][-1].content

    # The refusal arrives as structured JSON the planner can route on:
    #   {"applied": false, "audit_regression":
    #     {"rule_id": "AUDIT-01", "severity": "HIGH",
    #      "message": "bar y-axis truncated without annotation"}}
    verdict = await auditor.ainvoke({"messages": [("user", handoff)]})
    print(json.dumps({"auditor_report": verdict["messages"][-1].content}, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
