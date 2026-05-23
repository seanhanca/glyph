#!/usr/bin/env node
/**
 * Generate the compose JSON fixtures for the new bio + engineering
 * showcases under `__fixtures__/compose/`. These pages extend the
 * Life-in-Glyph gallery without modifying the existing 8 hand-authored
 * heroes.
 *
 * Run from repo root:
 *   node scripts/gen-bio-eng-fixtures.mjs
 *
 * Outputs:
 *   packages/core/__fixtures__/compose/bio-dna.json
 *   packages/core/__fixtures__/compose/bio-jellyfish.json
 *   packages/core/__fixtures__/compose/eng-hydraulic.json
 *   packages/core/__fixtures__/compose/eng-windmill.json
 *
 * Each fixture is consumed by an adjacent `.test.ts` that locks the SVG
 * snapshot via Vitest's `toMatchFileSnapshot`. Each is also wired into
 * a new HTML page under site/math/.
 *
 * Notes on schema (compose v0.1):
 *  - No "schematic" wrapper mark — use bare marks: `frame`, `gear`,
 *    `pendulum`, `annotation-leader` etc.
 *  - Annotation shape: `{ from: [x, y], to: [x, y], text, italic, anchor }`.
 *  - Frame shape: `{ width, height, title?, cornerRadius? }`.
 *  - No "group" mark. Each child carries its own optional `animation`.
 *  - Only `pencil-parchment` preset exists. For dark scenes, override
 *    `theme.background` and lay down a full-canvas silhouette-path.
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
// BIO 1 — DNA double helix
// ───────────────────────────────────────────────────────────────────────────
function buildDna() {
  const W = 600, H = 800;
  const yStart = 60, yEnd = 740;
  const period = 170;      // 4 full periods over the vertical span
  const amplitude = 90;    // strand half-width
  const cx = 300;
  const step = 6;          // sample every 6px in y
  const phase = Math.PI;   // strand B is π out of phase

  // Sample both strands.
  const ptsA = [];
  const ptsB = [];
  for (let y = yStart; y <= yEnd; y += step) {
    const theta = (2 * Math.PI * (y - yStart)) / period;
    ptsA.push([round(amplitude * Math.sin(theta)), round(y - yStart)]);
    ptsB.push([round(amplitude * Math.sin(theta + phase)), round(y - yStart)]);
  }
  const dStrand = (pts) =>
    "M " + pts.map(([x, y]) => `${x} ${y}`).join(" L ");

  // Rungs (base pairs) every 24 px in y. Alternate A-T (blue) and G-C (red).
  const rungs = [];
  const rungStep = 24;
  let rungIdx = 0;
  for (let y = yStart + 12; y <= yEnd - 12; y += rungStep) {
    const theta = (2 * Math.PI * (y - yStart)) / period;
    const ax = amplitude * Math.sin(theta);
    const bx = amplitude * Math.sin(theta + phase);
    // skip rungs where the strands cross (overlapping visually)
    if (Math.abs(ax - bx) < 18) {
      rungIdx++;
      continue;
    }
    const isAT = rungIdx % 2 === 0;
    const left = Math.min(ax, bx);
    rungs.push({
      at: { x: cx + left, y },
      mark: "polyline",
      polyline: {
        points: [[0, 0], [round(Math.abs(bx - ax)), 0]],
        fill: "none",
        stroke: isAT ? "#60a5fa" : "#f87171",
        strokeWidth: 2.2,
      },
    });
    rungIdx++;
  }

  return {
    compose: {
      viewBox: { width: W, height: H },
      title: "DNA double helix — base pairs spiraling in deep space",
      description:
        "Two phosphate-sugar strands wound at ~10 base pairs per turn. Adenine-Thymine rungs in blue, Guanine-Cytosine rungs in red. Background: a deterministic starfield, because life's blueprint is best read against the cosmos that hosts it.",
      theme: { background: "#020617", foreground: "#f1f5fb" },
      defs: {
        gradients: [
          {
            id: "g-bg",
            kind: "radial",
            cx: "50%", cy: "30%", r: "80%",
            stops: [
              { offset: "0%", color: "#1e1b4b", opacity: 1 },
              { offset: "70%", color: "#0f0a2e", opacity: 1 },
              { offset: "100%", color: "#020617", opacity: 1 },
            ],
          },
          {
            id: "g-strand-a",
            kind: "linear",
            x1: "0%", y1: "0%", x2: "0%", y2: "100%",
            stops: [
              { offset: "0%", color: "#22d3ee", opacity: 0.95 },
              { offset: "50%", color: "#a78bfa", opacity: 0.95 },
              { offset: "100%", color: "#ec4899", opacity: 0.95 },
            ],
          },
          {
            id: "g-strand-b",
            kind: "linear",
            x1: "0%", y1: "0%", x2: "0%", y2: "100%",
            stops: [
              { offset: "0%", color: "#ec4899", opacity: 0.95 },
              { offset: "50%", color: "#a78bfa", opacity: 0.95 },
              { offset: "100%", color: "#22d3ee", opacity: 0.95 },
            ],
          },
          {
            id: "g-halo",
            kind: "radial",
            cx: "50%", cy: "50%", r: "50%",
            stops: [
              { offset: "0%", color: "#a78bfa", opacity: 0.55 },
              { offset: "100%", color: "#a78bfa", opacity: 0 },
            ],
          },
        ],
      },
      children: [
        // Background rectangle with radial gradient
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${W} 0 L ${W} ${H} L 0 ${H} Z`,
            fill: "url(#g-bg)",
            stroke: "none",
          },
        },
        // Starfield — deterministic from seed 7
        {
          at: { x: 0, y: 0 },
          mark: "starfield",
          starfield: { count: 60, seed: 7, region: { x: 0, y: 0, w: W, h: H } },
        },
        // Soft purple halo behind the helix
        {
          at: { x: cx, y: H / 2 },
          mark: "glow",
          glow: { radius: 260, gradientId: "g-halo" },
        },
        // Rungs first (so strands draw on top)
        ...rungs,
        // Strand A — silhouette-path with gradient stroke
        {
          at: { x: cx, y: yStart },
          mark: "silhouette-path",
          silhouettePath: {
            d: dStrand(ptsA),
            fill: "none",
            stroke: "url(#g-strand-a)",
            strokeWidth: 4,
          },
        },
        // Strand B
        {
          at: { x: cx, y: yStart },
          mark: "silhouette-path",
          silhouettePath: {
            d: dStrand(ptsB),
            fill: "none",
            stroke: "url(#g-strand-b)",
            strokeWidth: 4,
          },
        },
        // Title text (top)
        {
          at: { x: cx, y: 36 },
          mark: "text",
          textMark: {
            text: "Deoxyribonucleic acid",
            fontSize: 18,
            fill: "#f1f5fb",
            italic: true,
            anchor: "middle",
          },
        },
        // Caption text (bottom)
        {
          at: { x: cx, y: 776 },
          mark: "text",
          textMark: {
            text: "~10 base pairs per turn · A-T (blue) · G-C (red)",
            fontSize: 13,
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
// BIO 2 — Jellyfish in the deep
// ───────────────────────────────────────────────────────────────────────────
function buildJellyfish() {
  const W = 600, H = 800;

  const bellCx = 300;
  const bellCy = 320;
  const bellRx = 130;
  const bellRy = 90;

  // Bell silhouette as a single d-string: dome on top, scalloped bottom.
  const bellD = (() => {
    const pts = [];
    const N = 60;
    // Top arc: -π to 0 (semicircle dome above center, SVG y-down so negative)
    for (let i = 0; i <= N; i++) {
      const t = -Math.PI + (Math.PI * i) / N;
      pts.push([round(bellRx * Math.cos(t)), round(bellRy * Math.sin(t))]);
    }
    // Scalloped bottom: dipped V shapes
    const scallops = 7;
    for (let s = 0; s < scallops; s++) {
      const x0 = bellRx - (2 * bellRx * s) / scallops;
      const x1 = bellRx - (2 * bellRx * (s + 1)) / scallops;
      const xm = (x0 + x1) / 2;
      pts.push([round(xm), round(14)]); // dip down
      pts.push([round(x1), round(0)]);
    }
    return "M " + pts.map(([x, y]) => `${x} ${y}`).join(" L ") + " Z";
  })();

  // Tentacles: long wavy paths from bell bottom down.
  const buildTentacle = (amp, freq, lenY, phase) => {
    const pts = [];
    const stepY = 10;
    for (let y = 0; y <= lenY; y += stepY) {
      const x = amp * Math.sin((freq * y) / 30 + phase) * (y / lenY);
      pts.push([round(x), round(y)]);
    }
    return "M " + pts.map(([x, y]) => `${x} ${y}`).join(" L ");
  };

  const tentacles = [];
  const tentacleCount = 7;
  for (let i = 0; i < tentacleCount; i++) {
    const t = i / (tentacleCount - 1);
    const xOff = -bellRx * 0.85 + 2 * bellRx * 0.85 * t;
    const lenY = 280 + 80 * Math.sin(t * Math.PI);
    const amp = 14 + 6 * Math.sin(t * Math.PI * 3 + 0.3);
    const freq = 2 + 0.7 * Math.sin(t * Math.PI + 1.1);
    const phase = i * 0.5;
    tentacles.push({
      at: { x: bellCx + xOff, y: bellCy + bellRy * 0.05 + 14 },
      mark: "silhouette-path",
      silhouettePath: {
        d: buildTentacle(amp, freq, lenY, phase),
        fill: "none",
        stroke: "url(#g-tentacle)",
        strokeWidth: 1.6,
      },
    });
  }

  // Bioluminescent dots inside the bell
  const dots = [];
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    const ang = -Math.PI + Math.PI * t;
    const r = bellRx * 0.42 * (0.7 + 0.3 * Math.sin(t * Math.PI));
    dots.push({
      at: { x: bellCx + round(r * Math.cos(ang)), y: bellCy + round(r * 0.55 * Math.sin(ang)) },
      mark: "icon",
      icon: { id: "star", size: 8, fill: "#fde68a" },
    });
  }

  // Bubbles drifting up
  const bubbles = [];
  for (let i = 0; i < 14; i++) {
    const t = i / 13;
    const bx = 80 + 440 * t + 30 * Math.sin(t * Math.PI * 3);
    const by = 740 - 180 * Math.sin(t * Math.PI * 2 + 0.2) - 40 * t;
    const sz = 4 + 4 * Math.sin(t * Math.PI * 5 + 1);
    bubbles.push({
      at: { x: round(bx), y: round(by) },
      mark: "circle",
      circle: {
        radius: round(Math.max(2, sz)),
        fill: "rgba(165, 220, 240, 0.35)",
        stroke: "rgba(165, 220, 240, 0.6)",
        strokeWidth: 0.5,
      },
    });
  }

  return {
    compose: {
      viewBox: { width: W, height: H },
      title: "A jellyfish in the deep — bioluminescence in the dark",
      description:
        "Aurelia aurita drifts through midnight water. Translucent bell, seven tentacles trailing sine-modulated curtains, bioluminescent dots inside the medusa. The sea around it is computed: a deep-ocean gradient with no horizon.",
      theme: { background: "#010516", foreground: "#f1f5fb" },
      defs: {
        gradients: [
          {
            id: "g-sea",
            kind: "linear",
            x1: "0%", y1: "0%", x2: "0%", y2: "100%",
            stops: [
              { offset: "0%", color: "#0c1e3a", opacity: 1 },
              { offset: "50%", color: "#04102a", opacity: 1 },
              { offset: "100%", color: "#010516", opacity: 1 },
            ],
          },
          {
            id: "g-bell",
            kind: "radial",
            cx: "50%", cy: "30%", r: "70%",
            stops: [
              { offset: "0%", color: "#fef3c7", opacity: 0.85 },
              { offset: "55%", color: "#f9a8d4", opacity: 0.55 },
              { offset: "100%", color: "#a78bfa", opacity: 0.25 },
            ],
          },
          {
            id: "g-inner",
            kind: "radial",
            cx: "50%", cy: "50%", r: "60%",
            stops: [
              { offset: "0%", color: "#fef9c3", opacity: 0.75 },
              { offset: "100%", color: "#fbbf24", opacity: 0 },
            ],
          },
          {
            id: "g-tentacle",
            kind: "linear",
            x1: "0%", y1: "0%", x2: "0%", y2: "100%",
            stops: [
              { offset: "0%", color: "#f9a8d4", opacity: 0.85 },
              { offset: "100%", color: "#a78bfa", opacity: 0.05 },
            ],
          },
          {
            id: "g-halo",
            kind: "radial",
            cx: "50%", cy: "50%", r: "50%",
            stops: [
              { offset: "0%", color: "#fde68a", opacity: 0.4 },
              { offset: "100%", color: "#fde68a", opacity: 0 },
            ],
          },
        ],
      },
      children: [
        // Sea background
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${W} 0 L ${W} ${H} L 0 ${H} Z`,
            fill: "url(#g-sea)",
            stroke: "none",
          },
        },
        // Plankton specks (starfield repurposed)
        {
          at: { x: 0, y: 0 },
          mark: "starfield",
          starfield: { count: 80, seed: 11, region: { x: 0, y: 0, w: W, h: H } },
        },
        // Halo behind the bell
        {
          at: { x: bellCx, y: bellCy },
          mark: "glow",
          glow: { radius: 220, gradientId: "g-halo" },
        },
        // Tentacles (behind the bell)
        ...tentacles,
        // Bell
        {
          at: { x: bellCx, y: bellCy },
          mark: "silhouette-path",
          silhouettePath: {
            d: bellD,
            fill: "url(#g-bell)",
            stroke: "rgba(254, 240, 196, 0.55)",
            strokeWidth: 1.2,
          },
        },
        // Inner body (oval)
        {
          at: { x: bellCx, y: bellCy - 10 },
          mark: "ellipse",
          ellipse: {
            rx: round(bellRx * 0.55),
            ry: round(bellRy * 0.6),
            fill: "url(#g-inner)",
          },
        },
        // Bioluminescent dots
        ...dots,
        // Bubbles
        ...bubbles,
        // Title (top)
        {
          at: { x: 300, y: 40 },
          mark: "text",
          textMark: {
            text: "Aurelia aurita — light in the deep",
            fontSize: 18,
            fill: "#f1f5fb",
            italic: true,
            anchor: "middle",
          },
        },
        // Caption (bottom)
        {
          at: { x: 300, y: 776 },
          mark: "text",
          textMark: {
            text: "tentacles trail · plankton drift · the medusa glows",
            fontSize: 13,
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
// ENGINEERING 1 — Hydraulic press (Pascal's principle)
// ───────────────────────────────────────────────────────────────────────────
function buildHydraulic() {
  const W = 1000, H = 600;

  // Coordinate layout (single source of truth):
  //   Small cylinder: x=180..260 (w=80),   y=240..480 (h=240)
  //   Large cylinder: x=620..860 (w=240),  y=180..480 (h=300)
  //   Connecting pipe top: y=440 (shared bottom-pipe band)
  //   Fluid extends from piston head (top) down to bottom (y=480)
  const smX = 180, smW = 80, smY = 240, smH = 240;
  const lgX = 620, lgW = 240, lgY = 180, lgH = 300;
  const pipeTop = 440, pipeBot = 480;
  // Piston heads inside cylinders (offset 60 / 80 from cylinder top)
  const smPistonY = smY + 60, smPistonH = 16;
  const lgPistonY = lgY + 80, lgPistonH = 18;

  return {
    compose: {
      viewBox: { width: W, height: H },
      title: "Hydraulic press — Pascal's principle in pencil",
      description:
        "Two pistons of unequal area connected by an incompressible fluid. Push down with force F on the small piston; the large piston pushes up with force F × (A_big / A_small). Pascal, 1647. Why a single foot can lift a car.",
      theme: { preset: "pencil-parchment" },
      defs: {
        patterns: [
          {
            id: "p-fluid",
            width: 6, height: 10,
            children: [
              // Vertical strokes — reads as still water.
              { kind: "line", x1: 0, y1: 0, x2: 0, y2: 10, stroke: "#3b4d80", strokeWidth: 0.5 },
              { kind: "line", x1: 3, y1: 5, x2: 3, y2: 10, stroke: "#3b4d80", strokeWidth: 0.5 },
            ],
          },
          {
            id: "p-piston",
            width: 5, height: 5,
            patternTransform: "rotate(135)",
            children: [
              { kind: "line", x1: 0, y1: 0, x2: 0, y2: 5, stroke: "#1f1a14", strokeWidth: 0.6 },
            ],
          },
        ],
      },
      children: [
        // ── Cylinder bodies (frames, drawn first so fluid pattern reads over) ──
        // Small cylinder (the frame label sits above the title bar)
        {
          at: { x: smX, y: smY },
          mark: "frame",
          frame: { width: smW, height: smH, title: "A₁ — input" },
        },
        // Large cylinder
        {
          at: { x: lgX, y: lgY },
          mark: "frame",
          frame: { width: lgW, height: lgH, title: "A₂ — output (3× wider)" },
        },
        // ── Fluid body (single unified silhouette-path, pattern-filled) ──
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            // U-shape covering both cylinder fluid columns + connecting pipe.
            //   Top-left of small fluid → down → across pipe bottom → up large
            //   right wall → top of large fluid → down left wall of large to
            //   pipe top → across pipe to small right wall → up to start.
            d: [
              `M ${smX + 2} ${smPistonY + smPistonH}`,                // top-left small fluid (just below piston)
              `L ${smX + 2} ${pipeBot - 2}`,                          // down left wall of small fluid
              `L ${lgX + lgW - 2} ${pipeBot - 2}`,                    // across bottom (small + pipe + large)
              `L ${lgX + lgW - 2} ${lgPistonY + lgPistonH}`,          // up right wall of large fluid
              `L ${lgX + 2} ${lgPistonY + lgPistonH}`,                // across top of large fluid (under piston)
              `L ${lgX + 2} ${pipeTop + 2}`,                          // down left wall of large to pipe top
              `L ${smX + smW - 2} ${pipeTop + 2}`,                    // across pipe top
              `L ${smX + smW - 2} ${smPistonY + smPistonH}`,          // up right wall of small fluid
              "Z",
            ].join(" "),
            fill: "url(#p-fluid)",
            stroke: "#1f1a14",
            strokeWidth: 1.4,
          },
        },
        // ── Small piston head (sliding inside the small cylinder) ──
        {
          at: { x: smX + 4, y: smPistonY },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${smW - 8} 0 L ${smW - 8} ${smPistonH} L 0 ${smPistonH} Z`,
            fill: "url(#p-piston)",
            stroke: "#1f1a14",
            strokeWidth: 1.6,
          },
        },
        // Small piston rod (rising through the cylinder cap)
        {
          at: { x: smX + smW / 2 - 8, y: smY - 60 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L 16 0 L 16 ${60 + 5} L 0 ${60 + 5} Z`,
            fill: "#fefce8",
            stroke: "#1f1a14",
            strokeWidth: 1.6,
          },
        },
        // Small piston handle (cap at the top of the rod)
        {
          at: { x: smX - 4, y: smY - 80 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${smW + 8} 0 L ${smW + 8} 20 L 0 20 Z`,
            fill: "#fefce8",
            stroke: "#1f1a14",
            strokeWidth: 1.6,
          },
        },
        // ── Large piston head (sliding inside the large cylinder) ──
        {
          at: { x: lgX + 4, y: lgPistonY },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${lgW - 8} 0 L ${lgW - 8} ${lgPistonH} L 0 ${lgPistonH} Z`,
            fill: "url(#p-piston)",
            stroke: "#1f1a14",
            strokeWidth: 1.6,
          },
        },
        // Large piston rod (rises through cylinder top)
        {
          at: { x: lgX + lgW / 2 - 22, y: lgY - 70 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L 44 0 L 44 ${70 + 8} L 0 ${70 + 8} Z`,
            fill: "#fefce8",
            stroke: "#1f1a14",
            strokeWidth: 1.6,
          },
        },
        // Large piston platform (load plate)
        {
          at: { x: lgX - 16, y: lgY - 90 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${lgW + 32} 0 L ${lgW + 32} 20 L 0 20 Z`,
            fill: "#fefce8",
            stroke: "#1f1a14",
            strokeWidth: 1.6,
          },
        },
        // ── Force arrows ──
        // Down arrow on small piston (input force, F_in)
        {
          at: { x: smX + smW / 2, y: 50 },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M 0 0 L 0 80 M -10 65 L 0 82 L 10 65",
            fill: "none",
            stroke: "#b00020",
            strokeWidth: 2.4,
          },
        },
        // Up arrow on large piston (output force, F_out)
        {
          at: { x: lgX + lgW / 2, y: lgY - 90 },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M 0 0 L 0 -70 M -16 -52 L 0 -74 L 16 -52",
            fill: "none",
            stroke: "#0b6c3a",
            strokeWidth: 4.4,
          },
        },
        // ── Annotations ──
        {
          at: { x: 0, y: 0 },
          mark: "annotation-leader",
          annotation: {
            from: [smX + smW / 2, 40],
            to: [smX - 40, 28],
            text: "F = 1 unit",
            italic: true,
            anchor: "end",
          },
        },
        {
          at: { x: 0, y: 0 },
          mark: "annotation-leader",
          annotation: {
            from: [lgX + lgW / 2, lgY - 170],
            to: [lgX + lgW + 60, lgY - 158],
            text: "≈ 9× the lift",
            italic: true,
            anchor: "start",
          },
        },
        // ── Equation in the middle ──
        {
          at: { x: 440, y: 90 },
          mark: "text",
          textMark: {
            text: "p  =  F₁ / A₁  =  F₂ / A₂",
            fontSize: 24,
            fill: "#1f1a14",
            italic: true,
            anchor: "middle",
          },
        },
        // ── Subtitle ──
        {
          at: { x: 500, y: 555 },
          mark: "text",
          textMark: {
            text: "Pressure equalizes through the fluid. A wider piston turns the same pressure into more force.",
            fontSize: 13,
            fill: "#4a3f30",
            italic: true,
            anchor: "middle",
          },
        },
      ],
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// ENGINEERING 2 — Windmill
// ───────────────────────────────────────────────────────────────────────────
function buildWindmill() {
  const W = 800, H = 800;

  const towerTopY = 350;
  const towerBotY = 700;
  const towerCx = 400;
  const towerTopW = 80;
  const towerBotW = 140;
  const towerD = (() => {
    const x1 = -towerTopW / 2, x2 = towerTopW / 2;
    const x3 = towerBotW / 2, x4 = -towerBotW / 2;
    const h = towerBotY - towerTopY;
    return `M ${x1} 0 L ${x2} 0 L ${x3} ${h} L ${x4} ${h} Z`;
  })();

  const capRx = 56;
  const capRy = 36;
  const capCy = towerTopY - capRy / 2;

  const hubCy = capCy;
  const hubCx = towerCx;
  const bladeLen = 230;
  const bladeWide = 36;

  // Build a single blade polygon in LOCAL coords (blade points to +x).
  // Each blade child has its `at` set to (hubCx, hubCy); animation
  // rotate-loop rotates about that anchor. The polygon's local coords
  // are pre-rotated by the blade angle so that all four blades look
  // different at t=0 but rotate together.
  const localBlade = (ang) => {
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    const localPts = [
      [10, -bladeWide * 0.45],
      [bladeLen * 0.4, -bladeWide * 0.55],
      [bladeLen, -2],
      [bladeLen, 6],
      [bladeLen * 0.4, bladeWide * 0.3],
      [10, bladeWide * 0.45],
    ];
    return localPts.map(([x, y]) => [
      round(x * cos - y * sin),
      round(x * sin + y * cos),
    ]);
  };

  const bladeAngles = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
  const blades = bladeAngles.map((ang) => ({
    at: { x: hubCx, y: hubCy },
    mark: "polygon",
    polygon: {
      points: localBlade(ang),
      fill: "#fef9c3",
      stroke: "#3b3a2a",
      strokeWidth: 1.6,
    },
    animation: { kind: "rotate-loop", periodMs: 8000, direction: "cw" },
  }));

  // Grass tufts at base (decorative polylines)
  const grass = [];
  for (let i = 0; i < 26; i++) {
    const gx = 80 + 26 * i + (i % 3) * 3;
    const gy = 700;
    const len = 24 + (i % 5) * 6;
    const bend = (i % 2 === 0 ? -1 : 1) * (4 + (i % 3) * 2);
    grass.push({
      at: { x: gx, y: gy },
      mark: "polyline",
      polyline: {
        points: [[0, 0], [bend, -round(len * 0.6)], [round(bend * 1.4), -len]],
        fill: "none",
        stroke: "#3a5a3a",
        strokeWidth: 1.6,
      },
    });
  }

  // V-shaped birds high in the sky
  const birds = [];
  for (let i = 0; i < 5; i++) {
    const bx = 540 + 40 * i + (i % 2 === 0 ? 0 : 12);
    const by = 110 + 14 * Math.sin(i * 1.3);
    birds.push({
      at: { x: round(bx), y: round(by) },
      mark: "polyline",
      polyline: {
        points: [[-7, 4], [0, 0], [7, 4]],
        fill: "none",
        stroke: "#1f1a14",
        strokeWidth: 1.4,
      },
    });
  }

  // Clouds (ellipses)
  const clouds = [
    { at: { x: 200, y: 180 }, rx: 50, ry: 16 },
    { at: { x: 600, y: 220 }, rx: 70, ry: 20 },
    { at: { x: 350, y: 90 }, rx: 60, ry: 18 },
  ].map(({ at, rx, ry }) => ({
    at,
    mark: "ellipse",
    ellipse: {
      rx, ry,
      fill: "rgba(255, 255, 255, 0.65)",
    },
  }));

  return {
    compose: {
      viewBox: { width: W, height: H },
      title: "Windmill — turning wind into work",
      description:
        "A four-bladed Dutch-style windmill against a morning sky. Wind from the west turns the blades; sails catch ~30% of available power. Cervantes' giant, Holland's drainage engine, ancestor of every wind farm.",
      theme: { preset: "pencil-parchment" },
      defs: {
        gradients: [
          {
            id: "g-sky",
            kind: "linear",
            x1: "0%", y1: "0%", x2: "0%", y2: "100%",
            stops: [
              { offset: "0%", color: "#fef3c7", opacity: 1 },
              { offset: "60%", color: "#fde9b0", opacity: 1 },
              { offset: "100%", color: "#ebe1c4", opacity: 1 },
            ],
          },
          {
            id: "g-sun",
            kind: "radial",
            cx: "50%", cy: "50%", r: "50%",
            stops: [
              { offset: "0%", color: "#fef9c3", opacity: 1 },
              { offset: "100%", color: "#fbbf24", opacity: 0.95 },
            ],
          },
          {
            id: "g-ground",
            kind: "linear",
            x1: "0%", y1: "0%", x2: "0%", y2: "100%",
            stops: [
              { offset: "0%", color: "#a3b18a", opacity: 1 },
              { offset: "100%", color: "#6b8a4a", opacity: 1 },
            ],
          },
        ],
        patterns: [
          {
            id: "p-stone",
            width: 18, height: 12,
            children: [
              { kind: "line", x1: 0, y1: 0, x2: 18, y2: 0, stroke: "#3b3a2a", strokeWidth: 0.5 },
              { kind: "line", x1: 0, y1: 6, x2: 18, y2: 6, stroke: "#3b3a2a", strokeWidth: 0.5 },
              { kind: "line", x1: 6, y1: 0, x2: 6, y2: 6, stroke: "#3b3a2a", strokeWidth: 0.5 },
              { kind: "line", x1: 12, y1: 6, x2: 12, y2: 12, stroke: "#3b3a2a", strokeWidth: 0.5 },
            ],
          },
        ],
      },
      children: [
        // Sky background
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${W} 0 L ${W} 700 L 0 700 Z`,
            fill: "url(#g-sky)",
            stroke: "none",
          },
        },
        // Ground
        {
          at: { x: 0, y: 700 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${W} 0 L ${W} 100 L 0 100 Z`,
            fill: "url(#g-ground)",
            stroke: "none",
          },
        },
        // Sun
        {
          at: { x: 670, y: 130 },
          mark: "circle",
          circle: { radius: 36, fill: "url(#g-sun)" },
        },
        // Clouds
        ...clouds,
        // Birds
        ...birds,
        // Wind arrow + label
        {
          at: { x: 110, y: 120 },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M 0 0 L 120 0 M 100 -8 L 120 0 L 100 8",
            fill: "none",
            stroke: "#3b4d80",
            strokeWidth: 2,
          },
        },
        {
          at: { x: 170, y: 100 },
          mark: "text",
          textMark: {
            text: "wind",
            fontSize: 14,
            fill: "#3b4d80",
            italic: true,
            anchor: "start",
          },
        },
        // Tower with stone-pattern fill
        {
          at: { x: towerCx, y: towerTopY },
          mark: "silhouette-path",
          silhouettePath: {
            d: towerD,
            fill: "url(#p-stone)",
            stroke: "#1f1a14",
            strokeWidth: 2,
          },
        },
        // Door at base
        {
          at: { x: towerCx - 14, y: towerBotY - 56 },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M 0 0 L 28 0 L 28 56 L 0 56 Z M 14 56 L 14 14",
            fill: "#5a3a1f",
            stroke: "#1f1a14",
            strokeWidth: 1.4,
          },
        },
        // Window
        {
          at: { x: towerCx, y: towerTopY + 70 },
          mark: "circle",
          circle: { radius: 12, fill: "#5a3a1f", stroke: "#1f1a14", strokeWidth: 1.4 },
        },
        // Cap (dome)
        {
          at: { x: towerCx, y: capCy },
          mark: "ellipse",
          ellipse: {
            rx: capRx, ry: capRy,
            fill: "#5a3a1f",
            stroke: "#1f1a14",
            strokeWidth: 2,
          },
        },
        // Hub
        {
          at: { x: hubCx, y: hubCy },
          mark: "circle",
          circle: { radius: 14, fill: "#1f1a14" },
        },
        // Blades — 4 individual children, each rotating around the hub
        ...blades,
        // Grass
        ...grass,
        // Caption
        {
          at: { x: W / 2, y: 766 },
          mark: "text",
          textMark: {
            text: "The same machine that drained the Netherlands powers your laptop today.",
            fontSize: 14,
            fill: "#4a3f30",
            italic: true,
            anchor: "middle",
          },
        },
      ],
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Write all four
// ───────────────────────────────────────────────────────────────────────────
const fixtures = {
  "bio-dna.json": buildDna(),
  "bio-jellyfish.json": buildJellyfish(),
  "eng-hydraulic.json": buildHydraulic(),
  "eng-windmill.json": buildWindmill(),
};

for (const [name, spec] of Object.entries(fixtures)) {
  const path = join(outDir, name);
  writeFileSync(path, JSON.stringify(spec, null, 2) + "\n");
  console.log(`wrote ${path} (${Math.round(JSON.stringify(spec).length / 1024)} KB)`);
}
