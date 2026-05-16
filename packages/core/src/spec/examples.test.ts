/**
 * Every JSON spec in the repo's top-level `examples/` directory must parse.
 * If you add a new example, this test will pick it up automatically.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { safeParseSpec } from "./parse.js";

const here = dirname(fileURLToPath(import.meta.url));
// Locate `examples/` relative to the package root (two levels up from src/spec).
const examplesDir = join(here, "..", "..", "..", "..", "examples");

function listJsonExamples(): string[] {
  try {
    return readdirSync(examplesDir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
}

describe("examples/", () => {
  const files = listJsonExamples();

  it("contains at least 5 example specs", () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  for (const file of files) {
    it(`parses ${file}`, () => {
      const raw = readFileSync(join(examplesDir, file), "utf8");
      const json = JSON.parse(raw);
      // Strip the optional $schema field — it's an editor hint, not part of the spec.
      // biome-ignore lint/performance/noDelete: simplest way to strip a known optional key
      delete (json as Record<string, unknown>).$schema;
      const r = safeParseSpec(json);
      if (!r.ok) {
        throw new Error(`${file}: ${r.error.message}\n${JSON.stringify(r.error.issues, null, 2)}`);
      }
      expect(r.ok).toBe(true);
    });
  }
});
