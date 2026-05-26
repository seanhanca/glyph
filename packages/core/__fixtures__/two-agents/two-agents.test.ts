/**
 * Two agents on a chart — the canonical Glyph multi-agent
 * collaboration demo, byte-locked end-to-end.
 *
 * Story:
 *   1. Agent A drafts a bar-chart spec (v1) and renders it.
 *   2. Agent B audits → suggests a patch that pins the y-axis to
 *      [0, 1500] and clarifies the title.
 *   3. Agent A applies the RFC 6902 patch → spec v2 → re-renders.
 *
 * Test:
 *   - v1 spec parses, compiles, renders to a locked SVG.
 *   - v2 spec parses, compiles, renders to a locked SVG.
 *   - v1 and v2 SVGs differ (the patch is observable).
 *   - Applying patch.json (RFC 6902) to v1 produces v2 byte-for-byte.
 *   - Both renders are deterministic (idempotent across runs).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileSpec } from "../../src/compiler/compile.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseSpec } from "../../src/spec/parse.js";

const v1Url = new URL("./v1-agent-a-draft.json", import.meta.url);
const v2Url = new URL("./v2-after-audit-patch.json", import.meta.url);
const patchUrl = new URL("./patch.json", import.meta.url);

/**
 * Apply an RFC 6902 patch to a JSON document. Minimal local
 * implementation — we only support the `add` and `replace` ops the
 * two-agents demo actually uses. Anything richer should pull in
 * `fast-json-patch` from a real dependency.
 */
function applyJsonPatch(
  doc: unknown,
  patch: Array<{ op: string; path: string; value?: unknown }>,
): unknown {
  // Defensive clone so we never mutate the input.
  const out = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
  for (const op of patch) {
    const segments = op.path.split("/").filter((s) => s.length > 0);
    let cursor: Record<string, unknown> | unknown[] = out;
    for (let i = 0; i < segments.length - 1; i++) {
      const key = segments[i];
      const next = Array.isArray(cursor) ? cursor[Number.parseInt(key, 10)] : cursor[key];
      if (next === undefined) {
        if (op.op === "add") {
          // Create intermediate objects for `add` ops on missing paths.
          const newObj: Record<string, unknown> = {};
          if (Array.isArray(cursor)) {
            cursor[Number.parseInt(key, 10)] = newObj;
          } else {
            cursor[key] = newObj;
          }
          cursor = newObj;
        } else {
          throw new Error(`patch path not found: ${op.path}`);
        }
      } else {
        cursor = next as Record<string, unknown> | unknown[];
      }
    }
    const lastKey = segments[segments.length - 1];
    if (op.op === "add" || op.op === "replace") {
      if (Array.isArray(cursor)) {
        cursor[Number.parseInt(lastKey, 10)] = op.value;
      } else {
        cursor[lastKey] = op.value;
      }
    } else {
      throw new Error(`unsupported op: ${op.op}`);
    }
  }
  return out;
}

describe("two agents on a chart — Beat 1 of the launch narrative", () => {
  it("Agent A's v1 draft renders deterministically", async () => {
    const raw = JSON.parse(readFileSync(fileURLToPath(v1Url), "utf8"));
    const spec = parseSpec(raw);
    const svg = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    const svg2 = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    expect(svg2).toBe(svg);
    await expect(svg).toMatchFileSnapshot("./v1-agent-a-draft.svg");
  });

  it("Agent A's v2 (after audit patch) renders deterministically", async () => {
    const raw = JSON.parse(readFileSync(fileURLToPath(v2Url), "utf8"));
    const spec = parseSpec(raw);
    const svg = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    const svg2 = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    expect(svg2).toBe(svg);
    await expect(svg).toMatchFileSnapshot("./v2-after-audit-patch.svg");
  });

  it("v1 and v2 produce different SVG (the patch is observable)", () => {
    const v1Raw = JSON.parse(readFileSync(fileURLToPath(v1Url), "utf8"));
    const v2Raw = JSON.parse(readFileSync(fileURLToPath(v2Url), "utf8"));
    const v1Svg = renderSvg(compileSpec({ spec: parseSpec(v1Raw), rows: [], schema: [] }));
    const v2Svg = renderSvg(compileSpec({ spec: parseSpec(v2Raw), rows: [], schema: [] }));
    expect(v1Svg).not.toBe(v2Svg);
    // The new title text must appear in v2 but not v1.
    expect(v2Svg).toContain("count per hour");
    expect(v1Svg).not.toContain("count per hour");
  });

  it("applying patch.json to v1 produces v2 byte-for-byte", () => {
    const v1Raw = JSON.parse(readFileSync(fileURLToPath(v1Url), "utf8"));
    const v2Raw = JSON.parse(readFileSync(fileURLToPath(v2Url), "utf8"));
    const patch = JSON.parse(readFileSync(fileURLToPath(patchUrl), "utf8")) as Array<{
      op: string;
      path: string;
      value?: unknown;
    }>;

    const patched = applyJsonPatch(v1Raw, patch);
    // Deep equal: the patch transforms v1 into v2.
    expect(JSON.stringify(patched)).toBe(JSON.stringify(v2Raw));
  });
});
