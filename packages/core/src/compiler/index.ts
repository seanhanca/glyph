export * from "./scales.js";
export * from "./compile.js";
export * from "./stats.js";
export * from "./morph.js";
// Compose grammar (RFC #5) — exposes `compileCompose` for the playground
// + browser bundle. The schema-side companion (`parseComposeSpec`) lives
// in `src/spec/compose-schema.ts` and is re-exported from `spec/index.ts`.
export { compileCompose } from "./compose.js";
