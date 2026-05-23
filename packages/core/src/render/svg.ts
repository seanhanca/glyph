/**
 * SVG renderer — Scene → SVG string.
 *
 * Pure function. No DOM, no jsdom. Deterministic: same Scene → same bytes.
 *
 * Output is intentionally compact: no whitespace between attributes, fixed
 * decimal precision (via the compiler's roundPx), and elements emitted in
 * a fixed order (axes, then marks).
 *
 * Interactive mode (opt-in via `scene.schema`):
 *   - Marks render inside a `<g class="glyph-marks" data-*>` group describing
 *     which source field each channel maps to.
 *   - Each mark gets `data-key` + `data-x` / `data-y` / `data-color` / `data-row`.
 *   - A tiny `<style>` block adds a `:hover` outline (zero JS, deterministic).
 *   - When `scene.schema` is absent, output is byte-identical to the
 *     non-interactive path so existing snapshots stay green.
 */

import { roundPx } from "../compiler/scales.js";
import type {
  MarkData,
  Scene,
  SceneAxis,
  SceneLegend,
  SceneMark,
  ScenePanel,
} from "../scenegraph/types.js";
import { polylineLength } from "./path-length.js";
import { renderProvenanceMetadata } from "./provenance.js";

const AXIS_COLOR = "#999999";
const AXIS_LABEL_COLOR = "#333333";
const GRID_COLOR = "#e6e6e6";
const FONT_FAMILY = "system-ui, -apple-system, sans-serif";

const HOVER_STYLE =
  "<style>.glyph-marks &gt; *{transition:filter .12s ease-out}.glyph-marks &gt; *:hover{filter:brightness(1.08);outline:1px solid #00000033;outline-offset:1px;cursor:pointer}</style>";

/**
 * Moat 5/5 — declarative crossfilter CSS. Same-chart "focus + dim"
 * effect (NOT key-matched sibling highlight; see note below):
 *   1. The directly-hovered mark gets a bright outline (yellow by
 *      default; overridable via the `--crossfilter-highlight` CSS
 *      variable a brand theme can set).
 *   2. When any descendant carrying `data-crossfilter-key` is hovered,
 *      the `:has()` rule on `.glyph-marks` enters "filter mode" and
 *      dims every OTHER `data-crossfilter-key` sibling to opacity .35
 *      — irrespective of key value. This is intentionally a focus aid,
 *      not a key-matched highlight: the static SVG path has no way to
 *      read the hovered element's key value in pure CSS.
 *
 * Real key-matched highlight (single-chart) and cross-chart linkage
 * both require JS — `@glyph/live` reads the same data-attrs and
 * broadcasts hover events keyed by group. This CSS is the zero-JS
 * baseline.
 *
 * Emitted only when `scene.schema.crossfilterGroup` is set, so
 * existing snapshots stay byte-identical.
 */
const CROSSFILTER_STYLE =
  "<style>[data-crossfilter-group] [data-crossfilter-key]:hover{outline:2px solid var(--crossfilter-highlight,#fbbf24);outline-offset:2px;cursor:pointer}.glyph-marks:has([data-crossfilter-key]:hover) [data-crossfilter-key]:not(:hover){opacity:.35;transition:opacity .12s ease-out}</style>";

/**
 * Escape user-derived text for inclusion in SVG. Covers the five XML chars
 * plus stripping control characters (which are illegal in XML 1.0).
 */
function esc(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    // Strip illegal-in-XML control characters (kept: TAB \t, LF \n, CR \r).
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) continue;
    const ch = s[i];
    if (ch === "&") out += "&amp;";
    else if (ch === "<") out += "&lt;";
    else if (ch === ">") out += "&gt;";
    else if (ch === '"') out += "&quot;";
    else if (ch === "'") out += "&apos;";
    else out += ch;
  }
  return out;
}

/** Render data-* attributes from MarkData. Deterministic ordering: key first, then sorted attrs. */
function renderDataAttrs(d: MarkData): string {
  let out = "";
  if (d.key !== undefined) out += ` data-key="${esc(d.key)}"`;
  const attrs = d.dataAttrs;
  if (attrs) {
    const keys = Object.keys(attrs).sort();
    for (const k of keys) {
      const v = attrs[k];
      if (v === undefined) continue;
      out += ` data-${k}="${esc(String(v))}"`;
    }
  }
  return out;
}

/** ARIA attributes for an interactive mark (reuses tooltip text as the label). */
function ariaForMark(m: { readonly tooltip?: string }): string {
  if (!m.tooltip) return ` role="button" tabindex="0"`;
  return ` role="button" tabindex="0" aria-label="${esc(m.tooltip)}"`;
}

