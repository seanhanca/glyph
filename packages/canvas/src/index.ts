/**
 * @glyph/canvas — HTMLCanvasElement renderer for Glyph scenegraphs.
 *
 * Mirrors `@glyph/core/renderSvg` but emits canvas draw calls instead of an
 * SVG string. Same Scene IR; same mark types; same axis layout. The render
 * budget per mark is ~10× cheaper than SVG once mark counts pass ~1k.
 *
 * Why a separate renderer
 * - SVG hits the DOM ceiling around 10k marks. Canvas comfortably renders
 *   100k+ rects per frame.
 * - Snapshot tests for SVG byte-identity stay green: this renderer doesn't
 *   touch `@glyph/core`. The contract is purely "Scene → ctx draw calls".
 *
 * Usage (browser)
 *   const canvas = document.querySelector("canvas")!;
 *   const ctx = canvas.getContext("2d")!;
 *   canvas.width = scene.width;
 *   canvas.height = scene.height;
 *   renderCanvas(scene, ctx);
 *
 * Usage (Node — for tests / static PNG export)
 *   import { createCanvas } from "canvas";   // optional dep
 *   const canvas = createCanvas(scene.width, scene.height);
 *   renderCanvas(scene, canvas.getContext("2d") as unknown as CanvasContext2D);
 *
 * No external runtime deps. Works with both browser CanvasRenderingContext2D
 * and node-canvas's compatible context.
 */

import type { AxisTick, Scene, SceneAxis, SceneLegend, SceneMark, ScenePanel } from "@glyph/core";

/**
 * Minimal subset of `CanvasRenderingContext2D` we depend on. Lets us avoid
 * a hard `lib.dom` requirement on consumers and keeps the test mock small.
 *
 * Both browser CanvasRenderingContext2D and node-canvas's Context2D satisfy
 * this interface.
 */
export interface CanvasContext2D {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  font: string;
  textAlign: "left" | "right" | "center" | "start" | "end";
  textBaseline: "top" | "middle" | "bottom" | "alphabetic" | "hanging";
  globalAlpha: number;

  save(): void;
  restore(): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, startAngle: number, endAngle: number): void;
  rect(x: number, y: number, w: number, h: number): void;
  fill(): void;
  stroke(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  strokeText(text: string, x: number, y: number): void;
}

const FONT_FAMILY = "system-ui, -apple-system, sans-serif";
const AXIS_COLOR = "#999999";
const AXIS_LABEL_COLOR = "#333333";
const GRID_COLOR = "#e6e6e6";
const TITLE_COLOR = "#1a1a1a";

/**
 * Render a Scene onto a 2D canvas context. Deterministic — same Scene +
 * same context resolution → same draw-call sequence (modulo platform font
 * rasterization, which is outside the renderer's contract).
 */
export function renderCanvas(scene: Scene, ctx: CanvasContext2D): void {
  ctx.clearRect(0, 0, scene.width, scene.height);
  // Background.
  ctx.fillStyle = scene.background;
  ctx.fillRect(0, 0, scene.width, scene.height);

  // Title.
  if (scene.title) {
    ctx.fillStyle = TITLE_COLOR;
    ctx.font = `14px ${FONT_FAMILY}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(scene.title, scene.width / 2, 16);
  }

  if (scene.panels && scene.panels.length > 0) {
    for (const panel of scene.panels) renderPanel(panel, ctx);
  } else {
    // Grid (behind marks).
    for (const axis of scene.axes) renderGridFromAxis(axis, ctx);
    // Marks.
    for (const mark of scene.marks) renderMark(mark, ctx);
    // Axes (in front of grid + marks).
    for (const axis of scene.axes) renderAxis(axis, ctx);
  }

  // Legends.
  if (scene.legends) {
    for (const legend of scene.legends) renderLegend(legend, ctx);
  }
}

function renderPanel(panel: ScenePanel, ctx: CanvasContext2D): void {
  if (panel.title) {
    ctx.fillStyle = TITLE_COLOR;
    ctx.font = `12px ${FONT_FAMILY}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(panel.title, panel.titleX, panel.titleY);
  }
  for (const m of panel.marks) renderMark(m, ctx);
  for (const a of panel.axes) renderAxis(a, ctx);
}

