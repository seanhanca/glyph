/**
 * Geo viz primitives — PR42.
 *
 * v0 supports two pure-math projections (equirectangular and Mercator) for
 * the new `geo-point` mark. No external GIS dependency. The projection
 * functions are deterministic and snapshot-testable.
 *
 * Usage from the compiler:
 *   const project = projector(spec.projection, { width, height });
 *   const [x, y] = project(lon, lat);
 *
 * lat is in degrees, range [-90, 90]
 * lon is in degrees, range [-180, 180]
 *
 * Output (x, y) is in pixel space inside the chart's drawing area.
 */

import type { Projection } from "../spec/types.js";

const DEG2RAD = Math.PI / 180;

/** A projector takes (lon, lat) in degrees and returns [x, y] in pixels. */
export type Projector = (lon: number, lat: number) => [number, number];

/** Bounds the projector renders into — typically the chart's plot area. */
export interface ProjectionFrame {
  readonly width: number;
  readonly height: number;
}

/**
 * Build a projector for a Projection config + an output frame. When
 * `projection` is undefined, defaults to equirectangular centered at (0, 0).
 */
export function projector(projection: Projection | undefined, frame: ProjectionFrame): Projector {
  const cfg = projection ?? { type: "equirectangular" as const };
  const [cLon, cLat] = cfg.center ?? [0, 0];

  if (cfg.type === "equirectangular") {
    // Map lon ∈ [-180, 180] → x ∈ [0, width]; lat ∈ [-90, 90] → y ∈ [0, height]
    // (inverted so north appears up). Center is applied as an offset.
    const scale = cfg.scale ?? frame.width / 360;
    const cx = frame.width / 2 - cLon * scale;
    const cy = frame.height / 2 + cLat * scale;
    return (lon, lat) => [cx + lon * scale, cy - lat * scale];
  }

  // Mercator. Output is clamped to ±85° latitude (the classic mercator
  // singularity at the poles). Scale is per radian.
  const scale = cfg.scale ?? frame.width / (2 * Math.PI);
  const cxBase = frame.width / 2 - cLon * DEG2RAD * scale;
  const cyBase = frame.height / 2 + mercatorY(cLat) * scale;
  return (lon, lat) => {
    const clamped = Math.max(-85, Math.min(85, lat));
    const x = cxBase + lon * DEG2RAD * scale;
    const y = cyBase - mercatorY(clamped) * scale;
    return [x, y];
  };
}

function mercatorY(latDeg: number): number {
  const latRad = latDeg * DEG2RAD;
  return Math.log(Math.tan(Math.PI / 4 + latRad / 2));
}

/**
 * Determine whether a mark identifier is a geo mark. Used by the compiler
 * to dispatch to the projection path.
 */
export function isGeoMark(mark: string): boolean {
  return mark === "geo-point";
}
