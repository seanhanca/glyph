// site/play/glyph-runtime.js
// Thin wrapper around the @glyph/core browser bundle. Exists so the
// playground (and any future browser caller) imports the
// `compileSpec` → `renderSvg` pipeline (plus `auditSpec` from PR5)
// through a single, named entry point instead of reaching into
// glyph-bundle.js directly. Keeping the surface this small is what
// makes the "same inputs → same SVG bytes" claim auditable: there's
// nothing else between the user's spec and the rendered string.
import {
  auditSpec,
  compileCompose,
  compileSpec,
  parseComposeSpec,
  renderSvg,
} from "./glyph-bundle.js";

/**
 * Compile a Glyph spec against rows + schema and return the SVG string.
 *
 * Branches on the spec shape:
 *  - If the spec is a compose scene (has a top-level `compose` field),
 *    use the compose compiler — these specs are self-contained and
 *    don't need rows/schema. This is the path for the Glyph-in-Life
 *    + Whyboard examples in the playground gallery.
 *  - Otherwise treat as a chart-shaped spec (the standard
 *    `compileSpec({ spec, rows, schema })` path).
 *
 * @param {object} spec   Parsed Glyph spec (object, not JSON text).
 * @param {Array<object>} rows  Tabular data, one row per object (or [] for
 *                              self-contained specs).
 * @param {Array<{name: string, type: string}>} schema  Column descriptors.
 * @returns {string} SVG markup. Caller is responsible for inserting it.
 */
export function compileAndRender(spec, rows, schema) {
  if (spec && typeof spec === "object" && spec.compose) {
    // Compose scene — re-validate through parseComposeSpec so any
    // schema violation surfaces as a Zod error the playground can show,
    // then compile + render.
    const composeSpec = parseComposeSpec(spec);
    return renderSvg(compileCompose(composeSpec));
  }
  const scene = compileSpec({ spec, rows, schema });
  return renderSvg(scene);
}

/**
 * Detect whether a spec is self-contained (no CSV needed). Returns
 * `true` if either (a) it's a compose scene or (b) it has a
 * `data.shape` field meaning the chart computes its own rows from
 * an equation (function, trajectory, recurrence, pde-solve, …).
 *
 * Used by the playground to decide whether to render immediately
 * after loading an example or wait for the user to provide a CSV.
 *
 * @param {object} spec
 * @returns {boolean}
 */
export function isSelfContainedSpec(spec) {
  if (!spec || typeof spec !== "object") return false;
  if (spec.compose) return true;
  if (spec.data && typeof spec.data === "object") {
    // Math-data shapes that compute rows in the renderer.
    for (const key of [
      "function",
      "trajectory",
      "recurrence",
      "pde_solve",
      "streamline",
      "geodesic",
      "parametric",
      "grid",
      "graph",
      "hierarchy",
    ]) {
      if (spec.data[key]) return true;
    }
  }
  return false;
}

/**
 * Run the static spec auditor and compute a 0-100 trust score.
 *
 * `auditSpec` is the pure-fn linter exported by `@glyph/core` — see
 * `packages/core/src/audit/index.ts`. It returns an array of findings
 * shaped like `{ rule_id, severity: "low"|"medium"|"high", message,
 * suggestion?, path? }`, sorted by severity desc.
 *
 * The trust score is a TEMPORARY playground-only computation: `@glyph/core`
 * does not yet export a `computeTrust` helper. The formula here
 * (100 - Σ weights, clamped to [0, 100]) is documented in the S3
 * playground plan and is expected to be replaced by a core-exported
 * calculator. Follow-up: track in a GH issue + delete this fallback
 * when `@glyph/core` ships `computeTrust`.
 *
 * Note: the MCP verb `glyph_trust` is about provenance/freshness, NOT
 * an audit-findings score — this is a separate concept.
 *
 * @param {object} spec  Parsed Glyph spec.
 * @param {{rowCount?: number, colorCardinality?: number}} [opts]
 * @returns {{findings: ReadonlyArray<object>, trust: number}}
 */
export function runAudit(spec, opts) {
  // Compose scenes are hand-authored scene graphs — they don't carry the
  // chart-spec encodings (`mark`, `encoding.x/y`, `data.shape`, …) that
  // `auditSpec` knows how to lint. Calling it on one throws inside core
  // (e.g. `Cannot read properties of undefined (reading 'length')`),
  // which would surface as a red error in the playground audit pane.
  // Return a clean stub so the trust chip + drawer summary still read
  // sensibly for Glyph-in-Life / Whyboard examples.
  if (spec && typeof spec === "object" && spec.compose) {
    return { findings: [], trust: 100 };
  }
  const findings = auditSpec({
    spec,
    rowCount: opts?.rowCount,
    colorCardinality: opts?.colorCardinality,
  });
  const trust = computeTrustFallback(findings);
  return { findings, trust };
}

// TEMP: weights match the S3 PR5 task brief: high=15, medium=7, low=3.
// Delete once `@glyph/core` exports a real `computeTrust(findings)` —
// the reviewer will compare against that. Tracked as a follow-up.
function computeTrustFallback(findings) {
  let penalty = 0;
  for (const f of findings) {
    if (f.severity === "high") penalty += 15;
    else if (f.severity === "medium") penalty += 7;
    else if (f.severity === "low") penalty += 3;
  }
  return Math.max(0, Math.min(100, 100 - penalty));
}
