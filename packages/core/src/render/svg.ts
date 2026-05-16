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

import type { MarkData, Scene, SceneAxis, SceneMark } from "../scenegraph/types.js";

const AXIS_COLOR = "#999999";
const AXIS_LABEL_COLOR = "#333333";
const FONT_FAMILY = "system-ui, -apple-system, sans-serif";

const HOVER_STYLE =
  "<style>.glyph-marks &gt; *{transition:filter .12s ease-out}.glyph-marks &gt; *:hover{filter:brightness(1.08);outline:1px solid #00000033;outline-offset:1px;cursor:pointer}</style>";

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

function renderMark(m: SceneMark, interactive: boolean): string {
  switch (m.type) {
    case "rect": {
      const stroke = m.stroke ? ` stroke="${esc(m.stroke)}"` : "";
      const sw = m.strokeWidth !== undefined ? ` stroke-width="${m.strokeWidth}"` : "";
      if (!interactive) {
        return `<rect x="${m.x}" y="${m.y}" width="${m.width}" height="${m.height}" fill="${esc(
          m.fill,
        )}"${stroke}${sw}/>`;
      }
      const data = renderDataAttrs(m);
      const tooltip = m.tooltip ? `<title>${esc(m.tooltip)}</title>` : "";
      if (tooltip) {
        // <rect> with a child <title> must use an opening + closing tag.
        return `<rect x="${m.x}" y="${m.y}" width="${m.width}" height="${m.height}" fill="${esc(
          m.fill,
        )}"${stroke}${sw}${data}>${tooltip}</rect>`;
      }
      return `<rect x="${m.x}" y="${m.y}" width="${m.width}" height="${m.height}" fill="${esc(
        m.fill,
      )}"${stroke}${sw}${data}/>`;
    }
    case "circle": {
      const stroke = m.stroke ? ` stroke="${esc(m.stroke)}"` : "";
      const sw = m.strokeWidth !== undefined ? ` stroke-width="${m.strokeWidth}"` : "";
      if (!interactive) {
        return `<circle cx="${m.cx}" cy="${m.cy}" r="${m.r}" fill="${esc(m.fill)}"${stroke}${sw}/>`;
      }
      const data = renderDataAttrs(m);
      const tooltip = m.tooltip ? `<title>${esc(m.tooltip)}</title>` : "";
      if (tooltip) {
        return `<circle cx="${m.cx}" cy="${m.cy}" r="${m.r}" fill="${esc(m.fill)}"${stroke}${sw}${data}>${tooltip}</circle>`;
      }
      return `<circle cx="${m.cx}" cy="${m.cy}" r="${m.r}" fill="${esc(m.fill)}"${stroke}${sw}${data}/>`;
    }
    case "line":
      return `<line x1="${m.x1}" y1="${m.y1}" x2="${m.x2}" y2="${m.y2}" stroke="${esc(
        m.stroke,
      )}" stroke-width="${m.strokeWidth}"/>`;
    case "text":
      return `<text x="${m.x}" y="${m.y}" font-size="${m.fontSize}" fill="${esc(
        m.fill,
      )}" text-anchor="${m.anchor}" dominant-baseline="${m.baseline}">${esc(m.text)}</text>`;
  }
}

function renderAxis(axis: SceneAxis): string {
  const parts: string[] = [];
  const { origin, length } = axis;

  if (axis.orientation === "bottom") {
    parts.push(
      `<line x1="${origin.x}" y1="${origin.y}" x2="${origin.x + length}" y2="${
        origin.y
      }" stroke="${AXIS_COLOR}" stroke-width="1"/>`,
    );
    for (const t of axis.ticks) {
      parts.push(
        `<line x1="${t.position}" y1="${origin.y}" x2="${t.position}" y2="${
          origin.y + 4
        }" stroke="${AXIS_COLOR}" stroke-width="1"/>`,
      );
      parts.push(
        `<text x="${t.position}" y="${
          origin.y + 16
        }" font-family="${FONT_FAMILY}" font-size="11" fill="${AXIS_LABEL_COLOR}" text-anchor="middle" dominant-baseline="hanging">${esc(t.label)}</text>`,
      );
    }
    if (axis.label) {
      parts.push(
        `<text x="${origin.x + length / 2}" y="${
          origin.y + 32
        }" font-family="${FONT_FAMILY}" font-size="12" fill="${AXIS_LABEL_COLOR}" text-anchor="middle" dominant-baseline="hanging">${esc(axis.label)}</text>`,
      );
    }
  } else {
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
        }" font-family="${FONT_FAMILY}" font-size="11" fill="${AXIS_LABEL_COLOR}" text-anchor="end" dominant-baseline="middle">${esc(t.label)}</text>`,
      );
    }
    if (axis.label) {
      parts.push(
        `<text x="${origin.x - 40}" y="${
          origin.y + length / 2
        }" font-family="${FONT_FAMILY}" font-size="12" fill="${AXIS_LABEL_COLOR}" text-anchor="middle" dominant-baseline="alphabetic" transform="rotate(-90 ${origin.x - 40} ${origin.y + length / 2})">${esc(axis.label)}</text>`,
      );
    }
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
  return out;
}

/**
 * Render a Scene as an SVG document string.
 */
export function renderSvg(scene: Scene): string {
  const interactive = scene.schema !== undefined;
  const rootAttrs = renderSceneAttrs(scene);
  const head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${scene.width} ${scene.height}" width="${scene.width}" height="${scene.height}"${rootAttrs}>`;
  const bg = `<rect x="0" y="0" width="${scene.width}" height="${scene.height}" fill="${esc(scene.background)}"/>`;
  const title = scene.title
    ? `<text x="${scene.width / 2}" y="16" font-family="${FONT_FAMILY}" font-size="14" fill="#1a1a1a" text-anchor="middle" dominant-baseline="middle">${esc(
        scene.title,
      )}</text>`
    : "";
  const markStrs = scene.marks.map((m) => renderMark(m, interactive)).join("");
  const marks = interactive ? `<g class="glyph-marks">${markStrs}</g>` : markStrs;
  const hoverStyle = interactive ? HOVER_STYLE : "";
  const axes = scene.axes.map(renderAxis).join("");
  return `${head}${hoverStyle}${bg}${title}${marks}${axes}</svg>\n`;
}
