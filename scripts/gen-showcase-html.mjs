#!/usr/bin/env node
/**
 * Generate 9 draw-me-*.html pages for the showcase-extensions PR.
 * Each page follows the same structure as the existing draw-me-*
 * pages but is data-driven from a small config so we don't maintain
 * 9 × 200-line HTML files by hand.
 *
 * Run from repo root:
 *   node scripts/gen-showcase-html.mjs
 *
 * Outputs under site/math/:
 *   draw-me-neuron.html, draw-me-butterfly.html, draw-me-eye.html
 *   draw-me-bridge.html, draw-me-locomotive.html, draw-me-radio.html
 *   draw-me-temple.html, draw-me-cathedral.html, draw-me-skyscraper.html
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "site", "math");

/** @type {Array<{slug:string, svg:string, title:string, kicker:string, lede:string, byline:string, prompt:string, alt:string, theme:{primary:string, primarySoft:string, primaryEdge:string, h1:string, h2:string, ledeColor:string, alt2:string, ctaTextColor:string, stageBg:string}, primitives:Array<{label:string, ticks:string, h3:string, p:string}>, jsonExcerpt:string, jsonChildren:string[], ctaLinks:Array<{label:string, href:string, primary?:boolean}>}> } */
const pages = [
  // ─────────────────────── BIO ───────────────────────
  {
    slug: "neuron",
    svg: "bio-neuron.svg",
    title: "Draw me a neuron",
    kicker: "Life in Glyph · RFC #9 · bio extension",
    lede: "A single pyramidal neuron. <strong>You asked Claude. Glyph drew it — from a compose spec.</strong> Dendrites on the left collect input; the soma integrates it; the axon on the right fires an action potential down to the synaptic terminals.",
    byline:
      "Subject: <em>pyramidal cell</em>, the workhorse of cortex. 86 billion of them in your brain right now.",
    prompt:
      '"Draw me a neuron firing. Soma in the middle with a nucleus. Dendrites branching out to the left. A long axon to the right with myelin sheaths, ending in synaptic terminals. A warm halo around the soma to suggest action-potential glow."',
    alt: "A pyramidal neuron: purple-yellow soma with a dark nucleus, five branching cyan dendrites fanning to the left, a long horizontal axon to the right wrapped in cream-yellow myelin-sheath ellipses, and four branching synaptic terminals at the far right with a soft glow.",
    theme: {
      primary: "#a78bfa",
      primarySoft: "rgba(167,139,250,.10)",
      primaryEdge: "rgba(167,139,250,.35)",
      h1: "linear-gradient(180deg, #ddd6fe, #a78bfa, #22d3ee)",
      h2: "#c4b5fd",
      ledeColor: "#94a3b8",
      alt2: "#22d3ee",
      ctaTextColor: "#1a1a1a",
      stageBg: "#020617",
    },
    primitives: [
      {
        label: "PRIMITIVE 1",
        ticks: "silhouette-path × 6",
        h3: "Dendrites & axon",
        p: "Five dendrite paths fan out from the soma — each one a hand-sampled branching d-string with sub-twigs at the tips. The axon is a single line; six myelin sheaths along it are ellipses.",
      },
      {
        label: "PRIMITIVE 2",
        ticks: "ellipse + radial gradient",
        h3: "The cell body",
        p: "An ellipse with a 3-stop radial gradient (cream → purple → indigo). The nucleus is a smaller circle. A glow halo (radial-gradient driven) sits behind the soma at radius 130.",
      },
      {
        label: "PRIMITIVE 3",
        ticks: "starfield seed 23 + glow",
        h3: "The dark + the synapse",
        p: "60 stars seeded at 23 paint the dark backdrop. A second glow halo at the axon terminal — radius 60 — is the moment the action potential reaches the synapse.",
      },
    ],
    jsonExcerpt: `{
  "compose": {
    "viewBox": { "width": 1000, "height": 500 },
    "theme": { "background": "#020617" },
    "defs": {
      "gradients": [
        { "id": "g-cell", "kind": "linear",
          "x1": "0%", "y1": "0%", "x2": "100%", "y2": "0%",
          "stops": [
            { "offset": "0%",  "color": "#a78bfa" },
            { "offset": "50%", "color": "#22d3ee" },
            { "offset": "100%","color": "#fde68a" }
          ]
        },
        // ... g-soma (radial), g-pulse (radial halo), g-bg
      ]
    },
    "children": [`,
    jsonChildren: [
      "background rect (radial gradient)",
      "starfield · 60 stars · seed 23",
      "5 dendrite silhouette-paths",
      "axon silhouette-path (3px stroke)",
      "6 myelin-sheath ellipses",
      "soma glow halo (radius 130)",
      "soma ellipse + nucleus circle",
      "4 synaptic terminal paths + boutons",
      "synapse glow halo (radius 60)",
      "5 italic labels",
    ],
    ctaLinks: [
      { label: "See the gallery ↗", href: "life-in-glyph.html", primary: true },
      { label: "DNA", href: "draw-me-dna.html" },
      { label: "Heartbeat", href: "draw-me-heartbeat.html" },
      { label: "Jellyfish", href: "draw-me-jellyfish.html" },
    ],
  },
  {
    slug: "butterfly",
    svg: "bio-butterfly.svg",
    title: "Draw me a butterfly",
    kicker: "Life in Glyph · RFC #9 · bio extension",
    lede: "Symmetry made wings. <strong>You asked Claude. Glyph drew it — from a compose spec.</strong> Two pairs of polygons mirrored across the body axis, with gradient fills and eyespots.",
    byline:
      "Order: <em>Lepidoptera</em> · ~250,000 species. Bilateral symmetry — pattern on the right mirrors the left.",
    prompt:
      '"Draw me a butterfly, top-down view. Two pairs of wings, symmetric across the body. Forewings with sunset gradient + eyespots. Hindwings darker purple-blue. Antennae. Pencil-on-parchment."',
    alt: "A top-down butterfly: orange-to-purple gradient forewings with white-and-black eyespots, darker indigo hindwings with golden spots, a black body and head, two curling antennae with club tips.",
    theme: {
      primary: "#dc2626",
      primarySoft: "rgba(220,38,38,.10)",
      primaryEdge: "rgba(220,38,38,.35)",
      h1: "linear-gradient(180deg, #fbbf24, #dc2626, #581c87)",
      h2: "#fca5a5",
      ledeColor: "#94a3b8",
      alt2: "#fbbf24",
      ctaTextColor: "#1a1a1a",
      stageBg: "#f5edd9",
    },
    primitives: [
      {
        label: "PRIMITIVE 1",
        ticks: "polygon × 4",
        h3: "The wings",
        p: "Each wing is a 7-point polygon — forewing and hindwing, drawn once on the right, then mirrored to the left by negating x. Linear-gradient fills give the sunset-to-twilight color story.",
      },
      {
        label: "PRIMITIVE 2",
        ticks: "ellipse + circle × 6",
        h3: "Eyespots & body",
        p: "Eyespots on the forewings: a white-ish ellipse plus a black pupil circle (the predator-deterring trick that survives in fossils). The body is one tall narrow ellipse; the head is a small circle.",
      },
      {
        label: "PRIMITIVE 3",
        ticks: "silhouette-path × 2",
        h3: "The antennae",
        p: "Two curling antennae — each a quadratic-Bézier d-string (just three points: start, control, end) ending in a tiny club-tip circle. The whole insect is ten polygons and four primitives.",
      },
    ],
    jsonExcerpt: `{
  "compose": {
    "viewBox": { "width": 800, "height": 600 },
    "theme": { "preset": "pencil-parchment" },
    "defs": {
      "gradients": [
        { "id": "g-wing-r", "kind": "linear",
          "x1": "0%", "y1": "0%", "x2": "100%", "y2": "100%",
          "stops": [
            { "offset": "0%",  "color": "#fbbf24" },
            { "offset": "60%", "color": "#dc2626" },
            { "offset": "100%","color": "#581c87" }
          ]
        }
        // ... g-wing-l (mirror), g-hind-r, g-hind-l
      ]
    },
    "children": [`,
    jsonChildren: [
      "2 hindwing polygons (right + mirrored left)",
      "2 forewing polygons (right + mirrored left)",
      "body ellipse + head circle",
      "2 antenna silhouette-paths + 2 club tips",
      "4 eyespot ellipses + pupils",
      "2 golden hindwing spots",
      "title + caption text",
    ],
    ctaLinks: [
      { label: "See the gallery ↗", href: "life-in-glyph.html", primary: true },
      { label: "DNA", href: "draw-me-dna.html" },
      { label: "Eye", href: "draw-me-eye.html" },
      { label: "Sunflower", href: "draw-me-sunflower.html" },
    ],
  },
  {
    slug: "eye",
    svg: "bio-eye.svg",
    title: "Draw me an eye",
    kicker: "Life in Glyph · RFC #9 · bio extension",
    lede: "The camera nature evolved 40 separate times. <strong>You asked Claude. Glyph drew it — from a compose spec.</strong> Almond sclera, radial-fiber iris, black pupil, a catchlight reflecting the world.",
    byline:
      "Substrate: vertebrate eye. The iris's 36 radial muscle fibers open and close the aperture — your camera does the same.",
    prompt:
      '"Draw me an eye looking straight at me. Almond shape. Blue iris with radial fibers. Black pupil. A small white catchlight near the upper-left. Warm skin tone framing. Two or three eyelashes."',
    alt: "A vertebrate eye in cross-section: an almond-shaped white sclera bordered by warm orange skin, a blue iris with 36 radial muscle fibers and a 3-stop radial gradient, a black pupil with a white catchlight near the top-left, five short eyelashes curving up.",
    theme: {
      primary: "#7dd3fc",
      primarySoft: "rgba(125,211,252,.10)",
      primaryEdge: "rgba(125,211,252,.35)",
      h1: "linear-gradient(180deg, #fde68a, #fbbf24, #7dd3fc)",
      h2: "#bae6fd",
      ledeColor: "#fde68a",
      alt2: "#fbbf24",
      ctaTextColor: "#1a1a1a",
      stageBg: "#1a0f0a",
    },
    primitives: [
      {
        label: "PRIMITIVE 1",
        ticks: "polyline × 36",
        h3: "The iris fibers",
        p: "Thirty-six polylines radiating from the inner pupil edge to the outer iris. Length jitter by index gives a natural irregular look — real iris muscles don't all reach the limit cleanly.",
      },
      {
        label: "PRIMITIVE 2",
        ticks: "circle × 3 + ellipse",
        h3: "Pupil + catchlight",
        p: "The pupil is a 48-radius black circle. The catchlight — that tiny white reflection that makes the eye look alive — is a small ellipse plus a tiny round secondary highlight. Cinematographers call it the eye-light.",
      },
      {
        label: "PRIMITIVE 3",
        ticks: "silhouette + 3 radial grads",
        h3: "Sclera + iris gradients",
        p: "The sclera is a single d-string with two arcs, almond-shaped. The iris uses a radial gradient with three stops (deep navy → cyan → sky), and a separate radial gradient for the solid iris base behind the fibers.",
      },
    ],
    jsonExcerpt: `{
  "compose": {
    "viewBox": { "width": 800, "height": 600 },
    "theme": { "background": "#1a0f0a" },
    "defs": {
      "gradients": [
        { "id": "g-iris", "kind": "radial",
          "cx": "50%", "cy": "50%", "r": "50%",
          "stops": [
            { "offset": "0%",  "color": "#0c4a6e" },
            { "offset": "60%", "color": "#0284c7" },
            { "offset": "100%","color": "#7dd3fc" }
          ]
        }
        // ... g-sclera, g-iris-base, g-skin
      ]
    },
    "children": [`,
    jsonChildren: [
      "skin background (radial)",
      "almond sclera silhouette",
      "solid iris circle (radial base)",
      "36 iris-fiber polylines",
      "outer iris ring",
      "pupil circle (radius 48)",
      "catchlight ellipse + dot",
      "5 eyelash silhouette-paths",
      "title + caption text",
    ],
    ctaLinks: [
      { label: "See the gallery ↗", href: "life-in-glyph.html", primary: true },
      { label: "Butterfly", href: "draw-me-butterfly.html" },
      { label: "Neuron", href: "draw-me-neuron.html" },
      { label: "Jellyfish", href: "draw-me-jellyfish.html" },
    ],
  },
  // ─────────────────────── ENGINEERING ───────────────────────
  {
    slug: "bridge",
    svg: "eng-bridge.svg",
    title: "Draw me a suspension bridge",
    kicker: "Machines of Wonder · RFC #9 · engineering extension",
    lede: "Gravity solved. <strong>You asked Claude. Glyph drew it — from a compose spec.</strong> Two towers, a parabolic cable, hundreds of vertical suspenders, and a road floating in mid-air.",
    byline:
      "Roebling, 1883 (Brooklyn) → Strauss, 1937 (Golden Gate). The cable hangs in a parabola because the load is uniform per horizontal distance.",
    prompt:
      '"Draw me a suspension bridge — Golden Gate style. Two red art-deco towers, a single parabolic main cable, vertical suspenders dropping to a deck, anchors on each side, deep water below, soft sky above."',
    alt: "A suspension bridge: two tall trapezoidal red towers with cross-bracing, a black parabolic main cable spanning between them, ~17 vertical suspender cables dropping to a dark deck with a dashed yellow centerline, side cables running to ground anchors on both ends, deep blue-sky overhead, gradient blue water below.",
    theme: {
      primary: "#dc2626",
      primarySoft: "rgba(220,38,38,.08)",
      primaryEdge: "rgba(220,38,38,.35)",
      h1: "linear-gradient(180deg, #fef3c7, #dc2626)",
      h2: "#fca5a5",
      ledeColor: "#94a3b8",
      alt2: "#7dd3fc",
      ctaTextColor: "#fef3c7",
      stageBg: "#f5edd9",
    },
    primitives: [
      {
        label: "PRIMITIVE 1",
        ticks: "silhouette-path (40 samples)",
        h3: "The parabolic cable",
        p: "The main cable is one silhouette-path — 41 sampled points along y = min - dip × (1 - 4(t-0.5)²), the parabola you get when a uniform horizontal load hangs from a flexible cable.",
      },
      {
        label: "PRIMITIVE 2",
        ticks: "polyline × 17",
        h3: "The suspenders",
        p: "Vertical cables connecting the main parabola to the deck — each one a 2-point polyline at the sampled cable position. Their length grows toward the center where the cable dips lowest.",
      },
      {
        label: "PRIMITIVE 3",
        ticks: "silhouette + 8 cross-braces",
        h3: "The towers + deck",
        p: "Each tower is a tapered trapezoidal d-string filled with a 3-stop linear gradient (the art-deco red). Cross-braces are polylines that get longer as they descend. The deck is a single rect; the centerline is a dashed polyline.",
      },
    ],
    jsonExcerpt: `{
  "compose": {
    "viewBox": { "width": 1200, "height": 600 },
    "theme": { "preset": "pencil-parchment" },
    "defs": {
      "gradients": [
        { "id": "g-tower", "kind": "linear",
          "x1": "0%", "y1": "0%", "x2": "100%", "y2": "0%",
          "stops": [
            { "offset": "0%",  "color": "#7c2d12" },
            { "offset": "50%", "color": "#dc2626" },
            { "offset": "100%","color": "#7c2d12" }
          ]
        }
        // ... g-sky, g-water
      ]
    },
    "children": [`,
    jsonChildren: [
      "sky gradient rect",
      "water gradient rect",
      "side cable left (anchor → tower top)",
      "side cable right",
      "17 vertical suspender polylines",
      "main parabolic cable (40-sample silhouette)",
      "2 tower silhouette-paths (gradient fill)",
      "8 tower cross-brace polylines",
      "deck silhouette + dashed centerline",
      "2 annotation-leaders (cable, tower)",
      "caption text",
    ],
    ctaLinks: [
      { label: "See the gallery ↗", href: "life-in-glyph.html", primary: true },
      { label: "Locomotive", href: "draw-me-locomotive.html" },
      { label: "Windmill", href: "draw-me-windmill.html" },
      { label: "Hydraulic press", href: "draw-me-hydraulic.html" },
    ],
  },
  {
    slug: "locomotive",
    svg: "eng-locomotive.svg",
    title: "Draw me a steam locomotive",
    kicker: "Machines of Wonder · RFC #9 · engineering extension",
    lede: "Fire on wheels. <strong>You asked Claude. Glyph drew it — from a compose spec.</strong> The wheels rotate via SMIL; the boiler glints; smoke puffs into the morning.",
    byline: "Stevenson's Rocket (1829) → Mallard (1938, world speed record 203 km/h).",
    prompt:
      '"Draw me a classic steam locomotive in profile. Black boiler, red cab, smokestack with smoke. Four wheels (one leading + three drivers) with a connecting rod. Wheels should rotate. Rails, ties, countryside hills."',
    alt: "A profile-view steam locomotive: black cylindrical boiler with three yellow bands, red cab with a yellow window at the back, brass-trimmed smokestack with five gray smoke puffs rising, a steam dome and whistle on top, four spoked wheels with a golden connecting rod, headlight on the boiler face, two black rails on dark ties, soft green hills receding in the background.",
    theme: {
      primary: "#fde68a",
      primarySoft: "rgba(253,230,138,.08)",
      primaryEdge: "rgba(253,230,138,.35)",
      h1: "linear-gradient(180deg, #fef3c7, #fde68a, #7c2d12)",
      h2: "#fde68a",
      ledeColor: "#94a3b8",
      alt2: "#dc2626",
      ctaTextColor: "#1a1a1a",
      stageBg: "#f5edd9",
    },
    primitives: [
      {
        label: "PRIMITIVE 1",
        ticks: "gear × 4 + rotate-loop",
        h3: "The driving wheels",
        p: "Four <code>gear</code> marks (RFC #7) — one leading wheel at 24 teeth, three drivers at 28. All four animate together with a <code>rotate-loop</code> at 4 s period. The golden connecting rod is a single thick silhouette-path linking the driver hubs.",
      },
      {
        label: "PRIMITIVE 2",
        ticks: "silhouette × 7 + linear grad",
        h3: "The boiler + cab",
        p: "Boiler is a black rectangle with a 3-stop gradient (g-boiler). The smokestack, steam dome, whistle, cab, and roof overhang are individual silhouette-path rectangles or trapezoids. Boiler bands are 3 yellow polylines across the gradient.",
      },
      {
        label: "PRIMITIVE 3",
        ticks: "circle × 5 + radial grad",
        h3: "Smoke + countryside",
        p: "Smoke puffs are circles with a g-smoke radial gradient (gray → transparent). The far hills are one silhouette-path with sampled peaks. Headlight is a yellow circle on the boiler face; rails are two long polylines; ties are 15 small rects.",
      },
    ],
    jsonExcerpt: `{
  "compose": {
    "viewBox": { "width": 1200, "height": 600 },
    "theme": { "preset": "pencil-parchment" },
    "defs": {
      "gradients": [
        { "id": "g-boiler", "kind": "linear",
          "stops": [
            { "offset": "0%",  "color": "#1f1a14" },
            { "offset": "60%", "color": "#3a3a2a" },
            { "offset": "100%","color": "#1f1a14" }
          ]
        }
        // ... g-sky, g-smoke (radial)
      ]
    },
    "children": [`,
    jsonChildren: [
      "sky + ground gradient rects",
      "far hills silhouette",
      "5 smoke puff circles (radial gradient)",
      "boiler silhouette + 3 yellow bands",
      "boiler front circle + headlight",
      "smokestack + steam dome + whistle",
      "cab + roof + window",
      "connecting rod (5px silhouette)",
      "4 gear wheels w/ rotate-loop · 4 s period",
      "4 wheel pin circles",
      "2 rails + 15 ties",
      "caption text",
    ],
    ctaLinks: [
      { label: "See the gallery ↗", href: "life-in-glyph.html", primary: true },
      { label: "Bridge", href: "draw-me-bridge.html" },
      { label: "Watt's Engine", href: "draw-me-piston.html" },
      { label: "Wankel Rotor", href: "draw-me-rotor.html" },
    ],
  },
  {
    slug: "radio",
    svg: "eng-radio.svg",
    title: "Draw me radio waves broadcasting",
    kicker: "Machines of Wonder · RFC #9 · engineering extension",
    lede: "Invisible voices. <strong>You asked Claude. Glyph drew it — from a compose spec.</strong> A lattice tower with a glowing antenna tip and seven concentric pulsing wave-rings.",
    byline:
      "Marconi, 1901 — the first wireless transatlantic signal. Every radio, every wifi router, every cell tower is a refinement of this one trick.",
    prompt:
      '"Draw me radio waves emanating from a broadcast tower. Lattice steel structure, a thin antenna at the top with a bright tip, concentric oval waves expanding outward. Night sky with stars."',
    alt: "A radio broadcast tower at night: a lattice steel triangle with diagonal cross-bracing rising to a single thin antenna mast, a glowing bright tip at the antenna's peak, seven concentric pale-yellow elliptical wave rings expanding outward from the tip with decreasing opacity, a dark blue radial-gradient sky scattered with 100 stars.",
    theme: {
      primary: "#fde68a",
      primarySoft: "rgba(253,230,138,.08)",
      primaryEdge: "rgba(253,230,138,.35)",
      h1: "linear-gradient(180deg, #fef3c7, #fde68a)",
      h2: "#fde68a",
      ledeColor: "#94a3b8",
      alt2: "#7dd3fc",
      ctaTextColor: "#1a1a1a",
      stageBg: "#020617",
    },
    primitives: [
      {
        label: "PRIMITIVE 1",
        ticks: "ellipse × 7 + pulse",
        h3: "The radio waves",
        p: "Seven ellipses at the antenna tip, increasing radius from 60 to 420, decreasing opacity from 0.6 to 0.14. Each one carries a <code>pulse</code> loop animation at slightly different periods (3.0 – 4.4 s) so the waves breathe at different tempos.",
      },
      {
        label: "PRIMITIVE 2",
        ticks: "polyline × 32",
        h3: "The lattice",
        p: "16 X-pattern cross-braces — each X is two polylines. The polylines connect the left and right sides of the tower at sequential heights, producing the classic triangulated steel lattice of broadcast towers.",
      },
      {
        label: "PRIMITIVE 3",
        ticks: "starfield + glow",
        h3: "Sky + antenna tip",
        p: "100 stars seeded at 31. The antenna tip carries a glow (radius 50, gradient g-tip) — that's the visible signature of the oscillator driving the broadcast. Stars and waves coexist because the whole point is signal-through-noise.",
      },
    ],
    jsonExcerpt: `{
  "compose": {
    "viewBox": { "width": 800, "height": 800 },
    "theme": { "background": "#020617" },
    "defs": {
      "gradients": [
        { "id": "g-tip", "kind": "radial",
          "cx": "50%", "cy": "50%", "r": "50%",
          "stops": [
            { "offset": "0%",  "color": "#fde68a", "opacity": 1 },
            { "offset": "100%","color": "#fde68a", "opacity": 0 }
          ]
        }
        // ... g-bg
      ]
    },
    "children": [`,
    jsonChildren: [
      "background radial gradient",
      "starfield · 100 stars · seed 31",
      "ground horizon rect",
      "7 wave ellipses w/ pulse animation",
      "glow halo at antenna tip (radius 50)",
      "tower silhouette outline",
      "32 lattice cross-brace polylines",
      "antenna mast silhouette + tip bulb",
      "broadcast label + caption text",
    ],
    ctaLinks: [
      { label: "See the gallery ↗", href: "life-in-glyph.html", primary: true },
      { label: "Bridge", href: "draw-me-bridge.html" },
      { label: "Locomotive", href: "draw-me-locomotive.html" },
      { label: "Antikythera", href: "draw-me-antikythera.html" },
    ],
  },
  // ─────────────────────── ARCHITECTURE ───────────────────────
  {
    slug: "temple",
    svg: "arch-temple.svg",
    title: "Draw me a Greek temple",
    kicker: "Architecture · RFC #9 · pattern + polygon",
    lede: "Order in stone. <strong>You asked Claude. Glyph drew it — from a compose spec.</strong> Six Doric columns, a triglyph-metope frieze, a pediment at the top.",
    byline:
      "Doric order · ~500 BCE. Height:diameter ≈ 5:1. The Parthenon's blueprint, scaled down.",
    prompt:
      '"Draw me a Greek temple — Doric order, front elevation. Six fluted columns on a stylobate. Architrave + triglyph frieze + cornice above. Pediment on top with an akroterion. Marble texture. Morning sky."',
    alt: "A front elevation of a Doric Greek temple: six fluted columns standing on a two-step stylobate, with simple Doric capitals supporting an architrave with a triglyph-metope frieze, a cornice, a triangular pediment, and a small akroterion finial at the apex. Set against a sky-blue to parchment gradient with a green lawn at ground level.",
    theme: {
      primary: "#94a3b8",
      primarySoft: "rgba(148,163,184,.08)",
      primaryEdge: "rgba(148,163,184,.35)",
      h1: "linear-gradient(180deg, #f1f5fb, #cbd5e1)",
      h2: "#e2e8f0",
      ledeColor: "#94a3b8",
      alt2: "#fbbf24",
      ctaTextColor: "#1a1a1a",
      stageBg: "#f5edd9",
    },
    primitives: [
      {
        label: "PRIMITIVE 1",
        ticks: "pattern · p-flute",
        h3: "Doric columns",
        p: "Each column body is a slightly tapered trapezoidal silhouette filled with a 8×8 flute pattern (two thin verticals per tile). Capitals and bases are stacked rectangles above and below. Six columns × three layered shapes = 18 children for the colonnade.",
      },
      {
        label: "PRIMITIVE 2",
        ticks: "pattern · p-marble + triglyph",
        h3: "Entablature + frieze",
        p: "The architrave, cornice, and stylobate are all rectangles filled with a 60×30 stone-block marble pattern. Six triglyphs in the frieze — each a small marble rect with a vertical groove polyline.",
      },
      {
        label: "PRIMITIVE 3",
        ticks: "polygon + akroterion",
        h3: "Pediment",
        p: "The pediment is a single triangle polygon filled with the marble pattern. A small akroterion (decorative apex finial) is a 3-point polygon perched at its peak.",
      },
    ],
    jsonExcerpt: `{
  "compose": {
    "viewBox": { "width": 1000, "height": 700 },
    "theme": { "preset": "pencil-parchment" },
    "defs": {
      "patterns": [
        { "id": "p-flute",  "width": 8, "height": 8,
          "children": [ /* two thin verticals */ ] },
        { "id": "p-marble", "width": 60, "height": 30,
          "children": [ /* block-pattern lines */ ] }
      ],
      "gradients": [ /* g-sky, g-ground */ ]
    },
    "children": [`,
    jsonChildren: [
      "sky gradient + ground gradient",
      "stylobate (2 marble-filled steps)",
      "6 columns (body + capital + base × 6 = 18)",
      "architrave marble band",
      "frieze background + 6 triglyphs (×2 = 12)",
      "cornice marble band",
      "pediment polygon (marble fill)",
      "akroterion finial",
      "title + caption text",
    ],
    ctaLinks: [
      { label: "See the gallery ↗", href: "life-in-glyph.html", primary: true },
      { label: "Cathedral", href: "draw-me-cathedral.html" },
      { label: "Skyscraper", href: "draw-me-skyscraper.html" },
      { label: "Windmill", href: "draw-me-windmill.html" },
    ],
  },
  {
    slug: "cathedral",
    svg: "arch-cathedral.svg",
    title: "Draw me a Gothic cathedral",
    kicker: "Architecture · RFC #9 · radial gradient + pointed arch",
    lede: "Light through stone. <strong>You asked Claude. Glyph drew it — from a compose spec.</strong> Two flanking towers with pointed spires, a central rose window of stained glass, a tall central spire.",
    byline:
      "Notre-Dame, Chartres, Reims, Cologne — 12th–15th century. The pointed arch + flying buttress let cathedrals reach for sky in a way Romanesque round arches never could.",
    prompt:
      '"Draw me a Gothic cathedral — front elevation. Two towers flanking a central nave. A rose window in the center. Pointed-arch windows below. A tall central spire. Smaller spires on the towers with crosses. Dawn sky."',
    alt: "A front-elevation Gothic cathedral: two tall stone towers each topped with a pointed brown spire and a small cross, a taller central spire above the nave, a large rose window of stained glass with twelve radial spokes mounted on the central facade, three tall pointed-arch nave windows below the rose, lancet windows and oculi in the towers, an arched central doorway with rivets, all rendered in warm stone against a pink-to-peach dawn gradient sky.",
    theme: {
      primary: "#a78bfa",
      primarySoft: "rgba(167,139,250,.10)",
      primaryEdge: "rgba(167,139,250,.35)",
      h1: "linear-gradient(180deg, #ddd6fe, #a78bfa, #dc2626)",
      h2: "#c4b5fd",
      ledeColor: "#94a3b8",
      alt2: "#dc2626",
      ctaTextColor: "#1a1a1a",
      stageBg: "#f5edd9",
    },
    primitives: [
      {
        label: "PRIMITIVE 1",
        ticks: "polyline × 12 + radial grad",
        h3: "The rose window",
        p: "12 spoke polylines around a central hub, layered over a radial-gradient circle (cream center → red → blue → violet). Twelve small decorative dots circle the perimeter. The whole window is 26 children.",
      },
      {
        label: "PRIMITIVE 2",
        ticks: "polygon × 3 (spires)",
        h3: "Three spires",
        p: "Two flanking tower spires + one tall central spire — each a triangle polygon (3-point). Crosses at the tip of each are silhouette-paths. The central spire is taller (28-wide base, tip at y=60).",
      },
      {
        label: "PRIMITIVE 3",
        ticks: "silhouette-path × 7",
        h3: "Towers + nave + arches",
        p: "Two tower-block silhouette-paths flank a peaked-nave silhouette. The nave's gable is a 7-point d-string with two angled shoulders. Three tall pointed-arch nave windows + two tower lancet windows are silhouette-paths with quadratic-Bézier curves.",
      },
    ],
    jsonExcerpt: `{
  "compose": {
    "viewBox": { "width": 800, "height": 1000 },
    "theme": { "preset": "pencil-parchment" },
    "defs": {
      "gradients": [
        { "id": "g-rose", "kind": "radial",
          "cx": "50%", "cy": "50%", "r": "50%",
          "stops": [
            { "offset": "0%",   "color": "#fef3c7" },
            { "offset": "30%",  "color": "#dc2626" },
            { "offset": "60%",  "color": "#1d4ed8" },
            { "offset": "100%", "color": "#581c87" }
          ]
        }
        // ... g-dawn, g-stone
      ]
    },
    "children": [`,
    jsonChildren: [
      "dawn sky rect + ground rect",
      "nave silhouette w/ gable peak",
      "left + right tower silhouettes",
      "4 tower string-course polylines",
      "2 tower spires (polygon) + crosses",
      "central tallest spire + cross",
      "2 lancet window silhouettes + 2 oculi",
      "rose window: 2 circles + 12 spokes + hub + 12 dots",
      "3 nave arch windows + tracery mullions",
      "doorway silhouette + arch rib + rivets",
      "title + caption text",
    ],
    ctaLinks: [
      { label: "See the gallery ↗", href: "life-in-glyph.html", primary: true },
      { label: "Greek Temple", href: "draw-me-temple.html" },
      { label: "Skyscraper", href: "draw-me-skyscraper.html" },
      { label: "Pendulum Clock", href: "draw-me-pendulum-clock.html" },
    ],
  },
  {
    slug: "skyscraper",
    svg: "arch-skyscraper.svg",
    title: "Draw me a skyscraper at dusk",
    kicker: "Architecture · RFC #9 · pattern + sunset gradient",
    lede: "Form follows function. <strong>You asked Claude. Glyph drew it — from a compose spec.</strong> A blue-glass tower at last light, hundreds of yellow-lit windows, an antenna with a blinking red warning light.",
    byline:
      "Sullivan, 1896 (the principle). Mies, 1958 (Seagram Building, the realization). Glass + rhythm = the 20th century.",
    prompt:
      '"Draw me a modern skyscraper at sunset. Tall rectangular tower with a grid of lit windows. Adjacent shorter buildings in silhouette. Antenna mast on top with a blinking red warning light. Dramatic dusk sky."',
    alt: "A modern glass skyscraper at dusk: a tall dark-blue rectangular tower filled with a grid of warmly-lit windows (pattern tiling) and a slanted warm reflection across its facade, an Art-Deco setback near the top, an antenna mast with a pulsing red warning light, smaller silhouetted buildings flanking it, and a vertical sunset gradient sky going from deep blue at top to red, orange, and peach at the horizon.",
    theme: {
      primary: "#fbbf24",
      primarySoft: "rgba(251,191,36,.10)",
      primaryEdge: "rgba(251,191,36,.35)",
      h1: "linear-gradient(180deg, #fef3c7, #fbbf24, #dc2626)",
      h2: "#fde68a",
      ledeColor: "#94a3b8",
      alt2: "#dc2626",
      ctaTextColor: "#1a1a1a",
      stageBg: "#0c1126",
    },
    primitives: [
      {
        label: "PRIMITIVE 1",
        ticks: "pattern · p-windows",
        h3: "720 lit windows",
        p: "A single 24×36 pattern with four yellow rectangles per tile. Tile it across the tower's facade and you get hundreds of lit windows for the cost of one pattern definition. Different opacities per rect give a few dark-window flickers.",
      },
      {
        label: "PRIMITIVE 2",
        ticks: "4 gradients + slanted reflect",
        h3: "Sunset + reflection",
        p: "A vertical 4-stop linear gradient (blue → red → orange → peach) for the sky. A separate diagonal gradient over the facade shows the sunset reflected on glass — angled top-right to bottom-left, low opacity, gold-to-transparent.",
      },
      {
        label: "PRIMITIVE 3",
        ticks: "starfield + pulse",
        h3: "Stars + warning light",
        p: "Thirty stars in the upper band (sky-only region). The antenna warning light is a tiny circle with a <code>pulse</code> loop at 1.5 s period, scale 1.4 — the same blink every aviation regulation requires.",
      },
    ],
    jsonExcerpt: `{
  "compose": {
    "viewBox": { "width": 800, "height": 1000 },
    "theme": { "background": "#0c1126" },
    "defs": {
      "gradients": [
        { "id": "g-dusk", "kind": "linear",
          "x1": "0%", "y1": "0%", "x2": "0%", "y2": "100%",
          "stops": [
            { "offset": "0%",  "color": "#1e3a8a" },
            { "offset": "40%", "color": "#7c2d12" },
            { "offset": "70%", "color": "#dc2626" },
            { "offset": "100%","color": "#fed7aa" }
          ]
        }
        // ... g-tower, g-reflect, g-ground
      ],
      "patterns": [ /* p-windows · 24×36 × 4 lit rects */ ]
    },
    "children": [`,
    jsonChildren: [
      "dusk sky linear gradient rect",
      "starfield · 30 stars · seed 47 · top region",
      "adjacent buildings silhouette + windows pattern",
      "main tower silhouette (gradient fill)",
      "tower windows (pattern fill)",
      "facade sunset reflection (diagonal gradient)",
      "art-deco setback at top",
      "antenna mast polyline",
      "warning light circle w/ pulse · 1.5 s",
      "ground silhouette + sidewalk line",
      "title + caption text",
    ],
    ctaLinks: [
      { label: "See the gallery ↗", href: "life-in-glyph.html", primary: true },
      { label: "Greek Temple", href: "draw-me-temple.html" },
      { label: "Cathedral", href: "draw-me-cathedral.html" },
      { label: "Bridge", href: "draw-me-bridge.html" },
    ],
  },
];

