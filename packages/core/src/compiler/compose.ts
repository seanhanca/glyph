/**
 * RFC #5 — compose: walk a ComposeSpec, dispatch each child to its
 * mark compiler, wrap the produced primitives in a `<g translate>`
 * (with an optional looping animation), and merge into one scene.
 *
 * The output Scene's `marks` is a flat list of `group` SceneMarks
 * (one per compose child). Each group contains its primitive
 * children + optional SMIL animation XML. The SVG renderer walks
 * this recursively, emitting `<g>` wrappers for each group.
 */

import { emitLoopAnimation } from "../animation/loops.js";
import type { Scene, SceneMark } from "../scenegraph/types.js";
import type {
  AnnotationMarkConfig,
  ComposeChild,
  ComposeSpec,
  FrameMarkConfig,
  GearMarkConfig,
  PendulumMarkConfig,
} from "../spec/compose-schema.js";
import { parseSpec } from "../spec/parse.js";
import type { CompileFieldInfo } from "./compile.js";
import { compileSpec } from "./compile.js";

/** Top-level compose compiler. Returns a Scene ready for renderSvg. */
export function compileCompose(spec: ComposeSpec): Scene {
  const marks: SceneMark[] = [];

  // Resolve background color from theme. RFC #8's pencil-parchment
  // preset hardcodes parchment; explicit `theme.background` wins.
  const bg = resolveBackground(spec);
  if (bg) {
    marks.push({
      type: "rect",
      x: 0,
      y: 0,
      width: spec.viewBox.width,
      height: spec.viewBox.height,
      fill: bg,
    });
  }

  // Optional graph-paper grid (RFC #8). Drawn before children so it
  // sits behind the schematic.
  if (spec.theme?.gridPattern === "graph-paper") {
    pushGraphPaperGrid(marks, spec.viewBox.width, spec.viewBox.height);
  }

  // Walk children in order; each produces one `group` mark.
  for (const child of spec.children) {
    const groupChildren = compileChild(child);
    if (groupChildren.length === 0) continue;
    const animXml = emitLoopAnimation(child.animation);
    const group: SceneMark = animXml
      ? {
          type: "group",
          translateX: child.at.x,
          translateY: child.at.y,
          children: groupChildren,
          loopAnimationXml: animXml,
        }
      : {
          type: "group",
          translateX: child.at.x,
          translateY: child.at.y,
          children: groupChildren,
        };
    marks.push(group);
  }

  return {
    width: spec.viewBox.width,
    height: spec.viewBox.height,
    marks,
    // Scene requires a `background` even though we paint it ourselves
    // via a `rect` mark above (so the grid sits between bg and
    // children). Set transparent to avoid double-painting.
    background: "transparent",
    axes: [],
    plotArea: { x: 0, y: 0, width: spec.viewBox.width, height: spec.viewBox.height },
  };
}

/** Dispatch one compose child to its mark compiler. */
function compileChild(child: ComposeChild): SceneMark[] {
  if (child.mark === "frame" && child.frame) return compileFrame(child.frame);
  if (child.mark === "gear" && child.gear) return compileGear(child.gear);
  if (child.mark === "pendulum" && child.pendulum) return compilePendulum(child.pendulum);
  if (child.mark === "annotation-leader" && child.annotation)
    return compileAnnotationLeader(child.annotation, child.at.x, child.at.y);
  if (child.mark === "chart" && child.chart && child.size)
    return compileChart(child.chart, child.size);
  return [];
}

/**
 * Nested chart spec inside a compose scene. Parses + compiles the
 * given chart spec, scales its viewBox down to fit the child's
 * `size`, and returns the scaled marks so the parent's group
 * wrapper can position them.
 *
 * The chart spec uses its own width/height (default 640×400) and
 * its scales resolve against the chart's own data. We then wrap
 * the resulting marks in a scaling SceneMark group so the chart
 * fits the requested `size`.
 *
 * This keeps composition compositional — the chart is rendered
 * exactly as if it were standalone, then placed in the parent.
 */