function renderMark(m: SceneMark, interactive: boolean): string {
  switch (m.type) {
    case "rect": {
      const stroke = m.stroke ? ` stroke="${esc(m.stroke)}"` : "";
      const sw = m.strokeWidth !== undefined ? ` stroke-width="${m.strokeWidth}"` : "";
      // Moat PR3 — dashed border for missing-data callout markers.
      const dash =
        m.strokeDasharray !== undefined ? ` stroke-dasharray="${esc(m.strokeDasharray)}"` : "";
      // Joy of Math E1 — rounded corners for annotation bubbles.
      // Undefined for every other rect consumer → byte-identical
      // rendering preserved.
      const rx = m.rx !== undefined ? ` rx="${m.rx}"` : "";
      if (!interactive) {
        // Moat PR3 — even in the non-interactive path, emit `<title>` when
        // the mark carries one. Today only the missing-data callout marker
        // sets `tooltip` outside interactive mode; every other path leaves
        // it undefined and falls back to the byte-identical self-closing
        // rect (existing snapshots stay green).
        if (m.tooltip) {
          return `<rect x="${m.x}" y="${m.y}" width="${m.width}" height="${m.height}" fill="${esc(
            m.fill,
          )}"${stroke}${sw}${dash}${rx}><title>${esc(m.tooltip)}</title></rect>`;
        }
        return `<rect x="${m.x}" y="${m.y}" width="${m.width}" height="${m.height}" fill="${esc(
          m.fill,
        )}"${stroke}${sw}${dash}${rx}/>`;
      }
      const data = renderDataAttrs(m);
      const aria = ariaForMark(m);
      const tooltip = m.tooltip ? `<title>${esc(m.tooltip)}</title>` : "";
      if (tooltip) {
        return `<rect x="${m.x}" y="${m.y}" width="${m.width}" height="${m.height}" fill="${esc(
          m.fill,
        )}"${stroke}${sw}${dash}${rx}${data}${aria}>${tooltip}</rect>`;
      }
      return `<rect x="${m.x}" y="${m.y}" width="${m.width}" height="${m.height}" fill="${esc(
        m.fill,
      )}"${stroke}${sw}${dash}${rx}${data}${aria}/>`;
    }
    case "circle": {
      const stroke = m.stroke ? ` stroke="${esc(m.stroke)}"` : "";
      const sw = m.strokeWidth !== undefined ? ` stroke-width="${m.strokeWidth}"` : "";
      // E2 — optional opacity (traveler trail circles use this for the
      // tail→head fade). Undefined elsewhere keeps snapshots stable.
      const op = m.opacity !== undefined ? ` opacity="${m.opacity}"` : "";
      // E2 — when motion is set, render the circle as an opening tag
      // wrapping an <animateMotion> child so SMIL can drive it along
      // the referenced path. Branches out early before the interactive /
      // tooltip fast paths because the motion child is required to live
      // inside the element, not on it.
      if (m.motion) {
        const pathRef = `#${m.motion.pathId}`;
        const dur = `${m.motion.durationMs}ms`;
        const begin =
          m.motion.beginMs !== undefined && m.motion.beginMs !== 0
            ? ` begin="${m.motion.beginMs}ms"`
            : "";
        // `repeatCount="indefinite"` matches the kid-delight "loop forever"
        // intent of the traveler mark. `rotate="auto"` keeps the dot's
        // local frame aligned to the path tangent — invisible for a
        // symmetric circle but lets future arrow-shaped travelers
        // orient correctly.
        //
        // `keyTimes="0;0.5;1" keyPoints="0;1;0"` makes the dot **bounce**
        // along the path: in the first half of each loop it rides start→
        // end (path fraction 0 → 1), in the second half it rides end→
        // start (1 → 0), then the loop repeats. Without this
        // reparameterization a one-way `repeatCount="indefinite"` would
        // snap the dot from path-end back to path-start at every cycle
        // boundary — visible to the viewer as the dot "disappearing on
        // the right and reappearing on the left" instead of riding the
        // wave continuously. The bounce keeps the dot on the curve at
        // all times. For open paths (sine wave, parabola, …) this is the
        // natural visual; for closed paths (circle) the bounce reverses
        // direction at each lap which still looks coherent because the
        // start and end points coincide.
        //
        // Both `href` (SVG 2) and `xlink:href` (SVG 1.1) are emitted so the
        // motion reference resolves in every browser that ever shipped
        // SMIL. xlink:href is the historical form (still required by
        // Safari < 14 / older WebKit-based viewers) and href is the
        // forward-compatible replacement. Including both is the
        // belt-and-suspenders pattern recommended by MDN's SMIL docs.
        const animateMotion =
          `<animateMotion dur="${dur}"${begin} repeatCount="indefinite" rotate="auto" keyTimes="0;0.5;1" keyPoints="0;1;0" calcMode="linear">` +
          `<mpath href="${pathRef}" xlink:href="${pathRef}"/></animateMotion>`;
        // `<animateMotion>` adds a `translate(pathX, pathY)` transform to
        // the element. For a `<circle>`, that transform composes with
        // the intrinsic `cx`/`cy` — so a circle authored at
        // `cx=116, cy=192` with a path starting at `(116, 192)` lands
        // at `(232, 384)` at t=0, NOT `(116, 192)`. Visible bug: dots
        // trace the wave shape but offset by the path's first point,
        // so they "move but not on the lines."
        //
        // Emit `cx=0 cy=0` whenever `motion` is set so the path
        // coordinates ARE the dot's absolute position. The compiler's
        // `m.cx` / `m.cy` are still the path's first point (used by
        // every other branch — non-interactive, interactive, tooltip),
        // we just drop them here.
        return `<circle cx="0" cy="0" r="${m.r}" fill="${esc(m.fill)}"${stroke}${sw}${op}>${animateMotion}</circle>`;
      }
      if (!interactive) {
        if (op) {
          return `<circle cx="${m.cx}" cy="${m.cy}" r="${m.r}" fill="${esc(m.fill)}"${stroke}${sw}${op}/>`;
        }
        return `<circle cx="${m.cx}" cy="${m.cy}" r="${m.r}" fill="${esc(m.fill)}"${stroke}${sw}/>`;
      }
      const data = renderDataAttrs(m);
      const aria = ariaForMark(m);
      const tooltip = m.tooltip ? `<title>${esc(m.tooltip)}</title>` : "";
      if (tooltip) {
        return `<circle cx="${m.cx}" cy="${m.cy}" r="${m.r}" fill="${esc(m.fill)}"${stroke}${sw}${op}${data}${aria}>${tooltip}</circle>`;
      }
      return `<circle cx="${m.cx}" cy="${m.cy}" r="${m.r}" fill="${esc(m.fill)}"${stroke}${sw}${op}${data}${aria}/>`;
    }
    case "line":
      return `<line x1="${m.x1}" y1="${m.y1}" x2="${m.x2}" y2="${m.y2}" stroke="${esc(
        m.stroke,
      )}" stroke-width="${m.strokeWidth}"/>`;
    case "path": {
      const fill = m.fill !== undefined ? esc(m.fill) : "none";
      const stroke = m.stroke ? ` stroke="${esc(m.stroke)}"` : "";
      const sw = m.strokeWidth !== undefined ? ` stroke-width="${m.strokeWidth}"` : "";
      const op = m.opacity !== undefined ? ` opacity="${m.opacity}"` : "";
      // Moat PR3 — dashed stroke for the interpolated bridge segment that
      // sits across a missing-data gap. Undefined on every other path so
      // existing snapshots stay byte-identical.
      const dash =
        m.strokeDasharray !== undefined ? ` stroke-dasharray="${esc(m.strokeDasharray)}"` : "";
      // E2 — id is emitted FIRST (before d) so `<mpath xlink:href="#id">`
      // can resolve it. Undefined on every existing path so byte output
      // is unchanged for the snapshot corpus.
      const id = m.id !== undefined ? ` id="${esc(m.id)}"` : "";
      return `<path${id} d="${m.d}" fill="${fill}"${stroke}${sw}${op}${dash}/>`;
    }
    case "text": {
      // Moat PR3 — emit `<title>` when the text mark carries a tooltip
      // (used by the line/point callout marker for "Missing value at
      // x=<value>"). Plain text marks leave `tooltip` undefined and
      // continue to render as the byte-identical self-closing form.
      if (m.tooltip) {
        return `<text x="${m.x}" y="${m.y}" font-size="${m.fontSize}" fill="${esc(
          m.fill,
        )}" text-anchor="${m.anchor}" dominant-baseline="${m.baseline}">${esc(
          m.text,
        )}<title>${esc(m.tooltip)}</title></text>`;
      }
      return `<text x="${m.x}" y="${m.y}" font-size="${m.fontSize}" fill="${esc(
        m.fill,
      )}" text-anchor="${m.anchor}" dominant-baseline="${m.baseline}">${esc(m.text)}</text>`;
    }
    case "arc": {
      // PR66 — pie / donut slice. Build the path inline so the renderer
      // has zero scenegraph→SVG transformation work other than emitting.
      const d = arcSvgPath(m.cx, m.cy, m.innerRadius, m.outerRadius, m.startAngle, m.endAngle);
      const stroke = m.stroke ? ` stroke="${esc(m.stroke)}"` : "";
      const sw = m.strokeWidth !== undefined ? ` stroke-width="${m.strokeWidth}"` : "";
      if (!interactive) {
        return `<path d="${d}" fill="${esc(m.fill)}"${stroke}${sw}/>`;
      }
      const data = renderDataAttrs(m);
      const aria = ariaForMark(m);
      const tooltip = m.tooltip ? `<title>${esc(m.tooltip)}</title>` : "";
      if (tooltip) {
        return `<path d="${d}" fill="${esc(m.fill)}"${stroke}${sw}${data}${aria}>${tooltip}</path>`;
      }
      return `<path d="${d}" fill="${esc(m.fill)}"${stroke}${sw}${data}${aria}/>`;
    }
    case "arrow": {
      // Math PR3 — oriented arrow for the `vector-field` mark. Tail at
      // (x, y); head at (x + length·cos(angle), y + length·sin(angle)).
      // The marker-end references `#glyph-arrow`, emitted once in
      // `<defs>` when the scene contains any arrow mark (see
      // `renderArrowDefs`).
      const x2 = m.x + Math.cos(m.angle) * m.length;
      const y2 = m.y + Math.sin(m.angle) * m.length;
      const sw = m.strokeWidth !== undefined ? m.strokeWidth : 1.5;
      // Round endpoints to 4 decimals — comfortably inside the roundPx
      // precision band so byte output stays stable.
      const r = (n: number): number => Math.round(n * 1e4) / 1e4;
      return `<line x1="${m.x}" y1="${m.y}" x2="${r(x2)}" y2="${r(y2)}" stroke="${esc(
        m.stroke,
      )}" stroke-width="${sw}" marker-end="url(#glyph-arrow)"/>`;
    }
    case "group": {
      // RFC #5 — compose group. Render the children recursively
      // inside a `<g transform="translate(...) [scale(...)]">`
      // wrapper; if the group has a loop animation, append the
      // pre-rendered SMIL XML after the children. The translate
      // places the group on the parent canvas; the optional scale
      // sizes embedded nested charts; the SMIL `additive="sum"`
      // rotation / scale layers on top, animating the contents
      // about their local origin.
      const tx = m.translateX.toFixed(3);
      const ty = m.translateY.toFixed(3);
      let transform = `translate(${tx}, ${ty})`;
      if (m.scaleX !== undefined || m.scaleY !== undefined) {
        const sx = (m.scaleX ?? 1).toFixed(6);
        const sy = (m.scaleY ?? m.scaleX ?? 1).toFixed(6);
        transform += ` scale(${sx}, ${sy})`;
      }
      const childrenSvg = m.children.map((c) => renderMark(c, interactive)).join("");
      const anim = m.loopAnimationXml ?? "";
      const idAttr = m.id ? ` id="${esc(m.id)}"` : "";
      return `<g${idAttr} transform="${transform}">${childrenSvg}${anim}</g>`;
    }
    case "gradient-def": {
      // RFC #9 — emitted inside the `<defs>` block at the top of the
      // SVG. The renderer's `renderSvg` collects all gradient-def +
      // pattern-def marks into one `<defs>` block.
      const tag = m.kind === "linear" ? "linearGradient" : "radialGradient";
      const attrs = Object.entries(m.attrs)
        .map(([k, v]) => `${k}="${esc(v)}"`)
        .join(" ");
      const stops = m.stops
        .map(
          (s) =>
            `<stop offset="${esc(s.offset)}" stop-color="${esc(s.color)}"${
              s.opacity !== undefined ? ` stop-opacity="${s.opacity}"` : ""
            }/>`,
        )
        .join("");
      return `<${tag} id="${esc(m.id)}" ${attrs}>${stops}</${tag}>`;
    }
    case "pattern-def": {
      const transform = m.patternTransform ? ` patternTransform="${esc(m.patternTransform)}"` : "";
      const childrenSvg = m.children.map((c) => renderMark(c, interactive)).join("");
      return `<pattern id="${esc(m.id)}" width="${m.width}" height="${m.height}" patternUnits="userSpaceOnUse"${transform}>${childrenSvg}</pattern>`;
    }
    case "ellipse": {
      const stroke = m.stroke ? ` stroke="${esc(m.stroke)}"` : "";
      const sw = m.strokeWidth !== undefined ? ` stroke-width="${m.strokeWidth}"` : "";
      const op = m.opacity !== undefined ? ` opacity="${m.opacity}"` : "";
      const rot =
        m.rotateDeg !== undefined && m.rotateDeg !== 0
          ? ` transform="rotate(${m.rotateDeg.toFixed(3)})"`
          : "";
      return `<ellipse cx="${m.cx}" cy="${m.cy}" rx="${m.rx}" ry="${m.ry}" fill="${esc(m.fill)}"${stroke}${sw}${op}${rot}/>`;
    }
    case "polygon": {
      const pts = m.points.map(([x, y]) => `${x},${y}`).join(" ");
      const stroke = m.stroke ? ` stroke="${esc(m.stroke)}"` : "";
      const sw = m.strokeWidth !== undefined ? ` stroke-width="${m.strokeWidth}"` : "";
      return `<polygon points="${pts}" fill="${esc(m.fill)}"${stroke}${sw}/>`;
    }
    case "polyline": {
      const pts = m.points.map(([x, y]) => `${x},${y}`).join(" ");
      const dash = m.strokeDasharray ? ` stroke-dasharray="${esc(m.strokeDasharray)}"` : "";
      return `<polyline points="${pts}" fill="${esc(m.fill)}" stroke="${esc(m.stroke)}" stroke-width="${m.strokeWidth}"${dash}/>`;
    }
    case "raw-svg": {
      // RFC #9 — verbatim SVG XML escape hatch. Schema-validated upstream.
      return m.xml;
    }
  }
}

