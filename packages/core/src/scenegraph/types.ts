/**
 * Scenegraph — the intermediate representation between the compiler and the
 * renderers. Each renderer (SVG / Canvas / WebGL) consumes the same Scene
 * structure, so they produce equivalent output for the same input.
 *
 * Phase 0 marks: rect (bar), circle (point). Line, path, area follow when
 * those grammar marks ship.
 *
 * Interactivity (opt-in via spec.interactive):
 *   - data-bound marks carry an optional `key` (stable row identity) and an
 *     optional `dataAttrs` map. The SVG renderer emits these as `data-*`
 *     attributes so the static SVG is also a queryable artifact. A
 *     browser-side `@glyph/live` package hydrates these for click/brush
 *     handlers; an MCP `glyph_drill` verb derives WHERE clauses from them.
 *   - When `interactive` is unset, no extra attributes are emitted and the
 *     snapshot tests remain byte-identical.
 */

/** Optional per-mark metadata for data-bound rendering. */
export interface MarkData {
  /** Stable row identity; emitted as `data-key`. */
  readonly key?: string;
  /**
   * Channel-name → bound value map. Emitted as `data-<channel>="<value>"`.
   * Channel names are lowercased and constrained to [a-z0-9_-]; values are
   * coerced to strings.
   */
  readonly dataAttrs?: Readonly<Record<string, string | number>>;
  /**
   * Optional plain-text tooltip rendered as an SVG `<title>` child. Browsers
   * + assistive tech surface it natively on hover. Zero JS, deterministic.
   */
  readonly tooltip?: string;
}

