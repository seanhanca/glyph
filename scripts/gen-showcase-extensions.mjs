#!/usr/bin/env node
/**
 * Generate compose JSON fixtures for the second wave of Life-in-Glyph
 * showcases: 3 bio + 3 engineering + 3 architecture (a new section).
 *
 * Run from repo root:
 *   node scripts/gen-showcase-extensions.mjs
 *
 * Outputs 9 fixtures under packages/core/__fixtures__/compose/:
 *   bio-neuron.json       — soma + dendrites + axon + glow pulse
 *   bio-butterfly.json    — symmetric 4-winged butterfly with gradients
 *   bio-eye.json          — iris + pupil + lashes (radial gradients)
 *   eng-bridge.json       — suspension bridge with parabolic cables
 *   eng-locomotive.json   — steam locomotive with rotating wheels
 *   eng-radio.json        — concentric pulsing radio waves
 *   arch-temple.json      — Greek temple with Doric columns
 *   arch-cathedral.json   — Gothic cathedral with rose window
 *   arch-skyscraper.json  — modern glass skyscraper at sunset
 *
 * Each fixture is fully self-contained and consumed by the shared
 * showcase-extensions.test.ts which locks SVG snapshots.
 *
 * Conventions (matches gen-bio-eng-fixtures.mjs):
 *  - No "schematic" wrapper mark; use bare marks (frame/gear/...).
 *  - Annotation shape: { from: [x,y], to: [x,y], text, italic, anchor }.
 *  - Only "pencil-parchment" theme preset. Dark scenes override
 *    theme.background and lay down a full-canvas silhouette-path.
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
// BIO — A neuron firing
// ───────────────────────────────────────────────────────────────────────────
function buildNeuron() {
  const W = 1000;
  const H = 500;
  const somaCx = 200;
  const somaCy = 250;
  const somaRx = 60;
  const somaRy = 50;

  // Dendrites: 6 branching paths emanating from the soma to the left.
  // Each one is a hand-sampled path with a primary branch + 2 sub-branches.
  const dendriteBase = (rootAng, mainLen, fan) => {
    // root point on soma perimeter
    const rx = Math.cos(rootAng);
    const ry = Math.sin(rootAng);
    const startX = somaCx + somaRx * 0.95 * rx;
    const startY = somaCy + somaRy * 0.95 * ry;
    // tip
    const tipX = startX + mainLen * rx;
    const tipY = startY + mainLen * ry;
    // sub-branches at 0.6 along main
    const midX = startX + 0.6 * (tipX - startX);
    const midY = startY + 0.6 * (tipY - startY);
    const subLen = mainLen * 0.45;
    const subAng1 = rootAng - fan;
    const subAng2 = rootAng + fan;
    const sub1X = midX + subLen * Math.cos(subAng1);
    const sub1Y = midY + subLen * Math.sin(subAng1);
    const sub2X = midX + subLen * Math.cos(subAng2);
    const sub2Y = midY + subLen * Math.sin(subAng2);
    // Two more tiny twigs off the tip
    const twigLen = mainLen * 0.18;
    const twigA = rootAng - fan * 0.5;
    const twigB = rootAng + fan * 0.5;
    const twigAX = tipX + twigLen * Math.cos(twigA);
    const twigAY = tipY + twigLen * Math.sin(twigA);
    const twigBX = tipX + twigLen * Math.cos(twigB);
    const twigBY = tipY + twigLen * Math.sin(twigB);
    return [
      `M ${round(startX)} ${round(startY)} L ${round(tipX)} ${round(tipY)}`,
      `M ${round(midX)} ${round(midY)} L ${round(sub1X)} ${round(sub1Y)}`,
      `M ${round(midX)} ${round(midY)} L ${round(sub2X)} ${round(sub2Y)}`,
      `M ${round(tipX)} ${round(tipY)} L ${round(twigAX)} ${round(twigAY)}`,
      `M ${round(tipX)} ${round(tipY)} L ${round(twigBX)} ${round(twigBY)}`,
    ].join(" ");
  };

  const dendrites = [];
  // 5 dendrites fanning out to the LEFT (rootAng around π)
  const dendriteSpec = [
    [Math.PI - 0.6, 110, 0.4],
    [Math.PI - 0.25, 130, 0.35],
    [Math.PI, 150, 0.35],
    [Math.PI + 0.25, 130, 0.35],
    [Math.PI + 0.55, 110, 0.4],
  ];
  for (const [ang, len, fan] of dendriteSpec) {
    dendrites.push({
      at: { x: 0, y: 0 },
      mark: "silhouette-path",
      silhouettePath: {
        d: dendriteBase(ang, len, fan),
        fill: "none",
        stroke: "url(#g-cell)",
        strokeWidth: 1.6,
        strokeLinecap: "round",
      },
    });
  }

  // Axon: starts on the right side of soma, goes long to the right with
  // myelin sheath segments along the way.
  const axonStart = somaCx + somaRx;
  const axonEndX = 880;
  const axonY = somaCy;
  const axonPath = `M ${axonStart} ${axonY} L ${axonEndX} ${axonY}`;

  // Myelin sheaths — small ellipses along the axon
  const myelin = [];
  const sheathSpacing = 80;
  for (let x = axonStart + 50; x < axonEndX - 50; x += sheathSpacing) {
    myelin.push({
      at: { x, y: axonY },
      mark: "ellipse",
      ellipse: {
        rx: 26,
        ry: 9,
        fill: "rgba(255, 243, 199, 0.85)",
        stroke: "#b8870e",
        strokeWidth: 1,
      },
    });
  }

  // Axon terminal — branched at the end with synaptic boutons
  const terminalAng = [-0.5, -0.18, 0.18, 0.5];
  const terminals = [];
  for (const a of terminalAng) {
    const tx = axonEndX + 40 * Math.cos(a);
    const ty = axonY + 40 * Math.sin(a);
    terminals.push({
      at: { x: 0, y: 0 },
      mark: "silhouette-path",
      silhouettePath: {
        d: `M ${axonEndX} ${axonY} L ${round(tx)} ${round(ty)}`,
        fill: "none",
        stroke: "url(#g-cell)",
        strokeWidth: 1.6,
        strokeLinecap: "round",
      },
    });
    // synaptic bouton (small circle at tip)
    terminals.push({
      at: { x: round(tx), y: round(ty) },
      mark: "circle",
      circle: { radius: 4, fill: "#fbbf24", stroke: "#7c2d12", strokeWidth: 0.6 },
    });
  }

  return {
    compose: {
      viewBox: { width: W, height: H },
      title: "A neuron firing — the cell that thinks",
      description:
        "A single pyramidal neuron. Dendrites on the left collect input; the soma integrates it; the axon on the right fires an action potential down to the synaptic terminals. Same architecture you use to read this sentence.",
      theme: { background: "#020617", foreground: "#f1f5fb" },
      defs: {
        gradients: [
          {
            id: "g-bg",
            kind: "radial",
            cx: "50%",
            cy: "50%",
            r: "75%",
            stops: [
              { offset: "0%", color: "#0f172a", opacity: 1 },
              { offset: "100%", color: "#020617", opacity: 1 },
            ],
          },
          {
            id: "g-cell",
            kind: "linear",
            x1: "0%",
            y1: "0%",
            x2: "100%",
            y2: "0%",
            stops: [
              { offset: "0%", color: "#a78bfa", opacity: 0.95 },
              { offset: "50%", color: "#22d3ee", opacity: 0.95 },
              { offset: "100%", color: "#fde68a", opacity: 0.95 },
            ],
          },
          {
            id: "g-soma",
            kind: "radial",
            cx: "40%",
            cy: "40%",
            r: "60%",
            stops: [
              { offset: "0%", color: "#fef3c7", opacity: 0.95 },
              { offset: "60%", color: "#a78bfa", opacity: 0.85 },
              { offset: "100%", color: "#312e81", opacity: 0.95 },
            ],
          },
          {
            id: "g-pulse",
            kind: "radial",
            cx: "50%",
            cy: "50%",
            r: "50%",
            stops: [
              { offset: "0%", color: "#fde68a", opacity: 0.9 },
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
        // Subtle starfield
        {
          at: { x: 0, y: 0 },
          mark: "starfield",
          starfield: { count: 60, seed: 23, region: { x: 0, y: 0, w: W, h: H } },
        },
        // Dendrites (drawn first so soma overlaps)
        ...dendrites,
        // Axon
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: axonPath,
            fill: "none",
            stroke: "url(#g-cell)",
            strokeWidth: 3,
            strokeLinecap: "round",
          },
        },
        // Myelin sheaths
        ...myelin,
        // Soma halo
        {
          at: { x: somaCx, y: somaCy },
          mark: "glow",
          glow: { radius: 130, gradientId: "g-pulse" },
        },
        // Soma (cell body)
        {
          at: { x: somaCx, y: somaCy },
          mark: "ellipse",
          ellipse: {
            rx: somaRx,
            ry: somaRy,
            fill: "url(#g-soma)",
            stroke: "#a78bfa",
            strokeWidth: 1.5,
          },
        },
        // Nucleus
        {
          at: { x: somaCx - 8, y: somaCy - 6 },
          mark: "circle",
          circle: { radius: 18, fill: "rgba(2,6,23,.6)", stroke: "#fde68a", strokeWidth: 1 },
        },
        // Terminals
        ...terminals,
        // Action potential pulse at axon end (glow halo at synapse)
        {
          at: { x: axonEndX, y: axonY },
          mark: "glow",
          glow: { radius: 60, gradientId: "g-pulse" },
        },
        // Labels
        {
          at: { x: 50, y: 60 },
          mark: "text",
          textMark: {
            text: "dendrites",
            fontSize: 14,
            fill: "#a78bfa",
            italic: true,
            anchor: "start",
          },
        },
        {
          at: { x: somaCx, y: somaCy + 90 },
          mark: "text",
          textMark: {
            text: "soma",
            fontSize: 14,
            fill: "#fde68a",
            italic: true,
            anchor: "middle",
          },
        },
        {
          at: { x: 530, y: 230 },
          mark: "text",
          textMark: {
            text: "axon · myelin sheath",
            fontSize: 14,
            fill: "#22d3ee",
            italic: true,
            anchor: "middle",
          },
        },
        {
          at: { x: 900, y: 320 },
          mark: "text",
          textMark: {
            text: "synapse",
            fontSize: 14,
            fill: "#fbbf24",
            italic: true,
            anchor: "start",
          },
        },
        {
          at: { x: W / 2, y: 460 },
          mark: "text",
          textMark: {
            text: "input · integrate · fire · transmit",
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
// BIO — A butterfly's wing
// ───────────────────────────────────────────────────────────────────────────
function buildButterfly() {
  const W = 800;
  const H = 600;
  const cx = 400;
  const cy = 300;

  // Forewing (upper) — drawn as a polygon for one side, mirrored for other.
  // Origin is the body center; local coords for the right wing point right.
  const foreWing = [
    [0, -10],
    [70, -110],
    [180, -120],
    [240, -80],
    [230, -20],
    [180, 10],
    [60, 20],
  ];
  const hindWing = [
    [0, 10],
    [60, 30],
    [160, 80],
    [180, 130],
    [120, 160],
    [40, 130],
    [10, 60],
  ];
  const mirrorX = (pts) => pts.map(([x, y]) => [-x, y]);

  // Wing-spot decorations
  const spots = [];
  // Right forewing
  spots.push({
    at: { x: cx + 150, y: cy - 70 },
    mark: "ellipse",
    ellipse: { rx: 22, ry: 16, fill: "rgba(255,255,255,.55)", stroke: "#3a2a14", strokeWidth: 1 },
  });
  spots.push({
    at: { x: cx + 150, y: cy - 70 },
    mark: "circle",
    circle: { radius: 8, fill: "#1f1a14" },
  });
  // Left forewing
  spots.push({
    at: { x: cx - 150, y: cy - 70 },
    mark: "ellipse",
    ellipse: { rx: 22, ry: 16, fill: "rgba(255,255,255,.55)", stroke: "#3a2a14", strokeWidth: 1 },
  });
  spots.push({
    at: { x: cx - 150, y: cy - 70 },
    mark: "circle",
    circle: { radius: 8, fill: "#1f1a14" },
  });
  // Right hindwing
  spots.push({
    at: { x: cx + 110, y: cy + 100 },
    mark: "circle",
    circle: { radius: 14, fill: "rgba(255, 200, 80, 0.65)", stroke: "#7c2d12", strokeWidth: 1 },
  });
  // Left hindwing
  spots.push({
    at: { x: cx - 110, y: cy + 100 },
    mark: "circle",
    circle: { radius: 14, fill: "rgba(255, 200, 80, 0.65)", stroke: "#7c2d12", strokeWidth: 1 },
  });

  // Antennae
  const antennae = [
    {
      at: { x: cx, y: cy - 30 },
      mark: "silhouette-path",
      silhouettePath: {
        d: "M 0 0 Q 18 -40, 36 -55",
        fill: "none",
        stroke: "#1f1a14",
        strokeWidth: 1.5,
      },
    },
    {
      at: { x: cx, y: cy - 30 },
      mark: "silhouette-path",
      silhouettePath: {
        d: "M 0 0 Q -18 -40, -36 -55",
        fill: "none",
        stroke: "#1f1a14",
        strokeWidth: 1.5,
      },
    },
    // Antenna club tips
    {
      at: { x: cx + 36, y: cy - 55 },
      mark: "circle",
      circle: { radius: 2.5, fill: "#1f1a14" },
    },
    {
      at: { x: cx - 36, y: cy - 55 },
      mark: "circle",
      circle: { radius: 2.5, fill: "#1f1a14" },
    },
  ];

  return {
    compose: {
      viewBox: { width: W, height: H },
      title: "A butterfly's wing — symmetry in scales",
      description:
        "Lepidopteran symmetry: same wing pattern reflected across the body axis. Forewing scales catch UV, hindwing eyespots scare predators. Two pairs of wings, one body, ~250,000 species worldwide.",
      theme: { preset: "pencil-parchment" },
      defs: {
        gradients: [
          {
            id: "g-wing-r",
            kind: "linear",
            x1: "0%",
            y1: "0%",
            x2: "100%",
            y2: "100%",
            stops: [
              { offset: "0%", color: "#fbbf24", opacity: 0.95 },
              { offset: "60%", color: "#dc2626", opacity: 0.95 },
              { offset: "100%", color: "#581c87", opacity: 0.95 },
            ],
          },
          {
            id: "g-wing-l",
            kind: "linear",
            x1: "100%",
            y1: "0%",
            x2: "0%",
            y2: "100%",
            stops: [
              { offset: "0%", color: "#fbbf24", opacity: 0.95 },
              { offset: "60%", color: "#dc2626", opacity: 0.95 },
              { offset: "100%", color: "#581c87", opacity: 0.95 },
            ],
          },
          {
            id: "g-hind-r",
            kind: "linear",
            x1: "0%",
            y1: "0%",
            x2: "100%",
            y2: "100%",
            stops: [
              { offset: "0%", color: "#581c87", opacity: 0.95 },
              { offset: "70%", color: "#1e3a8a", opacity: 0.95 },
              { offset: "100%", color: "#0f172a", opacity: 0.95 },
            ],
          },
          {
            id: "g-hind-l",
            kind: "linear",
            x1: "100%",
            y1: "0%",
            x2: "0%",
            y2: "100%",
            stops: [
              { offset: "0%", color: "#581c87", opacity: 0.95 },
              { offset: "70%", color: "#1e3a8a", opacity: 0.95 },
              { offset: "100%", color: "#0f172a", opacity: 0.95 },
            ],
          },
        ],
      },
      children: [
        // Right hindwing (drawn first so forewing overlaps)
        {
          at: { x: cx, y: cy },
          mark: "polygon",
          polygon: {
            points: hindWing,
            fill: "url(#g-hind-r)",
            stroke: "#3a2a14",
            strokeWidth: 1.4,
          },
        },
        // Left hindwing (mirrored)
        {
          at: { x: cx, y: cy },
          mark: "polygon",
          polygon: {
            points: mirrorX(hindWing),
            fill: "url(#g-hind-l)",
            stroke: "#3a2a14",
            strokeWidth: 1.4,
          },
        },
        // Right forewing
        {
          at: { x: cx, y: cy },
          mark: "polygon",
          polygon: {
            points: foreWing,
            fill: "url(#g-wing-r)",
            stroke: "#3a2a14",
            strokeWidth: 1.4,
          },
        },
        // Left forewing (mirrored)
        {
          at: { x: cx, y: cy },
          mark: "polygon",
          polygon: {
            points: mirrorX(foreWing),
            fill: "url(#g-wing-l)",
            stroke: "#3a2a14",
            strokeWidth: 1.4,
          },
        },
        // Body (vertical ellipse along centerline)
        {
          at: { x: cx, y: cy + 30 },
          mark: "ellipse",
          ellipse: { rx: 9, ry: 70, fill: "#1f1a14", stroke: "#7c2d12", strokeWidth: 1 },
        },
        // Head
        {
          at: { x: cx, y: cy - 38 },
          mark: "circle",
          circle: { radius: 9, fill: "#1f1a14", stroke: "#7c2d12", strokeWidth: 1 },
        },
        // Antennae
        ...antennae,
        // Wing spots
        ...spots,
        // Title (top)
        {
          at: { x: cx, y: 50 },
          mark: "text",
          textMark: {
            text: "Order Lepidoptera",
            fontSize: 18,
            fill: "#1f1a14",
            italic: true,
            anchor: "middle",
          },
        },
        // Caption
        {
          at: { x: cx, y: 560 },
          mark: "text",
          textMark: {
            text: "bilateral symmetry · iridescent scales · two pairs of wings",
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
// BIO — An eye
// ───────────────────────────────────────────────────────────────────────────
function buildEye() {
  const W = 800;
  const H = 600;
  const cx = 400;
  const cy = 300;

  // Iris radial fibers — 36 thin polylines from outer iris to inner.
  // We use a slightly varying length so it doesn't look TOO regular.
  const fibers = [];
  const N = 36;
  for (let i = 0; i < N; i++) {
    const a = (2 * Math.PI * i) / N;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    // Length jitter so fibers don't all reach the pupil cleanly
    const jitter = (i % 3) * 4;
    const inner = 50;
    const outer = 130 - jitter;
    fibers.push({
      at: { x: cx, y: cy },
      mark: "polyline",
      polyline: {
        points: [
          [round(inner * cos), round(inner * sin)],
          [round(outer * cos), round(outer * sin)],
        ],
        fill: "none",
        stroke: "url(#g-iris)",
        strokeWidth: 1.1,
      },
    });
  }

  return {
    compose: {
      viewBox: { width: W, height: H },
      title: "An eye — the camera that learned to see",
      description:
        "Cross-section through a vertebrate eye: sclera (white), iris (the radial muscle that opens or closes the pupil), pupil (the aperture), and a catchlight reflecting whatever the eye is looking at.",
      theme: { background: "#1a0f0a", foreground: "#fef3c7" },
      defs: {
        gradients: [
          {
            id: "g-skin",
            kind: "radial",
            cx: "50%",
            cy: "50%",
            r: "60%",
            stops: [
              { offset: "0%", color: "#fde68a", opacity: 1 },
              { offset: "60%", color: "#d97706", opacity: 1 },
              { offset: "100%", color: "#451a03", opacity: 1 },
            ],
          },
          {
            id: "g-iris",
            kind: "radial",
            cx: "50%",
            cy: "50%",
            r: "50%",
            stops: [
              { offset: "0%", color: "#0c4a6e", opacity: 0.95 },
              { offset: "60%", color: "#0284c7", opacity: 0.95 },
              { offset: "100%", color: "#7dd3fc", opacity: 0.95 },
            ],
          },
          {
            id: "g-iris-base",
            kind: "radial",
            cx: "50%",
            cy: "50%",
            r: "55%",
            stops: [
              { offset: "0%", color: "#0c4a6e", opacity: 1 },
              { offset: "100%", color: "#082f49", opacity: 1 },
            ],
          },
          {
            id: "g-sclera",
            kind: "radial",
            cx: "50%",
            cy: "40%",
            r: "60%",
            stops: [
              { offset: "0%", color: "#fef3c7", opacity: 1 },
              { offset: "70%", color: "#fde9b0", opacity: 1 },
              { offset: "100%", color: "#d97706", opacity: 1 },
            ],
          },
        ],
      },
      children: [
        // Skin background
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${W} 0 L ${W} ${H} L 0 ${H} Z`,
            fill: "url(#g-skin)",
            stroke: "none",
          },
        },
        // Sclera (the white of the eye) — almond-shaped via two arcs
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M ${cx - 220} ${cy} Q ${cx} ${cy - 160}, ${cx + 220} ${cy} Q ${cx} ${cy + 160}, ${cx - 220} ${cy} Z`,
            fill: "url(#g-sclera)",
            stroke: "#3a2a14",
            strokeWidth: 2,
          },
        },
        // Iris base (solid)
        {
          at: { x: cx, y: cy },
          mark: "circle",
          circle: { radius: 130, fill: "url(#g-iris-base)" },
        },
        // Iris radial fibers
        ...fibers,
        // Outer iris ring
        {
          at: { x: cx, y: cy },
          mark: "circle",
          circle: { radius: 130, fill: "none", stroke: "#1f1a14", strokeWidth: 1.5 },
        },
        // Pupil
        {
          at: { x: cx, y: cy },
          mark: "circle",
          circle: { radius: 48, fill: "#0a0a0a" },
        },
        // Catchlight (the small white reflection)
        {
          at: { x: cx - 18, y: cy - 18 },
          mark: "ellipse",
          ellipse: { rx: 14, ry: 10, fill: "rgba(255,255,255,.85)" },
        },
        {
          at: { x: cx + 8, y: cy - 6 },
          mark: "circle",
          circle: { radius: 3, fill: "rgba(255,255,255,.7)" },
        },
        // Upper lashes (5 silhouette curves)
        ...[-110, -55, 0, 55, 110].map((dx) => ({
          at: { x: cx + dx, y: cy - 130 + (Math.abs(dx) < 60 ? -8 : 0) },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 Q ${dx < 0 ? 4 : -4} -10, ${dx < 0 ? 10 : -10} -22`,
            fill: "none",
            stroke: "#1f1a14",
            strokeWidth: 2,
            strokeLinecap: "round",
          },
        })),
        // Title
        {
          at: { x: cx, y: 60 },
          mark: "text",
          textMark: {
            text: "iris · pupil · catchlight",
            fontSize: 16,
            fill: "#fef3c7",
            italic: true,
            anchor: "middle",
          },
        },
        // Caption
        {
          at: { x: cx, y: 540 },
          mark: "text",
          textMark: {
            text: "36 radial muscle fibers · one aperture · the camera nature evolved 40 separate times",
            fontSize: 13,
            fill: "#fde68a",
            italic: true,
            anchor: "middle",
          },
        },
      ],
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// ENG — Suspension bridge (Golden Gate style)
// ───────────────────────────────────────────────────────────────────────────
function buildBridge() {
  const W = 1200;
  const H = 600;
  const deckY = 420;
  const towerTopY = 120;
  const tower1X = 280;
  const tower2X = 920;
  const towerWidth = 22;

  // Main cable: parabolic between the two towers.
  // y = ay + (deckY - ay) * ((2t - 1)^2), where t goes 0..1 across the span.
  // Simpler: build with explicit sample points.
  const ay = towerTopY + 20; // cable hugs just below tower top
  const minCableY = deckY - 30; // sag bottom near deck
  const dip = deckY - minCableY; // how far below tower top the lowest point sits
  const cablePts = [];
  const cableSteps = 40;
  for (let i = 0; i <= cableSteps; i++) {
    const t = i / cableSteps;
    const x = tower1X + t * (tower2X - tower1X);
    const y = ay + (1 - 4 * (t - 0.5) * (t - 0.5)) * 0; // placeholder
    // Use cosh-like parabola: y = minCableY - dip * (1 - 4(t-.5)^2)
    const yp = minCableY - dip * (1 - 4 * (t - 0.5) * (t - 0.5));
    cablePts.push([round(x), round(yp)]);
  }
  const cablePath = `M ${cablePts.map(([x, y]) => `${x} ${y}`).join(" L ")}`;

  // Side cables (from anchor to tower tops)
  const anchorL = [80, deckY + 30];
  const anchorR = [W - 80, deckY + 30];

  // Vertical suspenders from cable to deck
  const suspenders = [];
  for (let i = 4; i <= cableSteps - 4; i += 2) {
    const [x, y] = cablePts[i];
    suspenders.push({
      at: { x, y },
      mark: "polyline",
      polyline: {
        points: [
          [0, 0],
          [0, deckY - y - 2],
        ],
        fill: "none",
        stroke: "#1f1a14",
        strokeWidth: 1,
      },
    });
  }

  return {
    compose: {
      viewBox: { width: W, height: H },
      title: "A suspension bridge — gravity solved",
      description:
        "Two towers, one main cable per side, hundreds of vertical suspenders carrying the deck. The cable hangs in a parabola because the load (the deck) is uniform per horizontal distance, not per arc length. Roebling, 1883 (Brooklyn) → Strauss, 1937 (Golden Gate).",
      theme: { preset: "pencil-parchment" },
      defs: {
        gradients: [
          {
            id: "g-sky",
            kind: "linear",
            x1: "0%",
            y1: "0%",
            x2: "0%",
            y2: "100%",
            stops: [
              { offset: "0%", color: "#fef3c7", opacity: 1 },
              { offset: "70%", color: "#fde9b0", opacity: 1 },
              { offset: "100%", color: "#ebe1c4", opacity: 1 },
            ],
          },
          {
            id: "g-water",
            kind: "linear",
            x1: "0%",
            y1: "0%",
            x2: "0%",
            y2: "100%",
            stops: [
              { offset: "0%", color: "#7dd3fc", opacity: 0.85 },
              { offset: "100%", color: "#0c4a6e", opacity: 0.95 },
            ],
          },
          {
            id: "g-tower",
            kind: "linear",
            x1: "0%",
            y1: "0%",
            x2: "100%",
            y2: "0%",
            stops: [
              { offset: "0%", color: "#7c2d12", opacity: 1 },
              { offset: "50%", color: "#dc2626", opacity: 1 },
              { offset: "100%", color: "#7c2d12", opacity: 1 },
            ],
          },
        ],
      },
      children: [
        // Sky
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${W} 0 L ${W} ${deckY + 30} L 0 ${deckY + 30} Z`,
            fill: "url(#g-sky)",
            stroke: "none",
          },
        },
        // Water
        {
          at: { x: 0, y: deckY + 30 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${W} 0 L ${W} ${H - deckY - 30} L 0 ${H - deckY - 30} Z`,
            fill: "url(#g-water)",
            stroke: "none",
          },
        },
        // Side cable left (anchor to tower top)
        {
          at: { x: 0, y: 0 },
          mark: "polyline",
          polyline: {
            points: [anchorL, [tower1X, ay]],
            fill: "none",
            stroke: "#1f1a14",
            strokeWidth: 2.5,
          },
        },
        // Side cable right
        {
          at: { x: 0, y: 0 },
          mark: "polyline",
          polyline: {
            points: [[tower2X, ay], anchorR],
            fill: "none",
            stroke: "#1f1a14",
            strokeWidth: 2.5,
          },
        },
        // Suspenders (drawn first so cable + deck overlap)
        ...suspenders,
        // Main parabolic cable
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: cablePath,
            fill: "none",
            stroke: "#1f1a14",
            strokeWidth: 3,
            strokeLinecap: "round",
          },
        },
        // Tower 1 (left) — trapezoidal red art-deco style
        {
          at: { x: tower1X, y: towerTopY },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M ${-towerWidth / 2} 0 L ${towerWidth / 2} 0 L ${towerWidth / 2 + 6} ${deckY - towerTopY + 30} L ${-towerWidth / 2 - 6} ${deckY - towerTopY + 30} Z`,
            fill: "url(#g-tower)",
            stroke: "#1f1a14",
            strokeWidth: 1.4,
          },
        },
        // Tower 2 (right)
        {
          at: { x: tower2X, y: towerTopY },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M ${-towerWidth / 2} 0 L ${towerWidth / 2} 0 L ${towerWidth / 2 + 6} ${deckY - towerTopY + 30} L ${-towerWidth / 2 - 6} ${deckY - towerTopY + 30} Z`,
            fill: "url(#g-tower)",
            stroke: "#1f1a14",
            strokeWidth: 1.4,
          },
        },
        // Cross-bracing on each tower (5 horizontals)
        ...[0.2, 0.4, 0.6, 0.8].flatMap((t) =>
          [tower1X, tower2X].map((tx) => ({
            at: { x: tx, y: towerTopY + t * (deckY - towerTopY + 20) },
            mark: "polyline",
            polyline: {
              points: [
                [-towerWidth / 2 - 3 - t * 3, 0],
                [towerWidth / 2 + 3 + t * 3, 0],
              ],
              fill: "none",
              stroke: "#1f1a14",
              strokeWidth: 1.4,
            },
          })),
        ),
        // Deck (the road)
        {
          at: { x: 0, y: deckY },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 60 0 L ${W - 60} 0 L ${W - 60} 30 L 60 30 Z`,
            fill: "#3b3a2a",
            stroke: "#1f1a14",
            strokeWidth: 1.4,
          },
        },
        // Deck centerline
        {
          at: { x: 0, y: deckY + 15 },
          mark: "polyline",
          polyline: {
            points: [
              [60, 0],
              [W - 60, 0],
            ],
            fill: "none",
            stroke: "#fde68a",
            strokeWidth: 1,
            strokeDasharray: "12 8",
          },
        },
        // Annotation: cable
        {
          at: { x: 0, y: 0 },
          mark: "annotation-leader",
          annotation: {
            from: [W / 2, minCableY - 2],
            to: [W / 2 + 80, 240],
            text: "main cable · parabolic sag",
            italic: true,
            anchor: "start",
          },
        },
        // Annotation: tower
        {
          at: { x: 0, y: 0 },
          mark: "annotation-leader",
          annotation: {
            from: [tower2X, towerTopY],
            to: [tower2X + 90, 90],
            text: "tower (~ 230 m)",
            italic: true,
            anchor: "start",
          },
        },
        // Caption
        {
          at: { x: W / 2, y: 565 },
          mark: "text",
          textMark: {
            text: "two towers, one parabola, a road suspended in mid-air",
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
// ENG — Steam locomotive
// ───────────────────────────────────────────────────────────────────────────
function buildLocomotive() {
  const W = 1200;
  const H = 600;

  const trackY = 480;
  const bodyY = 280;

  // Wheels: three big drivers + one small leading wheel
  const wheels = [
    { x: 280, r: 60, teeth: 24 }, // leading
    { x: 470, r: 80, teeth: 28 }, // driver 1
    { x: 660, r: 80, teeth: 28 }, // driver 2
    { x: 850, r: 80, teeth: 28 }, // driver 3
  ];

  return {
    compose: {
      viewBox: { width: W, height: H },
      title: "Steam locomotive — fire on wheels",
      description:
        "Stevenson's Rocket (1829) → Mallard (1938, world speed record 203 km/h). Coal in the firebox boils water in the boiler; steam expands through the cylinders; connecting rods turn the drivers; the whole thing rolls on steel rails.",
      theme: { preset: "pencil-parchment" },
      defs: {
        gradients: [
          {
            id: "g-sky",
            kind: "linear",
            x1: "0%",
            y1: "0%",
            x2: "0%",
            y2: "100%",
            stops: [
              { offset: "0%", color: "#fef3c7", opacity: 1 },
              { offset: "100%", color: "#ebe1c4", opacity: 1 },
            ],
          },
          {
            id: "g-boiler",
            kind: "linear",
            x1: "0%",
            y1: "0%",
            x2: "0%",
            y2: "100%",
            stops: [
              { offset: "0%", color: "#1f1a14", opacity: 1 },
              { offset: "60%", color: "#3a3a2a", opacity: 1 },
              { offset: "100%", color: "#1f1a14", opacity: 1 },
            ],
          },
          {
            id: "g-smoke",
            kind: "radial",
            cx: "50%",
            cy: "50%",
            r: "50%",
            stops: [
              { offset: "0%", color: "#94a3b8", opacity: 0.8 },
              { offset: "100%", color: "#94a3b8", opacity: 0 },
            ],
          },
        ],
      },
      children: [
        // Sky
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${W} 0 L ${W} ${trackY} L 0 ${trackY} Z`,
            fill: "url(#g-sky)",
            stroke: "none",
          },
        },
        // Ground (gravel band below track)
        {
          at: { x: 0, y: trackY + 16 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${W} 0 L ${W} ${H - trackY - 16} L 0 ${H - trackY - 16} Z`,
            fill: "#a3b18a",
            stroke: "none",
          },
        },
        // Far hills (silhouette)
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M 0 380 L 120 320 L 220 360 L 340 290 L 480 340 L 620 300 L 760 350 L 880 305 L 1020 345 L 1200 320 L 1200 460 L 0 460 Z",
            fill: "rgba(107,138,74,.4)",
            stroke: "none",
          },
        },
        // Smoke (5 cloud-like puffs above the stack)
        ...[0, 1, 2, 3, 4].map((i) => ({
          at: { x: 360 + i * 50 - i * i * 8, y: 130 - i * 25 },
          mark: "circle",
          circle: { radius: 35 + i * 6, fill: "url(#g-smoke)" },
        })),
        // Boiler (main horizontal cylinder)
        {
          at: { x: 360, y: bodyY },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M 0 0 L 540 0 L 540 110 L 0 110 Z",
            fill: "url(#g-boiler)",
            stroke: "#1f1a14",
            strokeWidth: 2,
          },
        },
        // Boiler bands (3 horizontal stripes)
        ...[15, 55, 95].map((dy) => ({
          at: { x: 360, y: bodyY + dy },
          mark: "polyline",
          polyline: {
            points: [
              [0, 0],
              [540, 0],
            ],
            fill: "none",
            stroke: "#fde68a",
            strokeWidth: 1.4,
          },
        })),
        // Boiler front (round face)
        {
          at: { x: 350, y: bodyY + 55 },
          mark: "circle",
          circle: { radius: 60, fill: "#1f1a14", stroke: "#fde68a", strokeWidth: 2 },
        },
        // Headlight
        {
          at: { x: 300, y: bodyY + 55 },
          mark: "circle",
          circle: { radius: 16, fill: "#fde68a", stroke: "#1f1a14", strokeWidth: 1.5 },
        },
        // Smoke stack
        {
          at: { x: 410, y: bodyY - 60 },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M 0 0 L 60 0 L 70 60 L -10 60 Z",
            fill: "#1f1a14",
            stroke: "#fde68a",
            strokeWidth: 1.5,
          },
        },
        // Steam dome (small dome on top of boiler)
        {
          at: { x: 580, y: bodyY - 20 },
          mark: "ellipse",
          ellipse: { rx: 30, ry: 22, fill: "#1f1a14", stroke: "#fde68a", strokeWidth: 1.5 },
        },
        // Whistle
        {
          at: { x: 640, y: bodyY - 10 },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M 0 0 L 6 0 L 6 -20 L 0 -20 Z",
            fill: "#fde68a",
            stroke: "#1f1a14",
            strokeWidth: 1,
          },
        },
        // Cab (driver compartment) — at rear
        {
          at: { x: 750, y: bodyY - 80 },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M 0 0 L 150 0 L 150 200 L 0 200 Z",
            fill: "#7c2d12",
            stroke: "#1f1a14",
            strokeWidth: 2,
          },
        },
        // Cab roof overhang
        {
          at: { x: 740, y: bodyY - 85 },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M 0 0 L 170 0 L 170 10 L 0 10 Z",
            fill: "#1f1a14",
            stroke: "#1f1a14",
            strokeWidth: 1,
          },
        },
        // Cab window
        {
          at: { x: 770, y: bodyY - 60 },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M 0 0 L 50 0 L 50 50 L 0 50 Z",
            fill: "#fde68a",
            stroke: "#1f1a14",
            strokeWidth: 1.4,
          },
        },
        // Connecting rod (links the 3 drivers)
        {
          at: { x: 0, y: trackY - 8 },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M 470 0 L 850 0",
            fill: "none",
            stroke: "#fde68a",
            strokeWidth: 5,
            strokeLinecap: "round",
          },
        },
        // Wheels (gear marks for the spoked-wheel look) with rotation
        ...wheels.map((w) => ({
          at: { x: w.x, y: trackY - 8 },
          mark: "gear",
          gear: {
            radius: w.r,
            teeth: w.teeth,
            toothLength: 4,
            hubRadius: 8,
          },
          animation: { kind: "rotate-loop", periodMs: 4000, direction: "cw" },
        })),
        // Wheel pin (on each driver, attached to connecting rod)
        ...wheels.slice(1).map((w) => ({
          at: { x: w.x, y: trackY - 8 },
          mark: "circle",
          circle: { radius: 6, fill: "#1f1a14", stroke: "#fde68a", strokeWidth: 1 },
        })),
        // Rails (two)
        {
          at: { x: 0, y: trackY },
          mark: "polyline",
          polyline: {
            points: [
              [0, 0],
              [W, 0],
            ],
            fill: "none",
            stroke: "#1f1a14",
            strokeWidth: 3,
          },
        },
        {
          at: { x: 0, y: trackY + 4 },
          mark: "polyline",
          polyline: {
            points: [
              [0, 0],
              [W, 0],
            ],
            fill: "none",
            stroke: "#1f1a14",
            strokeWidth: 3,
          },
        },
        // Ties (railroad sleepers) — every 80 px
        ...Array.from({ length: 15 }, (_, i) => ({
          at: { x: 40 + i * 80, y: trackY + 10 },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M 0 0 L 50 0 L 50 8 L 0 8 Z",
            fill: "#3a2a14",
            stroke: "none",
          },
        })),
        // Caption
        {
          at: { x: W / 2, y: 560 },
          mark: "text",
          textMark: {
            text: "fire → boiling water → expanding steam → turning wheels → 200 km/h",
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
// ENG — Radio waves broadcasting
// ───────────────────────────────────────────────────────────────────────────
function buildRadio() {
  const W = 800;
  const H = 800;
  const towerX = W / 2;
  const towerBaseY = 700;
  const towerTopY = 280;
  const antennaTipY = 200;

  // Tower silhouette (a lattice triangle)
  const towerD = `M ${towerX - 70} ${towerBaseY} L ${towerX + 70} ${towerBaseY} L ${towerX + 10} ${towerTopY} L ${towerX - 10} ${towerTopY} Z`;
  // Lattice crossbars
  const crossBars = [];
  const latticeSteps = 16;
  for (let i = 0; i < latticeSteps; i++) {
    const t1 = i / latticeSteps;
    const t2 = (i + 1) / latticeSteps;
    const x1L = towerX - 70 + t1 * 60;
    const x1R = towerX + 70 - t1 * 60;
    const x2L = towerX - 70 + t2 * 60;
    const x2R = towerX + 70 - t2 * 60;
    const y1 = towerBaseY + t1 * (towerTopY - towerBaseY);
    const y2 = towerBaseY + t2 * (towerTopY - towerBaseY);
    crossBars.push({
      at: { x: 0, y: 0 },
      mark: "polyline",
      polyline: {
        points: [
          [round(x1L), round(y1)],
          [round(x2R), round(y2)],
        ],
        fill: "none",
        stroke: "#fde68a",
        strokeWidth: 1,
        strokeDasharray: "",
      },
    });
    crossBars.push({
      at: { x: 0, y: 0 },
      mark: "polyline",
      polyline: {
        points: [
          [round(x1R), round(y1)],
          [round(x2L), round(y2)],
        ],
        fill: "none",
        stroke: "#fde68a",
        strokeWidth: 1,
      },
    });
  }

  // Antenna (single line from tower top to tip)
  const antennaPath = `M ${towerX} ${towerTopY} L ${towerX} ${antennaTipY}`;

  // Radio waves — 6 concentric ellipses emanating from the antenna tip,
  // each with decreasing opacity. We use ellipses to suggest horizontal
  // ground-wave dominance.
  const waves = [];
  for (let i = 1; i <= 7; i++) {
    const r = 60 * i;
    waves.push({
      at: { x: towerX, y: antennaTipY },
      mark: "ellipse",
      ellipse: {
        rx: r,
        ry: r * 0.55,
        fill: "none",
        stroke: "#fde68a",
        strokeWidth: 1.4,
        opacity: 0.7 - i * 0.08,
      },
      animation: { kind: "pulse", periodMs: 3000 + i * 200, scale: 1.05 },
    });
  }

  return {
    compose: {
      viewBox: { width: W, height: H },
      title: "Radio waves — invisible voices",
      description:
        "Marconi, 1901 — the first wireless transatlantic signal. A single antenna driven by an oscillator radiates electromagnetic waves at the speed of light in all directions. Every radio, every wifi router, every cell tower is a refinement of this one trick.",
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
              { offset: "0%", color: "#0c1e3a", opacity: 1 },
              { offset: "60%", color: "#04102a", opacity: 1 },
              { offset: "100%", color: "#020617", opacity: 1 },
            ],
          },
          {
            id: "g-tip",
            kind: "radial",
            cx: "50%",
            cy: "50%",
            r: "50%",
            stops: [
              { offset: "0%", color: "#fde68a", opacity: 1 },
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
          starfield: { count: 100, seed: 31, region: { x: 0, y: 0, w: W, h: H } },
        },
        // Ground horizon
        {
          at: { x: 0, y: towerBaseY },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${W} 0 L ${W} ${H - towerBaseY} L 0 ${H - towerBaseY} Z`,
            fill: "rgba(15, 23, 42, 0.85)",
            stroke: "none",
          },
        },
        // Radio waves (drawn first so tower is on top)
        ...waves,
        // Glow at tip
        {
          at: { x: towerX, y: antennaTipY },
          mark: "glow",
          glow: { radius: 50, gradientId: "g-tip" },
        },
        // Tower silhouette
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: towerD,
            fill: "rgba(15, 23, 42, 0.4)",
            stroke: "#fde68a",
            strokeWidth: 1.5,
          },
        },
        // Lattice cross-bars
        ...crossBars,
        // Antenna
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: antennaPath,
            fill: "none",
            stroke: "#fde68a",
            strokeWidth: 2.5,
          },
        },
        // Antenna tip bulb
        {
          at: { x: towerX, y: antennaTipY },
          mark: "circle",
          circle: { radius: 6, fill: "#fde68a", stroke: "#fbbf24", strokeWidth: 1 },
        },
        // Label
        {
          at: { x: towerX, y: 90 },
          mark: "text",
          textMark: {
            text: "broadcasting · 88 — 108 MHz",
            fontSize: 16,
            fill: "#fde68a",
            italic: true,
            anchor: "middle",
          },
        },
        // Caption
        {
          at: { x: towerX, y: 765 },
          mark: "text",
          textMark: {
            text: "electromagnetic waves · speed of light · receives everywhere within range",
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
// ARCH — Greek temple (Doric)
// ───────────────────────────────────────────────────────────────────────────
function buildTemple() {
  const W = 1000;
  const H = 700;
  const groundY = 590;
  const colCount = 6;
  const colWidth = 50;
  const colSpacing = 130;
  const colTopY = 280;
  const colBaseY = groundY - 20;

  // 6 columns evenly spaced
  const colStartX = W / 2 - ((colCount - 1) / 2) * colSpacing;
  const columns = [];
  for (let i = 0; i < colCount; i++) {
    const cx = colStartX + i * colSpacing;
    // Doric column has fluting — draw vertical lines on the column body
    columns.push({
      at: { x: cx, y: colTopY },
      mark: "silhouette-path",
      silhouettePath: {
        d: `M ${-colWidth / 2} 0 L ${colWidth / 2} 0 L ${colWidth / 2 + 4} ${colBaseY - colTopY} L ${-colWidth / 2 - 4} ${colBaseY - colTopY} Z`,
        fill: "url(#p-flute)",
        stroke: "#3a3a2a",
        strokeWidth: 1.4,
      },
    });
    // Column capital (Doric: simple flat cap)
    columns.push({
      at: { x: cx, y: colTopY - 18 },
      mark: "silhouette-path",
      silhouettePath: {
        d: `M ${-colWidth / 2 - 8} 0 L ${colWidth / 2 + 8} 0 L ${colWidth / 2 + 12} 12 L ${-colWidth / 2 - 12} 12 Z M ${-colWidth / 2 - 12} 12 L ${colWidth / 2 + 12} 12 L ${colWidth / 2 + 12} 18 L ${-colWidth / 2 - 12} 18 Z`,
        fill: "#fefce8",
        stroke: "#3a3a2a",
        strokeWidth: 1.4,
      },
    });
    // Column base
    columns.push({
      at: { x: cx, y: colBaseY - 6 },
      mark: "silhouette-path",
      silhouettePath: {
        d: `M ${-colWidth / 2 - 8} 0 L ${colWidth / 2 + 8} 0 L ${colWidth / 2 + 8} 6 L ${-colWidth / 2 - 8} 6 Z`,
        fill: "#fefce8",
        stroke: "#3a3a2a",
        strokeWidth: 1.4,
      },
    });
  }

  // Pediment triangle
  const pedimentLeft = colStartX - colWidth / 2 - 30;
  const pedimentRight = colStartX + (colCount - 1) * colSpacing + colWidth / 2 + 30;
  const pedimentBase = 180;
  const pedimentApex = 80;

  // Triglyphs and metopes on the entablature
  const entYTop = colTopY - 60;
  const entYBot = colTopY - 28;
  const triglyphs = [];
  for (let i = 0; i < colCount; i++) {
    const cx = colStartX + i * colSpacing;
    triglyphs.push({
      at: { x: cx - 8, y: entYTop + 6 },
      mark: "silhouette-path",
      silhouettePath: {
        d: "M 0 0 L 16 0 L 16 26 L 0 26 Z",
        fill: "#fefce8",
        stroke: "#3a3a2a",
        strokeWidth: 1,
      },
    });
    // Vertical lines on triglyph
    triglyphs.push({
      at: { x: cx, y: entYTop + 6 },
      mark: "polyline",
      polyline: {
        points: [
          [0, 0],
          [0, 26],
        ],
        fill: "none",
        stroke: "#3a3a2a",
        strokeWidth: 1,
      },
    });
  }

  return {
    compose: {
      viewBox: { width: W, height: H },
      title: "A Greek temple — order in stone",
      description:
        "Doric order, the oldest of the classical Greek styles. Six columns front the cella; their proportion (height : diameter ≈ 5:1) and the triglyph-metope frieze date this to ~500 BCE. The Parthenon's blueprint, scaled down.",
      theme: { preset: "pencil-parchment" },
      defs: {
        gradients: [
          {
            id: "g-sky",
            kind: "linear",
            x1: "0%",
            y1: "0%",
            x2: "0%",
            y2: "100%",
            stops: [
              { offset: "0%", color: "#7dd3fc", opacity: 1 },
              { offset: "60%", color: "#fde9b0", opacity: 1 },
              { offset: "100%", color: "#ebe1c4", opacity: 1 },
            ],
          },
          {
            id: "g-ground",
            kind: "linear",
            x1: "0%",
            y1: "0%",
            x2: "0%",
            y2: "100%",
            stops: [
              { offset: "0%", color: "#a3b18a", opacity: 1 },
              { offset: "100%", color: "#6b8a4a", opacity: 1 },
            ],
          },
        ],
        patterns: [
          {
            id: "p-flute",
            width: 8,
            height: 8,
            children: [
              { kind: "line", x1: 0, y1: 0, x2: 0, y2: 8, stroke: "#3a3a2a", strokeWidth: 0.5 },
              { kind: "line", x1: 4, y1: 0, x2: 4, y2: 8, stroke: "#3a3a2a", strokeWidth: 0.3 },
            ],
          },
          {
            id: "p-marble",
            width: 60,
            height: 30,
            children: [
              { kind: "line", x1: 0, y1: 0, x2: 60, y2: 0, stroke: "#3a3a2a", strokeWidth: 0.3 },
              { kind: "line", x1: 0, y1: 15, x2: 60, y2: 15, stroke: "#3a3a2a", strokeWidth: 0.3 },
              { kind: "line", x1: 30, y1: 0, x2: 30, y2: 15, stroke: "#3a3a2a", strokeWidth: 0.3 },
              { kind: "line", x1: 0, y1: 15, x2: 0, y2: 30, stroke: "#3a3a2a", strokeWidth: 0.3 },
              { kind: "line", x1: 60, y1: 15, x2: 60, y2: 30, stroke: "#3a3a2a", strokeWidth: 0.3 },
            ],
          },
        ],
      },
      children: [
        // Sky
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${W} 0 L ${W} ${groundY} L 0 ${groundY} Z`,
            fill: "url(#g-sky)",
            stroke: "none",
          },
        },
        // Ground
        {
          at: { x: 0, y: groundY },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${W} 0 L ${W} ${H - groundY} L 0 ${H - groundY} Z`,
            fill: "url(#g-ground)",
            stroke: "none",
          },
        },
        // Stylobate (the temple base, marble-pattern filled)
        {
          at: { x: pedimentLeft - 20, y: colBaseY },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${pedimentRight - pedimentLeft + 40} 0 L ${pedimentRight - pedimentLeft + 30} 30 L 10 30 Z`,
            fill: "url(#p-marble)",
            stroke: "#3a3a2a",
            strokeWidth: 2,
          },
        },
        // Stylobate steps
        {
          at: { x: pedimentLeft - 30, y: colBaseY + 30 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${pedimentRight - pedimentLeft + 60} 0 L ${pedimentRight - pedimentLeft + 50} 20 L 10 20 Z`,
            fill: "url(#p-marble)",
            stroke: "#3a3a2a",
            strokeWidth: 2,
          },
        },
        // Columns
        ...columns,
        // Architrave (the horizontal beam ON the columns)
        {
          at: { x: pedimentLeft, y: colTopY - 28 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${pedimentRight - pedimentLeft} 0 L ${pedimentRight - pedimentLeft} 12 L 0 12 Z`,
            fill: "url(#p-marble)",
            stroke: "#3a3a2a",
            strokeWidth: 2,
          },
        },
        // Frieze area background
        {
          at: { x: pedimentLeft, y: colTopY - 60 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${pedimentRight - pedimentLeft} 0 L ${pedimentRight - pedimentLeft} 32 L 0 32 Z`,
            fill: "#fefce8",
            stroke: "#3a3a2a",
            strokeWidth: 2,
          },
        },
        // Triglyphs
        ...triglyphs,
        // Cornice (horizontal band above frieze)
        {
          at: { x: pedimentLeft - 10, y: colTopY - 80 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${pedimentRight - pedimentLeft + 20} 0 L ${pedimentRight - pedimentLeft + 20} 14 L 0 14 Z`,
            fill: "url(#p-marble)",
            stroke: "#3a3a2a",
            strokeWidth: 2,
          },
        },
        // Pediment (triangular gable)
        {
          at: { x: 0, y: 0 },
          mark: "polygon",
          polygon: {
            points: [
              [pedimentLeft - 10, colTopY - 80],
              [pedimentRight + 10, colTopY - 80],
              [W / 2, pedimentApex],
            ],
            fill: "url(#p-marble)",
            stroke: "#3a3a2a",
            strokeWidth: 2,
          },
        },
        // Akroterion (decorative finial atop pediment)
        {
          at: { x: W / 2, y: pedimentApex - 24 },
          mark: "polygon",
          polygon: {
            points: [
              [-10, 24],
              [0, 0],
              [10, 24],
            ],
            fill: "#fefce8",
            stroke: "#3a3a2a",
            strokeWidth: 1.4,
          },
        },
        // Title
        {
          at: { x: W / 2, y: 60 },
          mark: "text",
          textMark: {
            text: "Templum Doricum",
            fontSize: 20,
            fill: "#1f1a14",
            italic: true,
            anchor: "middle",
          },
        },
        // Caption
        {
          at: { x: W / 2, y: 670 },
          mark: "text",
          textMark: {
            text: "stylobate · column · architrave · frieze · cornice · pediment",
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
// ARCH — Gothic cathedral
// ───────────────────────────────────────────────────────────────────────────
function buildCathedral() {
  const W = 800;
  const H = 1000;
  const groundY = 900;

  // Central nave (wider lower body) + towers on each side rising higher
  const naveX0 = 240;
  const naveX1 = 560;
  const naveTopY = 460;
  const towerX0L = 130; // outer-left tower
  const towerX1L = 230;
  const towerX0R = 570;
  const towerX1R = 670;
  const towerTopY = 200;
  const spireBaseY = 200;
  const spireTipY = 40;

  // Central spire (tallest, above the nave's gable)
  const centralSpireBaseY = naveTopY - 20;
  const centralSpireTipY = 60;

  // Rose window position
  const roseCx = W / 2;
  const roseCy = 580;
  const roseR = 75;

  // Rose window rays (12 spokes)
  const roseRays = [];
  for (let i = 0; i < 12; i++) {
    const a = (2 * Math.PI * i) / 12;
    roseRays.push({
      at: { x: roseCx, y: roseCy },
      mark: "polyline",
      polyline: {
        points: [
          [round(15 * Math.cos(a)), round(15 * Math.sin(a))],
          [round(roseR * Math.cos(a)), round(roseR * Math.sin(a))],
        ],
        fill: "none",
        stroke: "#3a2a14",
        strokeWidth: 1.5,
      },
    });
  }

  // Smaller arched windows on the nave (3 tall pointed arches at lower facade)
  const lowerArches = [];
  for (let i = 0; i < 3; i++) {
    const ax = 320 + i * 80;
    lowerArches.push({
      at: { x: ax, y: 830 },
      mark: "silhouette-path",
      silhouettePath: {
        d: "M -22 0 L -22 -100 Q -22 -135, 0 -135 Q 22 -135, 22 -100 L 22 0 Z",
        fill: "#1f1a14",
        stroke: "#3a2a14",
        strokeWidth: 1.5,
      },
    });
    // Tracery: vertical mullion
    lowerArches.push({
      at: { x: ax, y: 830 },
      mark: "polyline",
      polyline: {
        points: [
          [0, -125],
          [0, 0],
        ],
        fill: "none",
        stroke: "#fefce8",
        strokeWidth: 1,
      },
    });
  }

  // Tower lancet windows (one tall pointed arch per tower)
  const towerWindows = [];
  for (const [tx0, tx1] of [
    [towerX0L, towerX1L],
    [towerX0R, towerX1R],
  ]) {
    const mid = (tx0 + tx1) / 2;
    towerWindows.push({
      at: { x: mid, y: 700 },
      mark: "silhouette-path",
      silhouettePath: {
        d: "M -16 0 L -16 -70 Q -16 -95, 0 -95 Q 16 -95, 16 -70 L 16 0 Z",
        fill: "#1f1a14",
        stroke: "#3a2a14",
        strokeWidth: 1.2,
      },
    });
    // Small round window above each lancet
    towerWindows.push({
      at: { x: mid, y: 550 },
      mark: "circle",
      circle: {
        radius: 16,
        fill: "#3a2a14",
        stroke: "#fefce8",
        strokeWidth: 1.4,
      },
    });
    // Pinnacle (small spire) at top of each tower (drawn after main spire)
  }

  return {
    compose: {
      viewBox: { width: W, height: H },
      title: "A Gothic cathedral — light through stone",
      description:
        "Pointed arches let the cathedral go higher than Romanesque round arches ever could. The rose window — a wheel of stained glass radiating from a central oculus — became the calling card of 12th–15th century Europe. Notre-Dame, Chartres, Reims, Cologne.",
      theme: { preset: "pencil-parchment" },
      defs: {
        gradients: [
          {
            id: "g-dawn",
            kind: "linear",
            x1: "0%",
            y1: "0%",
            x2: "0%",
            y2: "100%",
            stops: [
              { offset: "0%", color: "#fef3c7", opacity: 1 },
              { offset: "40%", color: "#fed7aa", opacity: 1 },
              { offset: "100%", color: "#ebe1c4", opacity: 1 },
            ],
          },
          {
            id: "g-rose",
            kind: "radial",
            cx: "50%",
            cy: "50%",
            r: "50%",
            stops: [
              { offset: "0%", color: "#fef3c7", opacity: 1 },
              { offset: "30%", color: "#dc2626", opacity: 0.9 },
              { offset: "60%", color: "#1d4ed8", opacity: 0.95 },
              { offset: "100%", color: "#581c87", opacity: 0.95 },
            ],
          },
          {
            id: "g-stone",
            kind: "linear",
            x1: "0%",
            y1: "0%",
            x2: "100%",
            y2: "0%",
            stops: [
              { offset: "0%", color: "#f5edd9", opacity: 1 },
              { offset: "50%", color: "#ebe1c4", opacity: 1 },
              { offset: "100%", color: "#cbb89c", opacity: 1 },
            ],
          },
        ],
      },
      children: [
        // Dawn sky
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${W} 0 L ${W} ${groundY} L 0 ${groundY} Z`,
            fill: "url(#g-dawn)",
            stroke: "none",
          },
        },
        // Ground
        {
          at: { x: 0, y: groundY },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${W} 0 L ${W} ${H - groundY} L 0 ${H - groundY} Z`,
            fill: "#6b8a4a",
            stroke: "none",
          },
        },
        // Nave body (wider middle section between the two towers)
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M ${naveX0} ${groundY} L ${naveX0} ${naveTopY + 60} L ${naveX0 + 30} ${naveTopY + 30} L ${W / 2} ${naveTopY - 10} L ${naveX1 - 30} ${naveTopY + 30} L ${naveX1} ${naveTopY + 60} L ${naveX1} ${groundY} Z`,
            fill: "url(#g-stone)",
            stroke: "#3a2a14",
            strokeWidth: 2.2,
          },
        },
        // Left tower (rectangular block rising higher than nave)
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M ${towerX0L} ${groundY} L ${towerX0L} ${towerTopY} L ${towerX1L} ${towerTopY} L ${towerX1L} ${groundY} Z`,
            fill: "url(#g-stone)",
            stroke: "#3a2a14",
            strokeWidth: 2.2,
          },
        },
        // Right tower
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M ${towerX0R} ${groundY} L ${towerX0R} ${towerTopY} L ${towerX1R} ${towerTopY} L ${towerX1R} ${groundY} Z`,
            fill: "url(#g-stone)",
            stroke: "#3a2a14",
            strokeWidth: 2.2,
          },
        },
        // Tower string-course bands (2 horizontal stone lines per tower)
        ...[450, 730].flatMap((y) =>
          [
            [towerX0L, towerX1L],
            [towerX0R, towerX1R],
          ].map(([x0, x1]) => ({
            at: { x: 0, y },
            mark: "polyline",
            polyline: {
              points: [
                [x0, 0],
                [x1, 0],
              ],
              fill: "none",
              stroke: "#3a2a14",
              strokeWidth: 0.8,
            },
          })),
        ),
        // Left tower spire (sharp pointed roof)
        {
          at: { x: 0, y: 0 },
          mark: "polygon",
          polygon: {
            points: [
              [towerX0L - 8, spireBaseY],
              [towerX1L + 8, spireBaseY],
              [(towerX0L + towerX1L) / 2, spireTipY],
            ],
            fill: "#5a2d12",
            stroke: "#3a2a14",
            strokeWidth: 2,
          },
        },
        // Right tower spire
        {
          at: { x: 0, y: 0 },
          mark: "polygon",
          polygon: {
            points: [
              [towerX0R - 8, spireBaseY],
              [towerX1R + 8, spireBaseY],
              [(towerX0R + towerX1R) / 2, spireTipY],
            ],
            fill: "#5a2d12",
            stroke: "#3a2a14",
            strokeWidth: 2,
          },
        },
        // Cross at top of each tower spire
        ...[(towerX0L + towerX1L) / 2, (towerX0R + towerX1R) / 2].map((cx) => ({
          at: { x: cx, y: spireTipY - 4 },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M 0 0 L 0 -16 M -6 -10 L 6 -10",
            fill: "none",
            stroke: "#3a2a14",
            strokeWidth: 1.6,
          },
        })),
        // Central tallest spire (above the nave's gable)
        {
          at: { x: 0, y: 0 },
          mark: "polygon",
          polygon: {
            points: [
              [W / 2 - 28, centralSpireBaseY],
              [W / 2 + 28, centralSpireBaseY],
              [W / 2, centralSpireTipY],
            ],
            fill: "#5a2d12",
            stroke: "#3a2a14",
            strokeWidth: 2,
          },
        },
        // Cross at top of central spire
        {
          at: { x: W / 2, y: centralSpireTipY - 6 },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M 0 0 L 0 -22 M -8 -14 L 8 -14",
            fill: "none",
            stroke: "#3a2a14",
            strokeWidth: 2,
          },
        },
        // Tower windows
        ...towerWindows,
        // Rose window (drawn in layers)
        {
          at: { x: roseCx, y: roseCy },
          mark: "circle",
          circle: {
            radius: roseR + 6,
            fill: "#3a2a14",
            stroke: "#fefce8",
            strokeWidth: 2,
          },
        },
        {
          at: { x: roseCx, y: roseCy },
          mark: "circle",
          circle: { radius: roseR, fill: "url(#g-rose)" },
        },
        // Rose window rays
        ...roseRays,
        // Central rose hub
        {
          at: { x: roseCx, y: roseCy },
          mark: "circle",
          circle: { radius: 15, fill: "#fef3c7", stroke: "#3a2a14", strokeWidth: 1.5 },
        },
        // Outer rose-ring decorative dots (12 small circles around the perimeter)
        ...Array.from({ length: 12 }, (_, i) => {
          const a = (2 * Math.PI * i) / 12;
          return {
            at: {
              x: roseCx + round((roseR + 14) * Math.cos(a)),
              y: roseCy + round((roseR + 14) * Math.sin(a)),
            },
            mark: "circle",
            circle: { radius: 3, fill: "#fef3c7", stroke: "#3a2a14", strokeWidth: 0.8 },
          };
        }),
        // Lower pointed-arch windows on the nave
        ...lowerArches,
        // Central main doorway (large pointed arch)
        {
          at: { x: W / 2, y: groundY },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M -60 0 L -60 -120 Q -60 -160, 0 -160 Q 60 -160, 60 -120 L 60 0 Z",
            fill: "#3a2a14",
            stroke: "#1f1a14",
            strokeWidth: 2,
          },
        },
        // Doorway concentric arch ribs (Gothic detail)
        {
          at: { x: W / 2, y: groundY - 4 },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M -68 0 Q -68 -170, 0 -170 Q 68 -170, 68 0",
            fill: "none",
            stroke: "#3a2a14",
            strokeWidth: 1.4,
          },
        },
        // Doorway rivets
        ...[-32, 0, 32].map((dx) => ({
          at: { x: W / 2 + dx, y: groundY - 60 },
          mark: "circle",
          circle: { radius: 3, fill: "#fde68a", stroke: "#3a2a14", strokeWidth: 0.5 },
        })),
        // Buttresses on the sides of the nave (small triangular supports)
        ...[
          [naveX0 - 30, groundY],
          [naveX1 + 30, groundY],
        ].map(([bx, by]) => ({
          at: { x: bx, y: by },
          mark: "polygon",
          polygon: {
            points: [
              [-20, 0],
              [0, -120],
              [20, 0],
            ],
            fill: "url(#g-stone)",
            stroke: "#3a2a14",
            strokeWidth: 1.6,
          },
        })),
        // Title
        {
          at: { x: W / 2, y: 70 },
          mark: "text",
          textMark: {
            text: "Ecclesia Cathedralis · Gothic order",
            fontSize: 16,
            fill: "#1f1a14",
            italic: true,
            anchor: "middle",
          },
        },
        // Caption
        {
          at: { x: W / 2, y: 960 },
          mark: "text",
          textMark: {
            text: "pointed arch · flying buttress · rose window · light + stone",
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
// ARCH — Modern skyscraper
// ───────────────────────────────────────────────────────────────────────────
function buildSkyscraper() {
  const W = 800;
  const H = 1000;
  const groundY = 940;
  const towerX0 = 280;
  const towerX1 = 520;
  const towerTopY = 80;

  // Antenna mast on top
  const antennaTopY = 20;

  return {
    compose: {
      viewBox: { width: W, height: H },
      title: "A skyscraper at dusk — the city in one column",
      description:
        "Modernist glass tower at last light. A steel skeleton sheathed in a curtain wall of windows. Sullivan's principle (1896): form follows function. Mies's gift (1958, Seagram Building): glass plus rhythm = the entire 20th century.",
      theme: { background: "#0c1126", foreground: "#fef3c7" },
      defs: {
        gradients: [
          {
            id: "g-dusk",
            kind: "linear",
            x1: "0%",
            y1: "0%",
            x2: "0%",
            y2: "100%",
            stops: [
              { offset: "0%", color: "#1e3a8a", opacity: 1 },
              { offset: "40%", color: "#7c2d12", opacity: 1 },
              { offset: "70%", color: "#dc2626", opacity: 1 },
              { offset: "100%", color: "#fed7aa", opacity: 1 },
            ],
          },
          {
            id: "g-tower",
            kind: "linear",
            x1: "0%",
            y1: "0%",
            x2: "100%",
            y2: "0%",
            stops: [
              { offset: "0%", color: "#0c4a6e", opacity: 1 },
              { offset: "50%", color: "#1e3a8a", opacity: 1 },
              { offset: "100%", color: "#0c1e3a", opacity: 1 },
            ],
          },
          {
            id: "g-reflect",
            kind: "linear",
            x1: "0%",
            y1: "0%",
            x2: "100%",
            y2: "100%",
            stops: [
              { offset: "0%", color: "#fbbf24", opacity: 0.45 },
              { offset: "60%", color: "#dc2626", opacity: 0.15 },
              { offset: "100%", color: "#fbbf24", opacity: 0 },
            ],
          },
          {
            id: "g-ground",
            kind: "linear",
            x1: "0%",
            y1: "0%",
            x2: "0%",
            y2: "100%",
            stops: [
              { offset: "0%", color: "#1f1a14", opacity: 1 },
              { offset: "100%", color: "#0c0a08", opacity: 1 },
            ],
          },
        ],
        patterns: [
          {
            id: "p-windows",
            width: 24,
            height: 36,
            children: [
              { kind: "rect", x: 4, y: 6, width: 7, height: 12, fill: "#fde68a" },
              { kind: "rect", x: 13, y: 6, width: 7, height: 12, fill: "#fbbf24" },
              { kind: "rect", x: 4, y: 22, width: 7, height: 12, fill: "rgba(253,230,138,.35)" },
              { kind: "rect", x: 13, y: 22, width: 7, height: 12, fill: "#fde68a" },
            ],
          },
        ],
      },
      children: [
        // Dusk sky
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${W} 0 L ${W} ${groundY} L 0 ${groundY} Z`,
            fill: "url(#g-dusk)",
            stroke: "none",
          },
        },
        // Faint stars (smaller starfield)
        {
          at: { x: 0, y: 0 },
          mark: "starfield",
          starfield: { count: 30, seed: 47, region: { x: 0, y: 0, w: W, h: 200 } },
        },
        // Adjacent shorter buildings (silhouettes)
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M 0 600 L 70 600 L 70 940 L 0 940 Z M 70 660 L 170 660 L 170 940 L 70 940 Z M 580 580 L 660 580 L 660 940 L 580 940 Z M 660 700 L 760 700 L 760 940 L 660 940 Z M 760 640 L 800 640 L 800 940 L 760 940 Z",
            fill: "#0c1126",
            stroke: "#1d2444",
            strokeWidth: 1,
          },
        },
        // Side building windows (small grid)
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M 0 600 L 70 600 L 70 940 L 0 940 Z M 70 660 L 170 660 L 170 940 L 70 940 Z M 580 580 L 660 580 L 660 940 L 580 940 Z M 660 700 L 760 700 L 760 940 L 660 940 Z M 760 640 L 800 640 L 800 940 L 760 940 Z",
            fill: "url(#p-windows)",
            stroke: "none",
            opacity: 0.55,
          },
        },
        // Main tower
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M ${towerX0} ${groundY} L ${towerX0} ${towerTopY} L ${towerX1} ${towerTopY} L ${towerX1} ${groundY} Z`,
            fill: "url(#g-tower)",
            stroke: "#0c4a6e",
            strokeWidth: 2,
          },
        },
        // Window grid
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M ${towerX0 + 8} ${towerTopY + 24} L ${towerX1 - 8} ${towerTopY + 24} L ${towerX1 - 8} ${groundY - 80} L ${towerX0 + 8} ${groundY - 80} Z`,
            fill: "url(#p-windows)",
            stroke: "none",
          },
        },
        // Sunset reflection on the glass facade (a slanted band)
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M ${towerX0 + 8} ${towerTopY + 24} L ${towerX1 - 8} ${towerTopY + 24} L ${towerX1 - 8} ${groundY - 80} L ${towerX0 + 8} ${groundY - 80} Z`,
            fill: "url(#g-reflect)",
            stroke: "none",
          },
        },
        // Setback at top (Art-Deco-style)
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M ${towerX0 + 30} ${towerTopY - 60} L ${towerX1 - 30} ${towerTopY - 60} L ${towerX1 - 30} ${towerTopY} L ${towerX0 + 30} ${towerTopY} Z`,
            fill: "#0c1e3a",
            stroke: "#0c4a6e",
            strokeWidth: 2,
          },
        },
        // Antenna mast
        {
          at: { x: W / 2, y: antennaTopY },
          mark: "polyline",
          polyline: {
            points: [
              [0, 0],
              [0, towerTopY - 60 - antennaTopY],
            ],
            fill: "none",
            stroke: "#0c1126",
            strokeWidth: 2.5,
          },
        },
        // Antenna tip warning light
        {
          at: { x: W / 2, y: antennaTopY + 4 },
          mark: "circle",
          circle: { radius: 3, fill: "#dc2626", stroke: "#7c2d12", strokeWidth: 0.5 },
          animation: { kind: "pulse", periodMs: 1500, scale: 1.4 },
        },
        // Ground (street level)
        {
          at: { x: 0, y: groundY },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${W} 0 L ${W} ${H - groundY} L 0 ${H - groundY} Z`,
            fill: "url(#g-ground)",
            stroke: "none",
          },
        },
        // Plaza horizontal line (sidewalk edge)
        {
          at: { x: 0, y: groundY + 5 },
          mark: "polyline",
          polyline: {
            points: [
              [0, 0],
              [W, 0],
            ],
            fill: "none",
            stroke: "#94a3b8",
            strokeWidth: 0.5,
          },
        },
        // Title (top, in the sky)
        {
          at: { x: W / 2, y: 36 },
          mark: "text",
          textMark: {
            text: "form follows function · Sullivan, 1896",
            fontSize: 13,
            fill: "#fef3c7",
            italic: true,
            anchor: "middle",
          },
        },
        // Caption
        {
          at: { x: W / 2, y: 980 },
          mark: "text",
          textMark: {
            text: "steel frame · curtain wall · 720 lit windows at dusk",
            fontSize: 13,
            fill: "#fbbf24",
            italic: true,
            anchor: "middle",
          },
        },
      ],
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Write all nine
// ───────────────────────────────────────────────────────────────────────────
const fixtures = {
  "bio-neuron.json": buildNeuron(),
  "bio-butterfly.json": buildButterfly(),
  "bio-eye.json": buildEye(),
  "eng-bridge.json": buildBridge(),
  "eng-locomotive.json": buildLocomotive(),
  "eng-radio.json": buildRadio(),
  "arch-temple.json": buildTemple(),
  "arch-cathedral.json": buildCathedral(),
  "arch-skyscraper.json": buildSkyscraper(),
};

for (const [name, spec] of Object.entries(fixtures)) {
  const path = join(outDir, name);
  writeFileSync(path, `${JSON.stringify(spec, null, 2)}\n`);
  console.log(`wrote ${path} (${Math.round(JSON.stringify(spec).length / 1024)} KB)`);
}