/**
 * Emit the `<defs>` block for the arrow marker. Called once per render
 * when the scene contains any arrow SceneMark; returns "" otherwise so
 * existing snapshots (no arrows) stay byte-identical. The marker is a
 * filled triangle pointing along the line direction; the stroke color
 * of the referencing line drives the marker fill via `context-stroke`
 * (CSS Paint Module / SVG 2; degrades to black on older renderers).
 */
function renderArrowDefs(scene: Scene): string {
  for (const m of scene.marks) {
    if (m.type === "arrow") {
      return (
        '<defs><marker id="glyph-arrow" viewBox="0 0 10 10" refX="9" refY="5" ' +
        'markerWidth="6" markerHeight="6" orient="auto-start-reverse" markerUnits="strokeWidth">' +
        '<path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke"/></marker></defs>'
      );
    }
  }
  return "";
}

/**
 * E2 — true iff the scene contains any SMIL `<animateMotion>` reference
 * that needs the xlink namespace declared on the root SVG. Today only
 * the `traveler` mark emits circle marks with `motion`; this check
 * keeps the namespace OFF for every other scene so existing snapshots
 * stay byte-identical.
 */
function sceneNeedsXlinkNs(scene: Scene): boolean {
  for (const m of scene.marks) {
    if (m.type === "circle" && m.motion) return true;
  }
  if (scene.panels) {
    for (const p of scene.panels) {
      for (const m of p.marks) {
        if (m.type === "circle" && m.motion) return true;
      }
    }
  }
  return false;
}