function compileChart(rawChart: unknown, size: { w: number; h: number }): SceneMark[] {
  const spec = parseSpec(rawChart);
  const rows: ReadonlyArray<ReadonlyArray<number>> = [];
  const schema: CompileFieldInfo[] = [];
  const scene = compileSpec({ spec, rows, schema });
  const sx = size.w / scene.width;
  const sy = size.h / scene.height;
  // Inner group applies the scale; outer (compose-child) group
  // applies the translate. Two-step keeps each transformation
  // composable and easy to reason about.
  return [
    {
      type: "group",
      translateX: 0,
      translateY: 0,
      scaleX: sx,
      scaleY: sy,
      children: [...scene.marks],
    },
  ];
}

/* ----------------------------------------------------------------
 *  Schematic mark compilers (RFC #7)
 * ---------------------------------------------------------------- */

/** `frame`: bordered rectangle, optional title strip across the top. */
export function compileFrame(cfg: FrameMarkConfig): SceneMark[] {
  const marks: SceneMark[] = [];
  const frameRect: SceneMark =
    cfg.cornerRadius !== undefined
      ? {
          type: "rect",
          x: 0,
          y: 0,
          width: cfg.width,
          height: cfg.height,
          fill: "none",
          stroke: "#1f1a14",
          strokeWidth: 1.5,
          rx: cfg.cornerRadius,
        }
      : {
          type: "rect",
          x: 0,
          y: 0,
          width: cfg.width,
          height: cfg.height,
          fill: "none",
          stroke: "#1f1a14",
          strokeWidth: 1.5,
        };
  marks.push(frameRect);
  if (cfg.title) {
    // Title strip: shaded rect at the top + centered serif italic text
    marks.push({
      type: "rect",
      x: 15,
      y: 15,
      width: cfg.width - 30,
      height: 20,
      fill: "rgba(31,26,20,.05)",
      stroke: "#1f1a14",
      strokeWidth: 0.5,
    });
    marks.push({
      type: "text",
      x: cfg.width / 2,
      y: 29,
      text: cfg.title,
      fontSize: 11,
      fill: "#4a3f30",
      anchor: "middle",
      baseline: "alphabetic",
    });
  }
  return marks;
}

/**
 * `gear`: outer circle + inner dashed circle + N tooth radial lines +
 * central hub. Local origin is the gear's center; the group's translate
 * positions it on the parent canvas, and the group's loop-animation
 * rotates the whole gear about its own center.
 */
export function compileGear(cfg: GearMarkConfig): SceneMark[] {
  const marks: SceneMark[] = [];
  // Outer rim
  marks.push({
    type: "circle",
    cx: 0,
    cy: 0,
    r: cfg.radius,
    fill: "#fdf8ea",
    stroke: "#1f1a14",
    strokeWidth: 1.5,
  });
  // Inner reference circle (dashed, slightly smaller)
  marks.push({
    type: "circle",
    cx: 0,
    cy: 0,
    r: cfg.radius - 8,
    fill: "none",
    stroke: "#4a3f30",
    strokeWidth: 0.6,
  });
  // Teeth as radial lines around the rim
  const inner = cfg.radius;
  const outer = cfg.radius + cfg.toothLength;
  for (let i = 0; i < cfg.teeth; i++) {
    const angle = (i / cfg.teeth) * 2 * Math.PI - Math.PI / 2; // start at 12 o'clock
    const x1 = Number((Math.cos(angle) * inner).toFixed(3));
    const y1 = Number((Math.sin(angle) * inner).toFixed(3));
    const x2 = Number((Math.cos(angle) * outer).toFixed(3));
    const y2 = Number((Math.sin(angle) * outer).toFixed(3));
    marks.push({
      type: "line",
      x1,
      y1,
      x2,
      y2,
      stroke: "#1f1a14",
      strokeWidth: 1.2,
    });
  }
  // Central hub
  marks.push({
    type: "circle",
    cx: 0,
    cy: 0,
    r: cfg.hubRadius,
    fill: "#1f1a14",
  });
  return marks;
}

/**
 * `pendulum`: a thin rod hanging down from local (0, 0) to the bob,
 * a circular bob, and an optional cross/dot marker inside the bob.
 * Local origin is the pivot; the group's translate positions the
 * pivot, and a `swing` loop animation oscillates the whole pendulum.
 */
