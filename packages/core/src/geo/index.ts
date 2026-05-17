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
 *
 * Four projections supported (PR44):
 *   - equirectangular: linear lon→x, lat→y
 *   - mercator: log-tan latitude with ±85° clamp
 *   - naturalEarth: smooth pseudocylindrical (good for world maps)
 *   - albersUsa: composite albers projection for the US 48 + AK + HI
 */
export function projector(projection: Projection | undefined, frame: ProjectionFrame): Projector {
  const cfg = projection ?? { type: "equirectangular" as const };
  const [cLon, cLat] = cfg.center ?? [0, 0];

  if (cfg.type === "equirectangular") {
    const scale = cfg.scale ?? frame.width / 360;
    const cx = frame.width / 2 - cLon * scale;
    const cy = frame.height / 2 + cLat * scale;
    return (lon, lat) => [cx + lon * scale, cy - lat * scale];
  }

  if (cfg.type === "mercator") {
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

  if (cfg.type === "naturalEarth") {
    // Natural Earth projection (Šavrič et al. 2011). Pseudocylindrical,
    // good for world overviews. Coefficient-based; no iteration.
    const scale = cfg.scale ?? frame.width / 6.28;
    const cx = frame.width / 2 - cLon * 0 * scale;
    const cy = frame.height / 2;
    return (lon, lat) => {
      const lonR = (lon - cLon) * DEG2RAD;
      const latR = lat * DEG2RAD;
      const phi2 = latR * latR;
      const phi4 = phi2 * phi2;
      const x =
        cx +
        lonR *
          (0.870_7 -
            0.131_979 * phi2 -
            0.013_791 * phi4 +
            phi2 * phi2 * (0.003_971 * phi2 - 0.001_529 * phi4)) *
          scale;
      const y =
        cy -
        latR *
          (1.007_226 +
            phi2 * (0.015_085 + phi4 * (-0.044_475 + 0.028_874 * phi2 - 0.005_916 * phi4))) *
          scale;
      return [x, y];
    };
  }

  // albersUsa — composite of three Albers conic-equal-area projections
  // (US 48 + Alaska + Hawaii). v0 is a simplified single-Albers tuned to
  // the contiguous 48 with the standard parallels (29.5°, 45.5°). Alaska
  // and Hawaii points fall outside the rendered area; a follow-up adds
  // the proper composite insets.
  const scale = cfg.scale ?? frame.width;
  const phi1 = 29.5 * DEG2RAD;
  const phi2 = 45.5 * DEG2RAD;
  const lambda0 = (cLon || -98) * DEG2RAD;
  const phi0 = (cLat || 38) * DEG2RAD;
  const n = (Math.sin(phi1) + Math.sin(phi2)) / 2;
  const C = Math.cos(phi1) * Math.cos(phi1) + 2 * n * Math.sin(phi1);
  const rho0 = Math.sqrt(C - 2 * n * Math.sin(phi0)) / n;
  const cx = frame.width / 2;
  const cy = frame.height / 2;
  return (lon, lat) => {
    const lonR = lon * DEG2RAD;
    const latR = lat * DEG2RAD;
    const rho = Math.sqrt(C - 2 * n * Math.sin(latR)) / n;
    const theta = n * (lonR - lambda0);
    const x = cx + rho * Math.sin(theta) * scale;
    const y = cy + (rho0 - rho * Math.cos(theta)) * scale;
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
  return mark === "geo-point" || mark === "geo-region";
}

// ---------------------------------------------------------------------------
// GeoJSON support — PR44
// ---------------------------------------------------------------------------

/** A single [lon, lat] coordinate pair. */
export type LonLat = readonly [number, number];

/** A GeoJSON-like polygon feature. We support Polygon + MultiPolygon. */
export interface GeoFeature {
  readonly type?: string;
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly geometry: {
    readonly type: "Polygon" | "MultiPolygon" | string;
    /** For Polygon: [ring][point][lon,lat]. For MultiPolygon: one level deeper. */
    readonly coordinates: ReadonlyArray<unknown>;
  };
}

/** A GeoJSON FeatureCollection (or array-of-features for terseness). */
export interface GeoFeatureCollection {
  readonly type?: string;
  readonly features: ReadonlyArray<GeoFeature>;
}

/**
 * Project a single polygon ring + emit an SVG path-d string. Each ring is
 * `M x0 y0 L x1 y1 L x2 y2 ... Z`.
 */
export function ringToPath(ring: ReadonlyArray<LonLat>, project: Projector): string {
  if (ring.length === 0) return "";
  let d = "";
  for (let i = 0; i < ring.length; i++) {
    const pair = ring[i];
    if (!pair) continue;
    const [lon, lat] = pair;
    const [x, y] = project(lon, lat);
    d += i === 0 ? `M${x.toFixed(2)},${y.toFixed(2)}` : `L${x.toFixed(2)},${y.toFixed(2)}`;
  }
  d += "Z";
  return d;
}

/**
 * Project a Polygon or MultiPolygon feature to an SVG path-d string. Outer
 * ring + holes are concatenated; SVG's `evenodd` fill-rule handles them.
 */
export function featureToPath(feature: GeoFeature, project: Projector): string {
  const g = feature.geometry;
  if (!g || !Array.isArray(g.coordinates)) return "";
  if (g.type === "Polygon") {
    const rings = g.coordinates as ReadonlyArray<ReadonlyArray<LonLat>>;
    return rings.map((r) => ringToPath(r, project)).join("");
  }
  if (g.type === "MultiPolygon") {
    const multi = g.coordinates as ReadonlyArray<ReadonlyArray<ReadonlyArray<LonLat>>>;
    return multi.map((poly) => poly.map((r) => ringToPath(r, project)).join("")).join("");
  }
  // Unknown geometry — silently empty so a bad feature doesn't blow up
  // the whole render.
  return "";
}

// ---------------------------------------------------------------------------
// Graticule — PR44
// ---------------------------------------------------------------------------

export interface Graticule {
  /** Meridian / parallel paths as SVG `d` attributes. */
  readonly paths: ReadonlyArray<string>;
}

/**
 * Build a lat/lon grid (graticule) for a given projector. `step` is in
 * degrees; defaults to 30°. Each meridian + parallel becomes an SVG path.
 * Useful for orienting world maps.
 */
export function buildGraticule(
  project: Projector,
  options: { readonly step?: number; readonly densify?: number } = {},
): Graticule {
  const step = options.step ?? 30;
  // Densify each line so curved projections (naturalEarth, mercator)
  // render as smooth arcs instead of straight chords.
  const densify = options.densify ?? Math.max(2, Math.round(step / 2));
  const paths: string[] = [];

  // Meridians: lon constant, lat varying −85 → 85.
  for (let lon = -180; lon <= 180; lon += step) {
    const pts: LonLat[] = [];
    for (let i = 0; i <= densify; i++) {
      const lat = -85 + (170 * i) / densify;
      pts.push([lon, lat]);
    }
    paths.push(ringToPathOpen(pts, project));
  }
  // Parallels: lat constant, lon varying −180 → 180.
  for (let lat = -60; lat <= 60; lat += step) {
    const pts: LonLat[] = [];
    for (let i = 0; i <= densify; i++) {
      const lon = -180 + (360 * i) / densify;
      pts.push([lon, lat]);
    }
    paths.push(ringToPathOpen(pts, project));
  }
  return { paths };
}

/** Like `ringToPath` but without the trailing `Z` so the path stays open. */
function ringToPathOpen(ring: ReadonlyArray<LonLat>, project: Projector): string {
  let d = "";
  for (let i = 0; i < ring.length; i++) {
    const pair = ring[i];
    if (!pair) continue;
    const [lon, lat] = pair;
    const [x, y] = project(lon, lat);
    d += i === 0 ? `M${x.toFixed(2)},${y.toFixed(2)}` : `L${x.toFixed(2)},${y.toFixed(2)}`;
  }
  return d;
}
