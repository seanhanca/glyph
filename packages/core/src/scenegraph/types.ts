/**
 * Scenegraph — the intermediate representation between the compiler and the
 * renderers. Each renderer (SVG / Canvas / WebGL) consumes the same Scene
 * structure, so they produce equivalent output for the same input.
 *
 * Phase 0 marks: rect (bar), circle (point). Line, path, area follow when
 * those grammar marks ship.
 */

/** A single drawn primitive. */
export type SceneMark =
  | {
      readonly type: "rect";
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly fill: string;
      readonly stroke?: string;
      readonly strokeWidth?: number;
    }
  | {
      readonly type: "circle";
      readonly cx: number;
      readonly cy: number;
      readonly r: number;
      readonly fill: string;
      readonly stroke?: string;
      readonly strokeWidth?: number;
    }
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
    };

/** A single tick on an axis. */
export interface AxisTick {
  readonly position: number; // pixel offset along the axis
  readonly label: string;
}

/** An axis is a derived collection of marks; carried explicitly so renderers can style consistently. */
export interface SceneAxis {
  readonly orientation: "bottom" | "left";
  readonly origin: { readonly x: number; readonly y: number };
  readonly length: number;
  readonly ticks: ReadonlyArray<AxisTick>;
  readonly label?: string;
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
}
