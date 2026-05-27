/**
 * Public surface for the spec module.
 * Re-exports the schemas, types, and parse helpers.
 */
export * from "./schemas.js";
export * from "./types.js";
export * from "./parse.js";
// Compose grammar (RFC #5) — the playground bundle imports `parseComposeSpec`
// to validate / render the Glyph-in-Life + Whyboard example specs that don't
// go through the chart-shaped `parseSpec` path.
export { parseComposeSpec, ComposeSpecSchema } from "./compose-schema.js";
export type { ComposeSpec } from "./compose-schema.js";