/** A single drawn primitive. */
export type SceneMark =
  | ({
      readonly type: "rect";
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly fill: string;
      readonly stroke?: string;
      readonly strokeWidth?: number;
      /**
       * Moat PR3 — when set, the renderer emits `stroke-dasharray="<value>"`.
       * Used by the missing-data callout marker to visually distinguish the
       * "data is missing here" rect from a real data bar.
       */
      readonly strokeDasharray?: string;
      /**
       * Joy of Math E1 — corner radius (px). When set, the renderer emits
       * `rx="<value>"` so the rect reads as a rounded bubble (annotation
       * mark) rather than a sharp-cornered data rect. Existing rect
       * consumers leave this undefined and render unchanged.
       */
      readonly rx?: number;
    } & MarkData)
  | ({
      readonly type: "circle";
      readonly cx: number;
      readonly cy: number;
      readonly r: number;
      readonly fill: string;
      readonly stroke?: string;
      readonly strokeWidth?: number;
      /**
       * E2 — optional opacity override (used by traveler trail circles
       * to fade from tail to head). Other circle marks leave this
       * undefined so existing snapshots stay byte-identical.
       */
      readonly opacity?: number;
      /**
       * E2 — when set, the SVG renderer emits an `<animateMotion>`
       * child that drives this circle along a referenced `<path>`
       * (matched by `pathId`). `durationMs` is the loop period;
       * optional `beginMs` shifts the start (used by trail offsets so
       * the tail trails behind the head).
       */
      readonly motion?: {
        readonly pathId: string;
        readonly durationMs: number;
        readonly beginMs?: number;
      };
    } & MarkData)
  | {
      readonly type: "text";
      readonly x: number;
      readonly y: number;
      readonly text: string;
      readonly fontSize: number;
      readonly fill: string;
      readonly anchor: "start" | "middle" | "end";
      readonly baseline: "hanging" | "middle" | "alphabetic";
      /**
       * Moat PR3 — optional `<title>` tooltip rendered as a child of the
       * text element. Used by the missing-data callout marker (a "✕" glyph
       * with "Missing value at x=<value>" hover text) for accessibility.
       * Other text marks leave this undefined; the renderer treats it
       * as a no-op when absent, so existing snapshots stay byte-identical.
       */
      readonly tooltip?: string;
    }
  | {
      readonly type: "line";
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly stroke: string;
      readonly strokeWidth: number;
    }
  | {
      /**
       * A multi-point polyline / area. The `d` attribute is a fully formed
       * SVG path command string (e.g. "M 10 20 L 30 40 L 50 60"). Renderers
       * emit it verbatim. Glyph's compiler builds these for `line` (open
       * stroke) and `area` (closed fill) marks.
       */
      readonly type: "path";
      readonly d: string;
      readonly stroke?: string;
      readonly strokeWidth?: number;
      readonly fill?: string;
      readonly opacity?: number;
      /**
       * Moat PR3 — when set, the renderer emits `stroke-dasharray="<value>"`.
       * Used by the line-mark interpolated-segment overlay so the bridge
       * across a missing-data gap is visually distinct from solid data.
       */
      readonly strokeDasharray?: string;
      /**
       * E2 — when set, the SVG renderer emits `id="<id>"` on the path
       * element so other marks (today: a traveler `<animateMotion>`
       * with `<mpath xlink:href="#id"/>`) can reference it. Undefined
       * on every existing path so snapshots stay byte-identical.
       */
      readonly id?: string;
    }
  | ({
      /**
       * PR66 — a single annular sector (pie slice / donut slice / arc).
       * Drawn by the compiler when polar coordinates are active. Angles
       * in radians, measured clockwise from 12-o'clock (matches D3.arc).
       * Renderer emits a single `<path d="…A…">` with the elliptical-arc
       * SVG command, closed when innerRadius === 0 (pie) or with an
       * inner arc when > 0 (donut).
       */
      readonly type: "arc";
      readonly cx: number;
      readonly cy: number;
      readonly innerRadius: number;
      readonly outerRadius: number;
      readonly startAngle: number;
      readonly endAngle: number;
      readonly fill: string;
      readonly stroke?: string;
      readonly strokeWidth?: number;
    } & MarkData)
  | {
      /**
       * Math PR3 — oriented arrow. Drawn by the `vector-field` mark
       * compiler. `x, y` is the tail anchor (the row's (x, y) in pixel
       * space); the head extends `length` pixels along `angle` radians.
       * The renderer emits a `<line>` with `marker-end="url(#glyph-arrow)"`;
       * the marker definition is added once to the SVG `<defs>` when any
       * arrow is present in the scene.
       */
      readonly type: "arrow";
      readonly x: number;
      readonly y: number;
      readonly length: number;
      readonly angle: number;
      readonly stroke: string;
      readonly strokeWidth?: number;
    }
  | {
      /**
       * RFC #5 — `group` mark for scene composition. A group wraps a
       * sequence of child marks and an optional translate + optional
       * looping animation. The renderer emits this as a `<g transform=
       * "translate(...)">…children…<animateTransform .../></g>`. Used
       * by `compileCompose` (one group per scene child) so each child
       * can carry its own animation independently of its siblings.
       */
      readonly type: "group";
      readonly translateX: number;
      readonly translateY: number;
      /**
       * Optional uniform / per-axis scale applied AFTER translate
       * (so the children are scaled about the group's local origin,
       * not the parent's). Used to embed a nested chart at a custom
       * size while preserving the chart's internal scale resolution.
       */
      readonly scaleX?: number;
      readonly scaleY?: number;
      readonly children: ReadonlyArray<SceneMark>;
      /**
       * Pre-rendered SMIL XML (the output of one of the emitters in
       * `src/animation/loops.ts`). Inserted verbatim inside the `<g>`
       * so SVG viewers run the animation. Undefined for static groups.
       */
      readonly loopAnimationXml?: string;
      /** RFC #9 — optional id emitted on the `<g>` element. */
      readonly id?: string;
    }
  | {
      /** RFC #9 — gradient def emitted inside the SVG `<defs>` block.
       *  Compiler walks the spec's `defs.gradients` and emits one of
       *  these per gradient. Renderer collects all gradient-def marks
       *  into a single `<defs>` block at the start of the output. */
      readonly type: "gradient-def";
      readonly id: string;
      readonly kind: "linear" | "radial";
      readonly attrs: Record<string, string>;
      readonly stops: ReadonlyArray<{
        readonly offset: string;
        readonly color: string;
        readonly opacity?: number;
      }>;
    }
  | {
      /** RFC #9 — pattern def emitted inside the SVG `<defs>` block. */
      readonly type: "pattern-def";
      readonly id: string;
      readonly width: number;
      readonly height: number;
      readonly patternTransform?: string;
      readonly children: ReadonlyArray<SceneMark>;
    }
  | {
      /** RFC #9 — ellipse primitive (sunflower petals, savannah haze). */
      readonly type: "ellipse";
      readonly cx: number;
      readonly cy: number;
      readonly rx: number;
      readonly ry: number;
      readonly fill: string;
      readonly stroke?: string;
      readonly strokeWidth?: number;
      readonly opacity?: number;
      readonly rotateDeg?: number;
    }
  | {
      /** RFC #9 — polygon primitive (closed shape from point list). */
      readonly type: "polygon";
      readonly points: ReadonlyArray<readonly [number, number]>;
      readonly fill: string;
      readonly stroke?: string;
      readonly strokeWidth?: number;
    }
  | {
      /** RFC #9 — polyline primitive (open shape from point list). */
      readonly type: "polyline";
      readonly points: ReadonlyArray<readonly [number, number]>;
      readonly fill: string;
      readonly stroke: string;
      readonly strokeWidth: number;
      readonly strokeDasharray?: string;
    }
  | {
      /** RFC #9 — raw-svg escape hatch. The xml string is inserted
       *  verbatim. Validated upstream by the schema's allowlist regex. */
      readonly type: "raw-svg";
      readonly xml: string;
    };