export function compilePendulum(cfg: PendulumMarkConfig): SceneMark[] {
  const marks: SceneMark[] = [];
  // Rod
  marks.push({
    type: "line",
    x1: 0,
    y1: 0,
    x2: 0,
    y2: cfg.length - cfg.bobRadius,
    stroke: "#1f1a14",
    strokeWidth: 1.5,
  });
  // Bob
  marks.push({
    type: "circle",
    cx: 0,
    cy: cfg.length,
    r: cfg.bobRadius,
    fill: "#fdf8ea",
    stroke: "#1f1a14",
    strokeWidth: 2,
  });
  // Cross marker inside the bob, oriented in the bob's local frame
  // (rotates with the bob — for a pendulum that's natural; for a
  // dot/none marker we skip).
  if (cfg.markerKind === "cross") {
    const half = cfg.bobRadius * 0.55;
    marks.push({
      type: "line",
      x1: -half,
      y1: cfg.length,
      x2: half,
      y2: cfg.length,
      stroke: "#1f1a14",
      strokeWidth: 1.5,
    });
    marks.push({
      type: "line",
      x1: 0,
      y1: cfg.length - half,
      x2: 0,
      y2: cfg.length + half,
      stroke: "#1f1a14",
      strokeWidth: 1.5,
    });
  } else if (cfg.markerKind === "dot") {
    marks.push({
      type: "circle",
      cx: 0,
      cy: cfg.length,
      r: 3,
      fill: "#1f1a14",
    });
  }
  return marks;
}

/**
 * `annotation-leader`: a thin leader line from `from` to `to` plus
 * an italic serif text at `to`. Local origin is (0, 0); the absolute
 * coordinates in `from` / `to` are interpreted in the parent's
 * coordinate frame, with the group's translate adjusting from
 * (childOriginX, childOriginY) to (0, 0).
 */
export function compileAnnotationLeader(
  cfg: AnnotationMarkConfig,
  originX: number,
  originY: number,
): SceneMark[] {
  const marks: SceneMark[] = [];
  // Subtract the child's at-position from absolute coords so the
  // leader line is correct relative to the group's translate.
  const fromX = cfg.from[0] - originX;
  const fromY = cfg.from[1] - originY;
  const toX = cfg.to[0] - originX;
  const toY = cfg.to[1] - originY;
  marks.push({
    type: "line",
    x1: fromX,
    y1: fromY,
    x2: toX,
    y2: toY,
    stroke: "#4a3f30",
    strokeWidth: 0.5,
  });
  marks.push({
    type: "text",
    x: toX + (cfg.anchor === "start" ? 4 : cfg.anchor === "end" ? -4 : 0),
    y: toY - 2,
    text: cfg.text,
    fontSize: 11,
    fill: "#4a3f30",
    anchor: cfg.anchor,
    baseline: "alphabetic",
  });
  return marks;
}

/* ----------------------------------------------------------------
 *  Theme + background helpers
 * ---------------------------------------------------------------- */

/**
 * Resolve the background fill from the spec's theme. Explicit
 * `theme.background` wins over the preset. RFC #8's pencil-parchment
 * preset paints a warm cream background.
 */
function resolveBackground(spec: ComposeSpec): string | undefined {
  const t = spec.theme;
  if (!t) return undefined;
  if (t.background) return t.background;
  if (t.preset === "pencil-parchment") return "#f5edd9";
  return undefined;
}

/**
 * Push faint graph-paper gridlines covering the full viewBox. The
 * grid sits behind the rest of the scene. Used by the pencil-
 * parchment preset when `gridPattern: "graph-paper"`.
 */
function pushGraphPaperGrid(marks: SceneMark[], width: number, height: number): void {
  const step = 32;
  const stroke = "rgba(80,110,160,.08)";
  for (let x = step; x < width; x += step) {
    marks.push({
      type: "line",
      x1: x,
      y1: 0,
      x2: x,
      y2: height,
      stroke,
      strokeWidth: 1,
    });
  }
  for (let y = step; y < height; y += step) {
    marks.push({
      type: "line",
      x1: 0,
      y1: y,
      x2: width,
      y2: y,
      stroke,
      strokeWidth: 1,
    });
  }
}
