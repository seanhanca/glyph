/**
 * Tests for the geo projection helpers (PR42 + PR44).
 */
import { describe, expect, it } from "vitest";
import {
  type GeoFeature,
  buildGraticule,
  featureToPath,
  isGeoMark,
  projector,
  ringToPath,
} from "./index.js";

describe("isGeoMark", () => {
  it("returns true for geo-point and geo-region", () => {
    expect(isGeoMark("geo-point")).toBe(true);
    expect(isGeoMark("geo-region")).toBe(true);
  });
  it("returns false for non-geo marks", () => {
    for (const m of ["bar", "line", "point", "area", "rule", "rect", "geo"]) {
      expect(isGeoMark(m)).toBe(false);
    }
  });
});

describe("projector — equirectangular", () => {
  it("maps the center (0,0) to the frame center", () => {
    const project = projector(
      { type: "equirectangular", center: [0, 0] },
      { width: 640, height: 400 },
    );
    const [x, y] = project(0, 0);
    expect(x).toBe(320);
    expect(y).toBe(200);
  });

  it("maps lon=+90, lat=0 to the right half of the frame", () => {
    const project = projector({ type: "equirectangular" }, { width: 360, height: 180 });
    const [x, y] = project(90, 0);
    expect(x).toBe(270); // 180 + 90
    expect(y).toBe(90);
  });

  it("maps lat=+45 above center (smaller y in screen space)", () => {
    const project = projector({ type: "equirectangular" }, { width: 360, height: 180 });
    const [, y] = project(0, 45);
    expect(y).toBe(45);
  });

  it("is deterministic — same args → same pixels", () => {
    const project = projector(
      { type: "equirectangular", center: [10, 20], scale: 2 },
      { width: 100, height: 100 },
    );
    expect(project(5, 5)).toEqual(project(5, 5));
  });
});

describe("projector — mercator", () => {
  it("maps the center (0,0) to the frame center", () => {
    const project = projector({ type: "mercator", center: [0, 0] }, { width: 640, height: 400 });
    const [x, y] = project(0, 0);
    expect(x).toBeCloseTo(320, 6);
    expect(y).toBeCloseTo(200, 6);
  });

  it("clamps extreme latitudes near ±85° to avoid mercator's singularity", () => {
    const project = projector({ type: "mercator" }, { width: 640, height: 400 });
    const [, yClampedHi] = project(0, 89.9);
    const [, yClampedAt85] = project(0, 85);
    // 89.9° gets clamped to 85°, so its y matches 85°'s y.
    expect(yClampedHi).toBeCloseTo(yClampedAt85, 6);
  });
});

describe("projector — defaults", () => {
  it("falls back to equirectangular when projection is undefined", () => {
    const project = projector(undefined, { width: 360, height: 180 });
    const [x, y] = project(0, 0);
    expect(x).toBe(180);
    expect(y).toBe(90);
  });
});

describe("projector — naturalEarth (PR44)", () => {
  it("maps (0,0) close to the frame center", () => {
    const project = projector({ type: "naturalEarth" }, { width: 640, height: 400 });
    const [x, y] = project(0, 0);
    expect(x).toBeCloseTo(320, 1);
    expect(y).toBeCloseTo(200, 1);
  });
  it("compresses near the poles (smaller |y-delta| than equirectangular)", () => {
    const ne = projector({ type: "naturalEarth" }, { width: 640, height: 400 });
    // |y(80°) - y(0°)| should be < |y(40°) - y(0°)| × 2 because of compression.
    const [, y0] = ne(0, 0);
    const [, y40] = ne(0, 40);
    const [, y80] = ne(0, 80);
    expect(Math.abs(y80 - y0)).toBeLessThan(2 * Math.abs(y40 - y0));
  });
});

describe("projector — albersUsa (PR44)", () => {
  it("maps the projection center (−98°, 38°) roughly to the frame center", () => {
    const project = projector(
      { type: "albersUsa", center: [-98, 38], scale: 100 },
      { width: 640, height: 400 },
    );
    const [x, y] = project(-98, 38);
    // Albers at the projection origin lands at (cx, cy + offset) — y can
    // have a small offset due to rho0, but should be near center.
    expect(x).toBeCloseTo(320, 0);
    expect(y).toBeCloseTo(200, 0);
  });
  it("places NY (~-74, 40) to the right of LA (~-118, 34)", () => {
    const project = projector({ type: "albersUsa", scale: 100 }, { width: 640, height: 400 });
    const [xNY] = project(-74, 40);
    const [xLA] = project(-118, 34);
    expect(xNY).toBeGreaterThan(xLA);
  });
});

describe("featureToPath (PR44)", () => {
  const project = projector(undefined, { width: 360, height: 180 });

  it("renders a single Polygon as a closed SVG path", () => {
    const feature: GeoFeature = {
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
            [0, 0],
          ],
        ],
      },
    };
    const d = featureToPath(feature, project);
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    // 5 vertices → 1 M + 4 L commands.
    expect(d.match(/L/g)?.length).toBe(4);
  });

  it("renders a MultiPolygon as concatenated closed paths", () => {
    const feature: GeoFeature = {
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          [
            [
              [0, 0],
              [5, 0],
              [5, 5],
              [0, 0],
            ],
          ],
          [
            [
              [10, 10],
              [15, 10],
              [15, 15],
              [10, 10],
            ],
          ],
        ],
      },
    };
    const d = featureToPath(feature, project);
    // Two polygons → two M…Z subpaths.
    expect(d.match(/M/g)?.length).toBe(2);
    expect(d.match(/Z/g)?.length).toBe(2);
  });

  it("returns empty string for unknown geometry types (defensive)", () => {
    const feature: GeoFeature = {
      geometry: { type: "Point", coordinates: [0, 0] },
    };
    expect(featureToPath(feature, project)).toBe("");
  });
});