/**
 * PR66 — emit an SVG path-d string for one annular sector. The compiler
 * could pre-compute this, but keeping it in the renderer means the
 * scenegraph stays semantic (cx/cy/innerR/outerR/angles) rather than
 * a string blob — friendlier to other renderers (canvas/webgl).
 *
 * Angle convention: clockwise from 12-o'clock. We subtract π/2 here so
 * 0 rad points up.
 */
function arcSvgPath(
  cx: number,
  cy: number,
  innerR: number,
  outerR: number,
  startAngle: number,
  endAngle: number,
): string {
  const a0 = startAngle - Math.PI / 2;
  const a1 = endAngle - Math.PI / 2;
  const sweep = endAngle - startAngle;
  const largeArc = sweep > Math.PI ? 1 : 0;
  const r = (n: number): number => Math.round(n * 1e8) / 1e8;
  const ox = (rad: number, a: number): number => r(cx + rad * Math.cos(a));
  const oy = (rad: number, a: number): number => r(cy + rad * Math.sin(a));
  if (sweep >= 2 * Math.PI - 1e-9) {
    // Full ring or disc.
    if (innerR <= 0) {
      return `M ${ox(outerR, a0)} ${oy(outerR, a0)} A ${r(outerR)} ${r(outerR)} 0 1 1 ${ox(outerR, a0 + Math.PI)} ${oy(outerR, a0 + Math.PI)} A ${r(outerR)} ${r(outerR)} 0 1 1 ${ox(outerR, a0)} ${oy(outerR, a0)} Z`;
    }
    return `M ${ox(outerR, a0)} ${oy(outerR, a0)} A ${r(outerR)} ${r(outerR)} 0 1 1 ${ox(outerR, a0 + Math.PI)} ${oy(outerR, a0 + Math.PI)} A ${r(outerR)} ${r(outerR)} 0 1 1 ${ox(outerR, a0)} ${oy(outerR, a0)} Z M ${ox(innerR, a0)} ${oy(innerR, a0)} A ${r(innerR)} ${r(innerR)} 0 1 0 ${ox(innerR, a0 + Math.PI)} ${oy(innerR, a0 + Math.PI)} A ${r(innerR)} ${r(innerR)} 0 1 0 ${ox(innerR, a0)} ${oy(innerR, a0)} Z`;
  }
  if (innerR <= 0) {
    return `M ${r(cx)} ${r(cy)} L ${ox(outerR, a0)} ${oy(outerR, a0)} A ${r(outerR)} ${r(outerR)} 0 ${largeArc} 1 ${ox(outerR, a1)} ${oy(outerR, a1)} Z`;
  }
  return `M ${ox(innerR, a0)} ${oy(innerR, a0)} L ${ox(outerR, a0)} ${oy(outerR, a0)} A ${r(outerR)} ${r(outerR)} 0 ${largeArc} 1 ${ox(outerR, a1)} ${oy(outerR, a1)} L ${ox(innerR, a1)} ${oy(innerR, a1)} A ${r(innerR)} ${r(innerR)} 0 ${largeArc} 0 ${ox(innerR, a0)} ${oy(innerR, a0)} Z`;
}

// E4 review IMPORTANT-1 — text colors now honor the theme. Previously
// `AXIS_LABEL_COLOR = "#333333"` was hardcoded everywhere, producing
// dark-on-dark text under any dark theme (theme: "dark", brand-kit
// dark surfaces, the new 3b1b preset). Wired through as a parameter
// so existing light themes stay byte-identical (the resolved theme.axis
// matches the previous "#333" for light) while dark themes correctly
// route their light fg through.
function renderAxis(axis: SceneAxis, labelColor: string): string {
  const parts: string[] = [];
  const { origin, length } = axis;

  if (axis.orientation === "bottom") {
    parts.push(
      `<line x1="${origin.x}" y1="${origin.y}" x2="${origin.x + length}" y2="${
        origin.y
      }" stroke="${AXIS_COLOR}" stroke-width="1"/>`,
    );
    const rot = axis.tickRotation ?? 0;
    const titleOffset = rot !== 0 ? 60 : 32;
    for (const t of axis.ticks) {
      parts.push(
        `<line x1="${t.position}" y1="${origin.y}" x2="${t.position}" y2="${
          origin.y + 4
        }" stroke="${AXIS_COLOR}" stroke-width="1"/>`,
      );
      if (rot !== 0) {
        // Anchor the label at its end so the rotated text "hangs" below-left
        // of the tick, the conventional pattern for diagonal axis labels.
        const lx = t.position;
        const ly = origin.y + 14;
        parts.push(
          `<text x="${lx}" y="${ly}" font-family="${FONT_FAMILY}" font-size="11" fill="${labelColor}" text-anchor="end" dominant-baseline="middle" transform="rotate(${rot} ${lx} ${ly})">${esc(t.label)}</text>`,
        );
      } else {
        parts.push(
          `<text x="${t.position}" y="${
            origin.y + 16
          }" font-family="${FONT_FAMILY}" font-size="11" fill="${labelColor}" text-anchor="middle" dominant-baseline="hanging">${esc(t.label)}</text>`,
        );
      }
    }
    if (axis.label) {
      parts.push(
        `<text x="${origin.x + length / 2}" y="${
          origin.y + titleOffset
        }" font-family="${FONT_FAMILY}" font-size="12" fill="${labelColor}" text-anchor="middle" dominant-baseline="hanging">${esc(axis.label)}</text>`,
      );
    }
  } else if (axis.orientation === "left") {
    parts.push(
      `<line x1="${origin.x}" y1="${origin.y}" x2="${origin.x}" y2="${
        origin.y + length
      }" stroke="${AXIS_COLOR}" stroke-width="1"/>`,
    );
    for (const t of axis.ticks) {
      parts.push(
        `<line x1="${origin.x - 4}" y1="${t.position}" x2="${
          origin.x
        }" y2="${t.position}" stroke="${AXIS_COLOR}" stroke-width="1"/>`,
      );
      parts.push(
        `<text x="${origin.x - 8}" y="${
          t.position
        }" font-family="${FONT_FAMILY}" font-size="11" fill="${labelColor}" text-anchor="end" dominant-baseline="middle">${esc(t.label)}</text>`,
      );
    }
    if (axis.label) {
      parts.push(
        `<text x="${origin.x - 40}" y="${
          origin.y + length / 2
        }" font-family="${FONT_FAMILY}" font-size="12" fill="${labelColor}" text-anchor="middle" dominant-baseline="alphabetic" transform="rotate(-90 ${origin.x - 40} ${origin.y + length / 2})">${esc(axis.label)}</text>`,
      );
    }
  } else {
    // right axis — labels live to the right of the tick line
    parts.push(
      `<line x1="${origin.x}" y1="${origin.y}" x2="${origin.x}" y2="${
        origin.y + length
      }" stroke="${AXIS_COLOR}" stroke-width="1"/>`,
    );
    for (const t of axis.ticks) {
      parts.push(
        `<line x1="${origin.x}" y1="${t.position}" x2="${
          origin.x + 4
        }" y2="${t.position}" stroke="${AXIS_COLOR}" stroke-width="1"/>`,
      );
      parts.push(
        `<text x="${origin.x + 8}" y="${
          t.position
        }" font-family="${FONT_FAMILY}" font-size="11" fill="${labelColor}" text-anchor="start" dominant-baseline="middle">${esc(t.label)}</text>`,
      );
    }
    if (axis.label) {
      parts.push(
        `<text x="${origin.x + 40}" y="${
          origin.y + length / 2
        }" font-family="${FONT_FAMILY}" font-size="12" fill="${labelColor}" text-anchor="middle" dominant-baseline="alphabetic" transform="rotate(90 ${origin.x + 40} ${origin.y + length / 2})">${esc(axis.label)}</text>`,
      );
    }
  }
  return parts.join("");
}

