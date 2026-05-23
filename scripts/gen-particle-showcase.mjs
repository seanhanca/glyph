#!/usr/bin/env node
/**
 * Particle showcase — the best Glyph can do for "particle field"
 * visualizations. Produces two fixtures:
 *
 *   particle-static.json   — best static streamline field
 *   particle-animated.json — same field + rotate-loop on the whole
 *                            scene for hypnotic-galaxy motion
 *
 * The trick: Glyph's `data.shape: "streamline"` integrates a vector
 * field from N seed points (RK4) and renders each trajectory as a
 * colored path. We pick a field with multiple vortices to create the
 * dense, swirling pattern that particle-love demos are famous for.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "packages", "core", "__fixtures__", "compose");
mkdirSync(outDir, { recursive: true });

// The flow field — Arnold-Beltrami-Childress-flavored 2D curl:
//
//   dx/dt = sin(2·y) + 0.4·cos(x)
//   dy/dt = -sin(2·x) + 0.4·sin(y)
//
// On the domain (-π, π) × (-π, π) this produces a 2×2 grid of
// counter-rotating vortices with asymmetric perturbations. The result
// looks like a galaxy of interlocking eddies.
const FIELD = {
  dxdt: "sin(2*y) + 0.4*cos(x)",
  dydt: "-sin(2*x) + 0.4*sin(y)",
  domain: { x: [-Math.PI, Math.PI], y: [-Math.PI, Math.PI] },
};

// Two side-by-side streamline render configs differ only in the
// presence of animation. We share the chart spec via this builder.
const buildChartSpec = (seeds, maxSteps, colorBy) => ({
  version: "glyph/0.1",
  title: `Streamline field · ${seeds}×${seeds} seeds · colorBy: ${colorBy}`,
  data: {
    source: "inline:particle-field",
  },
  layers: [
    {
      mark: "streamline",
      encoding: {
        x: {
          field: "x",
          type: "quantitative",
          scale: { domain: FIELD.domain.x },
        },
        y: {
          field: "y",
          type: "quantitative",
          scale: { domain: FIELD.domain.y },
        },
      },
      streamline: {
        dxdt: FIELD.dxdt,
        dydt: FIELD.dydt,
        seeds: { kind: "grid", rows: seeds, cols: seeds },
        step: 0.04,
        maxSteps,
        domain: FIELD.domain,
        colorBy,
      },
    },
  ],
});

// The compose wrapper provides the dark background + the chart child.
// If animate=true, the chart child carries a rotate-loop animation.
const buildScene = ({ animate }) => {
  const W = 900;
  const H = 900;
  const chartW = 800;
  const chartH = 800;
  const chartX = (W - chartW) / 2;
  const chartY = (H - chartH) / 2;

  return {
    compose: {
      viewBox: { width: W, height: H },
      title: animate
        ? "Particle field — animated · the whole field rotates"
        : "Particle field — static · best of streamline mode",
      description: animate
        ? "144 RK4-integrated trajectories through an ABC-flavored vector field, rotated by a SMIL rotate-loop with periodMs=30000 (one slow revolution every 30 seconds)."
        : "144 RK4-integrated trajectories through an ABC-flavored vector field. Each path is colored by the local flow angle. Static SVG — byte-identical across CI.",
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
        // Dark space background
        {
          at: { x: 0, y: 0 },
          mark: "silhouette-path",
          silhouettePath: {
            d: `M 0 0 L ${W} 0 L ${W} ${H} L 0 ${H} Z`,
            fill: "url(#g-bg)",
            stroke: "none",
          },
        },
        // Subtle starfield ambiance behind the streamlines
        {
          at: { x: 0, y: 0 },
          mark: "starfield",
          starfield: {
            count: 60,
            seed: 13,
            region: { x: 0, y: 0, w: W, h: H },
          },
        },
        // The streamline chart (with or without rotation)
        {
          at: { x: chartX, y: chartY },
          size: { w: chartW, h: chartH },
          mark: "chart",
          chart: buildChartSpec(12, 100, "angle"),
          ...(animate
            ? {
                animation: {
                  kind: "rotate-loop",
                  periodMs: 30000,
                  direction: "ccw",
                },
              }
            : {}),
        },
        // Visible label at the bottom
        {
          at: { x: W / 2, y: H - 30 },
          mark: "text",
          textMark: {
            text: animate
              ? "Particle field · animated · rotate-loop 30s"
              : "Particle field · static · 144 trajectories · colorBy: angle",
            fontSize: 13,
            fill: "#94a3b8",
            italic: true,
            anchor: "middle",
          },
        },
      ],
    },
  };
};

const fixtures = {
  "particle-static.json": buildScene({ animate: false }),
  "particle-animated.json": buildScene({ animate: true }),
};

for (const [name, spec] of Object.entries(fixtures)) {
  const path = join(outDir, name);
  writeFileSync(path, `${JSON.stringify(spec, null, 2)}\n`);
  console.log(`wrote ${path} (${Math.round(JSON.stringify(spec).length / 1024)} KB)`);
}