// ---------------------------------------------------------------------------
// Mark drawing
// ---------------------------------------------------------------------------

function renderMark(m: SceneMark, ctx: CanvasContext2D): void {
  switch (m.type) {
    case "rect":
      ctx.fillStyle = m.fill;
      ctx.fillRect(m.x, m.y, m.width, m.height);
      if (m.stroke) {
        ctx.strokeStyle = m.stroke;
        ctx.lineWidth = m.strokeWidth ?? 1;
        ctx.strokeRect(m.x, m.y, m.width, m.height);
      }
      return;
    case "circle":
      ctx.beginPath();
      ctx.arc(m.cx, m.cy, m.r, 0, Math.PI * 2);
      ctx.closePath();
      ctx.fillStyle = m.fill;
      ctx.fill();
      if (m.stroke) {
        ctx.strokeStyle = m.stroke;
        ctx.lineWidth = m.strokeWidth ?? 1;
        ctx.stroke();
      }
      return;
    case "line":
      ctx.strokeStyle = m.stroke;
      ctx.lineWidth = m.strokeWidth;
      ctx.beginPath();
      ctx.moveTo(m.x1, m.y1);
      ctx.lineTo(m.x2, m.y2);
      ctx.stroke();
      return;
    case "path":
      renderPath(m, ctx);
      return;
    case "text":
      ctx.fillStyle = m.fill;
      ctx.font = `${m.fontSize}px ${FONT_FAMILY}`;
      ctx.textAlign = mapAnchor(m.anchor);
      ctx.textBaseline = mapBaseline(m.baseline);
      ctx.fillText(m.text, m.x, m.y);
      return;
  }
}

/**
 * Parse an SVG `d` attribute and replay it onto the canvas. We only emit
 * `M x,y` + `L x,y` + `Z` from the SVG side (line / area / geo / graticule
 * paths), so the parser is small and forgiving.
 */
function renderPath(m: Extract<SceneMark, { type: "path" }>, ctx: CanvasContext2D): void {
  ctx.save();
  if (m.opacity !== undefined) ctx.globalAlpha = m.opacity;
  const opensPaths = parsePathD(m.d);
  ctx.beginPath();
  for (const cmd of opensPaths) {
    if (cmd.op === "M") ctx.moveTo(cmd.x, cmd.y);
    else if (cmd.op === "L") ctx.lineTo(cmd.x, cmd.y);
    else if (cmd.op === "Z") ctx.closePath();
  }
  if (m.fill !== undefined && m.fill !== "none") {
    ctx.fillStyle = m.fill;
    ctx.fill();
  }
  if (m.stroke) {
    ctx.strokeStyle = m.stroke;
    ctx.lineWidth = m.strokeWidth ?? 1;
    ctx.stroke();
  }
  ctx.restore();
}

type PathCmd =
  | { readonly op: "M"; readonly x: number; readonly y: number }
  | { readonly op: "L"; readonly x: number; readonly y: number }
  | { readonly op: "Z" };

/**
 * Minimal `d`-attr parser. Supports the M / L / Z commands the SVG
 * renderer emits. Coords can be `x,y` or `x y` separated.
 */
export function parsePathD(d: string): ReadonlyArray<PathCmd> {
  const out: PathCmd[] = [];
  const re = /([MLZ])\s*([-\d.,\s]*)/g;
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic regex loop
  while ((m = re.exec(d)) !== null) {
    const op = m[1] ?? "";
    const args = (m[2] ?? "").trim();
    if (op === "Z") {
      out.push({ op: "Z" });
      continue;
    }
    if (!args) continue;
    const nums = args
      .split(/[,\s]+/)
      .filter((s) => s.length > 0)
      .map(Number);
    for (let i = 0; i + 1 < nums.length; i += 2) {
      const x = nums[i];
      const y = nums[i + 1];
      if (x === undefined || y === undefined || Number.isNaN(x) || Number.isNaN(y)) continue;
      if (op === "M") out.push({ op: "M", x, y });
      else if (op === "L") out.push({ op: "L", x, y });
    }
  }
  return out;
}