/**
 * Render grid lines for an axis's `gridTicks` across the plot area.
 *
 * For a left axis (`gridTicks` y positions): emit horizontal lines that span
 * the full plot width. Drawn at low contrast (#e6e6e6) and *before* marks so
 * they sit behind the data. Right-side gridTicks aren't drawn — they would
 * duplicate the left-side grid.
 */
function renderGrid(scene: Scene): string {
  const left = scene.axes.find((a) => a.orientation === "left");
  if (!left || !left.gridTicks || left.gridTicks.length === 0) return "";
  const pa = scene.plotArea;
  const lines: string[] = [];
  for (const t of left.gridTicks) {
    lines.push(
      `<line x1="${pa.x}" y1="${t.position}" x2="${pa.x + pa.width}" y2="${
        t.position
      }" stroke="${GRID_COLOR}" stroke-width="1"/>`,
    );
  }
  return lines.join("");
}

/** Render a color legend. */
function renderLegend(legend: SceneLegend, labelColor: string): string {
  const { origin, entries, title } = legend;
  const rowH = 18;
  const swatch = 10;
  const parts: string[] = [];
  parts.push(
    `<text x="${origin.x}" y="${
      origin.y
    }" font-family="${FONT_FAMILY}" font-size="11" font-weight="600" fill="${labelColor}" text-anchor="start" dominant-baseline="hanging">${esc(title)}</text>`,
  );
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e) continue;
    const y = origin.y + 16 + i * rowH;
    parts.push(
      `<rect x="${origin.x}" y="${y}" width="${swatch}" height="${swatch}" fill="${esc(
        e.color,
      )}"/>`,
    );
    parts.push(
      `<text x="${origin.x + swatch + 6}" y="${y + swatch / 2}" font-family="${FONT_FAMILY}" font-size="11" fill="${labelColor}" text-anchor="start" dominant-baseline="middle">${esc(e.label)}</text>`,
    );
  }
  return parts.join("");
}

/** Render scene-level data-* attributes (channel→field map + handle). */
function renderSceneAttrs(scene: Scene): string {
  const s = scene.schema;
  if (!s) return "";
  let out = "";
  const keys = Object.keys(s.fields).sort();
  for (const k of keys) {
    const f = s.fields[k];
    if (f) out += ` data-${k}-field="${esc(f)}"`;
  }
  if (s.handleId) out += ` data-handle="${esc(s.handleId)}"`;
  // PR77 (D3 Gap 8) — declarative interaction hooks. `@glyph/live` keys
  // on these attrs to attach the right hydration handlers.
  if (s.zoomable === true) out += ` data-glyph-zoom="true"`;
  if (s.lassoable === true) out += ` data-glyph-lasso="true"`;
  if (s.voronoiHover === true) out += ` data-glyph-voronoi="true"`;
  // Moat 5/5 — declarative crossfilter group. `@glyph/live` reads this
  // attribute at the SVG root and subscribes the chart to the shared
  // event bus keyed by group id. Static path: the per-mark
  // `data-crossfilter-key` plus `CROSSFILTER_STYLE` drive same-chart
  // hover highlight with zero JS.
  if (s.crossfilterGroup !== undefined) {
    out += ` data-crossfilter-group="${esc(s.crossfilterGroup)}"`;
  }
  return out;
}

/**
 * Render a Scene as an SVG document string.
 */
/**
 * Render one facet panel: title text + the panel's axes + marks.
 * Coordinates are already absolute; the renderer just emits them.
 */
function renderPanel(p: ScenePanel, interactive: boolean, labelColor: string): string {
  const titleStr = `<text x="${p.titleX}" y="${p.titleY}" font-family="${FONT_FAMILY}" font-size="12" font-weight="600" fill="${labelColor}" text-anchor="middle" dominant-baseline="alphabetic">${esc(
    p.title,
  )}</text>`;
  const axes = p.axes.map((a) => renderAxis(a, labelColor)).join("");
  const markStrs = p.marks.map((m) => renderMark(m, interactive)).join("");
  const marks = interactive ? `<g class="glyph-marks">${markStrs}</g>` : markStrs;
  return `${titleStr}${marks}${axes}`;
}