/**
 * PR61 (PLAN item 2.3) — uncertainty signals attached to a Scene. Set by
 * the compiler when the input `provenance` indicates the underlying data
 * has fewer rows than the threshold, or `confidence != "high"`. The
 * renderer reads this to emit:
 *   - hatched fills on `rect` (bar) marks
 *   - reduced opacity on `circle` (point) marks
 *   - a top-right badge: "n=N · confidence: low|medium|high"
 *
 * When unset, the renderer's output is byte-identical to prior baselines.
 */
export interface SceneUncertainty {
  /** Coarse tier; drives badge text + whether to dim/hatch. */
  readonly confidence: "low" | "medium" | "high";
  /** Sample count used for the badge ("n=…"). */
  readonly sampleRows: number;
  /** True when bars should be drawn hatched. */
  readonly hatchBars: boolean;
  /** True when points should render at reduced opacity. */
  readonly dimPoints: boolean;
  /** Optional one-line override text for the badge. */
  readonly note?: string;
}

/** A single tick on an axis. */
export interface AxisTick {
  readonly position: number; // pixel offset along the axis
  readonly label: string;
}

/** An axis is a derived collection of marks; carried explicitly so renderers can style consistently. */
export interface SceneAxis {
  readonly orientation: "bottom" | "left" | "right";
  readonly origin: { readonly x: number; readonly y: number };
  readonly length: number;
  readonly ticks: ReadonlyArray<AxisTick>;
  readonly label?: string;
  /**
   * Optional grid tick positions; renderers draw a thin grid line at each
   * one across the plot area. Currently only emitted for the left (primary)
   * y axis. When undefined, no grid is drawn.
   */
  readonly gridTicks?: ReadonlyArray<AxisTick>;
  /**
   * Optional rotation (degrees, negative = counterclockwise) applied to each
   * tick label. Set by the compiler when labels are too long to fit
   * horizontally — typically -30° to -45° for bottom axes with long
   * categorical strings.
   */
  readonly tickRotation?: number;
}