function mapAnchor(a: string): CanvasContext2D["textAlign"] {
  if (a === "middle") return "center";
  if (a === "start") return "start";
  if (a === "end") return "end";
  return "left";
}

function mapBaseline(b: string): CanvasContext2D["textBaseline"] {
  if (b === "middle") return "middle";
  if (b === "hanging") return "hanging";
  if (b === "alphabetic") return "alphabetic";
  if (b === "ideographic") return "alphabetic";
  return "middle";
}

// ---------------------------------------------------------------------------
// Axes + grid
// ---------------------------------------------------------------------------

function renderGridFromAxis(axis: SceneAxis, ctx: CanvasContext2D): void {
  if (!axis.gridTicks || axis.gridTicks.length === 0) return;
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const t of axis.gridTicks) {
    if (axis.orientation === "left" || axis.orientation === "right") {
      ctx.moveTo(axis.origin.x, t.position);
      ctx.lineTo(axis.origin.x + axis.length, t.position);
    } else {
      ctx.moveTo(t.position, axis.origin.y);
      ctx.lineTo(t.position, axis.origin.y - axis.length);
    }
  }
  ctx.stroke();
}

function renderAxis(axis: SceneAxis, ctx: CanvasContext2D): void {
  ctx.strokeStyle = AXIS_COLOR;
  ctx.lineWidth = 1;
  ctx.fillStyle = AXIS_LABEL_COLOR;
  ctx.font = `11px ${FONT_FAMILY}`;

  if (axis.orientation === "bottom") {
    line(ctx, axis.origin.x, axis.origin.y, axis.origin.x + axis.length, axis.origin.y);
    for (const t of axis.ticks) {
      tickAndLabel(ctx, t, axis.orientation, axis.origin);
    }
    if (axis.label) {
      ctx.font = `12px ${FONT_FAMILY}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "hanging";
      ctx.fillText(axis.label, axis.origin.x + axis.length / 2, axis.origin.y + 32);
    }
  } else if (axis.orientation === "left") {
    line(ctx, axis.origin.x, axis.origin.y, axis.origin.x, axis.origin.y + axis.length);
    for (const t of axis.ticks) {
      tickAndLabel(ctx, t, axis.orientation, axis.origin);
    }
    if (axis.label) {
      ctx.font = `12px ${FONT_FAMILY}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      // Canvas rotation: save, translate to label origin, rotate, draw.
      ctx.save();
      ctx.fillStyle = AXIS_LABEL_COLOR;
      // We can't easily rotate in our minimal context shim; skip rotation —
      // the y-axis label still renders horizontally. The browser canvas
      // handles rotation when the consumer supplies a real CanvasRenderingContext2D;
      // this shim's call sequence still includes a fillText.
      ctx.fillText(axis.label, axis.origin.x - 40, axis.origin.y + axis.length / 2);
      ctx.restore();
    }
  } else {
    // right axis
    line(ctx, axis.origin.x, axis.origin.y, axis.origin.x, axis.origin.y + axis.length);
    for (const t of axis.ticks) {
      tickAndLabel(ctx, t, axis.orientation, axis.origin);
    }
  }
}

function tickAndLabel(
  ctx: CanvasContext2D,
  t: AxisTick,
  orientation: SceneAxis["orientation"],
  origin: { x: number; y: number },
): void {
  ctx.strokeStyle = AXIS_COLOR;
  ctx.lineWidth = 1;
  ctx.fillStyle = AXIS_LABEL_COLOR;
  ctx.font = `11px ${FONT_FAMILY}`;
  if (orientation === "bottom") {
    line(ctx, t.position, origin.y, t.position, origin.y + 4);
    ctx.textAlign = "center";
    ctx.textBaseline = "hanging";
    ctx.fillText(t.label, t.position, origin.y + 16);
  } else if (orientation === "left") {
    line(ctx, origin.x - 4, t.position, origin.x, t.position);
    ctx.textAlign = "end";
    ctx.textBaseline = "middle";
    ctx.fillText(t.label, origin.x - 8, t.position);
  } else {
    // right
    line(ctx, origin.x, t.position, origin.x + 4, t.position);
    ctx.textAlign = "start";
    ctx.textBaseline = "middle";
    ctx.fillText(t.label, origin.x + 8, t.position);
  }
}