export function renderSvg(scene: Scene): string {
  const interactive = scene.schema !== undefined;
  const rootAttrs = renderSceneAttrs(scene);
  // ARIA — SVG is an image with a title + description. Screen readers
  // announce these. Without an aria-label, NVDA / VoiceOver treat the
  // whole SVG as anonymous.
  const ariaLabel = scene.title ? ` aria-label="${esc(scene.title)}"` : ` aria-label="Glyph chart"`;
  const ariaRole = ` role="img"`;
  const ariaDesribedBy = ` aria-describedby="glyph-desc"`;
  // E2 — declare the xlink namespace when the scene contains any
  // `<animateMotion>`-driven traveler. Detection scans `scene.marks` AND
  // every panel's marks (faceted scenes) for a circle carrying `motion`.
  // Without the namespace, the `xlink:href` attribute on `<mpath>` won't
  // resolve in strict XML parsers. Returns "" for every existing scene
  // so byte snapshots stay identical.
  const xlinkNs = sceneNeedsXlinkNs(scene) ? ' xmlns:xlink="http://www.w3.org/1999/xlink"' : "";
  const head = `<svg xmlns="http://www.w3.org/2000/svg"${xlinkNs} viewBox="0 0 ${scene.width} ${scene.height}" width="${scene.width}" height="${scene.height}"${ariaRole}${ariaLabel}${ariaDesribedBy}${rootAttrs}>`;
  // Hidden <desc> for screen-reader-only description.
  const desc = `<desc id="glyph-desc">${esc(scene.title ?? "Glyph chart")}</desc>`;
  // Moat PR1 — cryptographic provenance seal. Always emitted when the
  // compiler attaches a block; the rendered SVG becomes a verifiable
  // artifact (specHash + dataHash + scaleDigest tied to the bytes).
  const provenance = scene.provenance ? renderProvenanceMetadata(scene.provenance) : "";
  const bg = `<rect x="0" y="0" width="${scene.width}" height="${scene.height}" fill="${esc(scene.background)}"/>`;
  // E4 review IMPORTANT-1 — title color from scene.textPrimary
  // (resolved from theme.fg by the compiler), axis + legend labels
  // from scene.textMuted (resolved from theme.axis). Was hardcoded
  // "#1a1a1a" / "#333333", which read as dark-on-dark on chalkboard /
  // dark surfaces. The fallback to the original hardcoded values
  // preserves byte-identity for test scenes / morph snapshots
  // without a resolved theme.
  const titleColor = scene.textPrimary ?? "#1a1a1a";
  const labelColor = scene.textMuted ?? AXIS_LABEL_COLOR;
  const title = scene.title
    ? `<text x="${scene.width / 2}" y="16" font-family="${FONT_FAMILY}" font-size="14" fill="${esc(titleColor)}" text-anchor="middle" dominant-baseline="middle">${esc(
        scene.title,
      )}</text>`
    : "";
  const hoverStyle = interactive ? HOVER_STYLE : "";
  // Moat 5/5 — emit the crossfilter CSS only when the scene actually
  // opts in. Keeps non-crossfilter snapshots byte-identical.
  const crossfilterStyle = scene.schema?.crossfilterGroup ? CROSSFILTER_STYLE : "";
  // PR43 + PR45: opt-in animation. Three CSS-driven kinds (stage,
  // stage-stagger) and two SMIL-driven kinds (race, scrub).
  const animationStyle = buildAnimationStyle(scene);
  // PR61 — uncertainty overlay (defs + hatch + badge) + style for point
  // dimming. Both are "" when scene.uncertainty is unset.
  const uncertaintyStyle = buildUncertaintyStyle(scene);
  const uncertaintyOverlay = renderUncertaintyOverlay(scene);
  const legends = (scene.legends ?? []).map((l) => renderLegend(l, labelColor)).join("");

  // Faceted scene: render each panel; the top-level marks/axes/grid are
  // unused (panels carry their own).
  if (scene.panels && scene.panels.length > 0) {
    const panelStrs = scene.panels.map((p) => renderPanel(p, interactive, labelColor)).join("");
    return `${head}${desc}${provenance}${hoverStyle}${crossfilterStyle}${uncertaintyStyle}${bg}${title}${panelStrs}${uncertaintyOverlay}${legends}</svg>\n`;
  }

  // Grid sits behind marks; axes + legends in front.
  const grid = renderGrid(scene);
  const animKind = scene.animation?.kind;
  // Per-mark rendering. For stage-stagger, each mark carries an inline
  // `style="animation-delay:Nms"` driven by row index. For race/scrub,
  // each mark hosts a SMIL <animate> child built from scene.animation.frames.
  const stagger =
    animKind === "stage-stagger"
      ? ((scene.animation as { stagger_ms?: number }).stagger_ms ?? 60)
      : 0;
  // RFC #9 — separate `<defs>`-bound marks (gradient-def, pattern-def)
  // from regular content marks. The defs marks are emitted at the
  // top inside a single `<defs>` block so SVG viewers resolve
  // `url(#…)` references correctly. Content marks render in order.
  const defsMarks: SceneMark[] = [];
  const contentMarks: SceneMark[] = [];
  for (const m of scene.marks) {
    if (m.type === "gradient-def" || m.type === "pattern-def") defsMarks.push(m);
    else contentMarks.push(m);
  }
  const renderedMarks = contentMarks.map((m, i) =>
    decorateMarkForAnimation(renderMark(m, interactive), i, scene, stagger),
  );
  const composeDefsBlock =
    defsMarks.length > 0
      ? `<defs>${defsMarks.map((d) => renderMark(d, interactive)).join("")}</defs>`
      : "";
  const animClass =
    animKind === "stage"
      ? " glyph-stage"
      : animKind === "stage-stagger"
        ? " glyph-stage-stagger"
        : animKind === "race" || animKind === "scrub"
          ? " glyph-race"
          : animKind === "draw-in"
            ? " glyph-draw-in"
            : animKind === "timeline"
              ? " glyph-timeline"
              : "";
  // PR61 — append a `glyph-uncertain` marker class when dimPoints fires.
  const uncertainClass = scene.uncertainty?.dimPoints ? " glyph-uncertain" : "";
  // E3 — timeline animation: wrap each scene's marks in a `<g class="glyph-scene-…">`
  // with a child SMIL `<animate>` driving opacity 0 → 1 at `begin_ms`.
  // Marks not in any scene render outside groups (they remain visible
  // throughout). Captions emit additional animated `<text>` elements at
  // the bottom of the plot area.
  const markStrs =
    animKind === "timeline" ? buildTimelineMarks(scene, renderedMarks) : renderedMarks.join("");
  const timelineCaptions = animKind === "timeline" ? buildTimelineCaptions(scene) : "";
  const marks =
    interactive || animClass || uncertainClass
      ? `<g class="glyph-marks${animClass}${uncertainClass}">${markStrs}</g>`
      : markStrs;
  const axes = scene.axes.map((a) => renderAxis(a, labelColor)).join("");
  // Math PR3 — emit the arrow marker <defs> once when any arrow
  // SceneMark is present. Returns "" for scenes with no arrows so
  // existing snapshots stay byte-identical.
  const arrowDefs = renderArrowDefs(scene);
  return `${head}${desc}${provenance}${hoverStyle}${crossfilterStyle}${animationStyle}${uncertaintyStyle}${arrowDefs}${composeDefsBlock}${bg}${title}${grid}${marks}${axes}${timelineCaptions}${uncertaintyOverlay}${legends}</svg>\n`;
}

