#!/usr/bin/env node
/**
 * Glyph MCP entry — stdio transport.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const { server, state } = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = async (): Promise<void> => {
    try {
      await server.close();
    } catch {
      // ignore
    }
    await state.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err: unknown) => {
  process.stderr.write(`glyph-mcp: ${(err as Error).message ?? String(err)}\n`);
  process.exit(1);
});
