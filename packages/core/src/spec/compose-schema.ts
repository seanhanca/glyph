/**
 * RFC #5 — `compose`: multi-subject scene composition.
 *
 * Compose specs are a separate top-level shape from chart specs
 * (GlyphSpec). A compose spec describes a canvas with absolute-
 * positioned child marks — schematic primitives (frame, gear,
 * pendulum, annotation-leader) and, in a follow-up, nested chart
 * specs.
 *
 * Determinism contract: same input → byte-identical SVG output.
 * Each child's SceneMarks are translated by `at.{x, y}` before
 * being merged into the parent's mark list, in the order the
 * children appear in the JSON.
 *
 * This file lives separately from `schemas.ts` because the chart-
 * spec schema is large + brittle; keeping compose orthogonal lets
 * us evolve it without churning 75 call sites that destructure
 * `spec.layers`.
 */
import { z } from "zod";

/** RFC #6 — looping animation kinds. */
export const LoopAnimationSchema = z
  .union([
    z
      .object({
        kind: z.literal("swing"),
        amplitudeDeg: z.number().min(0).max(180),
        periodMs: z.number().int().min(100).max(120_000),
      })
      .strict(),
    z
      .object({
        kind: z.literal("rotate-loop"),
        periodMs: z.number().int().min(100).max(600_000),
        direction: z.enum(["cw", "ccw"]).default("cw"),
      })
      .strict(),
    z
      .object({
        kind: z.literal("pulse"),
        periodMs: z.number().int().min(100).max(60_000),
        scale: z.number().min(0.5).max(2),
      })
      .strict(),
  ])
  .optional();

/** RFC #7 — `frame` schematic mark config. */
export const FrameMarkSchema = z
  .object({
    width: z.number().positive(),
    height: z.number().positive(),
    title: z.string().max(80).optional(),
    cornerRadius: z.number().min(0).max(40).optional(),
  })
  .strict();

/** RFC #7 — `gear` schematic mark config. */
export const GearMarkSchema = z
  .object({
    radius: z.number().positive().max(400),
    teeth: z.number().int().min(4).max(120),
    toothLength: z.number().positive().max(40).default(7),
    innerStrokeDash: z.string().max(20).optional(),
    hubRadius: z.number().min(1).max(40).default(5),
  })
  .strict();

/** RFC #7 — `pendulum` schematic mark config. */
export const PendulumMarkSchema = z
  .object({
    length: z.number().positive().max(800),
    bobRadius: z.number().positive().max(80).default(20),
    markerKind: z.enum(["cross", "dot", "none"]).default("cross"),
  })
  .strict();

/** RFC #7 — `annotation-leader` mark config. */
export const AnnotationMarkSchema = z
  .object({
    from: z.tuple([z.number(), z.number()]),
    to: z.tuple([z.number(), z.number()]),
    text: z.string().max(120),
    italic: z.boolean().default(true),
    anchor: z.enum(["start", "middle", "end"]).default("start"),
  })
  .strict();

/** Decorative `circle` mark — a colored disc at the group's origin
 *  (the compose child's `at` coords). Used for Earth, Moon, the Sun,
 *  star fields, central seed heads, etc. */
export const CircleMarkSchema = z
  .object({
    radius: z.number().positive().max(400),
    fill: z.string().max(60),
    stroke: z.string().max(60).optional(),
    strokeWidth: z.number().min(0).max(20).optional(),
  })
  .strict();

/** Decorative `text` mark — a serif italic label at the group's origin.
 *  Used for "Earth", "Moon", "Sun" labels and titles outside the frame. */
export const TextMarkSchema = z
  .object({
    text: z.string().max(200),
    fontSize: z.number().min(6).max(64).default(12),
    fill: z.string().max(60).default("#1f1a14"),
    italic: z.boolean().default(true),
    anchor: z.enum(["start", "middle", "end"]).default("middle"),
  })
  .strict();

/** RFC #7 — `heart-icon` mark. A stylized heart shape with cusp at top
 *  and point at bottom. Local origin is the visual center; size scales
 *  the whole icon. Used on the heartbeat showcase to convey "lub-dub"
 *  at a glance — pairs naturally with the `pulse` animation. */
export const HeartIconSchema = z
  .object({
    size: z.number().positive().max(200).default(40),
    fill: z.string().max(60).default("#ef4444"),
    stroke: z.string().max(60).default("#7f1d1d"),
  })
  .strict();

