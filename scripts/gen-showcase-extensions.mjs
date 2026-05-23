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
// ENG — Steam locomotive
// ───────────────────────────────────────────────────────────────────────────
function buildLocomotive() {
  const W = 1300;
  const H = 620;

  const trackY = 500;
  const bodyY = 280;
  const wheelY = trackY - 8;

  const wheels = [
    { x: 320, r: 38, isDriver: false },
    { x: 460, r: 60, isDriver: true },
    { x: 620, r: 60, isDriver: true },
    { x: 780, r: 60, isDriver: true },
  ];

  const buildWheelSpokes = (r) => {
    const spokes = [];
    for (let k = 0; k < 8; k++) {
      const a = (Math.PI * k) / 4;
      const x1 = round(8 * Math.cos(a));
      const y1 = round(8 * Math.sin(a));
      const x2 = round((r - 4) * Math.cos(a));
      const y2 = round((r - 4) * Math.sin(a));
      spokes.push(`M ${x1} ${y1} L ${x2} ${y2}`);
    }
    return spokes.join(" ");
  };

  const smokePuffs = [];
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    const px = 480 + i * 50 - i * i * 4 + (i % 2) * 8;
    const py = 130 - i * 22 - t * 12;
    const pr = 36 + i * 4 + (i % 3) * 8;
    smokePuffs.push({
      at: { x: round(px), y: round(py) },
      mark: "circle",
      circle: { radius: pr, fill: "url(#g-smoke)" },
    });
  }

  const hillsD =
    "M 0 380 L 80 320 L 160 350 L 240 290 L 350 320 L 480 280 L 600 310 L 740 290 L 880 320 L 1020 285 L 1170 310 L 1300 290 L 1300 460 L 0 460 Z";

  return {
    compose: {
      viewBox: { width: W, height: H },
      title: "Steam locomotive — fire on wheels",
      description:
        "Stevenson's Rocket (1829) → Mallard (1938, 203 km/h). Coal in the firebox boils water in the boiler; steam expands through cylinders; connecting rods turn the drivers; the whole thing rolls on steel rails.",
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
              { offset: "50%", color: "#3a3a2a", opacity: 1 },
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
              { offset: "0%", color: "#e2e8f0", opacity: 0.85 },
              { offset: "60%", color: "#94a3b8", opacity: 0.5 },
              { offset: "100%", color: "#94a3b8", opacity: 0 },
            ],
          },
          {
            id: "g-wheel",
            kind: "radial",
            cx: "50%",
            cy: "50%",
            r: "50%",
            stops: [
              { offset: "0%", color: "#1f1a14", opacity: 1 },
              { offset: "100%", color: "#0a0a0a", opacity: 1 },
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
              { offset: "0%", color: "#dc2626", opacity: 1 },
              { offset: "100%", color: "#7c2d12", opacity: 1 },
            ],
          },
        ],
      },
      children: [
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${W} 0 L ${W} ${trackY} L 0 ${trackY} Z`,
            fill: "url(#g-sky)",
            stroke: "none",
          },
        },
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: hillsD,
            fill: "rgba(107,138,74,.35)",
            stroke: "none",
          },
        },
        {
          at: { x: 0, y: trackY + 18 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${W} 0 L ${W} ${H - trackY - 18} L 0 ${H - trackY - 18} Z`,
            fill: "#a3b18a",
            stroke: "none",
          },
        },
        ...smokePuffs,
        {
          at: { x: 340, y: bodyY },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M 0 0 L 560 0 L 560 120 L 0 120 Z",
            fill: "url(#g-boiler)",
            stroke: "#1f1a14",
            strokeWidth: 2,
          },
        },
        ...[20, 50, 80, 110].map((dy) => ({
          at: { x: 340, y: bodyY + dy },
          mark: "polyline",
          polyline: {
            points: [
              [0, 0],
              [560, 0],
            ],
            fill: "none",
            stroke: "#fde68a",
            strokeWidth: 1.4,
          },
        })),
        {
          at: { x: 330, y: bodyY + 60 },
          mark: "circle",
          circle: { radius: 68, fill: "#1f1a14", stroke: "#fde68a", strokeWidth: 2.5 },
        },
        {
          at: { x: 330, y: bodyY + 60 },
          mark: "circle",
          circle: { radius: 50, fill: "none", stroke: "#fde68a", strokeWidth: 1.4 },
        },
        {
          at: { x: 280, y: bodyY + 60 },
          mark: "circle",
          circle: { radius: 18, fill: "#fef3c7", stroke: "#1f1a14", strokeWidth: 1.5 },
        },
        {
          at: { x: 280, y: bodyY + 60 },
          mark: "circle",
          circle: { radius: 10, fill: "#fde68a" },
        },
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 260 ${trackY - 10} L 330 ${bodyY + 110} L 330 ${trackY - 10} Z`,
            fill: "#1f1a14",
            stroke: "#fde68a",
            strokeWidth: 1.4,
          },
        },
        {
          at: { x: 420, y: bodyY - 65 },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M 0 0 L 60 0 L 70 65 L -10 65 Z",
            fill: "#1f1a14",
            stroke: "#fde68a",
            strokeWidth: 1.5,
          },
        },
        {
          at: { x: 580, y: bodyY - 20 },
          mark: "ellipse",
          ellipse: { rx: 32, ry: 22, fill: "#1f1a14", stroke: "#fde68a", strokeWidth: 1.5 },
        },
        {
          at: { x: 650, y: bodyY - 8 },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M 0 0 L 8 0 L 8 -22 L 0 -22 Z",
            fill: "#fde68a",
            stroke: "#1f1a14",
            strokeWidth: 1,
          },
        },
        {
          at: { x: 900, y: bodyY - 90 },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M 0 0 L 160 0 L 160 210 L 0 210 Z",
            fill: "url(#g-cab)",
            stroke: "#1f1a14",
            strokeWidth: 2,
          },
        },
        {
          at: { x: 888, y: bodyY - 95 },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M 0 0 L 184 0 L 184 10 L 0 10 Z",
            fill: "#1f1a14",
            stroke: "none",
          },
        },
        {
          at: { x: 920, y: bodyY - 70 },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M 0 0 L 60 0 L 60 55 L 0 55 Z",
            fill: "#fef3c7",
            stroke: "#1f1a14",
            strokeWidth: 1.4,
          },
        },
        {
          at: { x: 1060, y: bodyY - 20 },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M 0 0 L 180 0 L 180 140 L 0 140 Z",
            fill: "#3a2a14",
            stroke: "#1f1a14",
            strokeWidth: 2,
          },
        },
        {
          at: { x: 1070, y: bodyY - 30 },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M 0 0 L 160 0 L 160 12 L 80 5 L 0 12 Z",
            fill: "#0a0a0a",
            stroke: "#1f1a14",
            strokeWidth: 1,
          },
        },
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M ${wheels[1].x} ${wheelY} L ${wheels[3].x} ${wheelY}`,
            fill: "none",
            stroke: "#fde68a",
            strokeWidth: 6,
            strokeLinecap: "round",
          },
        },
        ...wheels.map((w) => ({
          at: { x: w.x, y: wheelY },
          mark: "circle",
          circle: {
            radius: w.r,
            fill: "url(#g-wheel)",
            stroke: "#fde68a",
            strokeWidth: 2.5,
          },
          animation: { kind: "rotate-loop", periodMs: 3500, direction: "cw" },
        })),
        ...wheels.map((w) => ({
          at: { x: w.x, y: wheelY },
          mark: "silhouette-path",
          silhouettePath: {
            d: buildWheelSpokes(w.r),
            fill: "none",
            stroke: "#fde68a",
            strokeWidth: 2.2,
          },
          animation: { kind: "rotate-loop", periodMs: 3500, direction: "cw" },
        })),
        ...wheels.map((w) => ({
          at: { x: w.x, y: wheelY },
          mark: "circle",
          circle: { radius: 6, fill: "#fde68a", stroke: "#1f1a14", strokeWidth: 1 },
        })),
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
          at: { x: 0, y: trackY + 6 },
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
          at: { x: W / 2, y: 580 },
          mark: "text",
          textMark: {
            text: "coal → steam → connecting rods → 200 km/h on steel",
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
// ARCH — Gothic cathedral
// ───────────────────────────────────────────────────────────────────────────
function buildCathedral() {
  const W = 800;
  const H = 1050;
  const groundY = 950;

  const naveX0 = 220;
  const naveX1 = 580;
  const naveTopY = 480;
  const towerX0L = 110;
  const towerX1L = 220;
  const towerX0R = 580;
  const towerX1R = 690;
  const towerTopY = 240;
  const spireBaseY = 240;
  const spireTipY = 60;
  const centralSpireBaseY = 280;
  const centralSpireTipY = 30;

  const roseCx = W / 2;
  const roseCy = 600;
  const roseR = 80;

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
        strokeWidth: 1.6,
      },
    });
  }

  const naveArches = [];
  for (let i = 0; i < 3; i++) {
    const ax = 320 + i * 80;
    naveArches.push({
      at: { x: ax, y: 860 },
      mark: "silhouette-path",
      silhouettePath: {
        d: "M -22 0 L -22 -110 Q -22 -145, 0 -145 Q 22 -145, 22 -110 L 22 0 Z",
        fill: "#1f1a14",
        stroke: "#3a2a14",
        strokeWidth: 1.5,
      },
    });
    naveArches.push({
      at: { x: ax, y: 860 },
      mark: "polyline",
      polyline: {
        points: [
          [0, -135],
          [0, 0],
        ],
        fill: "none",
        stroke: "#fefce8",
        strokeWidth: 1,
      },
    });
  }

  const towerDetails = [];
  for (const [tx0, tx1] of [
    [towerX0L, towerX1L],
    [towerX0R, towerX1R],
  ]) {
    const mid = (tx0 + tx1) / 2;
    towerDetails.push({
      at: { x: mid, y: 770 },
      mark: "silhouette-path",
      silhouettePath: {
        d: "M -18 0 L -18 -90 Q -18 -120, 0 -120 Q 18 -120, 18 -90 L 18 0 Z",
        fill: "#1f1a14",
        stroke: "#3a2a14",
        strokeWidth: 1.2,
      },
    });
    towerDetails.push({
      at: { x: mid, y: 580 },
      mark: "circle",
      circle: {
        radius: 16,
        fill: "#3a2a14",
        stroke: "#fefce8",
        strokeWidth: 1.4,
      },
    });
  }

  return {
    compose: {
      viewBox: { width: W, height: H },
      title: "A Gothic cathedral — light through stone",
      description:
        "Notre-Dame, Chartres, Reims, Cologne. The pointed arch lets the cathedral reach for sky in a way the Romanesque round arch never could. The rose window — a wheel of stained glass — became the calling card of 12th–15th century Europe.",
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
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${W} 0 L ${W} ${groundY} L 0 ${groundY} Z`,
            fill: "url(#g-dawn)",
            stroke: "none",
          },
        },
        {
          at: { x: 0, y: groundY },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${W} 0 L ${W} ${H - groundY} L 0 ${H - groundY} Z`,
            fill: "#6b8a4a",
            stroke: "none",
          },
        },
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M ${naveX0} ${groundY} L ${naveX0} ${naveTopY + 60} L ${naveX0 + 20} ${naveTopY + 20} L ${W / 2} ${naveTopY - 30} L ${naveX1 - 20} ${naveTopY + 20} L ${naveX1} ${naveTopY + 60} L ${naveX1} ${groundY} Z`,
            fill: "url(#g-stone)",
            stroke: "#3a2a14",
            strokeWidth: 2.2,
          },
        },
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
        ...[490, 800].flatMap((y) =>
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
              strokeWidth: 1,
            },
          })),
        ),
        {
          at: { x: 0, y: 0 },
          mark: "polygon",
          polygon: {
            points: [
              [towerX0L - 12, spireBaseY],
              [towerX1L + 12, spireBaseY],
              [(towerX0L + towerX1L) / 2, spireTipY],
            ],
            fill: "#3a4a2a",
            stroke: "#1f1a14",
            strokeWidth: 2,
          },
        },
        {
          at: { x: 0, y: 0 },
          mark: "polygon",
          polygon: {
            points: [
              [towerX0R - 12, spireBaseY],
              [towerX1R + 12, spireBaseY],
              [(towerX0R + towerX1R) / 2, spireTipY],
            ],
            fill: "#3a4a2a",
            stroke: "#1f1a14",
            strokeWidth: 2,
          },
        },
        ...[(towerX0L + towerX1L) / 2, (towerX0R + towerX1R) / 2].map((cx) => ({
          at: { x: cx, y: spireTipY - 4 },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M 0 0 L 0 -18 M -7 -12 L 7 -12",
            fill: "none",
            stroke: "#3a2a14",
            strokeWidth: 1.8,
          },
        })),
        {
          at: { x: 0, y: 0 },
          mark: "polygon",
          polygon: {
            points: [
              [W / 2 - 26, centralSpireBaseY],
              [W / 2 + 26, centralSpireBaseY],
              [W / 2, centralSpireTipY],
            ],
            fill: "#3a4a2a",
            stroke: "#1f1a14",
            strokeWidth: 2,
          },
        },
        {
          at: { x: W / 2, y: centralSpireTipY - 6 },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M 0 0 L 0 -24 M -9 -16 L 9 -16",
            fill: "none",
            stroke: "#3a2a14",
            strokeWidth: 2,
          },
        },
        ...towerDetails,
        {
          at: { x: W / 2, y: roseCy },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M ${-roseR - 25} ${roseR + 50} L ${-roseR - 25} -10 Q ${-roseR - 25} ${-roseR - 60}, 0 ${-roseR - 70} Q ${roseR + 25} ${-roseR - 60}, ${roseR + 25} -10 L ${roseR + 25} ${roseR + 50} Z`,
            fill: "rgba(31,26,20,.2)",
            stroke: "#3a2a14",
            strokeWidth: 1.4,
          },
        },
        {
          at: { x: roseCx, y: roseCy },
          mark: "circle",
          circle: {
            radius: roseR + 8,
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
        ...roseRays,
        {
          at: { x: roseCx, y: roseCy },
          mark: "circle",
          circle: {
            radius: 16,
            fill: "#fef3c7",
            stroke: "#3a2a14",
            strokeWidth: 1.5,
          },
        },
        ...naveArches,
        {
          at: { x: W / 2, y: groundY },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M -65 0 L -65 -130 Q -65 -180, 0 -180 Q 65 -180, 65 -130 L 65 0 Z",
            fill: "#3a2a14",
            stroke: "#1f1a14",
            strokeWidth: 2.2,
          },
        },
        {
          at: { x: W / 2, y: groundY - 2 },
          mark: "polyline",
          polyline: {
            points: [
              [0, -178],
              [0, 0],
            ],
            fill: "none",
            stroke: "#fefce8",
            strokeWidth: 1.2,
          },
        },
        {
          at: { x: W / 2, y: 80 },
          mark: "text",
          textMark: {
            text: "Ecclesia Cathedralis · Gothic order",
            fontSize: 18,
            fill: "#1f1a14",
            italic: true,
            anchor: "middle",
          },
        },
        {
          at: { x: W / 2, y: 1010 },
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
  const W = 900;
  const H = 1050;
  const groundY = 980;
  const towerX0 = 320;
  const towerX1 = 580;
  const towerTopY = 80;
  const antennaTopY = 20;

  return {
    compose: {
      viewBox: { width: W, height: H },
      title: "A skyscraper at dusk — the city in one column",
      description:
        "Modernist glass tower at last light. A steel skeleton sheathed in a curtain wall of windows. Sullivan, 1896: form follows function. Mies, 1958 (Seagram Building): glass plus rhythm = the 20th century.",
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
              { offset: "35%", color: "#7c2d12", opacity: 1 },
              { offset: "65%", color: "#dc2626", opacity: 1 },
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
              { offset: "0%", color: "#fbbf24", opacity: 0.5 },
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
            height: 40,
            children: [
              { kind: "rect", x: 4, y: 6, width: 9, height: 14, fill: "#fde68a" },
              { kind: "rect", x: 15, y: 6, width: 9, height: 14, fill: "#fbbf24" },
              {
                kind: "rect",
                x: 4,
                y: 24,
                width: 9,
                height: 14,
                fill: "rgba(253,230,138,.35)",
              },
              { kind: "rect", x: 15, y: 24, width: 9, height: 14, fill: "#fde68a" },
            ],
          },
          {
            id: "p-adj-windows",
            width: 18,
            height: 24,
            children: [
              { kind: "rect", x: 3, y: 4, width: 5, height: 8, fill: "#fde68a" },
              { kind: "rect", x: 10, y: 4, width: 5, height: 8, fill: "rgba(253,230,138,.4)" },
              { kind: "rect", x: 3, y: 14, width: 5, height: 8, fill: "#fde68a" },
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
            fill: "url(#g-dusk)",
            stroke: "none",
          },
        },
        {
          at: { x: 740, y: 140 },
          mark: "circle",
          circle: {
            radius: 38,
            fill: "url(#g-moon)",
            stroke: "rgba(254,243,199,.5)",
            strokeWidth: 1,
          },
        },
        ...[
          [-8, -10, 4],
          [10, -2, 3],
          [-2, 12, 2.5],
        ].map(([dx, dy, r]) => ({
          at: { x: 740 + dx, y: 140 + dy },
          mark: "circle",
          circle: { radius: r, fill: "rgba(202,138,4,.25)" },
        })),
        {
          at: { x: 0, y: 0 },
          mark: "starfield",
          starfield: { count: 35, seed: 47, region: { x: 0, y: 0, w: W, h: 250 } },
        },
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M 0 600 L 80 600 L 80 980 L 0 980 Z M 80 680 L 180 680 L 180 980 L 80 980 Z M 180 720 L 250 720 L 250 980 L 180 980 Z",
            fill: "#0c1126",
            stroke: "#1d2444",
            strokeWidth: 1,
          },
        },
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M 620 540 L 700 540 L 700 980 L 620 980 Z M 700 660 L 800 660 L 800 980 L 700 980 Z M 800 600 L 880 600 L 880 980 L 800 980 Z M 880 700 L 900 700 L 900 980 L 880 980 Z",
            fill: "#0c1126",
            stroke: "#1d2444",
            strokeWidth: 1,
          },
        },
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: "M 0 600 L 80 600 L 80 980 L 0 980 Z M 80 680 L 180 680 L 180 980 L 80 980 Z M 180 720 L 250 720 L 250 980 L 180 980 Z M 620 540 L 700 540 L 700 980 L 620 980 Z M 700 660 L 800 660 L 800 980 L 700 980 Z M 800 600 L 880 600 L 880 980 L 800 980 Z M 880 700 L 900 700 L 900 980 L 880 980 Z",
            fill: "url(#p-adj-windows)",
            stroke: "none",
            opacity: 0.55,
          },
        },
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M ${towerX0} ${groundY} L ${towerX0} ${towerTopY + 70} L ${towerX0 + 30} ${towerTopY + 70} L ${towerX0 + 30} ${towerTopY} L ${towerX1 - 30} ${towerTopY} L ${towerX1 - 30} ${towerTopY + 70} L ${towerX1} ${towerTopY + 70} L ${towerX1} ${groundY} Z`,
            fill: "url(#g-tower)",
            stroke: "#0c4a6e",
            strokeWidth: 2,
          },
        },
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M ${towerX0 + 12} ${towerTopY + 90} L ${towerX1 - 12} ${towerTopY + 90} L ${towerX1 - 12} ${groundY - 90} L ${towerX0 + 12} ${groundY - 90} Z`,
            fill: "url(#p-windows)",
            stroke: "none",
          },
        },
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M ${towerX0 + 40} ${towerTopY + 10} L ${towerX1 - 40} ${towerTopY + 10} L ${towerX1 - 40} ${towerTopY + 65} L ${towerX0 + 40} ${towerTopY + 65} Z`,
            fill: "url(#p-windows)",
            stroke: "none",
          },
        },
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M ${towerX0 + 12} ${towerTopY + 90} L ${towerX1 - 12} ${towerTopY + 90} L ${towerX1 - 12} ${groundY - 90} L ${towerX0 + 12} ${groundY - 90} Z`,
            fill: "url(#g-reflect)",
            stroke: "none",
          },
        },
        {
          at: { x: W / 2, y: antennaTopY },
          mark: "polyline",
          polyline: {
            points: [
              [0, 0],
              [0, towerTopY - antennaTopY],
            ],
            fill: "none",
            stroke: "#0c1126",
            strokeWidth: 3,
          },
        },
        {
          at: { x: W / 2, y: antennaTopY + 4 },
          mark: "circle",
          circle: {
            radius: 4,
            fill: "#dc2626",
            stroke: "#7c2d12",
            strokeWidth: 0.5,
          },
          animation: { kind: "pulse", periodMs: 1500, scale: 1.5 },
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
        ...[140, 280, 440, 620, 760].map((dx) => ({
          at: { x: dx, y: groundY + 22 },
          mark: "circle",
          circle: {
            radius: 3,
            fill: "#fef3c7",
            stroke: "rgba(254,243,199,.4)",
            strokeWidth: 4,
          },
        })),
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
        {
          at: { x: W / 2, y: 1025 },
          mark: "text",
          textMark: {
            text: "steel frame · curtain wall · the city in one column",
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
