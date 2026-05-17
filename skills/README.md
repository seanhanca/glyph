# Glyph skills — day-one installs across four agent hosts

The same `skills/glyph/SKILL.md` is referenced by four plugin manifests in this repo, one per host. Each manifest wires up the same MCP server (`@glyph/mcp`) so agents on every supported host see the same nine-tool surface.

| Host | Manifest |
|---|---|
| Claude Code | [`.claude-plugin/plugin.json`](../.claude-plugin/plugin.json) |
| Cursor | [`.cursor-plugin/plugin.json`](../.cursor-plugin/plugin.json) |
| Codex | [`.codex-plugin/plugin.json`](../.codex-plugin/plugin.json) |
| Gemini CLI | [`.gemini-plugin/plugin.json`](../.gemini-plugin/plugin.json) |

Each manifest declares:

```json
{
  "skills": [{ "name": "glyph", "path": "./skills/glyph/SKILL.md" }],
  "mcpServers": {
    "glyph": { "command": "npx", "args": ["-y", "@glyph/mcp"] }
  }
}
```

Schema URLs vary per host as those vendors finalize their plugin formats; the JSON shape is intentionally identical so a single PR can update all four when conventions shift.

## Manual install fallback

If your host doesn't yet read its plugin manifest from the repo, drop the equivalent block into the host's user-level config:

- Claude Code: `~/.claude/mcp.json`
- Cursor: `~/.cursor/mcp.json`
- Codex: `~/.codex/config.toml` (under `[mcp_servers.glyph]`)
- Gemini CLI: `~/.gemini/settings.json` (`mcpServers.glyph`)

## What the skill does for you

Read `skills/glyph/SKILL.md` — it walks the agent through the **nine MCP tools** with concrete recipes:

1. `glyph_capabilities` — feature detection
2. `glyph_describe` — inspect a file before writing a spec
3. `glyph_render` — compile + render; returns SVG, PNG, and a `handle_id`
4. `glyph_query` — follow-up SQL against the chart's view
5. `glyph_drill` — predicate-driven drill-in (equals / between / in)
6. `glyph_import` — bring rows in from another MCP tool (CSV / JSON / URL)
7. `glyph_preview` — open an interactive chart in a localhost browser
8. `glyph_await_interaction` — long-poll the click → agent loop
9. `glyph_close_preview` — stop the preview server

Apache 2.0. No telemetry. Same skill content across all four hosts.
