/**
 * End-to-end snapshot tests — the determinism check.
 *
 * For each spec in test-fixtures/snapshots/specs/:
 *   1. Materialize via DuckDB (real engine, real data)
 *   2. Compile to a scenegraph
 *   3. Render to SVG
 *   4. Compare to the baseline .svg
 *
 * The baselines live next to the specs. To regenerate them after an
 * intentional change, run with UPDATE_SNAPSHOTS=1.
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileSpec, renderSvg, safeParseSpecJson } from "@glyph/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDuckDBEngine } from "./engine.js";
import { materializeSpec } from "./materialize.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "test-fixtures", "snapshots");
const specsDir = join(root, "specs");

const update = process.env.UPDATE_SNAPSHOTS === "1";

function listSpecs(): string[] {
  try {
    return readdirSync(specsDir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
}

describe("end-to-end snapshots", () => {
  const files = listSpecs();
  // biome-ignore lint/suspicious/noExplicitAny: vitest engine interface
  let engine: any;

  beforeEach(async () => {
    engine = await createDuckDBEngine();
  });

  afterEach(async () => {
    await engine.close();
  });

  it("snapshot directory has at least one spec", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`matches baseline for ${file}`, async () => {
      const rawSpec = readFileSync(join(specsDir, file), "utf8");
      // Resolve any data.source relative to the spec file's directory.
      const parsed = safeParseSpecJson(rawSpec);
      if (!parsed.ok) {
        throw new Error(`Bad spec ${file}: ${parsed.error.message}`);
      }
      // Phase 0: rewrite top-level data.source to be repo-relative.
      const spec = {
        ...parsed.spec,
        data: parsed.spec.data
          ? { ...parsed.spec.data, source: join(specsDir, parsed.spec.data.source) }
          : undefined,
      };
      const m = await materializeSpec(engine, spec);
      const scene = compileSpec({
        spec,
        rows: m.result.rows,
        schema: m.handle.schema,
      });
      const svg = renderSvg(scene);

      const baselinePath = join(root, "baselines", file.replace(/\.json$/, ".svg"));
      if (update) {
        writeFileSync(baselinePath, svg, "utf8");
        return;
      }
      let baseline: string;
      try {
        baseline = readFileSync(baselinePath, "utf8");
      } catch {
        // First-run: write baseline. Useful in dev; CI fails because the
        // file is committed.
        writeFileSync(baselinePath, svg, "utf8");
        return;
      }
      expect(svg).toBe(baseline);
    });
  }
});