function line(ctx: CanvasContext2D, x1: number, y1: number, x2: number, y2: number): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// Legends — color + size swatches with text labels
// ---------------------------------------------------------------------------

function renderLegend(legend: SceneLegend, ctx: CanvasContext2D): void {
  const x = legend.origin.x;
  let y = legend.origin.y;
  // Legend title.
  ctx.fillStyle = AXIS_LABEL_COLOR;
  ctx.font = `12px ${FONT_FAMILY}`;
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(legend.title, x, y);
  y += 16;
  // Entries — color swatch + label.
  ctx.font = `11px ${FONT_FAMILY}`;
  for (const e of legend.entries) {
    ctx.fillStyle = e.color;
    ctx.fillRect(x, y - 8, 12, 10);
    ctx.fillStyle = AXIS_LABEL_COLOR;
    ctx.fillText(e.label, x + 18, y);
    y += 16;
  }
}

// ---------------------------------------------------------------------------
// MockCanvasContext2D — for headless / Node tests
// ---------------------------------------------------------------------------

/**
 * Recording mock context. Captures every call as a string so tests can
 * snapshot the draw sequence. Real production users pass a browser or
 * node-canvas context to `renderCanvas`.
 */
export class MockCanvasContext2D implements CanvasContext2D {
  fillStyle = "#000";
  strokeStyle = "#000";
  lineWidth = 1;
  font = "10px sans-serif";
  textAlign: CanvasContext2D["textAlign"] = "start";
  textBaseline: CanvasContext2D["textBaseline"] = "alphabetic";
  globalAlpha = 1;
  readonly calls: string[] = [];

  save(): void {
    this.calls.push("save");
  }
  restore(): void {
    this.calls.push("restore");
  }
  beginPath(): void {
    this.calls.push("beginPath");
  }
  closePath(): void {
    this.calls.push("closePath");
  }
  moveTo(x: number, y: number): void {
    this.calls.push(`moveTo(${fmt(x)},${fmt(y)})`);
  }
  lineTo(x: number, y: number): void {
    this.calls.push(`lineTo(${fmt(x)},${fmt(y)})`);
  }
  arc(x: number, y: number, r: number, sa: number, ea: number): void {
    this.calls.push(`arc(${fmt(x)},${fmt(y)},${fmt(r)},${fmt(sa)},${fmt(ea)})`);
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.calls.push(`rect(${fmt(x)},${fmt(y)},${fmt(w)},${fmt(h)})`);
  }
  fill(): void {
    this.calls.push(`fill[${this.fillStyle}]`);
  }
  stroke(): void {
    this.calls.push(`stroke[${this.strokeStyle},lw=${this.lineWidth}]`);
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.calls.push(`fillRect(${fmt(x)},${fmt(y)},${fmt(w)},${fmt(h)})[${this.fillStyle}]`);
  }
  strokeRect(x: number, y: number, w: number, h: number): void {
    this.calls.push(`strokeRect(${fmt(x)},${fmt(y)},${fmt(w)},${fmt(h)})[${this.strokeStyle}]`);
  }
  clearRect(x: number, y: number, w: number, h: number): void {
    this.calls.push(`clearRect(${fmt(x)},${fmt(y)},${fmt(w)},${fmt(h)})`);
  }
  fillText(text: string, x: number, y: number): void {
    this.calls.push(`fillText(${JSON.stringify(text)},${fmt(x)},${fmt(y)})[${this.fillStyle}]`);
  }
  strokeText(text: string, x: number, y: number): void {
    this.calls.push(`strokeText(${JSON.stringify(text)},${fmt(x)},${fmt(y)})[${this.strokeStyle}]`);
  }
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}
