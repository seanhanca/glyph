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
import { ICON_LIBRARY } from "../icons/library.js";
import type {
  AnnotationMarkConfig,
  CircleMarkConfig,
  ComposeChild,
  ComposeSpec,
  EllipseConfig,
  FrameMarkConfig,
  GearMarkConfig,
  GlowConfig,
  HeartIconConfig,
  IconConfig,
  PendulumMarkConfig,
  PolygonConfig,
  PolylineConfig,
  RawSvgConfig,
  SilhouettePathConfig,
  SliderCrankConfig,
  StarfieldConfig,
  TextMarkConfig,
  WankelRotorConfig,
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

  // RFC #9 — emit `<defs>` first. gradient-def and pattern-def
  // SceneMarks are collected at the front of the marks array so the
  // renderer's <defs> block picks them up before any content marks.
  if (spec.defs?.gradients) {
    for (const g of spec.defs.gradients) {
      const attrs: Record<string, string> =
        g.kind === "linear"
          ? { x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2 }
          : { cx: g.cx, cy: g.cy, r: g.r };
      marks.push({
        type: "gradient-def",
        id: g.id,
        kind: g.kind,
        attrs,
        // exactOptionalPropertyTypes wants the opacity property
        // ABSENT (not =undefined) on stops without explicit opacity.
        // Filter undefineds out so the SceneMark variant matches.
        stops: g.stops.map((s) =>
          s.opacity !== undefined
            ? { offset: s.offset, color: s.color, opacity: s.opacity }
            : { offset: s.offset, color: s.color },
        ),
      });
    }
  }
  if (spec.defs?.patterns) {
    for (const p of spec.defs.patterns) {
      const children: SceneMark[] = p.children.map((c) => {
        if (c.kind === "line")
          return {
            type: "line" as const,
            x1: c.x1,
            y1: c.y1,
            x2: c.x2,
            y2: c.y2,
            stroke: c.stroke,
            strokeWidth: c.strokeWidth,
          };
        if (c.kind === "rect")
          return {
            type: "rect" as const,
            x: c.x,
            y: c.y,
            width: c.width,
            height: c.height,
            fill: c.fill,
          };
        return {
          type: "circle" as const,
          cx: c.cx,
          cy: c.cy,
          r: c.r,
          fill: c.fill,
        };
      });
      const patternMark: SceneMark = p.patternTransform
        ? {
            type: "pattern-def",
            id: p.id,
            width: p.width,
            height: p.height,
            patternTransform: p.patternTransform,
            children,
          }
        : { type: "pattern-def", id: p.id, width: p.width, height: p.height, children };
      marks.push(patternMark);
    }
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
    // Construct the group mark via conditional spread so that the
    // exactOptionalPropertyTypes compiler strictness doesn't complain
    // when id / loopAnimationXml are undefined.
    const base = {
      type: "group" as const,
      translateX: child.at.x,
      translateY: child.at.y,
      children: groupChildren,
    };
    const withId: SceneMark = child.id ? { ...base, id: child.id } : base;
    const group: SceneMark = animXml ? { ...withId, loopAnimationXml: animXml } : withId;
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
  if (child.mark === "circle" && child.circle) return compileCircle(child.circle);
  if (child.mark === "text" && child.textMark) return compileText(child.textMark);
  if (child.mark === "heart-icon" && child.heartIcon) return compileHeartIcon(child.heartIcon);
  if (child.mark === "slider-crank" && child.sliderCrank)
    return compileSliderCrank(child.sliderCrank);
  if (child.mark === "wankel-rotor" && child.wankelRotor)
    return compileWankelRotor(child.wankelRotor);
  // RFC #9 additions
  if (child.mark === "starfield" && child.starfield) return compileStarfield(child.starfield);
  if (child.mark === "glow" && child.glow) return compileGlow(child.glow);
  if (child.mark === "silhouette-path" && child.silhouettePath)
    return compileSilhouettePath(child.silhouettePath);
  if (child.mark === "icon" && child.icon) return compileIcon(child.icon);
  if (child.mark === "ellipse" && child.ellipse) return compileEllipse(child.ellipse);
  if (child.mark === "polygon" && child.polygon) return compilePolygon(child.polygon);
  if (child.mark === "polyline" && child.polyline) return compilePolyline(child.polyline);
  if (child.mark === "raw-svg" && child.rawSvg) return compileRawSvg(child.rawSvg);
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

/* ----------------------------------------------------------------
 *  Subject-specific schematic marks (RFC #7 extended set)
 * ---------------------------------------------------------------- */

/** Decorative circle at local origin. */
export function compileCircle(cfg: CircleMarkConfig): SceneMark[] {
  if (cfg.stroke !== undefined) {
    const sw = cfg.strokeWidth ?? 1;
    return [
      {
        type: "circle",
        cx: 0,
        cy: 0,
        r: cfg.radius,
        fill: cfg.fill,
        stroke: cfg.stroke,
        strokeWidth: sw,
      },
    ];
  }
  return [{ type: "circle", cx: 0, cy: 0, r: cfg.radius, fill: cfg.fill }];
}

/** Decorative text label at local origin. */
export function compileText(cfg: TextMarkConfig): SceneMark[] {
  return [
    {
      type: "text",
      x: 0,
      y: 0,
      text: cfg.text,
      fontSize: cfg.fontSize,
      fill: cfg.fill,
      anchor: cfg.anchor,
      baseline: "middle",
    },
  ];
}

/**
 * Heart-icon: a stylized heart shape centered at local origin.
 * Built as one filled SVG path; the classic two-arc / triangle-tip
 * heart silhouette. `size` scales the whole icon — at size=40 the
 * heart is about 40 px wide / 36 px tall.
 *
 * Pairs naturally with `animation.kind: "pulse"` on the same child
 * — the pulse transform scales the icon at the rhythm of a heart.
 */
export function compileHeartIcon(cfg: HeartIconConfig): SceneMark[] {
  // Path is in a [-s/2, +s/2] coordinate space where s = cfg.size.
  // Two cubic Bezier curves form the upper lobes; lines drop to the
  // bottom tip; closed with Z. Tuned visually.
  const s = cfg.size;
  const h = s * 0.9;
  const d = `M 0 ${(h * 0.32).toFixed(3)}
             C ${(-s * 0.42).toFixed(3)} ${(h * 0.06).toFixed(3)}, ${(-s * 0.65).toFixed(3)} ${(-h * 0.18).toFixed(3)}, ${(-s * 0.42).toFixed(3)} ${(-h * 0.4).toFixed(3)}
             C ${(-s * 0.2).toFixed(3)} ${(-h * 0.58).toFixed(3)}, 0 ${(-h * 0.42).toFixed(3)}, 0 ${(-h * 0.24).toFixed(3)}
             C 0 ${(-h * 0.42).toFixed(3)}, ${(s * 0.2).toFixed(3)} ${(-h * 0.58).toFixed(3)}, ${(s * 0.42).toFixed(3)} ${(-h * 0.4).toFixed(3)}
             C ${(s * 0.65).toFixed(3)} ${(-h * 0.18).toFixed(3)}, ${(s * 0.42).toFixed(3)} ${(h * 0.06).toFixed(3)}, 0 ${(h * 0.32).toFixed(3)} Z`;
  return [
    {
      type: "path",
      d: d.replace(/\s+/g, " ").trim(),
      fill: cfg.fill,
      stroke: cfg.stroke,
      strokeWidth: 0.8,
    },
  ];
}

/**
 * Slider-crank mechanism schematic for Watt's steam engine. Crank
 * wheel at local origin, connecting rod tilted slightly upward to
 * the right (mid-stroke pose), piston sliding inside an open
 * cylinder further to the right. Frozen in pose — for a live moving
 * version, render this scene + JS animation in the wrapping page.
 *
 * The angle = 30° past TDC. With crankRadius r and rodLength l:
 *   pinX  =  r·cos(30°) ≈ 0.866 r
 *   pinY  = -r·sin(30°) = -0.5 r       (above center in SVG y-down)
 *   pistonX = r·cos(30°) + √(l² − r²·sin²(30°))
 *           = r·cos(30°) + √(l² − r²/4)
 */
export function compileSliderCrank(cfg: SliderCrankConfig): SceneMark[] {
  const marks: SceneMark[] = [];
  const r = cfg.crankRadius;
  const l = cfg.rodLength;
  const theta = Math.PI / 6; // 30° past TDC
  const pinX = r * Math.cos(theta);
  const pinY = -r * Math.sin(theta);
  const pistonX = pinX + Math.sqrt(l * l - r * r * Math.sin(theta) * Math.sin(theta));
  // Crank wheel
  marks.push({
    type: "circle",
    cx: 0,
    cy: 0,
    r,
    fill: "#fdf8ea",
    stroke: "#1f1a14",
    strokeWidth: 1.5,
  });
  // Spokes
  marks.push({ type: "line", x1: -r, y1: 0, x2: r, y2: 0, stroke: "#4a3f30", strokeWidth: 0.6 });
  marks.push({ type: "line", x1: 0, y1: -r, x2: 0, y2: r, stroke: "#4a3f30", strokeWidth: 0.6 });
  // Crank hub
  marks.push({ type: "circle", cx: 0, cy: 0, r: 4, fill: "#1f1a14" });
  // Crank pin (where the connecting rod attaches)
  marks.push({
    type: "circle",
    cx: pinX,
    cy: pinY,
    r: 3,
    fill: "#8b3a1c",
    stroke: "#1f1a14",
    strokeWidth: 0.8,
  });
  // Connecting rod (pin → piston)
  marks.push({
    type: "line",
    x1: pinX,
    y1: pinY,
    x2: pistonX,
    y2: 0,
    stroke: "#1f1a14",
    strokeWidth: 2.5,
  });
  // Cylinder bore — leftmost edge at (pistonX - r - 10), rightmost
  // edge at (pistonX + l/2). Drawn as open rect, hatched right wall.
  const cylLeft = pistonX - r - 10;
  const cylRight = pistonX + l * 0.5;
  marks.push({
    type: "rect",
    x: cylLeft,
    y: -r - 4,
    width: cylRight - cylLeft,
    height: 2 * r + 8,
    fill: "none",
    stroke: "#1f1a14",
    strokeWidth: 1.5,
  });
  // Piston rect (centered on pistonX, 30 px wide)
  marks.push({
    type: "rect",
    x: pistonX - 15,
    y: -r,
    width: 30,
    height: 2 * r,
    fill: "#fdf8ea",
    stroke: "#1f1a14",
    strokeWidth: 1.5,
  });
  return marks;
}

/**
 * Wankel triangular rotor — equilateral triangle with three apex
 * markers, in the schematic style used in textbooks. Local origin
 * is the rotor's center; apex 0 is on the +x axis (3-o'clock at
 * body angle 0).
 */
export function compileWankelRotor(cfg: WankelRotorConfig): SceneMark[] {
  const R = cfg.apexRadius;
  // Three apex world positions in rotor's body frame
  const ax0 = R;
  const ay0 = 0;
  const ax1 = -R * 0.5;
  const ay1 = R * Math.sin((Math.PI * 2) / 3);
  const ax2 = -R * 0.5;
  const ay2 = -R * Math.sin((Math.PI * 2) / 3);
  // Filled triangle path (straight sides)
  const d = `M ${ax0.toFixed(3)} ${ay0.toFixed(3)} L ${ax1.toFixed(3)} ${ay1.toFixed(3)} L ${ax2.toFixed(3)} ${ay2.toFixed(3)} Z`;
  return [
    {
      type: "path",
      d,
      fill: "rgba(31,26,20,.06)",
      stroke: "#1f1a14",
      strokeWidth: 2,
    },
    {
      type: "circle",
      cx: ax0,
      cy: ay0,
      r: 4,
      fill: "#8b3a1c",
      stroke: "#1f1a14",
      strokeWidth: 0.8,
    },
    {
      type: "circle",
      cx: ax1,
      cy: ay1,
      r: 4,
      fill: "#8b3a1c",
      stroke: "#1f1a14",
      strokeWidth: 0.8,
    },
    {
      type: "circle",
      cx: ax2,
      cy: ay2,
      r: 4,
      fill: "#8b3a1c",
      stroke: "#1f1a14",
      strokeWidth: 0.8,
    },
    // Rotor bearing center
    { type: "circle", cx: 0, cy: 0, r: 4, fill: "#4a3f30" },
  ];
}

/* ----------------------------------------------------------------
 *  RFC #9 — decorative-primitive compilers
 * ---------------------------------------------------------------- */

/** Park-Miller LCG. Deterministic, byte-stable across platforms.
 *  Same seed → same sequence, every call. Used by the starfield. */
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  if (state === 0) state = 1; // avoid degenerate zero state
  return () => {
    state = (state * 48271) % 0x7fffffff;
    return state / 0x7fffffff;
  };
}

/**
 * Starfield: N stars placed deterministically in a rect region. Each
 * star is one `<circle>` SceneMark with size + color picked from the
 * cfg. Stars alternate between colorA/colorB so the rendered field
 * has gentle variation without needing per-star color config.
 *
 * When `twinkleMs > 0` an `<animate>` opacity oscillation is
 * attached to each star — but the implementation is deferred to
 * RFC #10's `attribute-animate` machinery so for now we emit
 * static stars.
 */
export function compileStarfield(cfg: StarfieldConfig): SceneMark[] {
  const rng = makeRng(cfg.seed);
  const out: SceneMark[] = [];
  for (let i = 0; i < cfg.count; i++) {
    const x = cfg.region.x + rng() * cfg.region.w;
    const y = cfg.region.y + rng() * cfg.region.h;
    const r = cfg.radiusMin + rng() * (cfg.radiusMax - cfg.radiusMin);
    const fill = i % 2 === 0 ? cfg.colorA : cfg.colorB;
    out.push({
      type: "circle",
      cx: Number(x.toFixed(3)),
      cy: Number(y.toFixed(3)),
      r: Number(r.toFixed(3)),
      fill,
    });
  }
  return out;
}

/**
 * Glow: a circle filled with a radial gradient at the group's origin.
 * The gradient must be defined in `spec.defs.gradients` and
 * referenced here by id. Optional `pulseMs > 0` adds a SMIL
 * `<animate>` on `r` for the breathing effect — implemented via
 * RFC #10's attribute-animate later; for now the radius is static.
 */
export function compileGlow(cfg: GlowConfig): SceneMark[] {
  return [
    {
      type: "circle",
      cx: 0,
      cy: 0,
      r: cfg.radius,
      fill: `url(#${cfg.gradientId})`,
    },
  ];
}

/** Silhouette-path: raw d-string with fill + optional stroke. */
export function compileSilhouettePath(cfg: SilhouettePathConfig): SceneMark[] {
  const base = {
    type: "path" as const,
    d: cfg.d,
    fill: cfg.fill,
  };
  const opacityBit = cfg.opacity !== undefined ? { opacity: cfg.opacity } : {};
  const strokeBits =
    cfg.stroke !== undefined
      ? {
          stroke: cfg.stroke,
          ...(cfg.strokeWidth !== undefined ? { strokeWidth: cfg.strokeWidth } : {}),
          ...(cfg.strokeDasharray !== undefined
            ? { strokeDasharray: cfg.strokeDasharray }
            : {}),
        }
      : {};
  return [{ ...base, ...strokeBits, ...opacityBit } as SceneMark];
}

/**
 * Icon: look up `id` in the ICON_LIBRARY, scale the unit-sized path
 * to the requested size, emit one `<path>` SceneMark. The icon's
 * native viewBox is [-0.5, +0.5] so size scales it to the desired
 * extent (size = 40 → icon spans 40 px).
 */
export function compileIcon(cfg: IconConfig): SceneMark[] {
  const entry = ICON_LIBRARY[cfg.id];
  if (!entry) return [];
  // Scale the d-string's coordinates by `size`. Since the unit
  // viewBox is [-0.5, +0.5], multiplying coordinates by size gives
  // the right extent. We rebuild the d-string by parsing numbers
  // out of it. Path commands (letters) are preserved verbatim.
  const scaled = entry.d.replace(/-?\d*\.?\d+(?:[eE][+-]?\d+)?/g, (n) => {
    const v = Number.parseFloat(n) * cfg.size;
    return Number(v.toFixed(3)).toString();
  });
  const out: SceneMark = {
    type: "path",
    d: scaled,
    fill: cfg.fill,
    ...(cfg.stroke !== undefined ? { stroke: cfg.stroke } : {}),
    ...(cfg.strokeWidth !== undefined ? { strokeWidth: cfg.strokeWidth } : {}),
  };
  return [out];
}

/** Decorative ellipse at local origin, optionally rotated. */
export function compileEllipse(cfg: EllipseConfig): SceneMark[] {
  // If we need rotation, wrap in a group with a transform. For
  // axis-aligned ellipses, emit directly.
  const ellipse: SceneMark = {
    type: "ellipse",
    cx: 0,
    cy: 0,
    rx: cfg.rx,
    ry: cfg.ry,
    fill: cfg.fill,
    ...(cfg.stroke !== undefined ? { stroke: cfg.stroke } : {}),
    ...(cfg.strokeWidth !== undefined ? { strokeWidth: cfg.strokeWidth } : {}),
    ...(cfg.opacity !== undefined ? { opacity: cfg.opacity } : {}),
    ...(cfg.rotateDeg !== 0 ? { rotateDeg: cfg.rotateDeg } : {}),
  };
  return [ellipse];
}

/** Polygon — closed shape from point list. */
export function compilePolygon(cfg: PolygonConfig): SceneMark[] {
  return [
    {
      type: "polygon",
      points: cfg.points,
      fill: cfg.fill,
      ...(cfg.stroke !== undefined ? { stroke: cfg.stroke } : {}),
      ...(cfg.strokeWidth !== undefined ? { strokeWidth: cfg.strokeWidth } : {}),
    },
  ];
}

/** Polyline — open shape from point list. */
export function compilePolyline(cfg: PolylineConfig): SceneMark[] {
  return [
    {
      type: "polyline",
      points: cfg.points,
      fill: cfg.fill,
      stroke: cfg.stroke,
      strokeWidth: cfg.strokeWidth,
      ...(cfg.strokeDasharray !== undefined ? { strokeDasharray: cfg.strokeDasharray } : {}),
    },
  ];
}

/** Raw-svg escape hatch. The xml is validated upstream; emit verbatim. */
export function compileRawSvg(cfg: RawSvgConfig): SceneMark[] {
  return [{ type: "raw-svg", xml: cfg.xml }];
}
