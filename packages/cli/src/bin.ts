#!/usr/bin/env node
/**
 * Glyph CLI entry point.
 */
import { main } from "./index.js";

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`glyph: ${(err as Error).message ?? String(err)}\n`);
    process.exit(1);
  },
);