/** RFC #7 — `slider-crank` mark. Engineering schematic of Watt's
 *  steam-engine kinematics: a crank wheel + connecting rod + piston
 *  sliding in a cylinder, all in static "frozen" mid-stroke pose.
 *  Local origin is the crank center; the wheel sits at (0, 0), the
 *  cylinder extends to the right. For visual interest, the crank
 *  pin sits at 30° past TDC, so the rod tilts slightly upward — a
 *  recognizable Watt-style technical drawing. */
export const SliderCrankSchema = z
  .object({
    crankRadius: z.number().positive().max(120).default(40),
    rodLength: z.number().positive().max(400).default(140),
  })
  .strict();

/** RFC #7 — `wankel-rotor` mark. The triangular rotor sitting inside
 *  a Wankel epitrochoidal housing, drawn as a Reuleaux-like triangle
 *  with three apex markers. Local origin is the rotor's center; the
 *  housing curve is NOT drawn here (use a `chart` child to embed the
 *  byte-locked wankel-rotor.svg fixture for the curve). */
export const WankelRotorSchema = z
  .object({
    apexRadius: z.number().positive().max(160).default(80),
  })
  .strict();

/** A single child in a compose scene — one mark at one position. */

/** Theme overrides for a compose scene. RFC #8 adds presets. */
export const ComposeThemeSchema = z
  .object({
    preset: z.enum(["pencil-parchment"]).optional(),
    background: z.string().max(60).optional(),
    foreground: z.string().max(40).optional(),
    gridPattern: z.enum(["graph-paper", "none"]).default("none"),
  })
  .strict()
  .optional();

/* ----------------------------------------------------------------
 *  RFC #9 — defs block: gradients + patterns
 * ---------------------------------------------------------------- */

/** A single color stop in a gradient. `offset` is a percentage like "55%". */
export const GradientStopSchema = z
  .object({
    offset: z.string().regex(/^\d{1,3}(\.\d+)?%$/, "offset must be e.g. '0%' or '55.5%'"),
    color: z.string().max(60),
    opacity: z.number().min(0).max(1).optional(),
  })
  .strict();

/** Linear gradient definition. Coordinates are percentages of the
 *  fillee's bounding box (objectBoundingBox is the SVG default). */
export const LinearGradientDefSchema = z
  .object({
    id: z.string().min(1).max(60),
    kind: z.literal("linear"),
    x1: z.string().default("0%"),
    y1: z.string().default("0%"),
    x2: z.string().default("100%"),
    y2: z.string().default("0%"),
    stops: z.array(GradientStopSchema).min(2).max(10),
  })
  .strict();

/** Radial gradient definition. cx/cy/r are percentages of the fillee. */
export const RadialGradientDefSchema = z
  .object({
    id: z.string().min(1).max(60),
    kind: z.literal("radial"),
    cx: z.string().default("50%"),
    cy: z.string().default("50%"),
    r: z.string().default("50%"),
    stops: z.array(GradientStopSchema).min(2).max(10),
  })
  .strict();

export const GradientDefSchema = z.union([LinearGradientDefSchema, RadialGradientDefSchema]);

/** A primitive element inside a `<pattern>` def — line, rect, or circle.
 *  Allowed shapes are SVG primitives the renderer already supports.
 *  No nested groups; keep patterns visually flat. */
