"""Analyst + Auditor + Renderer crew gated by Glyph's audit-aware patching.

A three-agent CrewAI crew shares the Glyph MCP server
(https://github.com/seanhanca/glyph):

* **Analyst** drafts a chart spec from a CSV and proposes refinements as
  RFC-6902 patches via ``glyph_spec_patch``.
* Glyph refuses any patch that introduces a new HIGH-severity finding from
  its 16-rule misleading-chart auditor and returns the refusal as structured
  JSON (``audit_regression``) — machine-routable, not prose.
* **Auditor** inspects refusals, repairs the patch, and re-submits.
* **Renderer** renders the approved spec (byte-deterministic SVG) and emits
  a ``glyph_seal`` provenance hash over (spec, rows, schema).

Requires: ``pip install crewai crewai-tools`` and Node 20+
(the Glyph MCP server runs via ``npx -y @glyph/mcp``).
"""

from crewai import Agent, Crew, Task
from crewai_tools import MCPServerAdapter
from mcp import StdioServerParameters

glyph_params = StdioServerParameters(command="npx", args=["-y", "@glyph/mcp"])

with MCPServerAdapter(glyph_params) as glyph_tools:
    analyst = Agent(
        role="Data Analyst",
        goal=(
            "Load rides.csv, build a bar chart of rides by hour, then refine "
            "it with glyph_spec_patch. Always report the tool's raw JSON."
        ),
        backstory="Moves fast; occasionally proposes axis tricks that overstate trends.",
        tools=glyph_tools,
    )

    auditor = Agent(
        role="Chart Auditor",
        goal=(
            "Whenever a glyph_spec_patch response contains an "
            "'audit_regression' object, the patch was refused. Quote the "
            "rule_id and severity, then submit a compliant alternative patch "
            "(e.g. annotate a truncated axis instead of hiding it)."
        ),
        backstory="Routes on structured refusals, never on vibes.",
        tools=glyph_tools,
    )

    renderer = Agent(
        role="Renderer",
        goal=(
            "Render the approved spec with glyph_render and emit a "
            "glyph_seal provenance hash. Report the SHA-256 seal."
        ),
        backstory="Ships byte-identical SVGs that can be snapshot-tested.",
        tools=glyph_tools,
    )

    crew = Crew(
        agents=[analyst, auditor, renderer],
        tasks=[
            Task(
                description=(
                    "Propose a y-axis truncation 'improvement' to the rides "
                    "chart via glyph_spec_patch and hand the JSON response on."
                ),
                expected_output="The raw glyph_spec_patch JSON response.",
                agent=analyst,
            ),
            Task(
                description=(
                    "If the response carries audit_regression, repair and "
                    "re-submit a compliant patch."
                ),
                expected_output="rule_id, severity, and the accepted patch.",
                agent=auditor,
            ),
            Task(
                description="Render the final spec and seal it.",
                expected_output="SVG path and SHA-256 provenance seal.",
                agent=renderer,
            ),
        ],
    )

    print(crew.kickoff())
