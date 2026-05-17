/**
 * Tests for the geo projection helpers (PR42 — v0).
 */
import { describe, expect, it } from "vitest";
import { isGeoMark, projector } from "./index.js";

describe("isGeoMark", () => {
  it("returns true for geo-point", () => {
    expect(isGeoMark("geo-point")).toBe(true);
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
