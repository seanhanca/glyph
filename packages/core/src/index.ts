/**
 * @glyph/core — public surface.
 *
 * Exports:
 *   - VERSION: package version constant
 *   - Spec types, schemas, and parsers (from ./spec/*)
 *   - Compute engine interface (from ./compute/*)
 *   - Compiler (spec + rows → scenegraph)
 *   - Scenegraph types (the IR consumed by renderers)
 *   - SVG renderer (Scene → SVG string)
 */
export const VERSION = "0.0.0";

export * from "./spec/index.js";
export * from "./compute/index.js";
export * from "./scenegraph/index.js";
export * from "./compiler/index.js";
export * from "./render/index.js";
export * from "./capabilities.js";