export const PatternElementSchema = z.union([
  z
    .object({
      kind: z.literal("line"),
      x1: z.number(),
      y1: z.number(),
      x2: z.number(),
      y2: z.number(),
      stroke: z.string().max(60),
      strokeWidth: z.number().min(0).max(20).default(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("rect"),
      x: z.number(),
      y: z.number(),
      width: z.number().positive(),
      height: z.number().positive(),
      fill: z.string().max(60),
    })
    .strict(),
  z
    .object({
      kind: z.literal("circle"),
      cx: z.number(),
      cy: z.number(),
      r: z.number().positive(),
      fill: z.string().max(60),
    })
    .strict(),
]);

/** Pattern fill def. patternUnits defaults to "userSpaceOnUse" so the
 *  width/height are absolute pixels, not bounding-box fractions. */
export const PatternDefSchema = z
  .object({
    id: z.string().min(1).max(60),
    width: z.number().positive().max(200),
    height: z.number().positive().max(200),
    patternTransform: z.string().max(80).optional(),
    children: z.array(PatternElementSchema).min(1).max(20),
  })
  .strict();

/** Top-level <defs> container — gradients + patterns. */
export const ComposeDefsSchema = z
  .object({
    gradients: z.array(GradientDefSchema).max(32).optional(),
    patterns: z.array(PatternDefSchema).max(32).optional(),
  })
  .strict()
  .optional();

/* ----------------------------------------------------------------
 *  RFC #9 — new mark configs
 * ---------------------------------------------------------------- */

/** Starfield: N stars placed deterministically inside a rectangular
 *  region. The seed drives a Park-Miller LCG so the same seed always
 *  produces the same star positions. Optional twinkle adds a SMIL
 *  opacity oscillation. */
export const StarfieldSchema = z
  .object({
    count: z.number().int().min(1).max(500),
    seed: z.number().int().min(0).max(0x7fffffff),
    region: z
      .object({
        x: z.number(),
        y: z.number(),
        w: z.number().positive(),
        h: z.number().positive(),
      })
      .strict(),
    radiusMin: z.number().positive().max(10).default(0.5),
    radiusMax: z.number().positive().max(10).default(1.2),
    colorA: z.string().max(60).default("#ffffff"),
    colorB: z.string().max(60).default("#cbd5e1"),
    twinkleMs: z.number().int().min(0).max(60_000).default(0),
  })
  .strict();

/** Glow: a radial-gradient halo around a center point, with optional
 *  breathing pulse (SMIL `<animate attributeName="r">`). */
export const GlowSchema = z
  .object({
    radius: z.number().positive().max(400),
    gradientId: z.string().min(1).max(60),
    pulseMs: z.number().int().min(0).max(60_000).default(0),
    pulseDeltaR: z.number().min(0).max(40).default(2),
  })
  .strict();

/** Silhouette-path: a raw SVG path `d` string with fill + stroke + an
 *  optional draw-in animation. The `d` regex permits SVG path commands
 *  and numeric whitespace only — no XML injection surface. */
export const SilhouettePathSchema = z
  .object({
    d: z.string().regex(/^[ MmLlHhVvCcSsQqTtAaZz0-9.,\s+\-eE]+$/, "d must be a valid SVG path string"),
    fill: z.string().max(60).default("none"),
    stroke: z.string().max(60).optional(),
    strokeWidth: z.number().min(0).max(20).optional(),
    strokeDasharray: z.string().max(40).optional(),
    strokeLinecap: z.enum(["butt", "round", "square"]).optional(),
    strokeLinejoin: z.enum(["miter", "round", "bevel"]).optional(),
    opacity: z.number().min(0).max(1).optional(),
  })
  .strict();

/** Icon: reference to a pre-built icon in the library (id) at a given
 *  size. The library entry contains the path `d` + viewBox. */
export const IconSchema = z
  .object({
    id: z.enum(["heart", "spacecraft", "leopard", "sunflower", "flame", "lightning", "leaf", "star", "raindrop", "snowflake"]),
    size: z.number().positive().max(400).default(40),
    fill: z.string().max(60).default("#1f1a14"),
    stroke: z.string().max(60).optional(),
    strokeWidth: z.number().min(0).max(20).optional(),
  })
  .strict();

/** Decorative ellipse — used for sunflower petals, savannah haze, etc. */
export const EllipseSchema = z
  .object({
    rx: z.number().positive().max(800),
    ry: z.number().positive().max(800),
    fill: z.string().max(60),
    stroke: z.string().max(60).optional(),
    strokeWidth: z.number().min(0).max(20).optional(),
    opacity: z.number().min(0).max(1).optional(),
    rotateDeg: z.number().min(-360).max(360).default(0),
  })
  .strict();

/** Polygon — closed shape from an explicit list of points. Used for
 *  the Orion spacecraft body, Reuleaux triangles, etc. */
export const PolygonSchema = z
  .object({
    points: z.array(z.tuple([z.number(), z.number()])).min(3).max(200),
    fill: z.string().max(60).default("none"),
    stroke: z.string().max(60).optional(),
    strokeWidth: z.number().min(0).max(20).optional(),
  })
  .strict();

/** Polyline — open shape from an explicit list of points. */
export const PolylineSchema = z
  .object({
    points: z.array(z.tuple([z.number(), z.number()])).min(2).max(2000),
    fill: z.string().max(60).default("none"),
    stroke: z.string().max(60).default("#1f1a14"),
    strokeWidth: z.number().min(0).max(20).default(1),
    strokeDasharray: z.string().max(40).optional(),
  })
  .strict();

/** Raw SVG escape hatch for plugin marks that need primitives the
 *  SceneMark set doesn't cover (e.g. <filter>, <mask>, advanced
 *  gradient stop chains). STRICTLY size-capped + regex-allowlisted
 *  to block <script>, <foreignObject>, <image>, javascript:, on*=
 *  event handlers. The 4 KB cap stops one DoS spec from inflating
 *  the SVG. */
const SAFE_SVG_REGEX = /^(?:(?!<\s*(?:script|foreignObject|image)\b)(?!\bon[a-z]+\s*=)(?!\bjavascript:)[\s\S])*$/i;
export const RawSvgSchema = z
  .object({
    xml: z.string().min(1).max(4096).refine(
      (s) => SAFE_SVG_REGEX.test(s),
      "raw-svg xml contains forbidden tags (script, foreignObject, image) or event handlers",
    ),
  })
  .strict();

export type GradientStop = z.infer<typeof GradientStopSchema>;
export type GradientDef = z.infer<typeof GradientDefSchema>;
export type PatternElement = z.infer<typeof PatternElementSchema>;
export type PatternDef = z.infer<typeof PatternDefSchema>;
export type ComposeDefs = z.infer<typeof ComposeDefsSchema>;
export type StarfieldConfig = z.infer<typeof StarfieldSchema>;
export type GlowConfig = z.infer<typeof GlowSchema>;
export type SilhouettePathConfig = z.infer<typeof SilhouettePathSchema>;
export type IconConfig = z.infer<typeof IconSchema>;
export type EllipseConfig = z.infer<typeof EllipseSchema>;
export type PolygonConfig = z.infer<typeof PolygonSchema>;
export type PolylineConfig = z.infer<typeof PolylineSchema>;
export type RawSvgConfig = z.infer<typeof RawSvgSchema>;

/** Top-level compose spec. */
export const ComposeChildSchema = z
  .object({
    /** Absolute position on the parent canvas (top-left origin, SVG y-down). */
    at: z.object({
      x: z.number().refine(Number.isFinite, "compose child x must be finite"),
      y: z.number().refine(Number.isFinite, "compose child y must be finite"),
    }),
    /**
     * Optional size for the child. Currently used by `chart` children
     * to inset the embedded chart at this size (the chart's own
     * viewBox is scaled to fit).
     */
    size: z
      .object({
        w: z.number().positive(),
        h: z.number().positive(),
      })
      .optional(),
    /** Optional id — emitted on the outer group `<g>` so other marks
     *  (motion-along-path, attribute-animate via `set href`, etc.) can
     *  reference this child. */
    id: z.string().min(1).max(60).optional(),
    /** Which schematic mark this child renders, or `chart` for an embedded chart spec. */
    mark: z.enum([
      "frame",
      "gear",
      "pendulum",
      "annotation-leader",
      "chart",
      "circle",
      "text",
      "heart-icon",
      "slider-crank",
      "wankel-rotor",
      // RFC #9 additions
      "starfield",
      "glow",
      "silhouette-path",
      "icon",
      "ellipse",
      "polygon",
      "polyline",
      "raw-svg",
    ]),
    /** Mark-specific config; exactly one of these must match `mark`. */
    frame: FrameMarkSchema.optional(),
    gear: GearMarkSchema.optional(),
    pendulum: PendulumMarkSchema.optional(),
    annotation: AnnotationMarkSchema.optional(),
    circle: CircleMarkSchema.optional(),
    textMark: TextMarkSchema.optional(),
    heartIcon: HeartIconSchema.optional(),
    sliderCrank: SliderCrankSchema.optional(),
    wankelRotor: WankelRotorSchema.optional(),
    // RFC #9 additions
    starfield: StarfieldSchema.optional(),
    glow: GlowSchema.optional(),
    silhouettePath: SilhouettePathSchema.optional(),
    icon: IconSchema.optional(),
    ellipse: EllipseSchema.optional(),
    polygon: PolygonSchema.optional(),
    polyline: PolylineSchema.optional(),
    rawSvg: RawSvgSchema.optional(),
    /**
     * `chart` mark: a nested Glyph chart spec (data + layers). The
     * compose compiler recursively calls compileSpec on this spec
     * and places the resulting Scene at `at.{x, y}` scaled to
     * `size.{w, h}`. The recursion is one-level deep — a chart spec
     * cannot itself contain a compose. Validated as `unknown` here
     * so we don't pull in the full GlyphSpecSchema (avoiding a
     * circular import); the compiler defers to parseSpec.
     */
    chart: z.unknown().optional(),
    /** RFC #6 — optional looping animation on this child. */
    animation: LoopAnimationSchema,
  })
  .strict()
  .refine(
    (c) => {
      if (c.mark === "frame") return c.frame !== undefined;
      if (c.mark === "gear") return c.gear !== undefined;
      if (c.mark === "pendulum") return c.pendulum !== undefined;
      if (c.mark === "annotation-leader") return c.annotation !== undefined;
      if (c.mark === "chart") return c.chart !== undefined && c.size !== undefined;
      if (c.mark === "circle") return c.circle !== undefined;
      if (c.mark === "text") return c.textMark !== undefined;
      if (c.mark === "heart-icon") return c.heartIcon !== undefined;
      if (c.mark === "slider-crank") return c.sliderCrank !== undefined;
      if (c.mark === "wankel-rotor") return c.wankelRotor !== undefined;
      if (c.mark === "starfield") return c.starfield !== undefined;
      if (c.mark === "glow") return c.glow !== undefined;
      if (c.mark === "silhouette-path") return c.silhouettePath !== undefined;
      if (c.mark === "icon") return c.icon !== undefined;
      if (c.mark === "ellipse") return c.ellipse !== undefined;
      if (c.mark === "polygon") return c.polygon !== undefined;
      if (c.mark === "polyline") return c.polyline !== undefined;
      if (c.mark === "raw-svg") return c.rawSvg !== undefined;
      return false;
    },
    {
      message:
        "compose child: the mark field must have a matching config block (chart needs both `chart` and `size`)",
    },
  );

export const ComposeSpecSchema = z
  .object({
    version: z.literal("glyph/0.1").optional(),
    title: z.string().max(120).optional(),
    /** Long-form accessibility description emitted as `<desc>` inside
     *  the root `<svg>`. Mirrors the chart-spec a11y contract. */
    description: z.string().max(800).optional(),
    /** Canvas dimensions in SVG user units. */
    viewBox: z.object({
      width: z.number().int().positive().max(4000),
      height: z.number().int().positive().max(4000),
    }),
    /** Theme / brand. RFC #8 adds the pencil-parchment preset. */
    theme: ComposeThemeSchema,
    /** RFC #9 — `<defs>` block: gradients + patterns referenced by id. */
    defs: ComposeDefsSchema,
    /** RFC #11 — click-to-replay event triggering on the root <svg>. */
    replayOnClick: z.boolean().default(false).optional(),
    /** Children — at least one. Cap at 64 to prevent DoS specs. */
    children: z.array(ComposeChildSchema).min(1).max(64),
  })
  .strict();

export type ComposeSpec = z.infer<typeof ComposeSpecSchema>;
export type ComposeChild = z.infer<typeof ComposeChildSchema>;
export type LoopAnimation = z.infer<typeof LoopAnimationSchema>;
export type FrameMarkConfig = z.infer<typeof FrameMarkSchema>;
export type GearMarkConfig = z.infer<typeof GearMarkSchema>;
export type PendulumMarkConfig = z.infer<typeof PendulumMarkSchema>;
export type AnnotationMarkConfig = z.infer<typeof AnnotationMarkSchema>;
export type CircleMarkConfig = z.infer<typeof CircleMarkSchema>;
export type TextMarkConfig = z.infer<typeof TextMarkSchema>;
export type HeartIconConfig = z.infer<typeof HeartIconSchema>;
export type SliderCrankConfig = z.infer<typeof SliderCrankSchema>;
export type WankelRotorConfig = z.infer<typeof WankelRotorSchema>;

/**
 * Discriminator: is this raw input a compose spec or a chart spec?
 * Used by the top-level parser entry point. A compose spec has a
 * top-level `compose` field OR a top-level `viewBox + children`
 * structure. Currently we use the `compose` wrapper to keep the
 * discrimination unambiguous.
 *
 * `parseAnySpec(raw)` (in compose.ts entry) dispatches:
 *   if (raw.compose)        → ComposeSpec  via parseComposeSpec
 *   else if (raw.layers)    → GlyphSpec   via parseSpec (existing)
 *   else                    → schema error
 */
export function isComposeRaw(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null) return false;
  return "compose" in raw;
}

export function parseComposeSpec(raw: unknown): ComposeSpec {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("parseComposeSpec: raw must be an object");
  }
  const wrapped = raw as { compose?: unknown };
  if (!wrapped.compose) {
    throw new Error("parseComposeSpec: missing top-level `compose` field");
  }
  return ComposeSpecSchema.parse(wrapped.compose);
}
