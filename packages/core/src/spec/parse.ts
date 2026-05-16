/**
 * Spec parsing — the entry point an agent uses to validate input before
 * handing it to the compiler/renderer.
 *
 * Two flavors:
 *   - `parseSpec(input)`: throws on invalid input (use in CLI / tests)
 *   - `safeParseSpec(input)`: returns a discriminated result (use in MCP server)
 *
 * Errors are formatted with Zod's path so an LLM can fix the offending field.
 */

import type { ZodError, ZodIssue } from "zod";
import { GlyphSpecSchema } from "./schemas.js";
import type { GlyphSpec } from "./types.js";

export interface SpecParseError {
  message: string;
  issues: ReadonlyArray<{
    path: ReadonlyArray<string | number>;
    code: string;
    message: string;
  }>;
}

export type SpecParseResult = { ok: true; spec: GlyphSpec } | { ok: false; error: SpecParseError };

function formatError(err: ZodError): SpecParseError {
  const issues = err.issues.map((i: ZodIssue) => ({
    path: i.path,
    code: i.code,
    message: i.message,
  }));
  // First issue gets surfaced in the top-level message — agents read this first.
  const head = issues[0];
  const headPath = head?.path.length ? head.path.join(".") : "<root>";
  const message = head
    ? `Invalid Glyph spec at ${headPath}: ${head.message}`
    : "Invalid Glyph spec";
  return { message, issues };
}

/** Parse a Glyph spec from any JSON-like input. Throws on invalid input. */
export function parseSpec(input: unknown): GlyphSpec {
  return GlyphSpecSchema.parse(input);
}

/** Parse a Glyph spec from any JSON-like input. Never throws. */
export function safeParseSpec(input: unknown): SpecParseResult {
  const result = GlyphSpecSchema.safeParse(input);
  if (result.success) {
    return { ok: true, spec: result.data };
  }
  return { ok: false, error: formatError(result.error) };
}

/** Parse a Glyph spec from a JSON string. Never throws. */
export function safeParseSpecJson(input: string): SpecParseResult {
  let json: unknown;
  try {
    json = JSON.parse(input);
  } catch (err) {
    return {
      ok: false,
      error: {
        message: `Invalid JSON: ${(err as Error).message}`,
        issues: [],
      },
    };
  }
  return safeParseSpec(json);
}