/** Schema metadata emitted at the SVG root level for interactive scenes. */
export interface SceneSchema {
  /** Encoded channel → source-field name. */
  readonly fields: Readonly<Record<string, string>>;
  /** When set, the SVG carries `data-handle="<id>"` for `@glyph/live` to find. */
  readonly handleId?: string;
  /**
   * PR77 (D3 Gap 8) — declarative interaction flags. The renderer emits
   * `data-glyph-zoom / lasso / voronoi="true"` on the SVG root so
   * `@glyph/live` knows what hydration to apply. Pure-fn → byte-stable.
   */
  readonly zoomable?: boolean;
  readonly lassoable?: boolean;
  readonly voronoiHover?: boolean;
  /**
   * Moat 5/5 — declarative crossfilter group id. When set, every
   * data-bound mark in the scene carries
   *   `data-crossfilter-group="<id>"` and
   *   `data-crossfilter-key="<key>"`
   * (the per-row key value lives in `MarkData.dataAttrs["crossfilter-key"]`).
   * The renderer emits a small `<style>` block driving same-chart
   * hover highlight via CSS attribute selectors. Cross-chart linkage
   * is hydrated by `@glyph/live` reading the same data-attrs.
   */
  readonly crossfilterGroup?: string;
}

/** A single legend entry — one row of color/label. */
export interface LegendEntry {
  readonly label: string;
  readonly color: string;
}

/** A legend rendered on the right of the plot area. */
export interface SceneLegend {
  readonly kind: "color";
  /** Source-field name (used as the legend title). */
  readonly title: string;
  /** Pixel coordinate of the top-left of the legend block. */
  readonly origin: { readonly x: number; readonly y: number };
  readonly entries: ReadonlyArray<LegendEntry>;
}

/**
 * A facet panel — one cell in a small-multiples grid. Each panel carries
 * its own marks + axes; coordinates are already absolute (SVG-space), so
 * the renderer just iterates them.
 */
export interface ScenePanel {
  readonly title: string;
  readonly titleX: number;
  readonly titleY: number;
  readonly plotArea: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly marks: ReadonlyArray<SceneMark>;
  readonly axes: ReadonlyArray<SceneAxis>;
}

/**
 * Moat PR1 — Cryptographic provenance seal. Computed by the compiler at
 * the end of every compile path; emitted by the SVG renderer as an
 * `<metadata id="glyph-provenance">` child of the root. Same shape as
 * `ProvenanceBlock` in `../render/provenance.ts`; declared here without
 * importing to keep the dependency direction (renderer → scenegraph)
 * one-way.
 */
export interface SceneProvenance {
  readonly format: "glyph-provenance/1";
  readonly specHash: string;
  readonly dataHash: string | null;
  readonly libraryVersion: string;
  readonly rowCount: number;
  readonly scaleDigest: string;
  /** Opt-in ISO 8601 timestamp; omitted by default so SVG bytes stay stable. */
  readonly generatedAt?: string;
}

