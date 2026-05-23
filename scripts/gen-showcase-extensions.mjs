#!/usr/bin/env node
/**
 * Generate compose JSON fixtures for the second-wave Life-in-Glyph
 * showcases: 3 bio + 3 engineering + 3 architecture pages.
 *
 * Quality-pass v2: rebuilt to match the visual bar of the DNA / jellyfish
 * / hydraulic / windmill scenes — curves over polygons, layered gradients,
 * better proportions, decorative richness, real animations where possible.
 *
 * Run from repo root:
 *   node scripts/gen-showcase-extensions.mjs
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
  const W = 1100;
  const H = 520;
  const somaCx = 240;
  const somaCy = 280;
  const somaRx = 56;
  const somaRy = 64;

  const buildDendrite = (rootAng, mainLen, fanAng) => {
    const sx = somaCx + somaRx * 0.95 * Math.cos(rootAng);
    const sy = somaCy + somaRy * 0.95 * Math.sin(rootAng);
    const cx1 = sx + 0.45 * mainLen * Math.cos(rootAng + 0.15);
    const cy1 = sy + 0.45 * mainLen * Math.sin(rootAng + 0.15);
    const tipX = sx + mainLen * Math.cos(rootAng);
    const tipY = sy + mainLen * Math.sin(rootAng);
    const branchX = sx + 0.75 * mainLen * Math.cos(rootAng);
    const branchY = sy + 0.75 * mainLen * Math.sin(rootAng);
    const subLen = 0.32 * mainLen;
    const sub1X = branchX + subLen * Math.cos(rootAng - fanAng);
    const sub1Y = branchY + subLen * Math.sin(rootAng - fanAng);
    const sub2X = branchX + subLen * Math.cos(rootAng + fanAng);
    const sub2Y = branchY + subLen * Math.sin(rootAng + fanAng);
    const twigLen = 0.45 * subLen;
    const tw1X = sub1X + twigLen * Math.cos(rootAng - fanAng * 1.8);
    const tw1Y = sub1Y + twigLen * Math.sin(rootAng - fanAng * 1.8);
    const tw2X = sub2X + twigLen * Math.cos(rootAng + fanAng * 1.8);
    const tw2Y = sub2Y + twigLen * Math.sin(rootAng + fanAng * 1.8);
    return [
      `M ${round(sx)} ${round(sy)}`,
      `Q ${round(cx1)} ${round(cy1)}, ${round(tipX)} ${round(tipY)}`,
      `M ${round(branchX)} ${round(branchY)} L ${round(sub1X)} ${round(sub1Y)}`,
      `L ${round(tw1X)} ${round(tw1Y)}`,
      `M ${round(branchX)} ${round(branchY)} L ${round(sub2X)} ${round(sub2Y)}`,
      `L ${round(tw2X)} ${round(tw2Y)}`,
    ].join(" ");
  };

  const dendriteAngles = [
    [Math.PI - 0.85, 180, 0.42],
    [Math.PI - 0.35, 220, 0.38],
    [Math.PI, 250, 0.35],
    [Math.PI + 0.35, 220, 0.38],
    [Math.PI + 0.85, 180, 0.42],
  ];

  const dendrites = [];
  for (const [ang, len, fan] of dendriteAngles) {
    const d = buildDendrite(ang, len, fan);
    dendrites.push({
      at: { x: 0, y: 0 },
      mark: "silhouette-path",
      silhouettePath: {
        d,
        fill: "none",
        stroke: "rgba(167,139,250,.35)",
        strokeWidth: 6,
        strokeLinecap: "round",
        strokeLinejoin: "round",
      },
    });
    dendrites.push({
      at: { x: 0, y: 0 },
      mark: "silhouette-path",
      silhouettePath: {
        d,
        fill: "none",
        stroke: "url(#g-cell)",
        strokeWidth: 1.8,
        strokeLinecap: "round",
        strokeLinejoin: "round",
      },
    });
  }

  const axonStartX = somaCx + somaRx - 4;
  const axonEndX = 980;
  const axonY = somaCy + 4;
  const axonD = `M ${axonStartX} ${axonY} L ${axonEndX} ${axonY}`;

  const myelinSheaths = [];
  const sheathSpacing = 90;
  for (let x = axonStartX + 60; x < axonEndX - 60; x += sheathSpacing) {
    myelinSheaths.push({
      at: { x, y: axonY },
      mark: "ellipse",
      ellipse: {
        rx: 32,
        ry: 10,
        fill: "url(#g-myelin)",
        stroke: "#b8870e",
        strokeWidth: 0.8,
      },
    });
  }

  const synapseTerminals = [];
  for (const a of [-0.7, -0.3, 0, 0.3, 0.7]) {
    const tx = axonEndX + 70 * Math.cos(a);
    const ty = axonY + 70 * Math.sin(a);
    synapseTerminals.push({
      at: { x: 0, y: 0 },
      mark: "silhouette-path",
      silhouettePath: {
        d: `M ${axonEndX} ${axonY} Q ${round(axonEndX + 35)} ${round(axonY + 35 * Math.sin(a) * 0.5)}, ${round(tx)} ${round(ty)}`,
        fill: "none",
        stroke: "url(#g-cell)",
        strokeWidth: 1.6,
        strokeLinecap: "round",
      },
    });
    synapseTerminals.push({
      at: { x: round(tx), y: round(ty) },
      mark: "circle",
      circle: { radius: 5, fill: "#fbbf24", stroke: "#fde68a", strokeWidth: 1 },
    });
  }

  return {
    compose: {
      viewBox: { width: W, height: H },
      title: "A neuron firing — the cell that thinks",
      description:
        "A single pyramidal neuron. Dendrites collect input; the soma integrates it; the axon carries the action potential down to the synaptic terminals at the right. The architecture you're using to read this sentence.",
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
              { offset: "0%", color: "#1e1b4b", opacity: 1 },
              { offset: "70%", color: "#0c0a25", opacity: 1 },
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
            r: "65%",
            stops: [
              { offset: "0%", color: "#fef3c7", opacity: 0.95 },
              { offset: "55%", color: "#a78bfa", opacity: 0.85 },
              { offset: "100%", color: "#312e81", opacity: 0.95 },
            ],
          },
          {
            id: "g-myelin",
            kind: "radial",
            cx: "50%",
            cy: "40%",
            r: "65%",
            stops: [
              { offset: "0%", color: "#fef3c7", opacity: 1 },
              { offset: "100%", color: "#fbbf24", opacity: 0.9 },
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
          {
            id: "g-soma-halo",
            kind: "radial",
            cx: "50%",
            cy: "50%",
            r: "50%",
            stops: [
              { offset: "0%", color: "#a78bfa", opacity: 0.55 },
              { offset: "100%", color: "#a78bfa", opacity: 0 },
            ],
          },
        ],
      },
      children: [
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${W} 0 L ${W} ${H} L 0 ${H} Z`,
            fill: "url(#g-bg)",
            stroke: "none",
          },
        },
        {
          at: { x: 0, y: 0 },
          mark: "starfield",
          starfield: { count: 70, seed: 23, region: { x: 0, y: 0, w: W, h: H } },
        },
        ...dendrites,
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: axonD,
            fill: "none",
            stroke: "rgba(34,211,238,.35)",
            strokeWidth: 8,
            strokeLinecap: "round",
          },
        },
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: axonD,
            fill: "none",
            stroke: "url(#g-cell)",
            strokeWidth: 3,
            strokeLinecap: "round",
          },
        },
        ...myelinSheaths,
        {
          at: { x: somaCx, y: somaCy },
          mark: "glow",
          glow: { radius: 150, gradientId: "g-soma-halo" },
        },
        {
          at: { x: somaCx, y: somaCy },
          mark: "ellipse",
          ellipse: {
            rx: somaRx,
            ry: somaRy,
            fill: "url(#g-soma)",
            stroke: "#c4b5fd",
            strokeWidth: 1.4,
          },
        },
        {
          at: { x: somaCx - 6, y: somaCy - 6 },
          mark: "circle",
          circle: {
            radius: 22,
            fill: "rgba(2,6,23,.55)",
            stroke: "#fde68a",
            strokeWidth: 1.2,
          },
        },
        {
          at: { x: somaCx - 2, y: somaCy - 4 },
          mark: "circle",
          circle: { radius: 4, fill: "#fde68a" },
        },
        ...synapseTerminals,
        {
          at: { x: axonEndX, y: axonY },
          mark: "glow",
          glow: { radius: 110, gradientId: "g-pulse" },
        },
        {
          at: { x: 50, y: 50 },
          mark: "text",
          textMark: {
            text: "dendrites · input",
            fontSize: 14,
            fill: "#a78bfa",
            italic: true,
            anchor: "start",
          },
        },
        {
          at: { x: somaCx, y: somaCy + 105 },
          mark: "text",
          textMark: {
            text: "soma · integrate",
            fontSize: 14,
            fill: "#fde68a",
            italic: true,
            anchor: "middle",
          },
        },
        {
          at: { x: 580, y: 230 },
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
          at: { x: 990, y: 360 },
          mark: "text",
          textMark: {
            text: "synapse · transmit",
            fontSize: 14,
            fill: "#fbbf24",
            italic: true,
            anchor: "end",
          },
        },
        {
          at: { x: W / 2, y: 480 },
          mark: "text",
          textMark: {
            text: "86 billion of these, talking to each other right now",
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
  const W = 900;
  const H = 700;
  const cx = W / 2;
  const cy = 360;

  const foreWingD =
    "M 0 -8 C 30 -90, 130 -150, 230 -130 C 270 -120, 290 -90, 280 -50 C 260 -10, 200 10, 130 8 C 80 6, 30 -2, 0 -8 Z";

  const hindWingD =
    "M 0 8 C 20 30, 90 60, 160 100 C 190 115, 205 140, 180 165 C 165 175, 145 165, 130 155 C 120 165, 100 175, 85 165 C 60 155, 40 130, 20 100 C 5 70, -2 30, 0 8 Z";

  const mirrorD = (d) =>
    d.replace(
      /(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g,
      (_m, x, y) => `${-Number.parseFloat(x)} ${y}`,
    );

  const veinsD =
    "M 5 -5 C 60 -50, 130 -90, 220 -100 M 5 -5 C 50 -30, 130 -50, 240 -65 M 5 -5 C 60 -10, 150 -10, 250 -20 M 5 0 C 70 5, 160 8, 200 5";
  const hindVeinsD =
    "M 5 10 C 50 40, 100 70, 160 110 M 5 10 C 40 30, 80 50, 120 80 M 5 10 C 60 15, 120 30, 165 60";

  const eyespots = [];
  for (const sign of [-1, 1]) {
    const ex = cx + sign * 170;
    const ey = cy - 65;
    eyespots.push({
      at: { x: ex, y: ey },
      mark: "circle",
      circle: { radius: 18, fill: "#1f1a14", stroke: "#fbbf24", strokeWidth: 1.4 },
    });
    eyespots.push({
      at: { x: ex, y: ey },
      mark: "circle",
      circle: { radius: 11, fill: "#fef3c7" },
    });
    eyespots.push({
      at: { x: ex, y: ey },
      mark: "circle",
      circle: { radius: 5, fill: "#1f1a14" },
    });
    eyespots.push({
      at: { x: ex - 2, y: ey - 2 },
      mark: "circle",
      circle: { radius: 1.4, fill: "rgba(255,255,255,.85)" },
    });
  }

  const hindSpots = [];
  for (const sign of [-1, 1]) {
    hindSpots.push({
      at: { x: cx + sign * 130, y: cy + 110 },
      mark: "circle",
      circle: { radius: 8, fill: "rgba(255,200,80,.85)", stroke: "#7c2d12", strokeWidth: 1 },
    });
    hindSpots.push({
      at: { x: cx + sign * 95, y: cy + 145 },
      mark: "circle",
      circle: { radius: 5, fill: "rgba(255,150,50,.9)", stroke: "#7c2d12", strokeWidth: 0.8 },
    });
  }

  return {
    compose: {
      viewBox: { width: W, height: H },
      title: "A butterfly's wing — symmetry in scales",
      description:
        "Lepidoptera, top-down. Same wing pattern reflected across the body axis. Forewing scales catch UV light; hindwing eyespots scare predators. Two pairs of wings, one body, ~250,000 species.",
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
              { offset: "0%", color: "#fbbf24", opacity: 0.98 },
              { offset: "45%", color: "#f97316", opacity: 0.98 },
              { offset: "75%", color: "#dc2626", opacity: 0.98 },
              { offset: "100%", color: "#7c2d12", opacity: 0.98 },
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
              { offset: "0%", color: "#fbbf24", opacity: 0.98 },
              { offset: "45%", color: "#f97316", opacity: 0.98 },
              { offset: "75%", color: "#dc2626", opacity: 0.98 },
              { offset: "100%", color: "#7c2d12", opacity: 0.98 },
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
              { offset: "0%", color: "#a78bfa", opacity: 0.98 },
              { offset: "60%", color: "#581c87", opacity: 0.98 },
              { offset: "100%", color: "#1e1b4b", opacity: 0.98 },
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
              { offset: "0%", color: "#a78bfa", opacity: 0.98 },
              { offset: "60%", color: "#581c87", opacity: 0.98 },
              { offset: "100%", color: "#1e1b4b", opacity: 0.98 },
            ],
          },
        ],
      },
      children: [
        {
          at: { x: cx, y: cy },
          mark: "silhouette-path",
          silhouettePath: {
            d: hindWingD,
            fill: "url(#g-hind-r)",
            stroke: "#3a2a14",
            strokeWidth: 1.4,
            strokeLinejoin: "round",
          },
        },
        {
          at: { x: cx, y: cy },
          mark: "silhouette-path",
          silhouettePath: {
            d: mirrorD(hindWingD),
            fill: "url(#g-hind-l)",
            stroke: "#3a2a14",
            strokeWidth: 1.4,
            strokeLinejoin: "round",
          },
        },
        {
          at: { x: cx, y: cy },
          mark: "silhouette-path",
          silhouettePath: {
            d: hindVeinsD,
            fill: "none",
            stroke: "rgba(31,26,20,.35)",
            strokeWidth: 0.8,
          },
        },
        {
          at: { x: cx, y: cy },
          mark: "silhouette-path",
          silhouettePath: {
            d: mirrorD(hindVeinsD),
            fill: "none",
            stroke: "rgba(31,26,20,.35)",
            strokeWidth: 0.8,
          },
        },
        {
          at: { x: cx, y: cy },
          mark: "silhouette-path",
          silhouettePath: {
            d: foreWingD,
            fill: "url(#g-wing-r)",
            stroke: "#3a2a14",
            strokeWidth: 1.4,
            strokeLinejoin: "round",
          },
        },
        {
          at: { x: cx, y: cy },
          mark: "silhouette-path",
          silhouettePath: {
            d: mirrorD(foreWingD),
            fill: "url(#g-wing-l)",
            stroke: "#3a2a14",
            strokeWidth: 1.4,
            strokeLinejoin: "round",
          },
        },
        {
          at: { x: cx, y: cy },
          mark: "silhouette-path",
          silhouettePath: {
            d: veinsD,
            fill: "none",
            stroke: "rgba(31,26,20,.4)",
            strokeWidth: 0.9,
          },
        },
        {
          at: { x: cx, y: cy },
          mark: "silhouette-path",
          silhouettePath: {
            d: mirrorD(veinsD),
            fill: "none",
            stroke: "rgba(31,26,20,.4)",
            strokeWidth: 0.9,
          },
        },
        {
          at: { x: cx, y: cy + 50 },
          mark: "ellipse",
          ellipse: { rx: 10, ry: 90, fill: "#1f1a14", stroke: "#3a2a14", strokeWidth: 1 },
        },
        ...[-20, 10, 40].map((dy) => ({
          at: { x: cx, y: cy + 50 + dy },
          mark: "polyline",
          polyline: {
            points: [
              [-10, 0],
              [10, 0],
            ],
            fill: "none",
            stroke: "#7c2d12",
            strokeWidth: 0.8,
          },
        })),
        {
          at: { x: cx, y: cy - 50 },
          mark: "circle",
          circle: { radius: 12, fill: "#1f1a14", stroke: "#3a2a14", strokeWidth: 1 },
        },
        ...[-1, 1].map((sign) => ({
          at: { x: cx + sign * 6, y: cy - 52 },
          mark: "circle",
          circle: { radius: 3, fill: "#fbbf24", stroke: "#7c2d12", strokeWidth: 0.5 },
        })),
        ...[-1, 1].map((sign) => ({
          at: { x: cx, y: cy - 58 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 Q ${sign * 18} -30, ${sign * 38} -60`,
            fill: "none",
            stroke: "#1f1a14",
            strokeWidth: 1.6,
            strokeLinecap: "round",
          },
        })),
        ...[-1, 1].map((sign) => ({
          at: { x: cx + sign * 38, y: cy - 60 },
          mark: "circle",
          circle: { radius: 3, fill: "#1f1a14" },
        })),
        ...eyespots,
        ...hindSpots,
        {
          at: { x: cx, y: 60 },
          mark: "text",
          textMark: {
            text: "Order Lepidoptera",
            fontSize: 20,
            fill: "#1f1a14",
            italic: true,
            anchor: "middle",
          },
        },
        {
          at: { x: cx, y: 650 },
          mark: "text",
          textMark: {
            text: "bilateral symmetry · iridescent scales · ~250,000 species",
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
// BIO — Heart + circulation (pencil-parchment style, anatomical front-view)
// ───────────────────────────────────────────────────────────────────────────
function buildCirculation() {
  const W = 1100;
  const H = 700;
  const heartCx = 550;
  const heartCy = 380;

  // Heart silhouette — anatomical front view, slightly tilted with the apex
  // pointing toward the viewer's lower-left. Coordinates are relative to
  // the heart center (heartCx, heartCy). The shape is a stylized but
  // anatomical pear with two lobes on top (the atria) and a slight apex
  // on the lower-left (the natural orientation of a real heart in the chest).
  const heartD = [
    "M 0 -130", // start at notch between atria
    "C 35 -170, 110 -165, 130 -100", // right atrium dome
    "C 145 -60, 140 -10, 125 30", // right wall going down
    "C 115 80, 95 130, 60 165", // right ventricle taper
    "C 30 195, -20 210, -50 195", // approach apex
    "C -90 175, -130 130, -150 70", // left ventricle big curve
    "C -165 20, -170 -40, -155 -90", // left wall up
    "C -135 -150, -75 -170, -40 -160", // left atrium dome
    "C -20 -150, -8 -140, 0 -130", // back to start (notch)
    "Z",
  ].join(" ");

  // Septum: the vertical wall dividing left from right
  const septumD = "M 0 -130 C 5 -80, 10 -20, 15 30 C 18 80, 15 130, -20 195";
  // Atrio-ventricular groove: the horizontal-ish line separating atria from ventricles
  const avGrooveD = "M -150 -10 C -100 0, 0 5, 130 -5";

  // Vessels (each is a separate silhouette-path, drawn relative to the
  // overall viewBox so they connect cleanly to the heart at its world coords).
  // Color convention: red = oxygenated, blue = deoxygenated.
  const vessels = [
    // Aorta — exits from the top of LV, arches up-right, descends along right
    {
      at: { x: 0, y: 0 },
      mark: "silhouette-path",
      silhouettePath: {
        d: `M ${heartCx - 40} ${heartCy - 130} C ${heartCx - 50} ${heartCy - 220}, ${heartCx + 80} ${heartCy - 270}, ${heartCx + 170} ${heartCy - 210} C ${heartCx + 220} ${heartCy - 170}, ${heartCx + 230} ${heartCy - 90}, ${heartCx + 220} ${heartCy + 60} L ${heartCx + 220} ${heartCy + 210}`,
        fill: "none",
        stroke: "#b00020",
        strokeWidth: 14,
        strokeLinecap: "round",
      },
    },
    // Aorta inner line (lighter) — gives the vessel a pencil-tube look
    {
      at: { x: 0, y: 0 },
      mark: "silhouette-path",
      silhouettePath: {
        d: `M ${heartCx - 40} ${heartCy - 130} C ${heartCx - 50} ${heartCy - 220}, ${heartCx + 80} ${heartCy - 270}, ${heartCx + 170} ${heartCy - 210} C ${heartCx + 220} ${heartCy - 170}, ${heartCx + 230} ${heartCy - 90}, ${heartCx + 220} ${heartCy + 60} L ${heartCx + 220} ${heartCy + 210}`,
        fill: "none",
        stroke: "#fca5a5",
        strokeWidth: 6,
        strokeLinecap: "round",
      },
    },
    // Branches from the aortic arch (3 small upward arteries to head/arms)
    ...[-30, 20, 60].map((dx) => ({
      at: { x: heartCx + 20 + dx * 2, y: heartCy - 270 },
      mark: "silhouette-path",
      silhouettePath: {
        d: `M 0 0 C ${dx} -30, ${dx} -60, ${dx} -90`,
        fill: "none",
        stroke: "#b00020",
        strokeWidth: 4,
        strokeLinecap: "round",
      },
    })),
    // Pulmonary trunk → splits into L+R pulmonary arteries (deoxygenated, blue)
    {
      at: { x: 0, y: 0 },
      mark: "silhouette-path",
      silhouettePath: {
        d: `M ${heartCx + 10} ${heartCy - 130} C ${heartCx + 50} ${heartCy - 190}, ${heartCx + 140} ${heartCy - 200}, ${heartCx + 200} ${heartCy - 140} M ${heartCx + 10} ${heartCy - 130} C ${heartCx - 30} ${heartCy - 190}, ${heartCx - 130} ${heartCy - 200}, ${heartCx - 200} ${heartCy - 140}`,
        fill: "none",
        stroke: "#1d4ed8",
        strokeWidth: 9,
        strokeLinecap: "round",
      },
    },
    // Pulmonary veins (lungs → LA, red — oxygenated)
    {
      at: { x: 0, y: 0 },
      mark: "silhouette-path",
      silhouettePath: {
        d: `M ${heartCx - 80} ${heartCy - 110} C ${heartCx - 180} ${heartCy - 90}, ${heartCx - 280} ${heartCy - 60}, ${heartCx - 350} ${heartCy - 10} M ${heartCx + 50} ${heartCy - 110} C ${heartCx + 180} ${heartCy - 90}, ${heartCx + 280} ${heartCy - 60}, ${heartCx + 340} ${heartCy - 10}`,
        fill: "none",
        stroke: "#b00020",
        strokeWidth: 7,
        strokeLinecap: "round",
      },
    },
    // Superior vena cava (from above, into RA, blue)
    {
      at: { x: 0, y: 0 },
      mark: "silhouette-path",
      silhouettePath: {
        d: `M ${heartCx + 90} ${heartCy - 130} C ${heartCx + 100} ${heartCy - 200}, ${heartCx + 100} ${heartCy - 260}, ${heartCx + 95} ${heartCy - 320}`,
        fill: "none",
        stroke: "#1d4ed8",
        strokeWidth: 11,
        strokeLinecap: "round",
      },
    },
    // Inferior vena cava (from below the heart, into RA, blue)
    {
      at: { x: 0, y: 0 },
      mark: "silhouette-path",
      silhouettePath: {
        d: `M ${heartCx + 110} ${heartCy + 100} C ${heartCx + 115} ${heartCy + 170}, ${heartCx + 110} ${heartCy + 240}, ${heartCx + 105} ${heartCy + 260}`,
        fill: "none",
        stroke: "#1d4ed8",
        strokeWidth: 11,
        strokeLinecap: "round",
      },
    },
  ];

  // Lungs (left + right, each with lobed silhouette)
  const lungLeftD =
    "M 0 0 C -40 -20, -90 -10, -130 30 C -160 70, -170 130, -160 180 C -150 230, -120 260, -80 270 C -40 275, -10 260, 0 220 C 5 180, 5 140, 5 100 C 10 60, 5 20, 0 0 Z";
  const lungRightD =
    "M 0 0 C 40 -20, 90 -10, 130 30 C 160 70, 170 130, 160 180 C 150 230, 120 260, 80 270 C 40 275, 10 260, 0 220 C -5 180, -5 140, -5 100 C -10 60, -5 20, 0 0 Z";

  // Heart-pulse animation applied to all heart children (so they pulse in sync
  // around the same anchor `heartCx, heartCy`).
  const heartPulse = { kind: "pulse", periodMs: 900, scale: 1.05 };

  return {
    compose: {
      viewBox: { width: W, height: H },
      title: "Heart + circulation — the engine of you",
      description:
        "Anatomical front view of the human heart connected to the great vessels and the lungs. Deoxygenated blood (blue) enters the right side from the vena cavae, gets pumped to the lungs via the pulmonary arteries, returns oxygenated (red) through the pulmonary veins, and exits via the aorta to the body. ~5 L/min at rest.",
      theme: { preset: "pencil-parchment" },
      defs: {
        gradients: [
          {
            id: "g-heart",
            kind: "radial",
            cx: "40%",
            cy: "40%",
            r: "60%",
            stops: [
              { offset: "0%", color: "#fda4af", opacity: 0.95 },
              { offset: "55%", color: "#dc2626", opacity: 0.95 },
              { offset: "100%", color: "#7c2d12", opacity: 0.95 },
            ],
          },
          {
            id: "g-lung",
            kind: "radial",
            cx: "50%",
            cy: "40%",
            r: "65%",
            stops: [
              { offset: "0%", color: "#fde9b0", opacity: 0.7 },
              { offset: "60%", color: "#fbcfe8", opacity: 0.55 },
              { offset: "100%", color: "#c084fc", opacity: 0.4 },
            ],
          },
        ],
      },
      children: [
        // Lungs (drawn first, so vessels + heart sit on top)
        {
          at: { x: heartCx - 220, y: heartCy - 200 },
          mark: "silhouette-path",
          silhouettePath: {
            d: lungLeftD,
            fill: "url(#g-lung)",
            stroke: "#3a2a14",
            strokeWidth: 1.6,
          },
        },
        {
          at: { x: heartCx + 220, y: heartCy - 200 },
          mark: "silhouette-path",
          silhouettePath: {
            d: lungRightD,
            fill: "url(#g-lung)",
            stroke: "#3a2a14",
            strokeWidth: 1.6,
          },
        },
        // Lung shading (a few internal hatching strokes per lung)
        {
          at: { x: heartCx - 220, y: heartCy - 100 },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M -110 -20 Q -80 -10, -50 -20 M -120 30 Q -80 40, -50 30 M -110 80 Q -80 90, -50 80",
            fill: "none",
            stroke: "rgba(124,45,18,.25)",
            strokeWidth: 0.8,
          },
        },
        {
          at: { x: heartCx + 220, y: heartCy - 100 },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M 50 -20 Q 80 -10, 110 -20 M 50 30 Q 80 40, 120 30 M 50 80 Q 80 90, 110 80",
            fill: "none",
            stroke: "rgba(124,45,18,.25)",
            strokeWidth: 0.8,
          },
        },
        // Vessels (between lungs and heart)
        ...vessels,
        // Heart silhouette (outer outline with pencil-shaded fill)
        {
          at: { x: heartCx, y: heartCy },
          mark: "silhouette-path",
          silhouettePath: {
            d: heartD,
            fill: "url(#g-heart)",
            stroke: "#1f1a14",
            strokeWidth: 2.4,
            strokeLinejoin: "round",
          },
          animation: heartPulse,
        },
        // Septum (chamber divider, drawn on top of heart)
        {
          at: { x: heartCx, y: heartCy },
          mark: "silhouette-path",
          silhouettePath: {
            d: septumD,
            fill: "none",
            stroke: "rgba(31,26,20,.7)",
            strokeWidth: 2.2,
            strokeLinecap: "round",
          },
          animation: heartPulse,
        },
        // AV groove (atria/ventricle boundary)
        {
          at: { x: heartCx, y: heartCy },
          mark: "silhouette-path",
          silhouettePath: {
            d: avGrooveD,
            fill: "none",
            stroke: "rgba(31,26,20,.55)",
            strokeWidth: 1.8,
            strokeLinecap: "round",
          },
          animation: heartPulse,
        },
        // Chamber labels (RA, RV, LA, LV) — italic pencil text
        {
          at: { x: heartCx + 70, y: heartCy - 60 },
          mark: "text",
          textMark: {
            text: "RA",
            fontSize: 16,
            fill: "#fef3c7",
            italic: true,
            anchor: "middle",
          },
          animation: heartPulse,
        },
        {
          at: { x: heartCx + 60, y: heartCy + 80 },
          mark: "text",
          textMark: {
            text: "RV",
            fontSize: 16,
            fill: "#fef3c7",
            italic: true,
            anchor: "middle",
          },
          animation: heartPulse,
        },
        {
          at: { x: heartCx - 80, y: heartCy - 60 },
          mark: "text",
          textMark: {
            text: "LA",
            fontSize: 16,
            fill: "#fef3c7",
            italic: true,
            anchor: "middle",
          },
          animation: heartPulse,
        },
        {
          at: { x: heartCx - 90, y: heartCy + 80 },
          mark: "text",
          textMark: {
            text: "LV",
            fontSize: 18,
            fill: "#fef3c7",
            italic: true,
            anchor: "middle",
          },
          animation: heartPulse,
        },
        // Vessel annotations
        {
          at: { x: 0, y: 0 },
          mark: "annotation-leader",
          annotation: {
            from: [heartCx + 215, heartCy - 230],
            to: [heartCx + 290, heartCy - 280],
            text: "aorta · oxygenated",
            italic: true,
            anchor: "start",
          },
        },
        {
          at: { x: 0, y: 0 },
          mark: "annotation-leader",
          annotation: {
            from: [heartCx + 100, heartCy - 320],
            to: [heartCx + 180, heartCy - 360],
            text: "superior vena cava",
            italic: true,
            anchor: "start",
          },
        },
        {
          at: { x: 0, y: 0 },
          mark: "annotation-leader",
          annotation: {
            from: [heartCx - 180, heartCy - 200],
            to: [heartCx - 350, heartCy - 230],
            text: "pulmonary artery → lung",
            italic: true,
            anchor: "start",
          },
        },
        {
          at: { x: 0, y: 0 },
          mark: "annotation-leader",
          annotation: {
            from: [heartCx - 340, heartCy - 50],
            to: [heartCx - 430, heartCy + 20],
            text: "pulmonary vein ← lung",
            italic: true,
            anchor: "start",
          },
        },
        // Title
        {
          at: { x: W / 2, y: 60 },
          mark: "text",
          textMark: {
            text: "Cor humanum · the circulation",
            fontSize: 22,
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
            text: "blue: deoxygenated · red: oxygenated · 60 bpm · ~5 L/min · ~3 billion beats per lifetime",
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
// ENG — Suspension bridge
// ───────────────────────────────────────────────────────────────────────────
function buildBridge() {
  const W = 1300;
  const H = 700;
  const deckY = 480;
  const tower1X = 320;
  const tower2X = 980;
  const towerTopY = 100;

  const baseHalfW = 24;
  const midHalfW = 16;
  const topHalfW = 10;
  const setback1Y = towerTopY + 100;
  const setback2Y = towerTopY + 220;
  const towerD = [
    `M ${-baseHalfW} ${deckY + 30}`,
    `L ${-baseHalfW} ${setback2Y}`,
    `L ${-midHalfW} ${setback2Y}`,
    `L ${-midHalfW} ${setback1Y}`,
    `L ${-topHalfW} ${setback1Y}`,
    `L ${-topHalfW} ${towerTopY}`,
    `L ${topHalfW} ${towerTopY}`,
    `L ${topHalfW} ${setback1Y}`,
    `L ${midHalfW} ${setback1Y}`,
    `L ${midHalfW} ${setback2Y}`,
    `L ${baseHalfW} ${setback2Y}`,
    `L ${baseHalfW} ${deckY + 30}`,
    "Z",
  ].join(" ");

  const ay = towerTopY + 25;
  const minCableY = deckY - 30;
  const dip = minCableY - ay;
  const cableSteps = 50;
  const cablePts = [];
  for (let i = 0; i <= cableSteps; i++) {
    const t = i / cableSteps;
    const x = tower1X + t * (tower2X - tower1X);
    const yp = ay + dip * (1 - 4 * (t - 0.5) * (t - 0.5));
    cablePts.push([round(x), round(yp)]);
  }
  const cablePath = `M ${cablePts.map(([x, y]) => `${x} ${y}`).join(" L ")}`;

  const anchorL = [80, deckY + 30];
  const anchorR = [W - 80, deckY + 30];

  const suspendersCount = 30;
  const suspenders = [];
  for (let i = 1; i < suspendersCount; i++) {
    const t = i / suspendersCount;
    const x = tower1X + t * (tower2X - tower1X);
    const cableY = ay + dip * (1 - 4 * (t - 0.5) * (t - 0.5));
    suspenders.push({
      at: { x: round(x), y: round(cableY) },
      mark: "polyline",
      polyline: {
        points: [
          [0, 0],
          [0, round(deckY - cableY)],
        ],
        fill: "none",
        stroke: "#3a2a14",
        strokeWidth: 0.8,
      },
    });
  }

  const waves = [];
  for (let i = 0; i < 4; i++) {
    waves.push({
      at: { x: 0, y: deckY + 80 + i * 30 },
      mark: "silhouette-path",
      silhouettePath: {
        d: `M 0 0 Q ${W / 4} ${-4 - i}, ${W / 2} 0 T ${W} 0`,
        fill: "none",
        stroke: "rgba(255,255,255,.25)",
        strokeWidth: 1,
      },
    });
  }

  return {
    compose: {
      viewBox: { width: W, height: H },
      title: "A suspension bridge — gravity solved",
      description:
        "Two art-deco towers, one parabolic main cable per side, hundreds of vertical suspenders carrying a deck. The cable hangs in a parabola because the load is uniform per horizontal distance. Roebling 1883 → Strauss 1937.",
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
              { offset: "0%", color: "#fed7aa", opacity: 1 },
              { offset: "50%", color: "#fbbf24", opacity: 1 },
              { offset: "100%", color: "#fde9b0", opacity: 1 },
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
              { offset: "0%", color: "#0284c7", opacity: 1 },
              { offset: "70%", color: "#0c4a6e", opacity: 1 },
              { offset: "100%", color: "#082f49", opacity: 1 },
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
          {
            id: "g-fog",
            kind: "linear",
            x1: "0%",
            y1: "0%",
            x2: "0%",
            y2: "100%",
            stops: [
              { offset: "0%", color: "#fef3c7", opacity: 0.6 },
              { offset: "100%", color: "#fef3c7", opacity: 0 },
            ],
          },
        ],
      },
      children: [
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${W} 0 L ${W} ${deckY + 30} L 0 ${deckY + 30} Z`,
            fill: "url(#g-sky)",
            stroke: "none",
          },
        },
        {
          at: { x: 480, y: deckY - 60 },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M 0 60 L 30 60 L 30 20 L 50 20 L 50 50 L 80 50 L 80 10 L 110 10 L 110 45 L 145 45 L 145 25 L 170 25 L 170 55 L 200 55 L 200 30 L 240 30 L 240 50 L 280 50 L 280 35 L 320 35 L 320 60 L 0 60 Z",
            fill: "rgba(124,45,18,.25)",
            stroke: "none",
          },
        },
        {
          at: { x: 0, y: deckY - 80 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${W} 0 L ${W} 110 L 0 110 Z`,
            fill: "url(#g-fog)",
            stroke: "none",
          },
        },
        {
          at: { x: 0, y: deckY + 30 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${W} 0 L ${W} ${H - deckY - 30} L 0 ${H - deckY - 30} Z`,
            fill: "url(#g-water)",
            stroke: "none",
          },
        },
        ...waves,
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
        ...suspenders,
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: cablePath,
            fill: "none",
            stroke: "#1f1a14",
            strokeWidth: 3.5,
            strokeLinecap: "round",
          },
        },
        {
          at: { x: tower1X, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: towerD,
            fill: "url(#g-tower)",
            stroke: "#1f1a14",
            strokeWidth: 1.4,
          },
        },
        {
          at: { x: tower2X, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: towerD,
            fill: "url(#g-tower)",
            stroke: "#1f1a14",
            strokeWidth: 1.4,
          },
        },
        ...[180, 280, 380].flatMap((y) =>
          [tower1X, tower2X].map((tx) => ({
            at: { x: tx, y },
            mark: "polyline",
            polyline: {
              points: [
                [-24, 0],
                [24, 0],
              ],
              fill: "none",
              stroke: "#1f1a14",
              strokeWidth: 1.4,
            },
          })),
        ),
        {
          at: { x: 60, y: deckY },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${W - 120} 0 L ${W - 120} 30 L 0 30 Z`,
            fill: "#3b3a2a",
            stroke: "#1f1a14",
            strokeWidth: 1.4,
          },
        },
        {
          at: { x: 60, y: deckY + 15 },
          mark: "polyline",
          polyline: {
            points: [
              [0, 0],
              [W - 120, 0],
            ],
            fill: "none",
            stroke: "#fde68a",
            strokeWidth: 1.2,
            strokeDasharray: "16 12",
          },
        },
        {
          at: { x: 0, y: 0 },
          mark: "annotation-leader",
          annotation: {
            from: [W / 2, minCableY],
            to: [W / 2 + 120, 280],
            text: "parabolic main cable",
            italic: true,
            anchor: "start",
          },
        },
        {
          at: { x: 0, y: 0 },
          mark: "annotation-leader",
          annotation: {
            from: [tower2X + 28, towerTopY + 18],
            to: [tower2X + 110, 130],
            text: "tower · 227 m",
            italic: true,
            anchor: "start",
          },
        },
        {
          at: { x: W / 2, y: 670 },
          mark: "text",
          textMark: {
            text: "two towers, a parabola, a road suspended in mid-air",
            fontSize: 14,
            fill: "#fef3c7",
            italic: true,
            anchor: "middle",
          },
        },
      ],
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// ENG — Steam locomotive (4-6-2 Pacific class, professional drafting style)
// ───────────────────────────────────────────────────────────────────────────
function buildLocomotive() {
  const W = 1500;
  const H = 700;

  const trackY = 560;
  const wheelY = trackY - 6;
  const boilerCy = 320;
  const boilerR = 100; // boiler radius (vertical half-height)
  const smokeboxFrontX = 110;
  const boilerFrontX = 230; // smokebox/boiler interface
  const boilerBackX = 880; // boiler/firebox interface
  const cabFrontX = 880;
  const cabBackX = 1080;

  // Wheels: 2-axle pilot truck + 3 drivers + 1-axle trailing + 4-axle tender
  // (compressed slightly for visual balance, real Pacific is 4-6-2)
  const drivers = [
    { x: 380, r: 75 },
    { x: 550, r: 75 },
    { x: 720, r: 75 },
  ];
  const pilotWheels = [
    { x: 220, r: 32 },
    { x: 290, r: 32 },
  ];
  const trailingWheels = [{ x: 830, r: 42 }];
  const tenderWheels = [
    { x: 1140, r: 38 },
    { x: 1220, r: 38 },
    { x: 1300, r: 38 },
    { x: 1380, r: 38 },
  ];

  // Build one wheel as a single silhouette-path: outer tire + 10 spokes + hub.
  // Returned as a relative d-string anchored at (0,0).
  const wheelD = (r, spokeCount = 10) => {
    // Outer tire circle (two arcs for a circle in path syntax)
    const tire = `M ${-r} 0 A ${r} ${r} 0 1 0 ${r} 0 A ${r} ${r} 0 1 0 ${-r} 0`;
    // Inner tire band (smaller circle for the railhead-rim)
    const innerR = r - 6;
    const innerRing = `M ${-innerR} 0 A ${innerR} ${innerR} 0 1 0 ${innerR} 0 A ${innerR} ${innerR} 0 1 0 ${-innerR} 0`;
    // Hub
    const hubR = Math.max(6, r * 0.16);
    const hub = `M ${-hubR} 0 A ${hubR} ${hubR} 0 1 0 ${hubR} 0 A ${hubR} ${hubR} 0 1 0 ${-hubR} 0`;
    // Spokes — each is a thin rectangle from hub to inner rim
    const spokes = [];
    for (let k = 0; k < spokeCount; k++) {
      const a = (Math.PI * 2 * k) / spokeCount;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const w = 1.6; // half-width perpendicular to spoke
      // 4 corners of the spoke
      const x1 = round(hubR * cos - w * sin);
      const y1 = round(hubR * sin + w * cos);
      const x2 = round(innerR * cos - w * sin);
      const y2 = round(innerR * sin + w * cos);
      const x3 = round(innerR * cos + w * sin);
      const y3 = round(innerR * sin - w * cos);
      const x4 = round(hubR * cos + w * sin);
      const y4 = round(hubR * sin - w * cos);
      spokes.push(`M ${x1} ${y1} L ${x2} ${y2} L ${x3} ${y3} L ${x4} ${y4} Z`);
    }
    return `${tire} ${innerRing} ${hub} ${spokes.join(" ")}`;
  };

  // Smoke puffs — 5 billowy circles
  const smokePuffs = [];
  const smokestackX = 270;
  const smokestackTopY = boilerCy - boilerR - 50;
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    const px = smokestackX + i * 32 - i * i * 3 + (i % 2) * 12;
    const py = smokestackTopY - 30 - i * 32 - t * 8;
    const pr = 30 + i * 8 + (i % 3) * 6;
    smokePuffs.push({
      at: { x: round(px), y: round(py) },
      mark: "circle",
      circle: { radius: pr, fill: "url(#g-smoke)" },
    });
  }

  // Side rod (connects driver crank pins, golden/brass) — runs at wheelY
  // between first and last driver. The crank pin is at the wheel-rim level
  // at a fixed phase angle, but for a static snapshot we just put it at
  // the bottom-front of each wheel.
  const sideRodY = wheelY + 8;
  const sideRodD = `M ${drivers[0].x} ${sideRodY} L ${drivers[drivers.length - 1].x} ${sideRodY}`;

  // Main connecting rod from cylinder (at front) to last driver crank
  const cylinderX = 180;
  const cylinderY = wheelY - 20;
  const mainRodD = `M ${cylinderX} ${cylinderY} L ${drivers[drivers.length - 1].x} ${sideRodY}`;

  // Far hills (countryside)
  const hillsD =
    "M 0 460 L 100 410 L 200 440 L 320 380 L 440 410 L 580 370 L 720 400 L 880 365 L 1040 395 L 1200 370 L 1360 400 L 1500 380 L 1500 540 L 0 540 Z";

  // Telephone poles for scale
  const polesD = "M 60 510 L 60 380 M 50 390 L 70 390 M 1450 510 L 1450 380 M 1440 390 L 1460 390";

  return {
    compose: {
      viewBox: { width: W, height: H },
      title: "4-6-2 Pacific — fire on wheels, in detail",
      description:
        "American Type 'Pacific' steam locomotive (4-6-2 wheel arrangement) in profile, drawn in the style of a 1930s shop drawing. A 2-axle pilot truck up front, three coupled drivers under the boiler, a single trailing axle under the firebox, and a 4-axle tender behind. Steam dome, sand dome, bell, headlight, brass boiler bands, side + main connecting rods, riveted plating. Stephenson's Rocket (1829) → Mallard (1938, 203 km/h world record).",
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
              { offset: "0%", color: "#0a0a0a", opacity: 1 },
              { offset: "30%", color: "#4a4a3a", opacity: 1 },
              { offset: "70%", color: "#2a2a1a", opacity: 1 },
              { offset: "100%", color: "#0a0a0a", opacity: 1 },
            ],
          },
          {
            id: "g-smoke",
            kind: "radial",
            cx: "40%",
            cy: "40%",
            r: "60%",
            stops: [
              { offset: "0%", color: "#e2e8f0", opacity: 0.9 },
              { offset: "50%", color: "#94a3b8", opacity: 0.6 },
              { offset: "100%", color: "#94a3b8", opacity: 0 },
            ],
          },
          {
            id: "g-cab",
            kind: "linear",
            x1: "0%",
            y1: "0%",
            x2: "0%",
            y2: "100%",
            stops: [
              { offset: "0%", color: "#7c2d12", opacity: 1 },
              { offset: "50%", color: "#dc2626", opacity: 1 },
              { offset: "100%", color: "#7c2d12", opacity: 1 },
            ],
          },
          {
            id: "g-wheel",
            kind: "radial",
            cx: "50%",
            cy: "50%",
            r: "50%",
            stops: [
              { offset: "0%", color: "#2a2a1a", opacity: 1 },
              { offset: "100%", color: "#0a0a0a", opacity: 1 },
            ],
          },
          {
            id: "g-headlamp",
            kind: "radial",
            cx: "50%",
            cy: "50%",
            r: "50%",
            stops: [
              { offset: "0%", color: "#fef9c3", opacity: 1 },
              { offset: "100%", color: "#fbbf24", opacity: 0.85 },
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
        // Far hills
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: hillsD,
            fill: "rgba(107,138,74,.35)",
            stroke: "none",
          },
        },
        // Telephone poles (small detail)
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: polesD,
            fill: "none",
            stroke: "rgba(58,42,20,.6)",
            strokeWidth: 1.2,
          },
        },
        // Ground / gravel
        {
          at: { x: 0, y: trackY + 14 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${W} 0 L ${W} ${H - trackY - 14} L 0 ${H - trackY - 14} Z`,
            fill: "#a3b18a",
            stroke: "none",
          },
        },
        // Smoke (12 puffs from billowing wisp pairs)
        ...smokePuffs,
        // Pilot/cowcatcher (V-shape at very front) — small angled blade
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M ${smokeboxFrontX - 60} ${trackY - 10} L ${smokeboxFrontX} ${boilerCy - 20} L ${smokeboxFrontX} ${trackY - 10} Z M ${smokeboxFrontX - 60} ${trackY - 10} L ${smokeboxFrontX} ${trackY - 10} M ${smokeboxFrontX - 50} ${trackY - 30} L ${smokeboxFrontX} ${trackY - 30} M ${smokeboxFrontX - 40} ${trackY - 50} L ${smokeboxFrontX} ${trackY - 50}`,
            fill: "#1f1a14",
            stroke: "#fde68a",
            strokeWidth: 1.4,
            strokeLinejoin: "round",
          },
        },
        // Smokebox (cylinder at front of boiler) — slightly larger diameter than boiler
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M ${smokeboxFrontX} ${boilerCy - boilerR - 10} L ${boilerFrontX} ${boilerCy - boilerR - 10} L ${boilerFrontX} ${boilerCy + boilerR + 10} L ${smokeboxFrontX} ${boilerCy + boilerR + 10} Z`,
            fill: "url(#g-boiler)",
            stroke: "#1f1a14",
            strokeWidth: 2,
          },
        },
        // Smokebox front face (round, with rivets)
        {
          at: { x: smokeboxFrontX, y: boilerCy },
          mark: "ellipse",
          ellipse: {
            rx: 14,
            ry: boilerR + 10,
            fill: "#1f1a14",
            stroke: "#fde68a",
            strokeWidth: 2,
          },
        },
        // Smokebox door (slightly smaller circle inset)
        {
          at: { x: smokeboxFrontX + 8, y: boilerCy },
          mark: "circle",
          circle: {
            radius: boilerR - 10,
            fill: "#0a0a0a",
            stroke: "#fde68a",
            strokeWidth: 1.4,
          },
        },
        // Smokebox door rivets (ring of 4 small circles around the door)
        ...[0, 1.57, 3.14, 4.71].map((a) => ({
          at: {
            x: smokeboxFrontX + 8 + round((boilerR - 10) * Math.cos(a)),
            y: boilerCy + round((boilerR - 10) * Math.sin(a)),
          },
          mark: "circle",
          circle: { radius: 1.6, fill: "#fde68a" },
        })),
        // Builder's plate (rectangle on smokebox door)
        {
          at: { x: smokeboxFrontX + 30, y: boilerCy - 12 },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M 0 0 L 60 0 L 60 24 L 0 24 Z",
            fill: "#fde68a",
            stroke: "#1f1a14",
            strokeWidth: 1.2,
          },
        },
        // Builder's plate text "4-6-2"
        {
          at: { x: smokeboxFrontX + 60, y: boilerCy + 4 },
          mark: "text",
          textMark: {
            text: "4-6-2",
            fontSize: 12,
            fill: "#1f1a14",
            italic: true,
            anchor: "middle",
          },
        },
        // Headlight (cone shape on top-front of smokebox)
        {
          at: { x: smokeboxFrontX - 6, y: boilerCy - boilerR - 30 },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M 0 0 L 30 0 L 36 20 L -6 20 Z",
            fill: "#1f1a14",
            stroke: "#fde68a",
            strokeWidth: 1.4,
          },
        },
        // Headlight lens (lit)
        {
          at: { x: smokeboxFrontX + 9, y: boilerCy - boilerR - 14 },
          mark: "circle",
          circle: {
            radius: 9,
            fill: "url(#g-headlamp)",
            stroke: "#1f1a14",
            strokeWidth: 1,
          },
        },
        // Boiler (long horizontal cylinder)
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M ${boilerFrontX} ${boilerCy - boilerR} L ${boilerBackX} ${boilerCy - boilerR} L ${boilerBackX} ${boilerCy + boilerR} L ${boilerFrontX} ${boilerCy + boilerR} Z`,
            fill: "url(#g-boiler)",
            stroke: "#1f1a14",
            strokeWidth: 2,
          },
        },
        // Boiler bands (6 brass rings spaced along boiler)
        ...[280, 380, 480, 580, 680, 780].map((x) => ({
          at: { x, y: 0 },
          mark: "polyline",
          polyline: {
            points: [
              [0, boilerCy - boilerR - 2],
              [0, boilerCy + boilerR + 2],
            ],
            fill: "none",
            stroke: "#fde68a",
            strokeWidth: 2.2,
          },
        })),
        // Handrail (along boiler, one thin line for the running board)
        {
          at: { x: 0, y: 0 },
          mark: "polyline",
          polyline: {
            points: [
              [boilerFrontX, boilerCy - boilerR + 16],
              [boilerBackX, boilerCy - boilerR + 16],
            ],
            fill: "none",
            stroke: "#fde68a",
            strokeWidth: 1,
          },
        },
        // Smokestack (taller, slimmer, with flared rim)
        {
          at: { x: smokestackX, y: smokestackTopY },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M -22 0 L -28 -10 L 28 -10 L 22 0 L 18 50 L -18 50 Z",
            fill: "#0a0a0a",
            stroke: "#fde68a",
            strokeWidth: 1.5,
          },
        },
        // Steam dome (rounded dome on top of boiler)
        {
          at: { x: 480, y: boilerCy - boilerR },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M -36 0 L -38 -10 Q -38 -36, 0 -38 Q 38 -36, 38 -10 L 36 0 Z",
            fill: "#1f1a14",
            stroke: "#fde68a",
            strokeWidth: 1.8,
          },
        },
        // Sand dome (smaller dome behind the steam dome)
        {
          at: { x: 640, y: boilerCy - boilerR },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M -26 0 L -28 -6 Q -28 -26, 0 -28 Q 28 -26, 28 -6 L 26 0 Z",
            fill: "#1f1a14",
            stroke: "#fde68a",
            strokeWidth: 1.6,
          },
        },
        // Bell (small bell hanging from frame on top, between domes)
        {
          at: { x: 560, y: boilerCy - boilerR - 8 },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M -8 0 L -10 -6 L -6 -16 L 6 -16 L 10 -6 L 8 0 Z",
            fill: "#fde68a",
            stroke: "#1f1a14",
            strokeWidth: 1.2,
          },
        },
        // Whistle (small vertical pipe on boiler)
        {
          at: { x: 720, y: boilerCy - boilerR - 4 },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M 0 0 L 6 0 L 6 -22 L 0 -22 Z",
            fill: "#fde68a",
            stroke: "#1f1a14",
            strokeWidth: 1,
          },
        },
        // Cylinder block (front of boiler, low) — where the piston works
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M ${cylinderX - 30} ${cylinderY - 20} L ${cylinderX + 30} ${cylinderY - 20} L ${cylinderX + 30} ${cylinderY + 40} L ${cylinderX - 30} ${cylinderY + 40} Z`,
            fill: "#1f1a14",
            stroke: "#fde68a",
            strokeWidth: 1.6,
          },
        },
        // Cab (large box at the rear with proper roof)
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M ${cabFrontX} ${boilerCy - boilerR - 50} L ${cabBackX} ${boilerCy - boilerR - 50} L ${cabBackX} ${trackY - 6} L ${cabFrontX} ${trackY - 6} Z`,
            fill: "url(#g-cab)",
            stroke: "#1f1a14",
            strokeWidth: 2,
          },
        },
        // Cab roof overhang
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M ${cabFrontX - 8} ${boilerCy - boilerR - 56} L ${cabBackX + 8} ${boilerCy - boilerR - 56} L ${cabBackX + 8} ${boilerCy - boilerR - 46} L ${cabFrontX - 8} ${boilerCy - boilerR - 46} Z`,
            fill: "#1f1a14",
            stroke: "none",
          },
        },
        // Cab windows (3 small square windows)
        ...[920, 970, 1020].map((x) => ({
          at: { x, y: boilerCy - boilerR - 32 },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M 0 0 L 30 0 L 30 38 L 0 38 Z",
            fill: "#fef3c7",
            stroke: "#1f1a14",
            strokeWidth: 1.4,
          },
        })),
        // Tender (coal car behind cab)
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M ${cabBackX + 10} ${boilerCy - 40} L ${cabBackX + 10 + 350} ${boilerCy - 40} L ${cabBackX + 10 + 350} ${trackY - 6} L ${cabBackX + 10} ${trackY - 6} Z`,
            fill: "#3a2a14",
            stroke: "#1f1a14",
            strokeWidth: 2,
          },
        },
        // Tender coal pile (sloped top)
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M ${cabBackX + 20} ${boilerCy - 50} L ${cabBackX + 200} ${boilerCy - 70} L ${cabBackX + 350} ${boilerCy - 50} L ${cabBackX + 350} ${boilerCy - 38} L ${cabBackX + 20} ${boilerCy - 38} Z`,
            fill: "#0a0a0a",
            stroke: "#1f1a14",
            strokeWidth: 1.4,
          },
        },
        // Frame (thin line under boiler connecting wheels)
        {
          at: { x: 0, y: 0 },
          mark: "polyline",
          polyline: {
            points: [
              [smokeboxFrontX, wheelY - 24],
              [cabBackX, wheelY - 24],
            ],
            fill: "none",
            stroke: "#1f1a14",
            strokeWidth: 3,
          },
        },
        // Side rod (brass, links the 3 drivers)
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: sideRodD,
            fill: "none",
            stroke: "#fde68a",
            strokeWidth: 7,
            strokeLinecap: "round",
          },
        },
        // Main connecting rod (cylinder → last driver crank)
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: mainRodD,
            fill: "none",
            stroke: "#fde68a",
            strokeWidth: 5,
            strokeLinecap: "round",
          },
        },
        // Crosshead (small box where main rod meets piston rod)
        {
          at: { x: cylinderX + 30, y: cylinderY - 6 },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M 0 0 L 30 0 L 30 12 L 0 12 Z",
            fill: "#fde68a",
            stroke: "#1f1a14",
            strokeWidth: 1.4,
          },
        },
        // Driving wheels (3 big drivers with 10 spokes each, animated)
        ...drivers.map((w) => ({
          at: { x: w.x, y: wheelY },
          mark: "silhouette-path",
          silhouettePath: {
            d: wheelD(w.r, 10),
            fill: "url(#g-wheel)",
            stroke: "#fde68a",
            strokeWidth: 2,
            strokeLinejoin: "round",
          },
          animation: { kind: "rotate-loop", periodMs: 3500, direction: "cw" },
        })),
        // Pilot truck (2 small leading wheels, animated faster since smaller)
        ...pilotWheels.map((w) => ({
          at: { x: w.x, y: wheelY },
          mark: "silhouette-path",
          silhouettePath: {
            d: wheelD(w.r, 8),
            fill: "url(#g-wheel)",
            stroke: "#fde68a",
            strokeWidth: 1.6,
            strokeLinejoin: "round",
          },
          animation: { kind: "rotate-loop", periodMs: 1500, direction: "cw" },
        })),
        // Trailing wheel (1 medium wheel)
        ...trailingWheels.map((w) => ({
          at: { x: w.x, y: wheelY },
          mark: "silhouette-path",
          silhouettePath: {
            d: wheelD(w.r, 10),
            fill: "url(#g-wheel)",
            stroke: "#fde68a",
            strokeWidth: 1.8,
            strokeLinejoin: "round",
          },
          animation: { kind: "rotate-loop", periodMs: 2000, direction: "cw" },
        })),
        // Tender wheels (4 small wheels under the tender)
        ...tenderWheels.map((w) => ({
          at: { x: w.x, y: wheelY },
          mark: "silhouette-path",
          silhouettePath: {
            d: wheelD(w.r, 8),
            fill: "url(#g-wheel)",
            stroke: "#fde68a",
            strokeWidth: 1.6,
            strokeLinejoin: "round",
          },
          animation: { kind: "rotate-loop", periodMs: 1800, direction: "cw" },
        })),
        // Rails (2 parallel lines, drawn very prominent)
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
            strokeWidth: 3.5,
          },
        },
        {
          at: { x: 0, y: trackY + 7 },
          mark: "polyline",
          polyline: {
            points: [
              [0, 0],
              [W, 0],
            ],
            fill: "none",
            stroke: "#1f1a14",
            strokeWidth: 3.5,
          },
        },
        // Caption
        {
          at: { x: W / 2, y: 660 },
          mark: "text",
          textMark: {
            text: "Stephenson's Rocket (1829) → Mallard, LNER A4 (1938): 203 km/h, world steam record",
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
  const W = 900;
  const H = 850;
  const towerX = W / 2;
  const towerBaseY = 720;
  const towerTopY = 280;
  const antennaTipY = 180;

  const towerD = `M ${towerX - 80} ${towerBaseY} L ${towerX + 80} ${towerBaseY} L ${towerX + 12} ${towerTopY} L ${towerX - 12} ${towerTopY} Z`;

  const crossBars = [];
  const latticeSteps = 12;
  for (let i = 0; i < latticeSteps; i++) {
    const t1 = i / latticeSteps;
    const t2 = (i + 1) / latticeSteps;
    const x1L = towerX - 80 + t1 * 68;
    const x1R = towerX + 80 - t1 * 68;
    const x2L = towerX - 80 + t2 * 68;
    const x2R = towerX + 80 - t2 * 68;
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
        strokeWidth: 0.8,
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
        strokeWidth: 0.8,
      },
    });
  }

  const antennaPath = `M ${towerX} ${towerTopY} L ${towerX} ${antennaTipY}`;

  const waves = [];
  for (let i = 1; i <= 9; i++) {
    const r = 50 * i;
    waves.push({
      at: { x: towerX, y: antennaTipY },
      mark: "ellipse",
      ellipse: {
        rx: r,
        ry: r * 0.5,
        fill: "none",
        stroke: "#fde68a",
        strokeWidth: 1.8,
        opacity: 0.85 - i * 0.07,
      },
      animation: { kind: "pulse", periodMs: 3000 + i * 180, scale: 1.06 },
    });
  }

  const cityD =
    "M 0 100 L 30 100 L 30 60 L 60 60 L 60 90 L 100 90 L 100 50 L 140 50 L 140 80 L 180 80 L 180 70 L 220 70 L 220 95 L 260 95 L 260 60 L 300 60 L 300 75 L 340 75 L 340 90 L 380 90 L 380 100 L 0 100 Z";

  return {
    compose: {
      viewBox: { width: W, height: H },
      title: "Radio waves — invisible voices",
      description:
        "Marconi, 1901. A single antenna driven by an oscillator radiates electromagnetic waves at the speed of light in all directions. Every radio, every wifi router, every cell tower is a refinement of this one trick.",
      theme: { background: "#020617", foreground: "#fef3c7" },
      defs: {
        gradients: [
          {
            id: "g-bg",
            kind: "radial",
            cx: "50%",
            cy: "30%",
            r: "85%",
            stops: [
              { offset: "0%", color: "#1e1b4b", opacity: 1 },
              { offset: "60%", color: "#0c1e3a", opacity: 1 },
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
          {
            id: "g-tower",
            kind: "linear",
            x1: "0%",
            y1: "0%",
            x2: "0%",
            y2: "100%",
            stops: [
              { offset: "0%", color: "#3a3a2a", opacity: 0.85 },
              { offset: "100%", color: "#1f1a14", opacity: 0.85 },
            ],
          },
          {
            id: "g-horizon",
            kind: "linear",
            x1: "0%",
            y1: "0%",
            x2: "0%",
            y2: "100%",
            stops: [
              { offset: "0%", color: "#0c1e3a", opacity: 0.85 },
              { offset: "100%", color: "#020617", opacity: 1 },
            ],
          },
        ],
      },
      children: [
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${W} 0 L ${W} ${H} L 0 ${H} Z`,
            fill: "url(#g-bg)",
            stroke: "none",
          },
        },
        {
          at: { x: 0, y: 0 },
          mark: "starfield",
          starfield: { count: 90, seed: 31, region: { x: 0, y: 0, w: W, h: H * 0.7 } },
        },
        {
          at: { x: 0, y: towerBaseY - 40 },
          mark: "silhouette-path",
          silhouettePath: {
            d: cityD,
            fill: "url(#g-horizon)",
            stroke: "none",
          },
        },
        ...[120, 280, 460, 660].map((dx) => ({
          at: { x: dx, y: 690 },
          mark: "circle",
          circle: { radius: 2.4, fill: "#fde68a", stroke: "#fbbf24", strokeWidth: 0.6 },
        })),
        ...waves,
        {
          at: { x: towerX, y: antennaTipY },
          mark: "glow",
          glow: { radius: 60, gradientId: "g-tip" },
        },
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: towerD,
            fill: "url(#g-tower)",
            stroke: "#fde68a",
            strokeWidth: 1.5,
          },
        },
        ...crossBars,
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
        {
          at: { x: towerX, y: antennaTipY },
          mark: "circle",
          circle: { radius: 7, fill: "#fde68a", stroke: "#fbbf24", strokeWidth: 1 },
        },
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
        {
          at: { x: towerX, y: 815 },
          mark: "text",
          textMark: {
            text: "electromagnetic waves · speed of light · the city listens",
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
// ARCH — Greek temple
// ───────────────────────────────────────────────────────────────────────────
function buildTemple() {
  const W = 1100;
  const H = 700;
  const groundY = 600;
  const colCount = 6;
  const colSpacing = 140;
  const colTopY = 230;
  const colBaseY = groundY - 30;
  const colHalfBase = 28;
  const colHalfTop = 22;
  const colMidBulge = 4;

  const h = colBaseY - colTopY;
  const colBodyD = [
    `M ${-colHalfTop} 0`,
    `L ${colHalfTop} 0`,
    `Q ${colHalfBase + colMidBulge} ${h / 2}, ${colHalfBase} ${h}`,
    `L ${-colHalfBase} ${h}`,
    `Q ${-colHalfBase - colMidBulge} ${h / 2}, ${-colHalfTop} 0`,
    "Z",
  ].join(" ");

  const colStartX = W / 2 - ((colCount - 1) / 2) * colSpacing;
  const columns = [];
  for (let i = 0; i < colCount; i++) {
    const colX = colStartX + i * colSpacing;
    columns.push({
      at: { x: colX, y: colTopY },
      mark: "silhouette-path",
      silhouettePath: {
        d: colBodyD,
        fill: "url(#p-flute)",
        stroke: "#3a3a2a",
        strokeWidth: 1.4,
      },
    });
    columns.push({
      at: { x: colX, y: colTopY - 14 },
      mark: "silhouette-path",
      silhouettePath: {
        d: `M ${-colHalfTop} 14 L ${-colHalfTop - 4} 8 Q ${-colHalfTop - 8} 0, ${-colHalfTop - 6} -2 L ${colHalfTop + 6} -2 Q ${colHalfTop + 8} 0, ${colHalfTop + 4} 8 L ${colHalfTop} 14 Z`,
        fill: "#fefce8",
        stroke: "#3a3a2a",
        strokeWidth: 1.4,
      },
    });
    columns.push({
      at: { x: colX, y: colTopY - 26 },
      mark: "silhouette-path",
      silhouettePath: {
        d: `M ${-colHalfTop - 14} 0 L ${colHalfTop + 14} 0 L ${colHalfTop + 14} 12 L ${-colHalfTop - 14} 12 Z`,
        fill: "#fefce8",
        stroke: "#3a3a2a",
        strokeWidth: 1.4,
      },
    });
  }

  const pedimentLeft = colStartX - colHalfBase - 30;
  const pedimentRight = colStartX + (colCount - 1) * colSpacing + colHalfBase + 30;
  const pedimentBaseY = colTopY - 70;
  const pedimentApexY = 100;

  const friezeYTop = colTopY - 60;
  const triglyphs = [];
  for (let i = 0; i < colCount; i++) {
    const colX = colStartX + i * colSpacing;
    triglyphs.push({
      at: { x: colX - 10, y: friezeYTop + 4 },
      mark: "silhouette-path",
      silhouettePath: {
        d: "M 0 0 L 20 0 L 20 28 L 0 28 Z",
        fill: "#fefce8",
        stroke: "#3a3a2a",
        strokeWidth: 1,
      },
    });
    triglyphs.push({
      at: { x: colX, y: friezeYTop + 4 },
      mark: "polyline",
      polyline: {
        points: [
          [0, 0],
          [0, 28],
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
        "Doric order, ~500 BCE. Six fluted columns with entasis stand on a stylobate; a triglyph-metope frieze runs across the entablature; a pediment caps the front. Height:diameter ≈ 5:1 — the Parthenon's blueprint.",
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
              { offset: "55%", color: "#fde9b0", opacity: 1 },
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
            width: 7,
            height: 8,
            children: [
              { kind: "line", x1: 0, y1: 0, x2: 0, y2: 8, stroke: "#3a3a2a", strokeWidth: 0.5 },
              { kind: "line", x1: 3.5, y1: 0, x2: 3.5, y2: 8, stroke: "#3a3a2a", strokeWidth: 0.3 },
            ],
          },
          {
            id: "p-marble",
            width: 80,
            height: 30,
            children: [
              { kind: "line", x1: 0, y1: 0, x2: 80, y2: 0, stroke: "#3a3a2a", strokeWidth: 0.3 },
              { kind: "line", x1: 0, y1: 15, x2: 80, y2: 15, stroke: "#3a3a2a", strokeWidth: 0.3 },
              { kind: "line", x1: 40, y1: 0, x2: 40, y2: 15, stroke: "#3a3a2a", strokeWidth: 0.3 },
              { kind: "line", x1: 0, y1: 15, x2: 0, y2: 30, stroke: "#3a3a2a", strokeWidth: 0.3 },
              { kind: "line", x1: 80, y1: 15, x2: 80, y2: 30, stroke: "#3a3a2a", strokeWidth: 0.3 },
            ],
          },
        ],
      },
      children: [
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${W} 0 L ${W} ${groundY} L 0 ${groundY} Z`,
            fill: "url(#g-sky)",
            stroke: "none",
          },
        },
        {
          at: { x: 0, y: groundY },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${W} 0 L ${W} ${H - groundY} L 0 ${H - groundY} Z`,
            fill: "url(#g-ground)",
            stroke: "none",
          },
        },
        {
          at: { x: pedimentLeft - 20, y: colBaseY },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${pedimentRight - pedimentLeft + 40} 0 L ${pedimentRight - pedimentLeft + 30} 14 L 10 14 Z`,
            fill: "url(#p-marble)",
            stroke: "#3a3a2a",
            strokeWidth: 2,
          },
        },
        {
          at: { x: pedimentLeft - 30, y: colBaseY + 14 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${pedimentRight - pedimentLeft + 60} 0 L ${pedimentRight - pedimentLeft + 50} 14 L 10 14 Z`,
            fill: "url(#p-marble)",
            stroke: "#3a3a2a",
            strokeWidth: 2,
          },
        },
        {
          at: { x: pedimentLeft - 40, y: colBaseY + 28 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${pedimentRight - pedimentLeft + 80} 0 L ${pedimentRight - pedimentLeft + 70} 14 L 10 14 Z`,
            fill: "url(#p-marble)",
            stroke: "#3a3a2a",
            strokeWidth: 2,
          },
        },
        ...columns,
        {
          at: { x: pedimentLeft, y: colTopY - 38 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${pedimentRight - pedimentLeft} 0 L ${pedimentRight - pedimentLeft} 12 L 0 12 Z`,
            fill: "url(#p-marble)",
            stroke: "#3a3a2a",
            strokeWidth: 2,
          },
        },
        {
          at: { x: pedimentLeft, y: friezeYTop },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${pedimentRight - pedimentLeft} 0 L ${pedimentRight - pedimentLeft} 36 L 0 36 Z`,
            fill: "#fefce8",
            stroke: "#3a3a2a",
            strokeWidth: 2,
          },
        },
        ...triglyphs,
        {
          at: { x: pedimentLeft - 10, y: pedimentBaseY },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${pedimentRight - pedimentLeft + 20} 0 L ${pedimentRight - pedimentLeft + 20} 12 L 0 12 Z`,
            fill: "url(#p-marble)",
            stroke: "#3a3a2a",
            strokeWidth: 2,
          },
        },
        {
          at: { x: 0, y: 0 },
          mark: "polygon",
          polygon: {
            points: [
              [pedimentLeft - 10, pedimentBaseY],
              [pedimentRight + 10, pedimentBaseY],
              [W / 2, pedimentApexY],
            ],
            fill: "url(#p-marble)",
            stroke: "#3a3a2a",
            strokeWidth: 2,
          },
        },
        {
          at: { x: W / 2, y: pedimentBaseY - 35 },
          mark: "ellipse",
          ellipse: { rx: 14, ry: 11, fill: "#3a3a2a" },
        },
        ...[-50, 50].map((dx) => ({
          at: { x: W / 2 + dx, y: pedimentBaseY - 22 },
          mark: "ellipse",
          ellipse: { rx: 10, ry: 8, fill: "#3a3a2a" },
        })),
        {
          at: { x: W / 2, y: pedimentApexY - 20 },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M -8 20 Q -4 0, 0 -12 Q 4 0, 8 20 Z",
            fill: "#fefce8",
            stroke: "#3a3a2a",
            strokeWidth: 1.4,
          },
        },
        {
          at: { x: W / 2, y: 65 },
          mark: "text",
          textMark: {
            text: "Templum Doricum",
            fontSize: 22,
            fill: "#1f1a14",
            italic: true,
            anchor: "middle",
          },
        },
        {
          at: { x: W / 2, y: 670 },
          mark: "text",
          textMark: {
            text: "stylobate · entasis · echinus · abacus · architrave · frieze · pediment",
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
// ARCH — Gothic cathedral (Notre-Dame west facade, professional drafting)
// ───────────────────────────────────────────────────────────────────────────
function buildCathedral() {
  const W = 900;
  const H = 1300;
  const groundY = 1240;

  // Three-part facade (twin towers + central nave)
  const towerLX0 = 90;
  const towerLX1 = 320;
  const towerRX0 = 580;
  const towerRX1 = 810;
  const naveX0 = 320;
  const naveX1 = 580;
  const naveCenterX = (naveX0 + naveX1) / 2;

  // Tower top (square plinth where spire starts) — at this y, the towers
  // are still rectangular; above it, spires begin.
  const towerTopY = 380;
  const spireTipY = 100;

  // Pinnacle (small spires at corners of tower top)
  const pinnacleD = "M -8 0 L 8 0 L 0 -28 Z";

  // Rose window
  const roseCy = 670;
  const roseR = 95;

  // Build a rose-window-petal pattern: 12 outer arches forming a ring around
  // the rose center, plus 6 inner spokes for additional tracery.
  const rosePetals = [];
  for (let i = 0; i < 12; i++) {
    const a = (2 * Math.PI * i) / 12;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    // a teardrop-shape petal from the outer ring inward
    rosePetals.push({
      at: { x: naveCenterX, y: roseCy },
      mark: "polyline",
      polyline: {
        points: [
          [round(18 * cos), round(18 * sin)],
          [round(roseR * 0.6 * cos - 12 * sin), round(roseR * 0.6 * sin + 12 * cos)],
          [round(roseR * 0.92 * cos), round(roseR * 0.92 * sin)],
          [round(roseR * 0.6 * cos + 12 * sin), round(roseR * 0.6 * sin - 12 * cos)],
          [round(18 * cos), round(18 * sin)],
        ],
        fill: "none",
        stroke: "#3a2a14",
        strokeWidth: 1.4,
      },
    });
  }

  // Triple portal — three pointed-arch doorways at the base
  // Central portal is bigger
  const centralPortalCx = naveCenterX;
  const centralPortalBaseY = groundY;
  const sidePortalBaseY = groundY;

  // Kings' Gallery — row of 7 small arched niches above the portals
  const kingsArches = [];
  const kingsY = 850;
  for (let i = 0; i < 7; i++) {
    const kx = naveX0 + 30 + i * 30;
    kingsArches.push({
      at: { x: kx, y: kingsY },
      mark: "silhouette-path",
      silhouettePath: {
        d: "M -10 0 L -10 -32 Q -10 -42, 0 -42 Q 10 -42, 10 -32 L 10 0 Z",
        fill: "#3a2a14",
        stroke: "#1f1a14",
        strokeWidth: 0.8,
      },
    });
  }

  // Tower belfry windows — tall pointed lancet pair per tower
  const belfryWindows = [];
  for (const [tx0, tx1] of [
    [towerLX0, towerLX1],
    [towerRX0, towerRX1],
  ]) {
    const mid = (tx0 + tx1) / 2;
    // Two lancets per belfry
    belfryWindows.push({
      at: { x: mid - 26, y: 580 },
      mark: "silhouette-path",
      silhouettePath: {
        d: "M -14 0 L -14 -100 Q -14 -130, 0 -130 Q 14 -130, 14 -100 L 14 0 Z",
        fill: "#1f1a14",
        stroke: "#3a2a14",
        strokeWidth: 1.4,
      },
    });
    belfryWindows.push({
      at: { x: mid + 26, y: 580 },
      mark: "silhouette-path",
      silhouettePath: {
        d: "M -14 0 L -14 -100 Q -14 -130, 0 -130 Q 14 -130, 14 -100 L 14 0 Z",
        fill: "#1f1a14",
        stroke: "#3a2a14",
        strokeWidth: 1.4,
      },
    });
    // Oculus (small round window) above each tower's belfry
    belfryWindows.push({
      at: { x: mid, y: 470 },
      mark: "circle",
      circle: {
        radius: 14,
        fill: "#3a2a14",
        stroke: "#fefce8",
        strokeWidth: 1.4,
      },
    });
  }

  return {
    compose: {
      viewBox: { width: W, height: H },
      title: "Notre-Dame west facade — Gothic order, professional draft",
      description:
        "West facade of a French Gothic cathedral, drawn in the style of a 19th-century architectural draftsman. Three horizontal stages — portal level (triple pointed-arch doorway), gallery level (Kings' Gallery with arcaded niches), rose-window level — capped by twin towers with belfry lancets, oculi, and tall pinnacled spires. Notre-Dame (1163), Chartres (1145), Reims (1211), Cologne (1248).",
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
              { offset: "50%", color: "#fed7aa", opacity: 1 },
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
              { offset: "25%", color: "#dc2626", opacity: 0.9 },
              { offset: "55%", color: "#1d4ed8", opacity: 0.95 },
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
              { offset: "0%", color: "#e7ddc6", opacity: 1 },
              { offset: "50%", color: "#ebe1c4", opacity: 1 },
              { offset: "100%", color: "#cbb89c", opacity: 1 },
            ],
          },
          {
            id: "g-spire",
            kind: "linear",
            x1: "0%",
            y1: "0%",
            x2: "100%",
            y2: "0%",
            stops: [
              { offset: "0%", color: "#3a4a2a", opacity: 1 },
              { offset: "50%", color: "#5a6a3a", opacity: 1 },
              { offset: "100%", color: "#3a4a2a", opacity: 1 },
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
        // Ground (paving)
        {
          at: { x: 0, y: groundY },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${W} 0 L ${W} ${H - groundY} L 0 ${H - groundY} Z`,
            fill: "#8b9968",
            stroke: "none",
          },
        },
        // Distant city/abbey rooftops in haze
        {
          at: { x: 0, y: groundY - 40 },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M 0 40 L 40 30 L 70 35 L 110 25 L 140 30 L 170 20 L 200 28 L 230 18 L 0 18 Z M 700 30 L 740 22 L 770 28 L 810 18 L 840 25 L 900 22 L 900 40 L 700 40 Z",
            fill: "rgba(124,45,18,.2)",
            stroke: "none",
          },
        },
        // ── Cathedral structure ──
        // Left tower body
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M ${towerLX0} ${groundY} L ${towerLX0} ${towerTopY} L ${towerLX1} ${towerTopY} L ${towerLX1} ${groundY} Z`,
            fill: "url(#g-stone)",
            stroke: "#3a2a14",
            strokeWidth: 2.4,
          },
        },
        // Right tower body
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M ${towerRX0} ${groundY} L ${towerRX0} ${towerTopY} L ${towerRX1} ${towerTopY} L ${towerRX1} ${groundY} Z`,
            fill: "url(#g-stone)",
            stroke: "#3a2a14",
            strokeWidth: 2.4,
          },
        },
        // Central nave body (with peaked Gothic gable above rose window)
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M ${naveX0} ${groundY} L ${naveX0} ${roseCy - roseR - 60} L ${naveX0 + 30} ${roseCy - roseR - 100} L ${naveCenterX} ${roseCy - roseR - 160} L ${naveX1 - 30} ${roseCy - roseR - 100} L ${naveX1} ${roseCy - roseR - 60} L ${naveX1} ${groundY} Z`,
            fill: "url(#g-stone)",
            stroke: "#3a2a14",
            strokeWidth: 2.4,
          },
        },
        // String courses (4 horizontal stone bands across the entire facade
        // at the major level breaks: above portals, above gallery, above rose, at tower top)
        ...[820, 760, 540, towerTopY + 10].map((y) => ({
          at: { x: 0, y },
          mark: "polyline",
          polyline: {
            points: [
              [towerLX0, 0],
              [towerRX1, 0],
            ],
            fill: "none",
            stroke: "#3a2a14",
            strokeWidth: 1.2,
          },
        })),
        // Left tower spire (tall, pyramidal)
        {
          at: { x: 0, y: 0 },
          mark: "polygon",
          polygon: {
            points: [
              [towerLX0 - 16, towerTopY],
              [towerLX1 + 16, towerTopY],
              [(towerLX0 + towerLX1) / 2, spireTipY],
            ],
            fill: "url(#g-spire)",
            stroke: "#1f1a14",
            strokeWidth: 2,
          },
        },
        // Right tower spire
        {
          at: { x: 0, y: 0 },
          mark: "polygon",
          polygon: {
            points: [
              [towerRX0 - 16, towerTopY],
              [towerRX1 + 16, towerTopY],
              [(towerRX0 + towerRX1) / 2, spireTipY],
            ],
            fill: "url(#g-spire)",
            stroke: "#1f1a14",
            strokeWidth: 2,
          },
        },
        // Cross at each tower spire tip
        ...[(towerLX0 + towerLX1) / 2, (towerRX0 + towerRX1) / 2].map((cx) => ({
          at: { x: cx, y: spireTipY - 6 },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M 0 0 L 0 -22 M -9 -14 L 9 -14",
            fill: "none",
            stroke: "#3a2a14",
            strokeWidth: 2,
          },
        })),
        // Pinnacles at corners of tower tops (4 per tower = 8 total, but
        // here we use just 2 outer corner pinnacles per tower for clarity)
        ...[towerLX0, towerLX1, towerRX0, towerRX1].map((cx) => ({
          at: { x: cx, y: towerTopY },
          mark: "polygon",
          polygon: {
            points: [
              [-8, 0],
              [8, 0],
              [0, -28],
            ],
            fill: "url(#g-stone)",
            stroke: "#3a2a14",
            strokeWidth: 1.4,
          },
        })),
        // Tower belfry windows + oculi (6 children)
        ...belfryWindows,
        // Rose window — outer dark ring
        {
          at: { x: naveCenterX, y: roseCy },
          mark: "circle",
          circle: {
            radius: roseR + 10,
            fill: "#3a2a14",
            stroke: "#fefce8",
            strokeWidth: 2.4,
          },
        },
        // Rose window — stained glass (radial gradient)
        {
          at: { x: naveCenterX, y: roseCy },
          mark: "circle",
          circle: { radius: roseR, fill: "url(#g-rose)" },
        },
        // Rose petals (12 tracery polylines)
        ...rosePetals,
        // Rose central hub
        {
          at: { x: naveCenterX, y: roseCy },
          mark: "circle",
          circle: {
            radius: 16,
            fill: "#fef3c7",
            stroke: "#3a2a14",
            strokeWidth: 1.5,
          },
        },
        // Gothic pointed arch frame ABOVE the rose (the gable arch)
        {
          at: { x: naveCenterX, y: roseCy },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M ${-roseR - 30} ${-10} Q ${-roseR - 30} ${-roseR - 100}, 0 ${-roseR - 130} Q ${roseR + 30} ${-roseR - 100}, ${roseR + 30} ${-10}`,
            fill: "none",
            stroke: "#3a2a14",
            strokeWidth: 1.8,
          },
        },
        // Kings' Gallery — arcaded niches (7 children)
        ...kingsArches,
        // String course below Kings' Gallery (extra emphasis)
        {
          at: { x: 0, y: 890 },
          mark: "polyline",
          polyline: {
            points: [
              [towerLX0, 0],
              [towerRX1, 0],
            ],
            fill: "none",
            stroke: "#3a2a14",
            strokeWidth: 2.4,
          },
        },
        // Central portal (large pointed Gothic arch with recessed orders)
        {
          at: { x: centralPortalCx, y: centralPortalBaseY },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M -68 0 L -68 -150 Q -68 -210, 0 -210 Q 68 -210, 68 -150 L 68 0 Z",
            fill: "#3a2a14",
            stroke: "#1f1a14",
            strokeWidth: 2.4,
          },
        },
        // Central portal recessed inner arch
        {
          at: { x: centralPortalCx, y: centralPortalBaseY - 4 },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M -58 0 L -58 -140 Q -58 -195, 0 -195 Q 58 -195, 58 -140 L 58 0 Z",
            fill: "#1f1a14",
            stroke: "#fefce8",
            strokeWidth: 1.4,
          },
        },
        // Central portal mullion (vertical divider)
        {
          at: { x: centralPortalCx, y: centralPortalBaseY - 4 },
          mark: "polyline",
          polyline: {
            points: [
              [0, -190],
              [0, 0],
            ],
            fill: "none",
            stroke: "#fefce8",
            strokeWidth: 1.4,
          },
        },
        // Left side portal (smaller)
        {
          at: { x: naveX0 + 50, y: centralPortalBaseY },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M -30 0 L -30 -90 Q -30 -130, 0 -130 Q 30 -130, 30 -90 L 30 0 Z",
            fill: "#3a2a14",
            stroke: "#1f1a14",
            strokeWidth: 1.8,
          },
        },
        // Right side portal
        {
          at: { x: naveX1 - 50, y: centralPortalBaseY },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M -30 0 L -30 -90 Q -30 -130, 0 -130 Q 30 -130, 30 -90 L 30 0 Z",
            fill: "#3a2a14",
            stroke: "#1f1a14",
            strokeWidth: 1.8,
          },
        },
        // Buttress piers below the towers (2 per outer corner)
        ...[towerLX0, towerRX1].map((bx) => ({
          at: { x: bx, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M -12 ${groundY} L -12 ${roseCy + 100} L -8 ${roseCy + 60} L -8 ${groundY} Z M -8 ${groundY} L -8 ${roseCy + 100} L -4 ${roseCy + 60} L -4 ${groundY} Z`,
            fill: "url(#g-stone)",
            stroke: "#3a2a14",
            strokeWidth: 1.4,
          },
        })),
        // Title
        {
          at: { x: W / 2, y: 75 },
          mark: "text",
          textMark: {
            text: "Ecclesia Cathedralis · Notre-Dame de Paris, west facade",
            fontSize: 17,
            fill: "#1f1a14",
            italic: true,
            anchor: "middle",
          },
        },
        // Caption
        {
          at: { x: W / 2, y: 1290 },
          mark: "text",
          textMark: {
            text: "pointed arch · flying buttress · rose window · stained glass · pinnacle · spire · Kings' Gallery",
            fontSize: 12,
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
// ARCH — Skyscraper (Empire State Building / Art Deco, professional draft)
// ───────────────────────────────────────────────────────────────────────────
function buildSkyscraper() {
  const W = 900;
  const H = 1400;
  const groundY = 1340;
  const cx = W / 2;

  // 4-tier Art-Deco massing (Empire State / Chrysler hybrid):
  //   Tier 1 (base, widest)     : y 1100 → 1340
  //   Setback A                 : y 1100
  //   Tier 2 (middle, narrower) : y 600 → 1100
  //   Setback B                 : y 600
  //   Tier 3 (upper, narrower)  : y 320 → 600
  //   Setback C                 : y 320
  //   Tier 4 (crown)            : y 180 → 320
  //   Spire/antenna             : y 60 → 180
  const tier1W = 340;
  const tier2W = 240;
  const tier3W = 160;
  const tier4W = 84;
  const tier1Top = 1100;
  const tier2Top = 600;
  const tier3Top = 320;
  const tier4Top = 180;
  const spireTop = 60;

  const halfT1 = tier1W / 2;
  const halfT2 = tier2W / 2;
  const halfT3 = tier3W / 2;
  const halfT4 = tier4W / 2;

  // Vertical limestone bands (Art Deco vertical emphasis) on each tier — these
  // are thin lines running vertically through the window grid, suggesting
  // the limestone-clad piers between the recessed window bays.
  const tier1Bands = [];
  for (let i = -5; i <= 5; i++) {
    if (i === 0) continue;
    const x = cx + i * 28;
    tier1Bands.push({
      at: { x, y: 0 },
      mark: "polyline",
      polyline: {
        points: [
          [0, tier1Top + 10],
          [0, groundY - 30],
        ],
        fill: "none",
        stroke: "rgba(31,30,40,.7)",
        strokeWidth: 1.2,
      },
    });
  }

  // Crown ornaments — radial Art-Deco fan above tier 4 (like Chrysler's
  // crown). Use 3 stepped arches narrowing toward the spire.
  const crownArches = [];
  for (let i = 0; i < 3; i++) {
    const half = halfT4 - i * 14;
    const yTop = tier4Top + 10 - i * 18;
    const yBot = tier4Top + 50 - i * 18;
    crownArches.push({
      at: { x: cx, y: 0 },
      mark: "silhouette-path",
      silhouettePath: {
        d: `M ${-half} ${yBot} L ${-half} ${yTop + 20} Q ${-half} ${yTop}, 0 ${yTop} Q ${half} ${yTop}, ${half} ${yTop + 20} L ${half} ${yBot}`,
        fill: "url(#g-tower)",
        stroke: "#0c1126",
        strokeWidth: 1.4,
      },
    });
  }

  return {
    compose: {
      viewBox: { width: W, height: H },
      title: "Empire State — modernist tower at dusk, Art Deco draft",
      description:
        "Steel-frame modernist tower in profile, drawn in the spirit of a 1930s architect's rendering. Three-tier setback massing inspired by the Empire State Building (1931): a wide limestone base, narrower middle shaft, slender upper shaft, and an Art-Deco crown with stepped arches feeding into a needle spire. Adjacent buildings, moon, sunset gradient. Sullivan (1896): form follows function.",
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
              { offset: "0%", color: "#1e1b4b", opacity: 1 },
              { offset: "30%", color: "#7c2d12", opacity: 1 },
              { offset: "60%", color: "#dc2626", opacity: 1 },
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
              { offset: "0%", color: "#374151", opacity: 1 },
              { offset: "50%", color: "#4b5563", opacity: 1 },
              { offset: "100%", color: "#1f2937", opacity: 1 },
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
              { offset: "0%", color: "#fde68a", opacity: 0.42 },
              { offset: "60%", color: "#dc2626", opacity: 0.12 },
              { offset: "100%", color: "#fde68a", opacity: 0 },
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
          {
            id: "g-moon",
            kind: "radial",
            cx: "50%",
            cy: "50%",
            r: "50%",
            stops: [
              { offset: "0%", color: "#fef9c3", opacity: 1 },
              { offset: "100%", color: "#fde68a", opacity: 0.95 },
            ],
          },
        ],
        patterns: [
          {
            id: "p-windows",
            width: 28,
            height: 36,
            children: [
              { kind: "rect", x: 5, y: 6, width: 8, height: 14, fill: "#fde68a" },
              { kind: "rect", x: 15, y: 6, width: 8, height: 14, fill: "#fbbf24" },
              {
                kind: "rect",
                x: 5,
                y: 22,
                width: 8,
                height: 10,
                fill: "rgba(253,230,138,.35)",
              },
              { kind: "rect", x: 15, y: 22, width: 8, height: 10, fill: "#fde68a" },
            ],
          },
          {
            id: "p-adj-windows",
            width: 16,
            height: 22,
            children: [
              { kind: "rect", x: 2, y: 3, width: 4, height: 7, fill: "#fde68a" },
              { kind: "rect", x: 9, y: 3, width: 4, height: 7, fill: "rgba(253,230,138,.4)" },
              { kind: "rect", x: 2, y: 13, width: 4, height: 7, fill: "#fde68a" },
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
        // Moon
        {
          at: { x: 720, y: 200 },
          mark: "circle",
          circle: {
            radius: 38,
            fill: "url(#g-moon)",
            stroke: "rgba(254,243,199,.5)",
            strokeWidth: 1,
          },
        },
        // Moon craters
        ...[
          [-8, -10, 4],
          [10, -2, 3],
          [-2, 12, 2.5],
        ].map(([dx, dy, r]) => ({
          at: { x: 720 + dx, y: 200 + dy },
          mark: "circle",
          circle: { radius: r, fill: "rgba(202,138,4,.25)" },
        })),
        // Stars
        {
          at: { x: 0, y: 0 },
          mark: "starfield",
          starfield: { count: 40, seed: 47, region: { x: 0, y: 0, w: W, h: 320 } },
        },
        // Adjacent buildings - varied silhouettes
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M 0 920 L 80 920 L 80 1340 L 0 1340 Z M 80 1020 L 200 1020 L 200 1340 L 80 1340 Z M 200 980 L 280 980 L 280 1340 L 200 1340 Z",
            fill: "#0c1126",
            stroke: "#1d2444",
            strokeWidth: 1,
          },
        },
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M 620 900 L 720 900 L 720 1340 L 620 1340 Z M 720 1000 L 820 1000 L 820 1340 L 720 1340 Z M 820 940 L 900 940 L 900 1340 L 820 1340 Z",
            fill: "#0c1126",
            stroke: "#1d2444",
            strokeWidth: 1,
          },
        },
        // Adjacent building windows
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M 0 920 L 80 920 L 80 1340 L 0 1340 Z M 80 1020 L 200 1020 L 200 1340 L 80 1340 Z M 200 980 L 280 980 L 280 1340 L 200 1340 Z M 620 900 L 720 900 L 720 1340 L 620 1340 Z M 720 1000 L 820 1000 L 820 1340 L 720 1340 Z M 820 940 L 900 940 L 900 1340 L 820 1340 Z",
            fill: "url(#p-adj-windows)",
            stroke: "none",
            opacity: 0.55,
          },
        },
        // ── Main tower (4 tiers) ──
        // Tier 1 (base)
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M ${cx - halfT1} ${groundY} L ${cx - halfT1} ${tier1Top} L ${cx + halfT1} ${tier1Top} L ${cx + halfT1} ${groundY} Z`,
            fill: "url(#g-tower)",
            stroke: "#0c4a6e",
            strokeWidth: 2,
          },
        },
        // Tier 1 window grid (recessed)
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M ${cx - halfT1 + 14} ${groundY - 40} L ${cx + halfT1 - 14} ${groundY - 40} L ${cx + halfT1 - 14} ${tier1Top + 30} L ${cx - halfT1 + 14} ${tier1Top + 30} Z`,
            fill: "url(#p-windows)",
            stroke: "none",
          },
        },
        // Vertical limestone bands on tier 1
        ...tier1Bands,
        // Tier 1 cornice (horizontal band at top)
        {
          at: { x: 0, y: tier1Top + 4 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M ${cx - halfT1 - 6} 0 L ${cx + halfT1 + 6} 0 L ${cx + halfT1 + 6} 14 L ${cx - halfT1 - 6} 14 Z`,
            fill: "#1f2937",
            stroke: "#fde68a",
            strokeWidth: 1.4,
          },
        },
        // Tier 2 (middle)
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M ${cx - halfT2} ${tier1Top} L ${cx - halfT2} ${tier2Top} L ${cx + halfT2} ${tier2Top} L ${cx + halfT2} ${tier1Top} Z`,
            fill: "url(#g-tower)",
            stroke: "#0c4a6e",
            strokeWidth: 2,
          },
        },
        // Tier 2 windows
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M ${cx - halfT2 + 10} ${tier1Top - 10} L ${cx + halfT2 - 10} ${tier1Top - 10} L ${cx + halfT2 - 10} ${tier2Top + 20} L ${cx - halfT2 + 10} ${tier2Top + 20} Z`,
            fill: "url(#p-windows)",
            stroke: "none",
          },
        },
        // Tier 2 cornice
        {
          at: { x: 0, y: tier2Top + 4 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M ${cx - halfT2 - 5} 0 L ${cx + halfT2 + 5} 0 L ${cx + halfT2 + 5} 12 L ${cx - halfT2 - 5} 12 Z`,
            fill: "#1f2937",
            stroke: "#fde68a",
            strokeWidth: 1.4,
          },
        },
        // Tier 3 (upper)
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M ${cx - halfT3} ${tier2Top} L ${cx - halfT3} ${tier3Top} L ${cx + halfT3} ${tier3Top} L ${cx + halfT3} ${tier2Top} Z`,
            fill: "url(#g-tower)",
            stroke: "#0c4a6e",
            strokeWidth: 2,
          },
        },
        // Tier 3 windows
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M ${cx - halfT3 + 8} ${tier2Top - 6} L ${cx + halfT3 - 8} ${tier2Top - 6} L ${cx + halfT3 - 8} ${tier3Top + 15} L ${cx - halfT3 + 8} ${tier3Top + 15} Z`,
            fill: "url(#p-windows)",
            stroke: "none",
          },
        },
        // Tier 3 cornice
        {
          at: { x: 0, y: tier3Top + 4 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M ${cx - halfT3 - 4} 0 L ${cx + halfT3 + 4} 0 L ${cx + halfT3 + 4} 10 L ${cx - halfT3 - 4} 10 Z`,
            fill: "#1f2937",
            stroke: "#fde68a",
            strokeWidth: 1.2,
          },
        },
        // Tier 4 (crown body)
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M ${cx - halfT4} ${tier3Top} L ${cx - halfT4} ${tier4Top} L ${cx + halfT4} ${tier4Top} L ${cx + halfT4} ${tier3Top} Z`,
            fill: "url(#g-tower)",
            stroke: "#0c4a6e",
            strokeWidth: 2,
          },
        },
        // Tier 4 small window
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M ${cx - halfT4 + 6} ${tier3Top - 4} L ${cx + halfT4 - 6} ${tier3Top - 4} L ${cx + halfT4 - 6} ${tier4Top + 10} L ${cx - halfT4 + 6} ${tier4Top + 10} Z`,
            fill: "url(#p-windows)",
            stroke: "none",
          },
        },
        // Crown decorative stepped arches (Art Deco)
        ...crownArches,
        // Reflection overlay (warm diagonal across the whole tower)
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M ${cx - halfT1 + 14} ${groundY - 40} L ${cx + halfT1 - 14} ${groundY - 40} L ${cx + halfT1 - 14} ${tier1Top + 30} L ${cx - halfT1 + 14} ${tier1Top + 30} Z`,
            fill: "url(#g-reflect)",
            stroke: "none",
          },
        },
        // Spire (the needle on top, with subtle taper)
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M ${cx - 6} ${tier4Top} L ${cx + 6} ${tier4Top} L ${cx + 3} ${spireTop + 20} L ${cx} ${spireTop} L ${cx - 3} ${spireTop + 20} Z`,
            fill: "#1f2937",
            stroke: "#fde68a",
            strokeWidth: 1.4,
          },
        },
        // Spire warning light (pulses red)
        {
          at: { x: cx, y: spireTop + 6 },
          mark: "circle",
          circle: {
            radius: 4.5,
            fill: "#dc2626",
            stroke: "#7c2d12",
            strokeWidth: 0.5,
          },
          animation: { kind: "pulse", periodMs: 1500, scale: 1.6 },
        },
        // Ground (dark street level)
        {
          at: { x: 0, y: groundY },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${W} 0 L ${W} ${H - groundY} L 0 ${H - groundY} Z`,
            fill: "url(#g-ground)",
            stroke: "none",
          },
        },
        // Street lights (small glowing dots)
        ...[120, 280, 440, 600, 780].map((dx) => ({
          at: { x: dx, y: groundY + 22 },
          mark: "circle",
          circle: {
            radius: 3,
            fill: "#fef3c7",
            stroke: "rgba(254,243,199,.4)",
            strokeWidth: 4,
          },
        })),
        // Title
        {
          at: { x: W / 2, y: 38 },
          mark: "text",
          textMark: {
            text: "form follows function · Sullivan, 1896 · Empire State, 1931",
            fontSize: 13,
            fill: "#fef3c7",
            italic: true,
            anchor: "middle",
          },
        },
        // Caption
        {
          at: { x: W / 2, y: 1380 },
          mark: "text",
          textMark: {
            text: "steel frame · limestone clad · 102 stories · 381 m to roof · 443 m to needle",
            fontSize: 12,
            fill: "#fbbf24",
            italic: true,
            anchor: "middle",
          },
        },
      ],
    },
  };
}

const fixtures = {
  "bio-neuron.json": buildNeuron(),
  "bio-butterfly.json": buildButterfly(),
  "bio-circulation.json": buildCirculation(),
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
