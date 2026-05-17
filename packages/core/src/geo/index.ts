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
// TopoJSON — PR57
// ---------------------------------------------------------------------------

/**
 * TopoJSON topology — minimal type covering the subset used by the
 * `topoToGeo` converter. Real TopoJSON has more fields (bbox, arcs nested
 * deeper for LineString variants, etc); we accept those via index access
 * but only operate on Polygon + MultiPolygon for choropleth use cases.
 */
export interface Topology {
  readonly type: string;
  readonly objects: Readonly<Record<string, unknown>>;
  readonly arcs: ReadonlyArray<ReadonlyArray<readonly [number, number]>>;
  readonly transform?: {
    readonly scale: readonly [number, number];
    readonly translate: readonly [number, number];
  };
}

/**
 * Convert a TopoJSON topology to a GeoFeatureCollection. Supports Polygon
 * and MultiPolygon geometries; arc indexing follows the spec
 * (positive = forward, ~i = reverse). Quantized topologies (with a
 * `transform`) are decoded back to absolute coordinates.
 *
 * Returns features matching the GeoFeature interface, so the result drops
 * straight into `spec.geojson.features` (or is consumed by `featureToPath`).
 *
 * @param topology the parsed TopoJSON object
 * @param objectName the key under `topology.objects` to expand; defaults
 *                   to the first object
 */
export function topoToGeo(topology: Topology, objectName?: string): GeoFeatureCollection {
  const keys = Object.keys(topology.objects);
  const key = objectName ?? keys[0];
  if (!key || !(key in topology.objects)) {
    throw new Error(`Topology has no object named "${objectName ?? "<first>"}"`);
  }
  const obj = topology.objects[key] as {
    type?: string;
    geometries?: ReadonlyArray<TopoGeometry>;
  };
  const transform = topology.transform;
  // Pre-decode every arc to absolute coords. TopoJSON encodes each arc as
  // deltas relative to the previous point, with a top-level transform
  // applied per axis.
  const arcs: ReadonlyArray<ReadonlyArray<LonLat>> = topology.arcs.map((arc) =>
    decodeArc(arc, transform),
  );
  // Each top-level object is typically a GeometryCollection containing per-
  // region geometries. We also tolerate a single geometry directly.
  const geometries: ReadonlyArray<TopoGeometry> =
    obj.type === "GeometryCollection" && Array.isArray(obj.geometries)
      ? obj.geometries
      : [obj as TopoGeometry];
  const features: GeoFeature[] = [];
  for (const g of geometries) {
    const feat = topoGeometryToFeature(g, arcs);
    if (feat) features.push(feat);
  }
  return { type: "FeatureCollection", features };
}

interface TopoGeometry {
  readonly type: string;
  readonly arcs?: ReadonlyArray<unknown>;
  readonly id?: string | number;
  readonly properties?: Readonly<Record<string, unknown>>;
}

/**
 * Decode a single arc's delta-encoded coords back to absolute [lon, lat]
 * pairs. With no transform, the arc is already absolute.
 */
function decodeArc(
  arc: ReadonlyArray<readonly [number, number]>,
  transform: Topology["transform"],
): LonLat[] {
  const out: LonLat[] = [];
  // TopoJSON arcs are always delta-encoded; the optional `transform`
  // adds a per-axis scale + translate to land the cumulative coords in
  // geographic space. Without a transform, the deltas are already in
  // their target coordinate space — but they're still cumulative.
  let x = 0;
  let y = 0;
  for (const pair of arc) {
    if (!pair) continue;
    x += pair[0];
    y += pair[1];
    if (transform) {
      out.push([
        x * transform.scale[0] + transform.translate[0],
        y * transform.scale[1] + transform.translate[1],
      ]);
    } else {
      out.push([x, y]);
    }
  }
  return out;
}

/**
 * Expand a single TopoJSON geometry into a GeoFeature. Polygon + MultiPolygon
 * only — Point/LineString are silently dropped (not used for choropleth).
 */
function topoGeometryToFeature(
  g: TopoGeometry,
  arcs: ReadonlyArray<ReadonlyArray<LonLat>>,
): GeoFeature | undefined {
  if (g.type === "Polygon") {
    const rings = expandRings(g.arcs as ReadonlyArray<ReadonlyArray<number>>, arcs);
    return {
      ...(g.properties !== undefined ? { properties: g.properties } : {}),
      geometry: { type: "Polygon", coordinates: rings },
    };
  }
  if (g.type === "MultiPolygon") {
    const polys = (g.arcs as ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>>).map((poly) =>
      expandRings(poly, arcs),
    );
    return {
      ...(g.properties !== undefined ? { properties: g.properties } : {}),
      geometry: { type: "MultiPolygon", coordinates: polys },
    };
  }
  return undefined;
}

/** Walk a ring's arc indices and concatenate the underlying coord arrays. */
function expandRings(
  ringIndices: ReadonlyArray<ReadonlyArray<number>>,
  arcs: ReadonlyArray<ReadonlyArray<LonLat>>,
): LonLat[][] {
  return ringIndices.map((ring) => {
    const out: LonLat[] = [];
    for (let i = 0; i < ring.length; i++) {
      const idx = ring[i];
      if (idx === undefined) continue;
      // Negative index means the arc is traversed in reverse.
      const arc = idx >= 0 ? arcs[idx] : arcs[~idx];
      if (!arc) continue;
      const points = idx >= 0 ? arc : [...arc].reverse();
      // Skip the first point of all arcs after the first to avoid duplicates
      // at arc junctions.
      const startIdx = i === 0 ? 0 : 1;
      for (let j = startIdx; j < points.length; j++) {
        const p = points[j];
        if (p) out.push(p);
      }
    }
    return out;
  });
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
