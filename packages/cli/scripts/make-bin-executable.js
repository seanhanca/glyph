// Make the CLI entry point executable after TypeScript compiles it.
// Cross-platform: chmod is a no-op on Windows (which uses the shim in the .cmd).
import { chmodSync, existsSync } from "node:fs";

const bin = new URL("../dist/bin.js", import.meta.url);
if (existsSync(bin)) {
  try {
    chmodSync(bin, 0o755);
  } catch {
    // ignore (Windows etc.)
  }
}
