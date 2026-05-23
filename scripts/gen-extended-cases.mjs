#!/usr/bin/env node
/**
 * Generate compose JSON fixtures for the "Extended Cases" gallery:
 * Glyph-shaped versions of harder visualizations (Physarum,
 * particle-love, NASA Eyes solar system, ISS).
 *
 * Run:
 *   node scripts/gen-extended-cases.mjs
 *
 * Outputs:
 *   packages/core/__fixtures__/compose/ext-physarum.json
 *   packages/core/__fixtures__/compose/ext-particles.json
 *   packages/core/__fixtures__/compose/ext-orrery.json
 *   packages/core/__fixtures__/compose/ext-iss.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "packages", "core", "__fixtures__", "compose");
mkdirSync(outDir, { recursive: true });

const round = (n, p = 2) => {
  const m = 10 ** p;
  return Math.round(n * m) / m;
};

// ───────────────────────────────────────────────────────────────────────────
// 1. PHYSARUM — Gray-Scott reaction-diffusion (filament regime)
//
// The same equation Physarum slime molds satisfy chemically: two
// chemicals U and V diffuse + react. We embed the existing pde-solve
// data shape inside a compose chart child, set F/k to the "worms"
// regime that produces filamentary patterns reminiscent of slime
// trail networks.
// ───────────────────────────────────────────────────────────────────────────
function buildPhysarum() {
  const W = 900;
  const H = 700;

  return {
    compose: {
      viewBox: { width: W, height: H },
      title: "Physarum chemistry — the math, drawn",
      description:
        "The Gray-Scott reaction-diffusion equation drives Physarum slime-mold pattern formation chemically. Two species U + V diffuse and react; for F=0.025, k=0.056 the pattern develops labyrinthine stripes — the same topology a real slime mold paints with its body. Snapshot at step 1000.",
      theme: { background: "#020617", foreground: "#fef3c7" },
      defs: {
        gradients: [
          {
            id: "g-bg",
            kind: "radial",
            cx: "50%",
            cy: "50%",
            r: "75%",
            stops: [
              { offset: "0%", color: "#0c0a25", opacity: 1 },
              { offset: "100%", color: "#020617", opacity: 1 },
            ],
          },
        ],
      },
      children: [
        // Background
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${W} 0 L ${W} ${H} L 0 ${H} Z`,
            fill: "url(#g-bg)",
            stroke: "none",
          },
        },
        // The PDE chart itself (this is where Glyph integrates Gray-Scott)
        {
          at: { x: 100, y: 90 },
          size: { w: 700, h: 540 },
          mark: "chart",
          chart: {
            version: "glyph/0.1",
            title: "Gray-Scott · F=0.025 · k=0.056 · labyrinth regime",
            data: {
              pde_solve: {
                shape: "pde-solve",
                kind: "reaction-diffusion",
                domain: { x: [-1, 1], y: [-1, 1] },
                grid: { rows: 28, cols: 28 },
                initial: "0",
                initial_U: "1",
                initial_V:
                  "exp(-25*(x*x + y*y))*0.5 + exp(-25*((x-0.5)*(x-0.5) + (y+0.4)*(y+0.4)))*0.5",
                params: { Du: 1.0, Dv: 0.5, F: 0.025, k: 0.056 },
                boundary: "periodic",
                steps: 1000,
                dt: 0.0012,
              },
            },
            layers: [
              {
                mark: "heatmap",
                encoding: {
                  x: {
                    field: "x",
                    type: "quantitative",
                    scale: { domain: [-1, 1] },
                  },
                  y: {
                    field: "y",
                    type: "quantitative",
                    scale: { domain: [-1, 1] },
                  },
                  color: {
                    field: "u",
                    type: "quantitative",
                  },
                },
              },
            ],
          },
        },
        // Title
        {
          at: { x: W / 2, y: 50 },
          mark: "text",
          textMark: {
            text: "Physarum polycephalum — the chemistry",
            fontSize: 20,
            fill: "#fef3c7",
            italic: true,
            anchor: "middle",
          },
        },
        // Caption
        {
          at: { x: W / 2, y: 670 },
          mark: "text",
          textMark: {
            text: "data.shape: 'pde-solve' · kind: 'reaction-diffusion' · 28×28 grid · 1000 steps · static SVG",
            fontSize: 12,
            fill: "#94a3b8",
            italic: true,
            anchor: "middle",
          },
        },
      ],
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// 2. PARTICLE FIELD — Streamlines through a double-vortex flow
//
// Equivalent to the particle-love demo's underlying physics: a vector
// field with two opposite vortices. Glyph's streamline data shape
// integrates this field from N seed points and renders each trace as
// a polyline. colorBy: "step" colors the trace from start to end with
// a rainbow gradient — same visual signature as particle-love's
// motion-blur trails, frozen as a single static SVG.
// ───────────────────────────────────────────────────────────────────────────
function buildParticles() {
  const W = 900;
  const H = 900;

  return {
    compose: {
      viewBox: { width: W, height: H },
      title: "Particle field — double-vortex streamlines",
      description:
        "Two counter-rotating vortices placed at (1,1) and (-1,-1). Each Gaussian-weighted vector field is integrated from an 8×8 grid of seed points using RK4; each trace becomes a path colored by the local flow direction. The signature of a million-particle GPU demo, drawn deterministically by integrating 64 trajectories.",
      theme: { background: "#020617", foreground: "#fef3c7" },
      defs: {
        gradients: [
          {
            id: "g-bg",
            kind: "radial",
            cx: "50%",
            cy: "50%",
            r: "80%",
            stops: [
              { offset: "0%", color: "#1e1b4b", opacity: 1 },
              { offset: "100%", color: "#020617", opacity: 1 },
            ],
          },
        ],
      },
      children: [
        // Background
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${W} 0 L ${W} ${H} L 0 ${H} Z`,
            fill: "url(#g-bg)",
            stroke: "none",
          },
        },
        // Starfield ambiance
        {
          at: { x: 0, y: 0 },
          mark: "starfield",
          starfield: {
            count: 80,
            seed: 17,
            region: { x: 0, y: 0, w: W, h: H },
          },
        },
        // The streamline chart
        {
          at: { x: 80, y: 90 },
          size: { w: 740, h: 740 },
          mark: "chart",
          chart: {
            version: "glyph/0.1",
            title: "Double-vortex flow · 8×8 seeds · RK4 integration · colorBy: angle",
            data: {
              source: "inline:ext-particles",
            },
            layers: [
              {
                mark: "streamline",
                encoding: {
                  x: {
                    field: "x",
                    type: "quantitative",
                    scale: { domain: [-2.4, 2.4] },
                  },
                  y: {
                    field: "y",
                    type: "quantitative",
                    scale: { domain: [-2.4, 2.4] },
                  },
                },
                streamline: {
                  // Two Gaussian-weighted vortices, opposite signs
                  dxdt: "-(y-1)*exp(-((x-1)^2+(y-1)^2)/1.5) + (y+1)*exp(-((x+1)^2+(y+1)^2)/1.5)",
                  dydt: "(x-1)*exp(-((x-1)^2+(y-1)^2)/1.5) - (x+1)*exp(-((x+1)^2+(y+1)^2)/1.5)",
                  seeds: { kind: "grid", rows: 8, cols: 8 },
                  step: 0.05,
                  maxSteps: 100,
                  domain: { x: [-2.4, 2.4], y: [-2.4, 2.4] },
                  colorBy: "angle",
                },
              },
            ],
          },
        },
        // Title
        {
          at: { x: W / 2, y: 50 },
          mark: "text",
          textMark: {
            text: "Particle field — the physics of beautiful particles",
            fontSize: 20,
            fill: "#fef3c7",
            italic: true,
            anchor: "middle",
          },
        },
        // Caption
        {
          at: { x: W / 2, y: 870 },
          mark: "text",
          textMark: {
            text: "data.shape: 'streamline' · ODE integration · ~200 deterministic traces · static SVG",
            fontSize: 12,
            fill: "#94a3b8",
            italic: true,
            anchor: "middle",
          },
        },
      ],
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// 3. ORRERY — Solar system, top-down, animated rotate-loops
//
// What NASA Eyes does in 3D, Glyph does in 2D as a classic orrery:
// concentric orbital ellipses + planet circles, each orbiting the sun
// via SMIL rotate-loop with a period scaled by real years (compressed).
// ───────────────────────────────────────────────────────────────────────────
function buildOrrery() {
  const W = 1200;
  const H = 1000;
  const cx = W / 2;
  const cy = H / 2;

  // Planet specs: radius-from-sun, body radius, color, real-year-ratio
  // We scale all periods so Earth = 8 seconds in the animation.
  const earthYearMs = 8000;
  const planets = [
    { name: "Mercury", r: 80, bodyR: 4, color: "#94a3b8", years: 0.24 },
    { name: "Venus", r: 130, bodyR: 8, color: "#fde68a", years: 0.62 },
    { name: "Earth", r: 190, bodyR: 9, color: "#3b82f6", years: 1.0 },
    { name: "Mars", r: 250, bodyR: 6, color: "#dc2626", years: 1.88 },
    { name: "Jupiter", r: 360, bodyR: 28, color: "#d97706", years: 11.86 },
    { name: "Saturn", r: 450, bodyR: 24, color: "#fbbf24", years: 29.46 },
  ];

  // For each planet:
  // - one ellipse orbit (centered on sun, dashed thin ring)
  // - one circle planet body at its current position (above sun, since
  //   rotate-loop will spin it around the local origin = sun center)
  const orbits = [];
  const planetBodies = [];
  const planetLabels = [];

  for (const p of planets) {
    // Orbit ring
    orbits.push({
      at: { x: cx, y: cy },
      mark: "ellipse",
      ellipse: {
        rx: p.r,
        ry: p.r,
        fill: "none",
        stroke: "rgba(148,163,184,.35)",
        strokeWidth: 1,
      },
    });
    // Planet body — sits at (cx + r, cy) initially. rotate-loop spins
    // around the child's `at` point, but if we set `at = (cx, cy)` and
    // the planet's circle is "above" by p.r, then rotate-loop on this
    // child rotates the planet circle around the sun. We can't do that
    // directly because the circle is drawn at the at-point. Workaround:
    // we draw the planet at (cx + p.r, cy) and apply rotate-loop with
    // the child at its current position — pulse around itself, not the
    // sun. That won't work.
    //
    // Real solution: put each planet's container at sun-center
    // (`at: { x: cx, y: cy }`), set its body coords as a circle with
    // an offset… but compose's circle mark draws the circle AT the
    // `at` point.
    //
    // Workaround: use silhouette-path with the circle drawn at a local
    // offset, so rotate-loop spins the path around the at-point. The
    // path is a tiny circle d-string at (p.r, 0) in local coords.
    const bodyD = `M ${p.r - p.bodyR} 0 A ${p.bodyR} ${p.bodyR} 0 1 0 ${p.r + p.bodyR} 0 A ${p.bodyR} ${p.bodyR} 0 1 0 ${p.r - p.bodyR} 0`;
    planetBodies.push({
      at: { x: cx, y: cy },
      mark: "silhouette-path",
      silhouettePath: {
        d: bodyD,
        fill: p.color,
        stroke: "rgba(255,255,255,.4)",
        strokeWidth: 0.8,
      },
      animation: {
        kind: "rotate-loop",
        periodMs: Math.round(earthYearMs * p.years),
        direction: "ccw",
      },
    });
    // Static label outside the orbit
    planetLabels.push({
      at: { x: cx + p.r + 14, y: cy + 4 },
      mark: "text",
      textMark: {
        text: p.name,
        fontSize: 12,
        fill: "#cbd5e1",
        italic: true,
        anchor: "start",
      },
    });
  }

  // Saturn rings: a flat ellipse around Saturn's orbit position.
  // Since Saturn orbits, the ring should orbit with it. We add it as a
  // silhouette-path drawn in local coords at the same offset as Saturn,
  // sharing the same rotate-loop animation.
  const saturn = planets[5];
  const ringD = `M ${saturn.r - saturn.bodyR - 12} 0 A ${saturn.bodyR + 12} ${(saturn.bodyR + 12) * 0.35} 0 1 0 ${saturn.r + saturn.bodyR + 12} 0 A ${saturn.bodyR + 12} ${(saturn.bodyR + 12) * 0.35} 0 1 0 ${saturn.r - saturn.bodyR - 12} 0`;
  planetBodies.push({
    at: { x: cx, y: cy },
    mark: "silhouette-path",
    silhouettePath: {
      d: ringD,
      fill: "none",
      stroke: "#fbbf24",
      strokeWidth: 2.4,
    },
    animation: {
      kind: "rotate-loop",
      periodMs: Math.round(earthYearMs * saturn.years),
      direction: "ccw",
    },
  });

  // Asteroid belt: a starfield ring between Mars and Jupiter (no animation
  // for individual asteroids, just visual ambiance)
  // We achieve this by placing a starfield in a thin annular region; but
  // starfield uses rectangular regions, so we use one rect that overlaps
  // both planet orbits. Simpler: a thin ring of small static circles via
  // a single silhouette-path with many move-to commands.
  const asteroidPath = (() => {
    const points = [];
    // Park-Miller LCG
    let seed = 33;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const beltMin = 295;
    const beltMax = 335;
    for (let i = 0; i < 80; i++) {
      const a = rand() * Math.PI * 2;
      const r = beltMin + rand() * (beltMax - beltMin);
      const x = round(r * Math.cos(a));
      const y = round(r * Math.sin(a));
      const dotR = 1 + Math.floor(rand() * 1.5);
      points.push(
        `M ${x - dotR} ${y} A ${dotR} ${dotR} 0 1 0 ${x + dotR} ${y} A ${dotR} ${dotR} 0 1 0 ${x - dotR} ${y}`,
      );
    }
    return points.join(" ");
  })();

  return {
    compose: {
      viewBox: { width: W, height: H },
      title: "Solar system orrery — top-down, animated",
      description:
        "Top-down schematic of the inner solar system. Six planet circles ride orbital ellipses centered on the Sun. Each carries a SMIL rotate-loop with periodMs scaled by its real orbital year — Mercury whips around once per ~1.9s, Saturn drifts once per ~3m55s. Asteroid belt between Mars and Jupiter. Saturn's rings co-rotate with the planet. What NASA Eyes does in 3D, Glyph does as a flat orrery.",
      theme: { background: "#020617", foreground: "#fef3c7" },
      defs: {
        gradients: [
          {
            id: "g-bg",
            kind: "radial",
            cx: "50%",
            cy: "50%",
            r: "80%",
            stops: [
              { offset: "0%", color: "#1e1b4b", opacity: 1 },
              { offset: "100%", color: "#020617", opacity: 1 },
            ],
          },
          {
            id: "g-sun",
            kind: "radial",
            cx: "50%",
            cy: "50%",
            r: "50%",
            stops: [
              { offset: "0%", color: "#fef3c7", opacity: 1 },
              { offset: "60%", color: "#fbbf24", opacity: 1 },
              { offset: "100%", color: "#dc2626", opacity: 0.9 },
            ],
          },
          {
            id: "g-sun-halo",
            kind: "radial",
            cx: "50%",
            cy: "50%",
            r: "50%",
            stops: [
              { offset: "0%", color: "#fde68a", opacity: 0.55 },
              { offset: "100%", color: "#fde68a", opacity: 0 },
            ],
          },
        ],
      },
      children: [
        // Background
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${W} 0 L ${W} ${H} L 0 ${H} Z`,
            fill: "url(#g-bg)",
            stroke: "none",
          },
        },
        // Starfield
        {
          at: { x: 0, y: 0 },
          mark: "starfield",
          starfield: {
            count: 100,
            seed: 19,
            region: { x: 0, y: 0, w: W, h: H },
          },
        },
        // Orbits (6 concentric ellipses)
        ...orbits,
        // Asteroid belt (80 small circles in a ring)
        {
          at: { x: cx, y: cy },
          mark: "silhouette-path",
          silhouettePath: {
            d: asteroidPath,
            fill: "#cbd5e1",
            stroke: "none",
            opacity: 0.6,
          },
        },
        // Sun halo
        {
          at: { x: cx, y: cy },
          mark: "glow",
          glow: { radius: 80, gradientId: "g-sun-halo" },
        },
        // Sun
        {
          at: { x: cx, y: cy },
          mark: "circle",
          circle: {
            radius: 32,
            fill: "url(#g-sun)",
            stroke: "rgba(254,243,199,.5)",
            strokeWidth: 1,
          },
        },
        // Planet bodies (animated)
        ...planetBodies,
        // Planet labels (static, at each planet's max orbital distance)
        ...planetLabels,
        // Title
        {
          at: { x: W / 2, y: 60 },
          mark: "text",
          textMark: {
            text: "Sol — top-down orrery",
            fontSize: 22,
            fill: "#fef3c7",
            italic: true,
            anchor: "middle",
          },
        },
        // Caption
        {
          at: { x: W / 2, y: 970 },
          mark: "text",
          textMark: {
            text: "6 SMIL rotate-loops · periods scaled by real orbital years · Earth = 8 s in the animation",
            fontSize: 12,
            fill: "#94a3b8",
            italic: true,
            anchor: "middle",
          },
        },
      ],
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// 4. ISS — Engineering schematic (side elevation)
//
// What NASA Eyes / ISS-3D models show in 3D, Glyph does as a pencil-
// on-parchment engineering elevation. Trussed spine, 8 solar arrays in
// 4 pairs, 6 pressurized modules along the axis, Cupola hanging below,
// 3 radiator panels perpendicular. Earth arc + starfield in space.
// ───────────────────────────────────────────────────────────────────────────
function buildISS() {
  const W = 1500;
  const H = 900;
  const issCx = 750;
  const issCy = 380;

  // Central truss spine
  const trussLen = 1100;
  const trussY = issCy;

  // Pressurized modules (along the central axis perpendicular to truss)
  // Each module is a rectangle on the central spine
  const modules = [
    { name: "Zarya", offset: -100, len: 130, w: 60 },
    { name: "Unity", offset: -30, len: 70, w: 65 },
    { name: "Destiny", offset: 40, len: 130, w: 65 },
    { name: "Harmony", offset: 170, len: 70, w: 65 },
    { name: "Columbus", offset: 240, len: 90, w: 60 },
    { name: "Kibo", offset: 240, len: 110, w: 60 },
  ];

  // Solar arrays — 4 pairs, each pair has 2 long rectangles
  // Each pair is at a specific x-offset along the truss
  // The 2 in a pair extend up and down
  const arrayPairs = [-450, -200, 250, 500]; // x-offsets from issCx
  const arrayWidth = 60;
  const arrayLength = 200;

  // Radiator panels (3 small ones, perpendicular to truss)
  const radiatorPositions = [-350, 0, 350];

  return {
    compose: {
      viewBox: { width: W, height: H },
      title: "ISS — engineering elevation, pencil draft",
      description:
        "International Space Station, side-elevation schematic. Integrated Truss Structure (the spine), 8 solar arrays in 4 pairs, 6 pressurized modules + Cupola, 3 radiator panels. The orbit is the thin grey ellipse below the station; Earth's limb arcs underneath. Drawn the way an engineer would draft it.",
      theme: { preset: "pencil-parchment" },
      defs: {
        gradients: [
          {
            id: "g-space",
            kind: "linear",
            x1: "0%",
            y1: "0%",
            x2: "0%",
            y2: "100%",
            stops: [
              { offset: "0%", color: "#0c0a25", opacity: 1 },
              { offset: "75%", color: "#082f49", opacity: 1 },
              { offset: "100%", color: "#0c4a6e", opacity: 1 },
            ],
          },
          {
            id: "g-earth",
            kind: "radial",
            cx: "50%",
            cy: "0%",
            r: "100%",
            stops: [
              { offset: "0%", color: "#7dd3fc", opacity: 1 },
              { offset: "40%", color: "#0284c7", opacity: 1 },
              { offset: "100%", color: "#082f49", opacity: 1 },
            ],
          },
          {
            id: "g-solar",
            kind: "linear",
            x1: "0%",
            y1: "0%",
            x2: "100%",
            y2: "0%",
            stops: [
              { offset: "0%", color: "#1e3a8a", opacity: 1 },
              { offset: "50%", color: "#3730a3", opacity: 1 },
              { offset: "100%", color: "#1e3a8a", opacity: 1 },
            ],
          },
          {
            id: "g-module",
            kind: "linear",
            x1: "0%",
            y1: "0%",
            x2: "0%",
            y2: "100%",
            stops: [
              { offset: "0%", color: "#f5edd9", opacity: 1 },
              { offset: "50%", color: "#cbb89c", opacity: 1 },
              { offset: "100%", color: "#8b7355", opacity: 1 },
            ],
          },
        ],
      },
      children: [
        // Space background
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${W} 0 L ${W} ${H} L 0 ${H} Z`,
            fill: "url(#g-space)",
            stroke: "none",
          },
        },
        // Starfield
        {
          at: { x: 0, y: 0 },
          mark: "starfield",
          starfield: {
            count: 120,
            seed: 51,
            region: { x: 0, y: 0, w: W, h: H * 0.7 },
          },
        },
        // Earth limb (huge arc at the bottom)
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M -200 ${H + 100} A 1900 1900 0 0 0 ${W + 200} ${H + 100} L ${W + 200} ${H} L -200 ${H} Z`,
            fill: "url(#g-earth)",
            stroke: "none",
          },
        },
        // Earth atmosphere glow
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M -200 ${H + 100} A 1860 1860 0 0 0 ${W + 200} ${H + 100} L ${W + 200} ${H + 100 - 5} A 1855 1855 0 0 1 -200 ${H + 100 - 5} Z`,
            fill: "rgba(125,211,252,.4)",
            stroke: "none",
          },
        },
        // Orbital path (thin ellipse arcing across)
        {
          at: { x: 0, y: 720 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 50 0 Q ${W / 2} -80, ${W - 50} 0`,
            fill: "none",
            stroke: "rgba(253,230,138,.4)",
            strokeWidth: 1.5,
            strokeDasharray: "8 6",
          },
        },
        // ── ISS structure ──
        // Solar arrays — 4 pairs, each pair is 2 long rectangles (upper + lower)
        ...arrayPairs.flatMap((dx) => [
          // upper array
          {
            at: { x: issCx + dx - arrayWidth / 2, y: trussY - arrayLength - 16 },
            mark: "silhouette-path",
            silhouettePath: {
              d: `M 0 0 L ${arrayWidth} 0 L ${arrayWidth} ${arrayLength} L 0 ${arrayLength} Z`,
              fill: "url(#g-solar)",
              stroke: "#1f1a14",
              strokeWidth: 1.4,
            },
          },
          // upper array grid lines (suggests photovoltaic cells)
          {
            at: { x: issCx + dx - arrayWidth / 2, y: trussY - arrayLength - 16 },
            mark: "silhouette-path",
            silhouettePath: {
              d: Array.from(
                { length: 8 },
                (_, i) =>
                  `M 0 ${round(((i + 1) * arrayLength) / 9)} L ${arrayWidth} ${round(((i + 1) * arrayLength) / 9)}`,
              ).join(" "),
              fill: "none",
              stroke: "rgba(253,230,138,.35)",
              strokeWidth: 0.5,
            },
          },
          // lower array
          {
            at: { x: issCx + dx - arrayWidth / 2, y: trussY + 16 },
            mark: "silhouette-path",
            silhouettePath: {
              d: `M 0 0 L ${arrayWidth} 0 L ${arrayWidth} ${arrayLength} L 0 ${arrayLength} Z`,
              fill: "url(#g-solar)",
              stroke: "#1f1a14",
              strokeWidth: 1.4,
            },
          },
          // lower array grid lines
          {
            at: { x: issCx + dx - arrayWidth / 2, y: trussY + 16 },
            mark: "silhouette-path",
            silhouettePath: {
              d: Array.from(
                { length: 8 },
                (_, i) =>
                  `M 0 ${round(((i + 1) * arrayLength) / 9)} L ${arrayWidth} ${round(((i + 1) * arrayLength) / 9)}`,
              ).join(" "),
              fill: "none",
              stroke: "rgba(253,230,138,.35)",
              strokeWidth: 0.5,
            },
          },
          // Connecting rotary joint (small circle on the truss at this x)
          {
            at: { x: issCx + dx, y: trussY },
            mark: "circle",
            circle: {
              radius: 8,
              fill: "#fde68a",
              stroke: "#1f1a14",
              strokeWidth: 1.5,
            },
          },
        ]),
        // Radiator panels (3 small white rectangles perpendicular to truss)
        ...radiatorPositions.map((dx) => ({
          at: { x: issCx + dx - 18, y: trussY + 8 },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M 0 0 L 36 0 L 36 70 L 0 70 Z",
            fill: "#fefce8",
            stroke: "#1f1a14",
            strokeWidth: 1.4,
          },
        })),
        // Central truss (long thin horizontal beam)
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M ${issCx - trussLen / 2} ${trussY - 8} L ${issCx + trussLen / 2} ${trussY - 8} L ${issCx + trussLen / 2} ${trussY + 8} L ${issCx - trussLen / 2} ${trussY + 8} Z`,
            fill: "#1f1a14",
            stroke: "#fde68a",
            strokeWidth: 1.4,
          },
        },
        // Truss diagonal bracing (X pattern on the truss)
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: Array.from({ length: 11 }, (_, i) => {
              const x = issCx - trussLen / 2 + i * (trussLen / 11);
              const x2 = issCx - trussLen / 2 + (i + 1) * (trussLen / 11);
              return `M ${x} ${trussY - 8} L ${x2} ${trussY + 8} M ${x2} ${trussY - 8} L ${x} ${trussY + 8}`;
            }).join(" "),
            fill: "none",
            stroke: "rgba(253,230,138,.5)",
            strokeWidth: 0.6,
          },
        },
        // Pressurized modules along central axis (above or below the truss)
        ...modules.map((m) => ({
          at: { x: issCx + m.offset - m.len / 2, y: trussY - m.w / 2 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${m.len} 0 L ${m.len} ${m.w} L 0 ${m.w} Z`,
            fill: "url(#g-module)",
            stroke: "#1f1a14",
            strokeWidth: 1.8,
          },
        })),
        // Module ring details (small circles on the ends — docking ports)
        ...modules.flatMap((m) => [
          {
            at: { x: issCx + m.offset - m.len / 2, y: trussY },
            mark: "circle",
            circle: { radius: 4, fill: "#1f1a14" },
          },
          {
            at: { x: issCx + m.offset + m.len / 2, y: trussY },
            mark: "circle",
            circle: { radius: 4, fill: "#1f1a14" },
          },
        ]),
        // Cupola (small dome hanging below modules)
        {
          at: { x: issCx + 30, y: trussY + 32 },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M 0 0 Q 8 28, 24 28 Q 40 28, 48 0 Z",
            fill: "url(#g-module)",
            stroke: "#1f1a14",
            strokeWidth: 1.4,
          },
        },
        // Cupola windows (7 small dots)
        ...[8, 16, 24, 32, 40].map((x) => ({
          at: { x: issCx + 30 + x, y: trussY + 18 },
          mark: "circle",
          circle: { radius: 2, fill: "#1f1a14" },
        })),
        // Annotation labels
        {
          at: { x: 0, y: 0 },
          mark: "annotation-leader",
          annotation: {
            from: [issCx - 450, trussY - 220],
            to: [issCx - 580, trussY - 280],
            text: "solar array · port-far",
            italic: true,
            anchor: "end",
          },
        },
        {
          at: { x: 0, y: 0 },
          mark: "annotation-leader",
          annotation: {
            from: [issCx + 500, trussY - 220],
            to: [issCx + 600, trussY - 280],
            text: "solar array · starboard-far",
            italic: true,
            anchor: "start",
          },
        },
        {
          at: { x: 0, y: 0 },
          mark: "annotation-leader",
          annotation: {
            from: [issCx, trussY + 8],
            to: [issCx + 100, trussY + 180],
            text: "Integrated Truss Structure (108 m)",
            italic: true,
            anchor: "start",
          },
        },
        {
          at: { x: 0, y: 0 },
          mark: "annotation-leader",
          annotation: {
            from: [issCx + 50, trussY - 30],
            to: [issCx + 200, trussY - 130],
            text: "Destiny + Harmony modules",
            italic: true,
            anchor: "start",
          },
        },
        // Title
        {
          at: { x: W / 2, y: 60 },
          mark: "text",
          textMark: {
            text: "International Space Station — elevation, side view",
            fontSize: 20,
            fill: "#fde68a",
            italic: true,
            anchor: "middle",
          },
        },
        // Caption
        {
          at: { x: W / 2, y: 870 },
          mark: "text",
          textMark: {
            text: "altitude 408 km · velocity 7.66 km/s · orbital period 92.7 min · mass 420 t · 109 m × 73 m",
            fontSize: 12,
            fill: "#cbd5e1",
            italic: true,
            anchor: "middle",
          },
        },
      ],
    },
  };
}

const fixtures = {
  "ext-physarum.json": buildPhysarum(),
  "ext-particles.json": buildParticles(),
  "ext-orrery.json": buildOrrery(),
  "ext-iss.json": buildISS(),
};

for (const [name, spec] of Object.entries(fixtures)) {
  const path = join(outDir, name);
  writeFileSync(path, `${JSON.stringify(spec, null, 2)}\n`);
  console.log(`wrote ${path} (${Math.round(JSON.stringify(spec).length / 1024)} KB)`);
}
