# @glyph/mcp

Glyph MCP server — three tools for AI agents.

```bash
npx @glyph/mcp
# or in Claude Code's mcp config:
# { "mcpServers": { "glyph": { "command": "npx", "args": ["@glyph/mcp"] } } }
```

## Tools

| Tool | Input | Output |
|---|---|---|
| `glyph_describe` | `{ source }` | row count + per-column schema + suggested encoding types |
| `glyph_render` | `{ spec }` | SVG + `handle_id` + view schema |
| `glyph_query` | `{ handle_id, where? }` | drill-in rows |

That's the entire library. ~500 tokens of tool-definition payload, infinite expressiveness via the grammar.

Apache 2.0. Pre-alpha — see the [MVP plan](../../mvp.md).
