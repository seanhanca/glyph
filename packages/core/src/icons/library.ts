/**
 * RFC #9 — built-in icon library.
 *
 * Each entry is a unit-sized SVG path `d` string in a [-0.5, +0.5]
 * coordinate space, so the compiler can scale it to any `size` via
 * a transform on the wrapping group. The library covers the common
 * decorative subjects used across the Life-in-Glyph heroes plus a
 * small set of future-proof generics (flame, lightning, leaf, star,
 * raindrop, snowflake).
 *
 * Adding a new icon: add an entry here with its unit-sized path and
 * an entry to the `IconSchema` enum. No compiler/renderer changes.
 */

export interface IconEntry {
  /** Unit-sized SVG path d-string in [-0.5, +0.5] coordinate space. */
  readonly d: string;
  /** ViewBox bounds in unit-space — usually [-0.5, -0.5, 1, 1]. */
  readonly viewBox: readonly [number, number, number, number];
}

/* eslint-disable max-len */

/** Classic heart shape — two upper lobes, V-shaped point at the bottom. */
const HEART: IconEntry = {
  d: "M 0 0.32 C -0.42 0.06, -0.65 -0.18, -0.42 -0.4 C -0.2 -0.58, 0 -0.42, 0 -0.24 C 0 -0.42, 0.2 -0.58, 0.42 -0.4 C 0.65 -0.18, 0.42 0.06, 0 0.32 Z",
  viewBox: [-0.5, -0.5, 1, 1],
};

/** Stylized spacecraft (capsule + thruster cone). */
const SPACECRAFT: IconEntry = {
  d: "M 0.4 0 L -0.2 -0.22 L -0.36 -0.16 L -0.4 0 L -0.36 0.16 L -0.2 0.22 Z M -0.2 -0.22 L -0.2 0.22",
  viewBox: [-0.5, -0.5, 1, 1],
};

/** Leopard side-profile silhouette (head + body + tail outline). */
const LEOPARD: IconEntry = {
  d: "M -0.42 0.08 C -0.42 -0.02, -0.36 -0.12, -0.28 -0.12 C -0.22 -0.14, -0.16 -0.12, -0.14 -0.08 C -0.1 -0.14, -0.04 -0.16, 0.02 -0.14 L 0.06 -0.1 C 0.14 -0.14, 0.24 -0.14, 0.3 -0.1 C 0.34 -0.06, 0.36 0, 0.34 0.04 C 0.4 0.06, 0.42 0.1, 0.38 0.16 C 0.34 0.2, 0.28 0.22, 0.24 0.2 C 0.16 0.24, 0.04 0.22, -0.08 0.18 C -0.18 0.16, -0.28 0.14, -0.36 0.1 C -0.4 0.08, -0.42 0.08, -0.42 0.08 Z",
  viewBox: [-0.5, -0.5, 1, 1],
};

/** Sunflower silhouette — head + 8 petal lobes. */
const SUNFLOWER: IconEntry = {
  d: "M 0 -0.46 L 0.12 -0.24 L 0.36 -0.32 L 0.26 -0.08 L 0.46 0.06 L 0.24 0.12 L 0.32 0.36 L 0.08 0.24 L 0 0.46 L -0.08 0.24 L -0.32 0.36 L -0.24 0.12 L -0.46 0.06 L -0.26 -0.08 L -0.36 -0.32 L -0.12 -0.24 Z M 0 -0.18 C 0.1 -0.18, 0.18 -0.1, 0.18 0 C 0.18 0.1, 0.1 0.18, 0 0.18 C -0.1 0.18, -0.18 0.1, -0.18 0 C -0.18 -0.1, -0.1 -0.18, 0 -0.18 Z",
  viewBox: [-0.5, -0.5, 1, 1],
};

/** Flame — teardrop with curled tip pointing up. */
const FLAME: IconEntry = {
  d: "M 0 -0.46 C 0.1 -0.3, 0.24 -0.2, 0.22 -0.04 C 0.2 0.14, 0.12 0.28, 0 0.34 C -0.12 0.28, -0.2 0.14, -0.22 -0.04 C -0.24 -0.2, -0.1 -0.3, 0 -0.46 Z",
  viewBox: [-0.5, -0.5, 1, 1],
};

/** Lightning bolt — jagged Z shape. */
const LIGHTNING: IconEntry = {
  d: "M -0.06 -0.46 L -0.3 0.04 L -0.08 0.04 L -0.18 0.46 L 0.3 -0.08 L 0.06 -0.08 L 0.22 -0.46 Z",
  viewBox: [-0.5, -0.5, 1, 1],
};

/** Leaf — almond-shape with central vein implied by stroke. */
const LEAF: IconEntry = {
  d: "M -0.4 0.16 C -0.4 -0.16, -0.16 -0.4, 0.16 -0.4 C 0.4 -0.4, 0.4 -0.16, 0.16 0.16 C -0.16 0.4, -0.4 0.4, -0.4 0.16 Z",
  viewBox: [-0.5, -0.5, 1, 1],
};

/** Five-pointed star. */
const STAR: IconEntry = {
  d: "M 0 -0.46 L 0.108 -0.142 L 0.438 -0.142 L 0.171 0.054 L 0.272 0.372 L 0 0.176 L -0.272 0.372 L -0.171 0.054 L -0.438 -0.142 L -0.108 -0.142 Z",
  viewBox: [-0.5, -0.5, 1, 1],
};

/** Raindrop. */
const RAINDROP: IconEntry = {
  d: "M 0 -0.46 C 0.18 -0.18, 0.24 0, 0.24 0.16 C 0.24 0.32, 0.12 0.42, 0 0.42 C -0.12 0.42, -0.24 0.32, -0.24 0.16 C -0.24 0, -0.18 -0.18, 0 -0.46 Z",
  viewBox: [-0.5, -0.5, 1, 1],
};

/** Six-arm snowflake. */
const SNOWFLAKE: IconEntry = {
  d: "M 0 -0.46 L 0 0.46 M -0.4 -0.23 L 0.4 0.23 M -0.4 0.23 L 0.4 -0.23 M -0.06 -0.4 L 0 -0.46 L 0.06 -0.4 M -0.06 0.4 L 0 0.46 L 0.06 0.4 M -0.36 -0.27 L -0.4 -0.23 L -0.34 -0.17 M 0.36 -0.17 L 0.4 -0.23 L 0.34 -0.27 M -0.36 0.17 L -0.4 0.23 L -0.34 0.27 M 0.36 0.27 L 0.4 0.23 L 0.34 0.17",
  viewBox: [-0.5, -0.5, 1, 1],
};

/* eslint-enable max-len */

export const ICON_LIBRARY: Readonly<Record<string, IconEntry>> = Object.freeze({
  heart: HEART,
  spacecraft: SPACECRAFT,
  leopard: LEOPARD,
  sunflower: SUNFLOWER,
  flame: FLAME,
  lightning: LIGHTNING,
  leaf: LEAF,
  star: STAR,
  raindrop: RAINDROP,
  snowflake: SNOWFLAKE,
});