// E3 — timeline animation: assemble the per-scene mark groups.
//
// For each timeline scene we wrap the scene's marks in a `<g>` that
// starts at `opacity="0"` and is driven to `opacity="1"` by a SMIL
// `<animate>` child with `begin="<begin_ms>ms"` and
// `dur="<duration_ms>ms"`. The `fill="freeze"` attribute pins the end
// state so the scene's marks stay visible after the fade-in
// completes. Marks that aren't claimed by any scene are emitted
// outside the groups so they remain visible throughout (typical for
// axes-aligned reference marks that don't need a scene beat).
//
// Determinism: the scenes are emitted in spec order; mark indices in
// each scene's `markIndices` are emitted in scene order (the compiler
// preserves spec layer order). Same input → same SVG bytes.
function buildTimelineMarks(scene: Scene, renderedMarks: ReadonlyArray<string>): string {
  const a = scene.animation;
  if (!a || a.kind !== "timeline") return renderedMarks.join("");
  const claimed = new Set<number>();
  const parts: string[] = [];
  // Marks not in any scene render first so they sit underneath the
  // sequenced layers (same z-order as a no-animation chart).
  for (const s of a.scenes) {
    for (const i of s.markIndices) claimed.add(i);
  }
  for (let i = 0; i < renderedMarks.length; i++) {
    if (!claimed.has(i)) parts.push(renderedMarks[i] ?? "");
  }
  for (let si = 0; si < a.scenes.length; si++) {
    const s = a.scenes[si];
    if (!s) continue;
    const id = s.id ?? String(si);
    const sceneMarks = s.markIndices.map((i) => renderedMarks[i] ?? "").join("");
    if (sceneMarks.length === 0) continue;
    const animate = `<animate attributeName="opacity" from="0" to="1" begin="${s.begin_ms}ms" dur="${s.duration_ms}ms" fill="freeze"/>`;
    parts.push(`<g class="glyph-scene-${esc(id)}" opacity="0">${animate}${sceneMarks}</g>`);
  }
  return parts.join("");
}

// E3 — timeline captions. One `<text>` element per scene that
// declares a `caption`. Positioned at the bottom-center of the plot
// area; each has a SMIL `<animate>` driving opacity 0 → 1 at its
// scene's `begin_ms`. When successive scenes both carry captions we
// emit a second `<animate>` on the prior caption driving opacity back
// to 0 at the next scene's `begin_ms`, so only one caption is visible
// at a time.
function buildTimelineCaptions(scene: Scene): string {
  const a = scene.animation;
  if (!a || a.kind !== "timeline") return "";
  const captioned = a.scenes
    .map((s, i) => ({ s, i }))
    .filter(
      (e): e is { s: typeof e.s & { caption: string }; i: number } => e.s.caption !== undefined,
    );
  if (captioned.length === 0) return "";
  // E3 review IMPORTANT-1 fix: previous offset (+32) collided with the
  // x-axis title which also sits at `plotArea.y + plotArea.height + 32`
  // (svg.ts:357 + titleOffset=32). Bumped to +56 so captions clear the
  // axis title; matches the rotated-tick offset (60) but pulled in 4
  // for snug vertical centering. Caption coords now also pass through
  // `roundPx` for byte-stability under future float plotArea (NIT-4).
  const cx = roundPx(scene.plotArea.x + scene.plotArea.width / 2);
  const cy = roundPx(scene.plotArea.y + scene.plotArea.height + 56);
  const parts: string[] = [];
  for (let k = 0; k < captioned.length; k++) {
    const cur = captioned[k];
    if (!cur) continue;
    const fadeIn = `<animate attributeName="opacity" from="0" to="1" begin="${cur.s.begin_ms}ms" dur="${cur.s.duration_ms}ms" fill="freeze"/>`;
    // When a subsequent caption arrives, fade this one back out at
    // the next caption's begin (over a short 200ms transition).
    const next = captioned[k + 1];
    const fadeOut = next
      ? `<animate attributeName="opacity" from="1" to="0" begin="${next.s.begin_ms}ms" dur="200ms" fill="freeze"/>`
      : "";
    parts.push(
      `<text x="${cx}" y="${cy}" font-family="${FONT_FAMILY}" font-size="13" fill="#1a1a1a" text-anchor="middle" dominant-baseline="middle" opacity="0">${esc(
        cur.s.caption,
      )}${fadeIn}${fadeOut}</text>`,
    );
  }
  return parts.join("");
}

/**
 * Build the <style> block for the scene's animation. CSS kinds (stage,
 * stage-stagger) emit @keyframes; SMIL kinds (race, scrub) animate inline
 * and need no style block.
 */
/**
 * PR61 (PLAN item 2.3) — render the optional uncertainty overlay.
 *
 * When `scene.uncertainty` is set, emits up to three additional fragments:
 *   1. A `<defs>` block with a 45° hatch `<pattern>` (only when hatchBars).
 *   2. A translucent hatch overlay covering the plot area (visual cue).
 *   3. A small top-right "n=… · confidence: …" badge.
 *
 * The marks group also gains a `glyph-uncertain` class when `dimPoints`
 * is true, so a tiny `<style>` rule can fade circles without dimming bars.
 *
 * Snapshot byte-identity: when `scene.uncertainty` is undefined (the
 * default for every existing snapshot), this function returns "".
 */
function renderUncertaintyOverlay(scene: Scene): string {
  const u = scene.uncertainty;
  if (!u) return "";
  const parts: string[] = [];
  if (u.hatchBars) {
    parts.push(
      '<defs><pattern id="glyph-hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">' +
        '<line x1="0" y1="0" x2="0" y2="6" stroke="#444" stroke-width="1" stroke-opacity="0.35"/></pattern></defs>',
    );
    const pa = scene.plotArea;
    parts.push(
      `<rect x="${pa.x}" y="${pa.y}" width="${pa.width}" height="${pa.height}" fill="url(#glyph-hatch)" pointer-events="none" class="glyph-uncertainty-hatch"/>`,
    );
  }
  const badgeText = u.note ?? `n=${u.sampleRows} · confidence: ${u.confidence}`;
  const bx = scene.width - 8;
  const by = 14;
  parts.push(
    `<text x="${bx}" y="${by}" font-family="${FONT_FAMILY}" font-size="11" fill="#666" text-anchor="end" dominant-baseline="middle" class="glyph-uncertainty-badge">${esc(badgeText)}</text>`,
  );
  return parts.join("");
}

/** PR61 — extra style block applied when uncertainty.dimPoints fires. */
function buildUncertaintyStyle(scene: Scene): string {
  const u = scene.uncertainty;
  if (!u || !u.dimPoints) return "";
  return "<style>g.glyph-marks.glyph-uncertain circle{opacity:0.55}</style>";
}

function buildAnimationStyle(scene: Scene): string {
  const a = scene.animation;
  if (!a) return "";
  if (a.kind === "stage") {
    return `<style>@keyframes glyph-stage{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}.glyph-stage{animation:glyph-stage ${a.duration_ms}ms ease-out both;transform-box:fill-box;transform-origin:center}</style>`;
  }
  if (a.kind === "stage-stagger") {
    return `<style>@keyframes glyph-stage-stagger{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}.glyph-stage-stagger>*{animation:glyph-stage-stagger ${a.duration_ms}ms ease-out both;transform-box:fill-box;transform-origin:center;opacity:0}</style>`;
  }
  return "";
}

/**
 * Decorate a mark's SVG markup for animation:
 *   - stage-stagger: inject `style="animation-delay:Nms"` based on row index.
 *   - race / scrub: inject a child <animate values="..."> driving the mark's
 *     animated attribute (width for rect, r for circle).
 * Falls through unchanged for stage and no-animation specs.
 */
