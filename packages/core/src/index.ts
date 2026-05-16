/**
 * @glyph/core — public surface.
 *
 * Phase 0 exports:
 *   - VERSION: package version constant
 *   - Spec types, schemas, and parsers (from ./spec/*)
 *
 * Subsequent PRs will add the compiler, scenegraph, and SVG renderer.
 */
export const VERSION = "0.0.0";

export * from "./spec/index.js";