describe("ringToPath (PR44)", () => {
  it("emits the expected M + L sequence", () => {
    const project = projector(undefined, { width: 360, height: 180 });
    // identity in the equirectangular default at width=360
    const ring: ReadonlyArray<readonly [number, number]> = [
      [0, 0],
      [10, 0],
    ];
    const d = ringToPath(ring, project);
    expect(d).toMatch(/^M\d/);
    expect(d).toContain("L");
    expect(d.endsWith("Z")).toBe(true);
  });
});

describe("buildGraticule (PR44)", () => {
  it("emits 13 meridians + 5 parallels at step=30°", () => {
    const project = projector(undefined, { width: 640, height: 400 });
    const grat = buildGraticule(project, { step: 30 });
    // Meridians: -180 to 180 step 30 = 13 lines.
    // Parallels: -60 to 60 step 30 = 5 lines.
    expect(grat.paths.length).toBe(18);
    for (const p of grat.paths) {
      expect(p.startsWith("M")).toBe(true);
      expect(p.endsWith("Z")).toBe(false); // open paths
    }
  });
});

// ---------------------------------------------------------------------------
// TopoJSON (PR57)
// ---------------------------------------------------------------------------

import { topoToGeo } from "./index.js";

describe("topoToGeo (PR57)", () => {
  it("decodes a quantized TopoJSON polygon back to GeoJSON Polygon", () => {
    // Tiny synthetic topology: one square polygon decoded from quantized
    // delta-coords with a top-level transform.
    const topology = {
      type: "Topology",
      objects: {
        states: {
          type: "GeometryCollection",
          geometries: [
            {
              type: "Polygon",
              properties: { id: "us-1" },
              arcs: [[0]],
            },
          ],
        },
      },
      // Arc 0: starts at quantized (0,0), then deltas to (10,0), (0,10), (-10,0), (0,-10).
      // After decode + transform (scale=1, translate=0) we get 5 corner points.
      arcs: [
        [
          [0, 0],
          [10, 0],
          [0, 10],
          [-10, 0],
          [0, -10],
        ],
      ],
      transform: { scale: [1, 1] as const, translate: [0, 0] as const },
    };
    const fc = topoToGeo(topology, "states");
    expect(fc.features.length).toBe(1);
    const f = fc.features[0];
    expect(f?.geometry.type).toBe("Polygon");
    // The polygon's outer ring has 5 points.
    const ring = (f?.geometry.coordinates as ReadonlyArray<ReadonlyArray<[number, number]>>)[0];
    expect(ring?.length).toBe(5);
    // Bottom-left corner should be at (0, 0) after decode.
    expect(ring?.[0]).toEqual([0, 0]);
    // After 4 deltas (10, 0), (0, 10), (-10, 0), (0, -10), should return to origin.
    expect(ring?.[4]).toEqual([0, 0]);
  });

  it("handles MultiPolygon via nested arc indices", () => {
    const topology = {
      type: "Topology",
      objects: {
        regions: {
          type: "GeometryCollection",
          geometries: [
            {
              type: "MultiPolygon",
              properties: { id: "multi-1" },
              arcs: [[[0]], [[1]]],
            },
          ],
        },
      },
      arcs: [
        [
          [0, 0],
          [5, 0],
          [0, 5],
          [-5, 0],
          [0, -5],
        ],
        [
          [10, 10],
          [3, 0],
          [0, 3],
          [-3, 0],
          [0, -3],
        ],
      ],
    };
    const fc = topoToGeo(topology, "regions");
    expect(fc.features[0]?.geometry.type).toBe("MultiPolygon");
    const polys = fc.features[0]?.geometry.coordinates as ReadonlyArray<
      ReadonlyArray<ReadonlyArray<[number, number]>>
    >;
    expect(polys.length).toBe(2);
  });

  it("falls back to first object when objectName is omitted", () => {
    const topology = {
      type: "Topology",
      objects: {
        only: {
          type: "GeometryCollection",
          geometries: [
            {
              type: "Polygon",
              arcs: [[0]],
            },
          ],
        },
      },
      arcs: [
        [
          [0, 0],
          [1, 0],
          [0, 1],
        ],
      ],
    };
    expect(topoToGeo(topology).features.length).toBe(1);
  });

  it("throws when the named object doesn't exist", () => {
    const topology = {
      type: "Topology",
      objects: { only: { type: "GeometryCollection", geometries: [] } },
      arcs: [],
    };
    expect(() => topoToGeo(topology, "missing")).toThrow(/no object named/i);
  });

  it("supports reverse arcs (negative indices ~i)", () => {
    const topology = {
      type: "Topology",
      objects: {
        s: {
          type: "GeometryCollection",
          geometries: [
            { type: "Polygon", arcs: [[~0]] }, // arc 0 reversed
          ],
        },
      },
      arcs: [
        [
          [0, 0],
          [10, 0],
          [0, 10],
        ],
      ],
    };
    const ring = (
      topoToGeo(topology).features[0]?.geometry.coordinates as ReadonlyArray<
        ReadonlyArray<[number, number]>
      >
    )[0];
    // Reverse of decoded [(0,0),(10,0),(10,10)] = [(10,10),(10,0),(0,0)].
    expect(ring?.[0]).toEqual([10, 10]);
    expect(ring?.[ring.length - 1]).toEqual([0, 0]);
  });
});
