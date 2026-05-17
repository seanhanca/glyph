/**
 * @glyph/duckdb — DuckDB Node implementation of @glyph/core's ComputeEngine.
 */
export { createDuckDBEngine } from "./engine.js";
export type { DuckDBEngineOptions } from "./engine.js";
export {
  materializeSpec,
  materializeRowsAsHandle,
  materializeViewAsHandle,
} from "./materialize.js";
export type { MaterializedSpec, HandleResolver } from "./materialize.js";