/** The complete scene a renderer consumes. */
export interface Scene {
  readonly width: number;
  readonly height: number;
  readonly background: string;
  readonly plotArea: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly axes: ReadonlyArray<SceneAxis>;
  readonly marks: ReadonlyArray<SceneMark>;
  readonly title?: string;
  /**
   * E4 review IMPORTANT-1 — resolved text colors propagated from the
   * theme so the renderer can paint titles + axis labels + legend
   * labels in colors that contrast against the chart background.
   * Previously titles + axis labels were hardcoded `#1a1a1a` / `#333`,
   * which read as dark-on-dark under any dark theme (`"dark"`,
   * `corporate-brand-dark`, `"3b1b"`).
   *
   * `textPrimary` — used for the chart title (theme.fg, primary).
   * `textMuted` — used for axis labels + legend labels + panel
   *   titles (theme.axis, the muted secondary text color).
   *
   * Optional so test scenes / morph snapshots without a resolved
   * theme fall back to the hardcoded `#1a1a1a` / `#333` (preserves
   * byte-identity on existing snapshot fixtures that don't set
   * an explicit theme block).
   */
  readonly textPrimary?: string;
  readonly textMuted?: string;
  /**
   * Moat PR1 — cryptographic provenance seal. Optional only for
   * scenes built by tests / morph-from snapshots / non-spec callers;
   * `compileSpec` always sets it.
   */
  readonly provenance?: SceneProvenance;
  /** When set, the renderer emits data-* attributes for interactivity. */
  readonly schema?: SceneSchema;
  /** Optional legends (color/size/opacity). Renderer places them on the right. */
  readonly legends?: ReadonlyArray<SceneLegend>;
  /**
   * When set, the scene is a faceted grid. `marks` + `axes` at the top level
   * are unused; the renderer iterates `panels` instead. Each panel carries
   * its own absolute-coordinate marks + axes.
   */
  readonly panels?: ReadonlyArray<ScenePanel>;
  /**
   * Optional data-driven animation hint (PR43 + PR45). The renderer
   * applies CSS / SMIL based on the kind:
   *   - "stage"          — chart-wide entrance fade
   *   - "stage-stagger"  — per-mark delay = row-index × stagger_ms
   *   - "race"           — per-mark SMIL <animate> across N frames
   *   - "scrub"          — frame metadata only; UI handled by @glyph/live
   * `frames` is populated by the compiler for "race"/"scrub": the i-th
   * entry holds the per-mark values at frame i.
   */
  /**
   * PR61 (PLAN item 2.3) — uncertainty signals derived from
   * `CompileInput.provenance`. Renderer-visible. Optional — undefined
   * keeps all existing snapshots byte-identical.
   */
  readonly uncertainty?: SceneUncertainty;
  readonly animation?:
    | {
        readonly kind: "stage" | "stage-stagger";
        readonly duration_ms: number;
        readonly stagger_ms?: number;
      }
    | {
        readonly kind: "race" | "scrub";
        readonly duration_ms: number;
        readonly frame_field: string;
        readonly frames: ReadonlyArray<{
          /** Frame label (the distinct frame_field value). */
          readonly label: string;
          /** Per-row values keyed by row index in the scene's marks. */
          readonly values: ReadonlyArray<number>;
        }>;
      }
    | {
        /**
         * PR74 (D3 Gap 3) — morph between two scene states. The renderer
         * emits SMIL `<animate>` elements on each mark interpolating
         * from `fromMarks[i]` → current `marks[i]`. Mark types must align
         * by index (a rect must morph to a rect, etc.).
         */
        readonly kind: "morph";
        readonly duration_ms: number;
        /**
         * The "from" marks. Positionally aligned to the scene's `marks`
         * — same length, same type per index. Built by `morphScenes()`
         * in the compiler module.
         */
        readonly fromMarks: ReadonlyArray<SceneMark>;
      }
    | {
        /**
         * Math Phase 2 / Track A2 — pen-draw effect for path marks. The
         * renderer computes each path's polyline length, sets
         * `stroke-dasharray` + `stroke-dashoffset` to that length, and
         * emits a SMIL `<animate>` driving the offset to zero over
         * `duration_ms`. The line traces itself from start to end.
         */
        readonly kind: "draw-in";
        readonly duration_ms: number;
        readonly easing?: "linear" | "ease-in-out";
      }
    | {
        /**
         * E3 — timeline animation. Sequenced scenes that fade in groups
         * of marks at declared beats. The compiler resolves each spec
         * scene's `layers: number[]` into `markIndices: number[]` (the
         * positions in `Scene.marks` that the scene owns). The renderer
         * wraps each `markIndices` group in a `<g class="glyph-scene-…">`
         * with a child SMIL `<animate attributeName="opacity">` driving
         * fade-in at `begin_ms` ms over `duration_ms` ms.
         */
        readonly kind: "timeline";
        readonly scenes: ReadonlyArray<{
          readonly id?: string;
          readonly begin_ms: number;
          readonly duration_ms: number;
          /**
           * Resolved mark-index list — every `Scene.marks` position the
           * scene controls. Computed by the compiler from the spec's
           * `layers: number[]` + the per-layer mark count.
           */
          readonly markIndices: ReadonlyArray<number>;
          readonly caption?: string;
        }>;
      };
}
