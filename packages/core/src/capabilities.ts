/**
 * Glyph capabilities — what this build of the library supports.
 *
 * Used by:
 *   - `glyph_capabilities` MCP verb so agents can detect feature
 *     availability before calling tools that may not exist in older builds.
 *   - The compiler, when refusing a spec that asks for a feature the
 *     current build doesn't implement.
 *
 * Pure data; no side effects.
 */

import { DEFAULT_SPEC_VERSION, SUPPORTED_SPEC_VERSIONS, type SpecVersion } from "./spec/schemas.js";

export const LIBRARY_VERSION = "0.0.0";

/** Marks the current build can compile + render. */
export const SUPPORTED_MARKS = ["bar", "point", "line", "area"] as const;
export type SupportedMark = (typeof SUPPORTED_MARKS)[number];

/** Stats the current build can compile (SQL-rewritten before materialize). */
export const SUPPORTED_STATS = [] as const;
export type SupportedStat = (typeof SUPPORTED_STATS)[number];

/** Renderers the current build provides. */
export const SUPPORTED_RENDERERS = ["svg"] as const;

/** Engines the current build provides. */
export const SUPPORTED_ENGINES = ["duckdb-node"] as const;

export interface Capabilities {
  readonly libraryVersion: string;
  readonly specVersions: ReadonlyArray<SpecVersion>;
  readonly defaultSpecVersion: SpecVersion;
  readonly marks: ReadonlyArray<SupportedMark>;
  readonly stats: ReadonlyArray<SupportedStat>;
  readonly renderers: ReadonlyArray<string>;
  readonly engines: ReadonlyArray<string>;
  /** MCP tools the server exposes today. Sourced from the server bundle. */
  readonly mcpTools?: ReadonlyArray<{ name: string; since: string }>;
}

/** Build the canonical Capabilities object for this library version. */
export function getCapabilities(
  extras: { mcpTools?: ReadonlyArray<{ name: string; since: string }> } = {},
): Capabilities {
  return {
    libraryVersion: LIBRARY_VERSION,
    specVersions: SUPPORTED_SPEC_VERSIONS,
    defaultSpecVersion: DEFAULT_SPEC_VERSION,
    marks: SUPPORTED_MARKS,
    stats: SUPPORTED_STATS,
    renderers: SUPPORTED_RENDERERS,
    engines: SUPPORTED_ENGINES,
    ...(extras.mcpTools ? { mcpTools: extras.mcpTools } : {}),
  };
}