/**
 * Frame-export helper (PR45). Given a scene with a `race` or `scrub`
 * animation, emit one SVG string per frame — each frame substitutes the
 * mark values for that frame. Useful for stitching an MP4/GIF outside the
 * renderer, or for snapshot-testing per-frame state in CI.
 *
 * For non-animated scenes this returns a single-element array with the
 * scene's regular render.
 */
export function renderFrames(scene: Scene): ReadonlyArray<string> {
  const a = scene.animation;
  if (!a || (a.kind !== "race" && a.kind !== "scrub")) {
    return [renderSvg(scene)];
  }
  return a.frames.map((frame) => {
    // Strip the animation field via destructure so the per-frame scene is
    // a plain static Scene.
    const { animation: _animation, ...rest } = scene;
    const frameScene: Scene = {
      ...rest,
      marks: scene.marks.map((m, i) => {
        const v = frame.values[i];
        if (v === undefined) return m;
        if (m.type === "rect") return { ...m, width: v };
        if (m.type === "circle") return { ...m, r: v };
        return m;
      }),
      title: `${scene.title ? `${scene.title} — ` : ""}${a.frame_field}=${frame.label}`,
    };
    return renderSvg(frameScene);
  });
}

function decorateMarkForAnimation(
  svgFragment: string,
  index: number,
  scene: Scene,
  stagger: number,
): string {
  const a = scene.animation;
  if (!a) return svgFragment;
  if (a.kind === "stage-stagger") {
    const delay = index * stagger;
    return svgFragment.replace(
      /<(rect|circle|line|path|text)\b/,
      (m) => `${m} style="animation-delay:${delay}ms"`,
    );
  }
  if (a.kind === "race" || a.kind === "scrub") {
    const m = scene.marks[index];
    if (!m) return svgFragment;
    const dur = a.duration_ms;
    if (m.type === "rect") {
      const values = a.frames.map((f) => String(f.values[index] ?? 0)).join(";");
      const animate = `<animate attributeName="width" values="${values}" dur="${dur}ms" repeatCount="indefinite"/>`;
      return svgFragment.replace(/<rect\b([^/]*)\/>/, `<rect$1>${animate}</rect>`);
    }
    if (m.type === "circle") {
      const values = a.frames.map((f) => String(f.values[index] ?? 0)).join(";");
      const animate = `<animate attributeName="r" values="${values}" dur="${dur}ms" repeatCount="indefinite"/>`;
      return svgFragment.replace(/<circle\b([^/]*)\/>/, `<circle$1>${animate}</circle>`);
    }
    return svgFragment;
  }
  if (a.kind === "morph") {
    // PR74 (D3 Gap 3) — interpolate geometric attrs between fromMarks[i]
    // and marks[i]. Single transition (no loop) so the chart settles in
    // the "to" state after one duration_ms. fill="freeze" pins the end.
    const to = scene.marks[index];
    const from = a.fromMarks[index];
    if (!to || !from) return svgFragment;
    const dur = a.duration_ms;
    const ms = `${dur}ms`;
    const animate = (attr: string, fromVal: number, toVal: number): string =>
      `<animate attributeName="${attr}" from="${fromVal}" to="${toVal}" dur="${ms}" fill="freeze"/>`;
    // Inject `anims` as children of the mark element. Handles BOTH:
    //   self-closing: `<rect ATTRS/>`         → `<rect ATTRS>anims</rect>`
    //   open + close: `<rect ATTRS>kids</rect>` → `<rect ATTRS>animskids</rect>`
    // The latter happens whenever the mark has a tooltip (which is
    // emitted as a <title> child by the interactive path). Without
    // this, tooltipped marks silently skip animation (PR74 review
    // critical finding).
    const injectChild = (tag: string, anims: string): string => {
      const selfClose = new RegExp(`<${tag}\\b([^>]*?)/>`);
      if (selfClose.test(svgFragment)) {
        return svgFragment.replace(selfClose, `<${tag}$1>${anims}</${tag}>`);
      }
      const open = new RegExp(`<${tag}\\b([^>]*)>`);
      return svgFragment.replace(open, `<${tag}$1>${anims}`);
    };
    if (to.type === "rect" && from.type === "rect") {
      const anims =
        animate("x", from.x, to.x) +
        animate("y", from.y, to.y) +
        animate("width", from.width, to.width) +
        animate("height", from.height, to.height);
      return injectChild("rect", anims);
    }
    if (to.type === "circle" && from.type === "circle") {
      const anims =
        animate("cx", from.cx, to.cx) + animate("cy", from.cy, to.cy) + animate("r", from.r, to.r);
      return injectChild("circle", anims);
    }
    if (to.type === "line" && from.type === "line") {
      const anims =
        animate("x1", from.x1, to.x1) +
        animate("y1", from.y1, to.y1) +
        animate("x2", from.x2, to.x2) +
        animate("y2", from.y2, to.y2);
      return injectChild("line", anims);
    }
    return svgFragment;
  }
  if (a.kind === "draw-in") {
    // Math Phase 2 / Track A2 — pen-draw effect. Only path marks
    // participate; everything else is rendered statically. We compute
    // the path's geometric length, then inject stroke-dasharray +
    // stroke-dashoffset attrs plus a SMIL `<animate>` child that drives
    // the offset from `len` → 0 over `duration_ms` with `fill="freeze"`
    // so the line stays drawn at the end.
    const m = scene.marks[index];
    if (!m || m.type !== "path") return svgFragment;
    const len = polylineLength(m.d);
    if (len <= 0) return svgFragment; // graceful no-op for zero-length / unsupported `d`
    const dur = a.duration_ms;
    const easing = a.easing ?? "linear";
    // SMIL easing: linear is the default; "ease-in-out" emits keyTimes +
    // keySplines to slow the trace at both endpoints (cubic Bézier
    // approximating the CSS ease-in-out curve).
    const easeAttrs =
      easing === "ease-in-out"
        ? ' calcMode="spline" keyTimes="0;1" keySplines="0.42 0 0.58 1"'
        : "";
    const animate = `<animate attributeName="stroke-dashoffset" from="${len}" to="0" dur="${dur}ms" begin="0s" fill="freeze"${easeAttrs}/>`;
    const dashAttrs = ` stroke-dasharray="${len}" stroke-dashoffset="${len}"`;
    // Inject dash attrs before the closing `/>` AND replace `/>` with
    // `>…</path>` so the <animate> child lives inside the path. Handles
    // both self-closing and explicit-close forms (the latter only
    // happens for arc marks today, which draw-in skips above).
    const selfClose = /<path\b([^>]*?)\/>/;
    if (selfClose.test(svgFragment)) {
      return svgFragment.replace(selfClose, `<path$1${dashAttrs}>${animate}</path>`);
    }
    const open = /<path\b([^>]*)>/;
    return svgFragment.replace(open, `<path$1${dashAttrs}>${animate}`);
  }
  return svgFragment;
}
