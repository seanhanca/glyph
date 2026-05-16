/**
 * @glyph/core — public surface.
 *
 * Phase 0 exports:
 *   - VERSION: package version constant
 *   - Spec types, schemas, and parsers (from ./spec/*)
 *   - Compute engine interface (from ./compute/*)
 *
 * Subsequent PRs will add the compiler, scenegraph, and SVG renderer.
 */
export const VERSION = "0.0.0";

export * from "./spec/index.js";
export * from "./compute/index.js";
