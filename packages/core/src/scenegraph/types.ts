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
    } & MarkData)
  | ({
      readonly type: "circle";
      readonly cx: number;
      readonly cy: number;
      readonly r: number;
      readonly fill: string;
      readonly stroke?: string;
      readonly strokeWidth?: number;
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
    };

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
}

/** Schema metadata emitted at the SVG root level for interactive scenes. */
export interface SceneSchema {
  /** Encoded channel → source-field name. */
  readonly fields: Readonly<Record<string, string>>;
  /** When set, the SVG carries `data-handle="<id>"` for `@glyph/live` to find. */
  readonly handleId?: string;
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
  /** When set, the renderer emits data-* attributes for interactivity. */
  readonly schema?: SceneSchema;
  /** Optional legends (color/size/opacity). Renderer places them on the right. */
  readonly legends?: ReadonlyArray<SceneLegend>;
}