/**
 * Render one full HTML page from a page config.
 * @param {(typeof pages)[number]} p
 */
function renderPage(p) {
  const t = p.theme;
  const ctaButtons = p.ctaLinks
    .map(
      (l) =>
        `<a class="btn ${l.primary ? "btn-primary" : "btn-ghost"}" href="${l.href}">${l.label}</a>`,
    )
    .join("\n  ");
  const primitivesHtml = p.primitives
    .map(
      (pr) => `      <div class="timeline-card">
        <span class="phase-num">${pr.label}</span>
        <div class="ticks">${pr.ticks}</div>
        <h3>${pr.h3}</h3>
        <p>${pr.p}</p>
      </div>`,
    )
    .join("\n");
  const childrenComments = p.jsonChildren
    .map((c, i) => `      <span class="c">// ${i + 1}. ${c}</span>`)
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${p.title} — Claude × Glyph showcase</title>
<meta name="description" content="${p.title}. A Claude × Glyph showcase: one English prompt, one compose JSON spec, one byte-locked SVG.">
<meta property="og:title" content="${p.title} — Life in Glyph">
<meta property="og:description" content="${p.lede.replace(/<[^>]+>/g, "")}">
<style>
  :root {
    --bg-deep: #02030a;
    --panel: #0c1126;
    --panel-edge: #1d2444;
    --ink: #f1f5fb;
    --muted: ${t.ledeColor};
    --primary: ${t.primary};
    --primary-soft: ${t.primarySoft};
    --primary-edge: ${t.primaryEdge};
    --alt2: ${t.alt2};
    --stage-bg: ${t.stageBg};
    --font-sans: -apple-system, "Helvetica Neue", system-ui, "Segoe UI", sans-serif;
    --font-mono: "SF Mono", "Cascadia Code", ui-monospace, monospace;
  }
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:var(--bg-deep);color:var(--ink);font-family:var(--font-sans);-webkit-font-smoothing:antialiased;line-height:1.6}
  body{background:
    radial-gradient(ellipse at 50% 18%, ${t.primarySoft}, transparent 55%),
    radial-gradient(ellipse at 80% 80%, rgba(125,211,252,.04), transparent 55%),
    var(--bg-deep);
    min-height:100vh}
  a{color:var(--primary);text-underline-offset:3px}
  h1,h2,h3{margin:0 0 .4em;letter-spacing:-.015em;line-height:1.15}
  h1{font-size:clamp(2.4rem,6vw,4.2rem);font-weight:800;background:${t.h1};-webkit-background-clip:text;background-clip:text;color:transparent}
  h2{font-size:clamp(1.6rem,3.5vw,2.4rem);font-weight:700;color:${t.h2}}
  h3{font-size:1.18rem;font-weight:600;color:var(--ink)}
  p{margin:0 0 1em}
  .container{max-width:1100px;margin:0 auto;padding:0 24px}
  code{font-family:var(--font-mono);font-size:.92em;background:#1a1f3a;padding:.12em .4em;border-radius:4px;color:#ddd6fe}
  pre{font-family:var(--font-mono);font-size:.86rem;background:#0a0f25;border:1px solid var(--panel-edge);border-radius:10px;padding:18px 20px;color:#ddd6fe;overflow-x:auto;line-height:1.55;margin:0;max-height:520px}
  pre .k{color:#7eb6ff}
  pre .s{color:#fda4af}
  pre .n{color:#34d399}
  pre .c{color:#94a3b8;font-style:italic;display:block}

  .breadcrumb{padding:18px 0;font-size:.86rem;color:var(--muted);text-align:center}
  .breadcrumb a{color:var(--muted);text-decoration:none;border-bottom:1px dashed transparent;transition:border-color .15s ease,color .15s ease}
  .breadcrumb a:hover{color:var(--primary);border-bottom-color:var(--primary)}

  .hero{padding:24px 0 24px;text-align:center}
  .hero .kicker{display:inline-block;padding:6px 16px;border-radius:9999px;background:var(--primary-soft);color:var(--primary);font-size:.82rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;margin-bottom:24px;border:1px solid var(--primary-edge)}
  .hero p.lede{color:var(--muted);max-width:64ch;margin:.6em auto 0;font-size:1.12rem}
  .hero p.lede strong{color:var(--ink)}
  .hero p.byline{color:var(--muted);font-size:.92rem;margin-top:24px;font-style:italic}

  .prompt-card{margin:32px auto 24px;max-width:760px;background:linear-gradient(180deg, ${t.primarySoft}, rgba(125,211,252,.03));border:1px solid var(--panel-edge);border-radius:18px;padding:28px 32px}
  .prompt-card .label{display:inline-block;font-size:.74rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--alt2);margin-bottom:10px}
  .prompt-card blockquote{margin:0;font-family:var(--font-mono);font-size:1.04rem;line-height:1.7;color:var(--ink);padding-left:18px;border-left:3px solid var(--primary)}
  .prompt-card .who{margin-top:14px;font-size:.86rem;color:var(--muted)}

  .stage{margin:0 auto 48px;max-width:980px;background:var(--stage-bg);border:1px solid var(--panel-edge);border-radius:22px;overflow:hidden;position:relative;padding:6px}
  .stage img{display:block;width:100%;height:auto;border-radius:16px}

  .timeline{padding:48px 0 24px}
  .timeline h2{text-align:center}
  .timeline > .container > p.lede{color:var(--muted);text-align:center;max-width:54ch;margin:0 auto 32px;font-size:1.02rem}
  .timeline-grid{display:grid;grid-template-columns:repeat(3, 1fr);gap:18px;max-width:1000px;margin:0 auto}
  @media (max-width:880px){.timeline-grid{grid-template-columns:1fr}}
  .timeline-card{background:var(--panel);border:1px solid var(--panel-edge);border-radius:14px;padding:22px 22px 20px;transition:transform .2s ease,border-color .2s ease}
  .timeline-card:hover{transform:translateY(-3px);border-color:var(--primary-edge)}
  .timeline-card .phase-num{display:inline-block;font-family:var(--font-mono);font-size:.78rem;color:var(--primary);letter-spacing:.05em;margin-bottom:4px}
  .timeline-card .ticks{font-family:var(--font-mono);font-size:.84rem;color:var(--alt2);margin-bottom:10px}
  .timeline-card h3{margin-bottom:8px}
  .timeline-card p{font-size:.96rem;color:var(--muted);margin:0}

  .reveal{padding:48px 0;border-top:1px solid var(--panel-edge);background:linear-gradient(180deg, ${t.primarySoft}, transparent 40%)}
  .reveal h2{text-align:center}
  .reveal > .container > p.lede{color:var(--muted);text-align:center;max-width:60ch;margin:0 auto 32px;font-size:1.02rem}
  .reveal-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start;max-width:1080px;margin:0 auto}
  @media (max-width:880px){.reveal-grid{grid-template-columns:1fr}}
  .reveal-side h3{margin-bottom:10px;display:flex;align-items:center;gap:10px;color:${t.h2}}
  .reveal-side h3 .pill{font-size:.66rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:3px 9px;border-radius:9999px;background:var(--primary-soft);color:var(--primary);border:1px solid var(--primary-edge)}
  .reveal-side p.cap{color:var(--muted);font-size:.92rem;margin-top:10px}
  .reveal-svg-frame{background:var(--stage-bg);border-radius:12px;padding:6px;border:1px solid var(--panel-edge)}
  .reveal-svg-frame img{display:block;width:100%;height:auto;border-radius:8px}

  .cta{text-align:center;padding:48px 24px;border-top:1px solid var(--panel-edge)}
  .cta .btn{display:inline-block;margin:6px;padding:12px 22px;border-radius:9999px;text-decoration:none;font-weight:600;font-size:.96rem;border:1px solid transparent;transition:transform .15s ease,background .15s ease}
  .cta .btn-primary{background:var(--primary);color:${t.ctaTextColor}}
  .cta .btn-primary:hover{transform:translateY(-1px);background:${t.h2}}
  .cta .btn-ghost{border-color:#374151;color:var(--ink)}
  .cta .btn-ghost:hover{border-color:var(--primary);color:var(--primary)}
  footer{padding:24px 0 48px;text-align:center;color:var(--muted);font-size:.88rem}
</style>
</head>
<body>

<div class="breadcrumb">
  <a href="life-in-glyph.html">← Life in Glyph</a> &nbsp;·&nbsp; <a href="joy.html">Joy of Math</a>
</div>

<header class="hero">
  <div class="container">
    <span class="kicker">${p.kicker}</span>
    <h1>${p.title}</h1>
    <p class="lede">${p.lede}</p>
    <p class="byline">${p.byline}</p>
  </div>
</header>

<section class="container">
  <div class="prompt-card">
    <span class="label">▸ The prompt</span>
    <blockquote>${p.prompt}</blockquote>
    <p class="who">— what to say to your AI agent. Claude writes the Glyph compose spec; the compose compiler emits one byte-locked SVG.</p>
  </div>
</section>

<section class="container">
  <div class="stage" aria-label="${p.title}">
    <img src="${p.svg}" alt="${p.alt}" loading="lazy">
  </div>
</section>

<section class="timeline">
  <div class="container">
    <h2>One scene, three primitives</h2>
    <p class="lede">RFC #9's defs (gradients + patterns), shapes (silhouette-path, polygon, polyline, ellipse), and accents (glow, starfield, icon) compose the whole picture.</p>
    <div class="timeline-grid">
${primitivesHtml}
    </div>
  </div>
</section>

<section class="reveal">
  <div class="container">
    <h2>How Glyph drew it</h2>
    <p class="lede">Claude writes the compose JSON; Glyph's compose compiler turns it into byte-identical SVG.</p>
    <div class="reveal-grid">
      <div class="reveal-side">
        <h3>The compose spec <span class="pill">JSON · excerpt</span></h3>
        <pre>${p.jsonExcerpt}
${childrenComments}
    ]
  }
}</pre>
        <p class="cap">Generator script: <code>scripts/gen-showcase-extensions.mjs</code> · fixture: <code>packages/core/__fixtures__/compose/${p.svg.replace(".svg", ".json")}</code>. <a href="https://github.com/seanhanca/glyph/blob/main/packages/core/__fixtures__/compose/${p.svg.replace(".svg", ".json")}">View on GitHub</a>.</p>
      </div>
      <div class="reveal-side">
        <h3>Glyph compose output <span class="pill">SVG</span></h3>
        <div class="reveal-svg-frame">
          <img src="${p.svg}" alt="Glyph-rendered ${p.title.toLowerCase()}, same SVG as the hero stage" loading="lazy">
        </div>
        <p class="cap">Byte-stable across Ubuntu / macOS / Windows × Node 20 / 22. The compose compiler resolves the gradient + pattern defs first, then walks children in z-order.</p>
      </div>
    </div>
  </div>
</section>

<section class="cta">
  <h2 style="margin-bottom:24px">More Life in Glyph</h2>
  ${ctaButtons}
</section>

<footer>
  <div class="container">
    Drawn by Glyph · Asked by you · Apache 2.0 · <a href="https://github.com/seanhanca/glyph">GitHub</a>
  </div>
</footer>

</body>
</html>
`;
}

for (const p of pages) {
  const path = join(outDir, `draw-me-${p.slug}.html`);
  writeFileSync(path, renderPage(p));
  console.log(`wrote ${path}`);
}
