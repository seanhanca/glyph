"""Query engine -> Glyph Story template: a quarterly review chart from RAG.

A LlamaIndex agent retrieves quarterly metrics with a query engine, then
drops the retrieved facts straight into one of Glyph 0.3.0's Story
templates (https://github.com/seanhanca/glyph) via MCP:

* ``glyph_story`` with ``template="quarterly-review"`` turns rows + a
  one-line intent into a finished, annotated chart.
* Refinements go through ``glyph_spec_patch``, which refuses any RFC-6902
  patch that introduces a new HIGH-severity finding from the 16-rule
  misleading-chart auditor — the refusal is structured JSON
  (``audit_regression``) the agent can route on.
* Output is deterministic: same spec + rows -> same SVG bytes, plus a
  ``glyph_seal`` SHA-256 provenance hash over (spec, rows, schema).

Requires: ``pip install llama-index llama-index-tools-mcp`` and Node 20+
(the Glyph MCP server runs via ``npx -y @glyph/mcp``).
"""

import asyncio

from llama_index.core import VectorStoreIndex, SimpleDirectoryReader
from llama_index.core.agent.workflow import FunctionAgent
from llama_index.llms.anthropic import Anthropic
from llama_index.tools.mcp import BasicMCPClient, McpToolSpec


async def main() -> None:
    # 1. Plain RAG over the quarterly report.
    index = VectorStoreIndex.from_documents(
        SimpleDirectoryReader("./data/quarterly_reports").load_data()
    )
    query_engine = index.as_query_engine()
    facts = str(
        query_engine.query(
            "List revenue, gross margin, and active users per quarter for the "
            "last 6 quarters as CSV with a header row."
        )
    )

    # 2. Hand the retrieved facts to Glyph's Story template via MCP.
    glyph = McpToolSpec(client=BasicMCPClient("npx", args=["-y", "@glyph/mcp"]))
    agent = FunctionAgent(
        tools=await glyph.to_tool_list_async(),
        llm=Anthropic(model="claude-sonnet-4-6"),
        system_prompt=(
            "You are a reporting agent. Use glyph_story with "
            "template='quarterly-review' to chart the data you are given. "
            "If you refine the spec, use glyph_spec_patch and obey any "
            "audit_regression refusal (quote its rule_id). Finish with "
            "glyph_render to ./quarterly-review.svg and report the "
            "glyph_seal provenance hash."
        ),
    )

    result = await agent.run(
        "Build the quarterly review chart from this data:\n" + facts
    )
    print(result)


if __name__ == "__main__":
    asyncio.run(main())
