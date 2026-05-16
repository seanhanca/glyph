/**
 * SVG renderer — Scene → SVG string.
 *
 * Pure function. No DOM, no jsdom. Deterministic: same Scene → same bytes.
 *
 * Output is intentionally compact: no whitespace between attributes, fixed
 * decimal precision (via the compiler's roundPx), and elements emitted in
 * a fixed order (axes, then marks).
 */

import type { Scene, SceneAxis, SceneMark } from "../scenegraph/types.js";

const AXIS_COLOR = "#999999";
const AXIS_LABEL_COLOR = "#333333";
const FONT_FAMILY = "system-ui, -apple-system, sans-serif";

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

function renderMark(m: SceneMark): string {
  switch (m.type) {
    case "rect": {
      const stroke = m.stroke ? ` stroke="${esc(m.stroke)}"` : "";
      const sw = m.strokeWidth !== undefined ? ` stroke-width="${m.strokeWidth}"` : "";
      return `<rect x="${m.x}" y="${m.y}" width="${m.width}" height="${m.height}" fill="${esc(
        m.fill,
      )}"${stroke}${sw}/>`;
    }
    case "circle": {
      const stroke = m.stroke ? ` stroke="${esc(m.stroke)}"` : "";
      const sw = m.strokeWidth !== undefined ? ` stroke-width="${m.strokeWidth}"` : "";
      return `<circle cx="${m.cx}" cy="${m.cy}" r="${m.r}" fill="${esc(m.fill)}"${stroke}${sw}/>`;
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

/**
 * Render a Scene as an SVG document string.
 */
export function renderSvg(scene: Scene): string {
  const head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${scene.width} ${scene.height}" width="${scene.width}" height="${scene.height}">`;
  const bg = `<rect x="0" y="0" width="${scene.width}" height="${scene.height}" fill="${esc(scene.background)}"/>`;
  const title = scene.title
    ? `<text x="${scene.width / 2}" y="16" font-family="${FONT_FAMILY}" font-size="14" fill="#1a1a1a" text-anchor="middle" dominant-baseline="middle">${esc(
        scene.title,
      )}</text>`
    : "";
  const marks = scene.marks.map(renderMark).join("");
  const axes = scene.axes.map(renderAxis).join("");
  return `${head}${bg}${title}${marks}${axes}</svg>\n`;
}
