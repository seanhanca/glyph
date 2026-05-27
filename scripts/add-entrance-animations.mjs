#!/usr/bin/env node
// Picks the charts where animation adds the most visual value, and
// adds entrance / loop SMIL animations to them. Each animation plays
// once on load (with begin="0s") and freezes at the final frame.
//
// Charts re-emitted with entrance animations:
//
//   1. Index chart — each ticker's polyline DRAWS IN left-to-right
//      via `stroke-dasharray` + animated `stroke-dashoffset`.
//      Staggered 0–0.4s so the leader starts first.
//
//   2. KPI radar — the data polygon GROWS from a single center point
//      via `animateTransform` `type="scale"`. Dots pop in
//      sequentially around the perimeter.
//
//   3. Marketing sunburst — wedges SWEEP IN clockwise via a group
//      `rotate` animation, then dots/labels fade in.
//
//   4. Circle packing — every product bubble POPS IN with a scale
//      0→1 animation, staggered so the eye sees the hierarchy.
//
//   5. Conversion funnel — bars CASCADE in top-to-bottom by animating
//      width from 0 to final. Was chart-spec; now compose.
//
// Run from repo root:
//   node scripts/add-entrance-animations.mjs

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const BIZ = join(ROOT, "site/play/examples/business");
mkdirSync(BIZ, { recursive: true });

function writeSpec(name, spec) {
  writeFileSync(join(BIZ, name), `${JSON.stringify(spec, null, 2)}\n`);
}

// ============================================================================
// 1. Index chart — draw-in lines, staggered start per ticker
// ============================================================================
{
  const tickers = [
    { name: "ACME", start: 100, drift: 0.013, vol: 0.045, color: "#4c78a8" },
    { name: "BRIX", start: 100, drift: 0.018, vol: 0.07, color: "#f58518" },
    { name: "COIL", start: 100, drift: 0.008, vol: 0.05, color: "#54a24b" },
    { name: "DYAD", start: 100, drift: -0.005, vol: 0.04, color: "#e45756" },
    { name: "ECHO", start: 100, drift: 0.025, vol: 0.09, color: "#72b7b2" },
  ];
  function lcg(seed) {
    let s = seed % 0x7fffffff;
    if (s <= 0) s += 0x7ffffffe;
    return () => {
      s = (s * 48271) % 0x7fffffff;
      return s / 0x7fffffff;
    };
  }
  const months = 24;
  const series = tickers.map((t) => {
    const rand = lcg(101 + t.name.charCodeAt(0));
    const vals = [t.start];
    for (let i = 1; i < months; i++) {
      const step = t.drift + (rand() - 0.5) * t.vol * 2;
      vals.push(vals[i - 1] * (1 + step));
    }
    return { ...t, vals };
  });

  const W = 720;
  const H = 420;
  const padL = 60;
  const padR = 140;
  const padT = 70;
  const padB = 50;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  let yMin = Number.POSITIVE_INFINITY;
  let yMax = Number.NEGATIVE_INFINITY;
  for (const s of series)
    for (const v of s.vals) {
      if (v < yMin) yMin = v;
      if (v > yMax) yMax = v;
    }
  yMin = Math.floor(yMin / 10) * 10;
  yMax = Math.ceil(yMax / 10) * 10;
  const xAt = (i) => padL + (i / (months - 1)) * plotW;
  const yAt = (v) => padT + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  const children = [];
  children.push({
    at: { x: W / 2, y: 30 },
    mark: "text",
    textMark: {
      text: "Index chart — 5 tech stocks, rebased to 100",
      fontSize: 17,
      fill: "#1a1a1a",
      italic: false,
      anchor: "middle",
    },
  });
  children.push({
    at: { x: W / 2, y: 52 },
    mark: "text",
    textMark: {
      text: "Each line normalized to its starting value (100). Lines draw in on load.",
      fontSize: 12,
      fill: "#666",
      italic: true,
      anchor: "middle",
    },
  });
  // Grid + axes.
  let gridD = "";
  for (let g = 0; g <= 4; g++) {
    const y = padT + (g / 4) * plotH;
    gridD += ` M ${padL} ${y} L ${padL + plotW} ${y}`;
  }
  children.push({
    at: { x: 0, y: 0 },
    mark: "silhouette-path",
    silhouettePath: { d: gridD.trim(), fill: "none", stroke: "#e6e9ee", strokeWidth: 1 },
  });
  for (let g = 0; g <= 4; g++) {
    const v = yMax - (g / 4) * (yMax - yMin);
    children.push({
      at: { x: padL - 8, y: padT + (g / 4) * plotH + 4 },
      mark: "text",
      textMark: {
        text: String(Math.round(v)),
        fontSize: 10.5,
        fill: "#888",
        italic: false,
        anchor: "end",
      },
    });
  }
  for (const i of [0, 5, 11, 17, 23]) {
    children.push({
      at: { x: xAt(i), y: padT + plotH + 16 },
      mark: "text",
      textMark: {
        text: `M${i + 1}`,
        fontSize: 10.5,
        fill: "#888",
        italic: false,
        anchor: "middle",
      },
    });
  }
  children.push({
    at: { x: 0, y: 0 },
    mark: "silhouette-path",
    silhouettePath: {
      d: `M ${padL} ${yAt(100)} L ${padL + plotW} ${yAt(100)}`,
      fill: "none",
      stroke: "#bcc4cf",
      strokeWidth: 1,
      strokeDasharray: "4,3",
    },
  });

  // Series — one raw-svg per ticker so the draw-in can carry its own
  // stroke-dasharray length without polluting siblings. Each path has
  // SMIL animation: stroke-dashoffset goes from totalLen → 0.
  for (let si = 0; si < series.length; si++) {
    const s = series[si];
    let d = "";
    let totalLen = 0;
    let prev = null;
    for (let i = 0; i < s.vals.length; i++) {
      const x = Number(xAt(i).toFixed(2));
      const y = Number(yAt(s.vals[i]).toFixed(2));
      if (i === 0) d += `M ${x} ${y}`;
      else d += ` L ${x} ${y}`;
      if (prev) {
        totalLen += Math.hypot(x - prev[0], y - prev[1]);
      }
      prev = [x, y];
    }
    const len = Math.ceil(totalLen);
    // Stagger: leader (highest final value) starts first.
    const beginDelay = (si * 0.12).toFixed(2);
    const xml = `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-dasharray="${len}" stroke-dashoffset="${len}"><animate attributeName="stroke-dashoffset" from="${len}" to="0" dur="2.4s" begin="${beginDelay}s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.42 0 0.58 1"/></path>`;
    // End-of-line label — fade in after the line finishes.
    const lastV = s.vals[s.vals.length - 1];
    const labelXml = `<text x="${(padL + plotW + 8).toFixed(2)}" y="${(yAt(lastV) + 4).toFixed(2)}" font-family="system-ui,sans-serif" font-size="11.5" fill="${s.color}" text-anchor="start" opacity="0"><animate attributeName="opacity" from="0" to="1" dur="0.4s" begin="${(Number(beginDelay) + 2.4).toFixed(2)}s" fill="freeze"/>${s.name}  ${lastV.toFixed(0)}</text>`;
    children.push({ at: { x: 0, y: 0 }, mark: "raw-svg", rawSvg: { xml } });
    children.push({ at: { x: 0, y: 0 }, mark: "raw-svg", rawSvg: { xml: labelXml } });
  }

  writeSpec("index-chart.spec.json", {
    compose: {
      viewBox: { width: W, height: H },
      title: "Index chart — relative performance (animated draw-in)",
      description:
        "5 tech stocks normalized to 100. Each line draws in on load via SMIL `stroke-dashoffset` animation; end-of-line labels fade in after their line finishes.",
      children,
    },
  });
}

// ============================================================================
// 2. KPI radar — polygon grows from center, dots pop in around the perimeter
// ============================================================================
{
  const metrics = [
    { label: "Performance", score: 86 },
    { label: "Reliability", score: 92 },
    { label: "Security", score: 78 },
    { label: "Cost", score: 64 },
    { label: "UX", score: 88 },
    { label: "Velocity", score: 74 },
  ];
  const cx = 320;
  const cy = 340;
  const maxR = 200;
  const N = metrics.length;
  const angleAt = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / N;
  const ringRadii = [0.25, 0.5, 0.75, 1].map((f) => f * maxR);
  let gridD = "";
  for (const r of ringRadii) {
    gridD += ` M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0`;
  }
  for (let i = 0; i < N; i++) {
    const a = angleAt(i);
    gridD += ` M ${cx} ${cy} L ${(cx + maxR * Math.cos(a)).toFixed(2)} ${(cy + maxR * Math.sin(a)).toFixed(2)}`;
  }
  const polyPts = metrics.map((m, i) => {
    const a = angleAt(i);
    const r = (m.score / 100) * maxR;
    return [Number((cx + r * Math.cos(a)).toFixed(2)), Number((cy + r * Math.sin(a)).toFixed(2))];
  });

  const children = [];
  children.push({
    at: { x: cx, y: 36 },
    mark: "text",
    textMark: {
      text: "Product KPI scorecard — Q3 (animated)",
      fontSize: 18,
      fill: "#1a1a1a",
      italic: false,
      anchor: "middle",
    },
  });
  children.push({
    at: { x: cx, y: 58 },
    mark: "text",
    textMark: {
      text: "Polygon grows from center on load; dots pop in around the perimeter.",
      fontSize: 12,
      fill: "#666",
      italic: true,
      anchor: "middle",
    },
  });
  children.push({
    at: { x: 0, y: 0 },
    mark: "silhouette-path",
    silhouettePath: { d: gridD.trim(), fill: "none", stroke: "#dde3ec", strokeWidth: 1 },
  });
  // Ring value labels.
  for (let k = 0; k < 4; k++) {
    const v = (k + 1) * 25;
    const r = ringRadii[k];
    children.push({
      at: { x: cx + 6, y: cy - r + 3 },
      mark: "text",
      textMark: {
        text: String(v),
        fontSize: 10,
        fill: "#aab2bd",
        italic: false,
        anchor: "start",
      },
    });
  }

  // Data polygon: animate its `points` attribute from "all collapsed at
  // the center" to the final positions. SMIL's `points` interpolation
  // is broadly supported and avoids the transform-list interpolation
  // quirks Chrome has with `translate(...) scale(...) translate(...)`.
  const polyPointsAttr = polyPts.map((p) => p.join(",")).join(" ");
  const collapsedPointsAttr = polyPts.map(() => `${cx},${cy}`).join(" ");
  const polyXml = `<polygon points="${collapsedPointsAttr}" fill="rgba(76,120,168,0.22)" stroke="#4c78a8" stroke-width="2"><animate attributeName="points" values="${collapsedPointsAttr};${polyPointsAttr}" dur="0.9s" begin="0.2s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.22 1 0.36 1"/></polygon>`;
  children.push({ at: { x: 0, y: 0 }, mark: "raw-svg", rawSvg: { xml: polyXml } });

  // Per-axis dots + value labels — pop in with stagger, aligned to the
  // polygon's animation (begin ~ 0.7s onward).
  for (let i = 0; i < N; i++) {
    const [px, py] = polyPts[i];
    const a = angleAt(i);
    const vx = px + 12 * Math.cos(a);
    const vy = py + 12 * Math.sin(a) + 4;
    const begin = (1.0 + i * 0.08).toFixed(2);
    const dotXml = `<circle cx="${px}" cy="${py}" r="0" fill="#4c78a8" stroke="#1a1a1a" stroke-width="1"><animate attributeName="r" from="0" to="4.5" dur="0.4s" begin="${begin}s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.22 1 0.36 1"/></circle><text x="${vx}" y="${vy}" font-family="system-ui,sans-serif" font-size="11" fill="#1a1a1a" text-anchor="middle" opacity="0"><animate attributeName="opacity" from="0" to="1" dur="0.3s" begin="${(Number(begin) + 0.15).toFixed(2)}s" fill="freeze"/>${metrics[i].score}</text>`;
    children.push({ at: { x: 0, y: 0 }, mark: "raw-svg", rawSvg: { xml: dotXml } });
  }
  // Axis labels (static).
  for (let i = 0; i < N; i++) {
    const a = angleAt(i);
    const lx = cx + (maxR + 28) * Math.cos(a);
    const ly = cy + (maxR + 28) * Math.sin(a);
    const dx = Math.cos(a);
    const anchor = Math.abs(dx) < 0.3 ? "middle" : dx > 0 ? "start" : "end";
    children.push({
      at: { x: lx, y: ly + 4 },
      mark: "text",
      textMark: {
        text: metrics[i].label,
        fontSize: 12.5,
        fill: "#1a1a1a",
        italic: false,
        anchor,
      },
    });
  }

  writeSpec("kpi-radar.spec.json", {
    compose: {
      viewBox: { width: 640, height: 600 },
      title: "Product KPI scorecard — animated radar",
      description:
        "On load, the data polygon scales up from the radar center, then dots pop in one-by-one around the perimeter with the corresponding score.",
      children,
    },
  });
}

// ============================================================================
// 3. Marketing sunburst — wedges sweep in clockwise
// ============================================================================
// Implementation trick: render each outer-ring arc as a stroked path
// instead of a filled wedge, then animate stroke-dashoffset to "draw"
// the ring clockwise. The inner ring is small and stays static (fades
// in via opacity).
//
// For visual fidelity we keep both fills (the wedges) AND the outline
// trick — the fills fade in via opacity stagger, so the effect is
// "wedges paint in clockwise."
{
  const data = [
    {
      label: "Performance",
      fill: "#4c78a8",
      tint: "#7eaad1",
      children: [
        { label: "Paid search", value: 720 },
        { label: "Paid social", value: 480 },
        { label: "Display", value: 240 },
        { label: "Retargeting", value: 180 },
      ],
    },
    {
      label: "Brand",
      fill: "#f58518",
      tint: "#f8b25e",
      children: [
        { label: "Content", value: 540 },
        { label: "PR", value: 220 },
        { label: "Events", value: 380 },
        { label: "Sponsorships", value: 140 },
      ],
    },
    {
      label: "Lifecycle",
      fill: "#54a24b",
      tint: "#88c182",
      children: [
        { label: "Email", value: 320 },
        { label: "Webinars", value: 280 },
        { label: "Referral", value: 240 },
        { label: "Community", value: 160 },
      ],
    },
  ];
  const cx = 320;
  const cy = 330;
  const innerR0 = 70;
  const innerR1 = 145;
  const outerR1 = 215;
  const totalValue = data.reduce((s, d) => s + d.children.reduce((s2, c) => s2 + c.value, 0), 0);
  function arcPath(r0, r1, a0, a1) {
    const x0o = cx + r1 * Math.cos(a0);
    const y0o = cy + r1 * Math.sin(a0);
    const x1o = cx + r1 * Math.cos(a1);
    const y1o = cy + r1 * Math.sin(a1);
    const x0i = cx + r0 * Math.cos(a1);
    const y0i = cy + r0 * Math.sin(a1);
    const x1i = cx + r0 * Math.cos(a0);
    const y1i = cy + r0 * Math.sin(a0);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return `M ${x0o.toFixed(2)} ${y0o.toFixed(2)} A ${r1} ${r1} 0 ${large} 1 ${x1o.toFixed(2)} ${y1o.toFixed(2)} L ${x0i.toFixed(2)} ${y0i.toFixed(2)} A ${r0} ${r0} 0 ${large} 0 ${x1i.toFixed(2)} ${y1i.toFixed(2)} Z`;
  }

  const children = [];
  children.push({
    at: { x: cx, y: 38 },
    mark: "text",
    textMark: {
      text: "Marketing spend — animated sweep",
      fontSize: 17,
      fill: "#1a1a1a",
      italic: false,
      anchor: "middle",
    },
  });
  children.push({
    at: { x: cx, y: 60 },
    mark: "text",
    textMark: {
      text: "Wedges fade in clockwise on load. Labels follow after the ring finishes.",
      fontSize: 12,
      fill: "#666",
      italic: true,
      anchor: "middle",
    },
  });

  // Compute per-wedge angles + cumulative time for stagger.
  let theta = -Math.PI / 2;
  const totalSweepMs = 1500;
  const startMs = 200;
  const wedgeSpec = [];
  for (const cat of data) {
    const catTotal = cat.children.reduce((s, c) => s + c.value, 0);
    const catSpan = (catTotal / totalValue) * Math.PI * 2;
    const catEnd = theta + catSpan;
    let childTheta = theta;
    for (const ch of cat.children) {
      const span = (ch.value / catTotal) * catSpan;
      const childEnd = childTheta + span;
      wedgeSpec.push({
        kind: "outer",
        cat,
        ch,
        a0: childTheta,
        a1: childEnd,
      });
      childTheta = childEnd;
    }
    wedgeSpec.push({ kind: "inner", cat, a0: theta, a1: catEnd });
    theta = catEnd;
  }
  // Sweep order: outer arcs clockwise, then inner ring fades in.
  // First, emit outer wedges with begin times proportional to their
  // starting angle (so they appear clockwise from 12 o'clock).
  const outers = wedgeSpec.filter((w) => w.kind === "outer");
  // Normalize a0+PI/2 to [0, 2π) for time mapping.
  for (const w of outers) {
    const normA = (((w.a0 + Math.PI / 2) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const t = startMs + (normA / (2 * Math.PI)) * totalSweepMs;
    const begin = (t / 1000).toFixed(3);
    const d = arcPath(innerR1, outerR1, w.a0, w.a1);
    const xml = `<path d="${d}" fill="${w.cat.tint}" stroke="#ffffff" stroke-width="1.5" opacity="0"><animate attributeName="opacity" from="0" to="1" dur="0.4s" begin="${begin}s" fill="freeze"/></path>`;
    children.push({ at: { x: 0, y: 0 }, mark: "raw-svg", rawSvg: { xml } });
  }
  // Inner ring: fade in after the outer sweep finishes.
  const innerBegin = ((startMs + totalSweepMs + 100) / 1000).toFixed(3);
  for (const w of wedgeSpec.filter((w) => w.kind === "inner")) {
    const d = arcPath(innerR0, innerR1, w.a0, w.a1);
    const midA = (w.a0 + w.a1) / 2;
    const rMid = (innerR0 + innerR1) / 2;
    const lx = cx + rMid * Math.cos(midA);
    const ly = cy + rMid * Math.sin(midA);
    const xml = `<path d="${d}" fill="${w.cat.fill}" stroke="#ffffff" stroke-width="2" opacity="0"><animate attributeName="opacity" from="0" to="1" dur="0.5s" begin="${innerBegin}s" fill="freeze"/></path><text x="${lx.toFixed(2)}" y="${(ly + 5).toFixed(2)}" font-family="system-ui,sans-serif" font-size="13" fill="#ffffff" text-anchor="middle" opacity="0"><animate attributeName="opacity" from="0" to="1" dur="0.5s" begin="${(Number(innerBegin) + 0.3).toFixed(3)}s" fill="freeze"/>${w.cat.label}</text>`;
    children.push({ at: { x: 0, y: 0 }, mark: "raw-svg", rawSvg: { xml } });
  }
  // Outer ring labels: appear after their wedge.
  for (const w of outers) {
    const normA = (((w.a0 + Math.PI / 2) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const t = startMs + (normA / (2 * Math.PI)) * totalSweepMs + 500;
    const begin = (t / 1000).toFixed(3);
    const midA = (w.a0 + w.a1) / 2;
    const lx = cx + (outerR1 + 16) * Math.cos(midA);
    const ly = cy + (outerR1 + 16) * Math.sin(midA);
    const dx = Math.cos(midA);
    const anchor = Math.abs(dx) < 0.25 ? "middle" : dx > 0 ? "start" : "end";
    const xml =
      `<text x="${lx.toFixed(2)}" y="${(ly + 4).toFixed(2)}" font-family="system-ui,sans-serif" ` +
      `font-size="11" fill="#1a1a1a" text-anchor="${anchor}" opacity="0">` +
      `<animate attributeName="opacity" from="0" to="1" dur="0.3s" begin="${begin}s" fill="freeze"/>` +
      `${w.ch.label} · $${w.ch.value}K</text>`;
    children.push({ at: { x: 0, y: 0 }, mark: "raw-svg", rawSvg: { xml } });
  }
  // Center "$3.9M annual spend" — fades in last.
  const totalSpend = totalValue;
  const centerBegin = ((startMs + totalSweepMs + 1100) / 1000).toFixed(3);
  const centerXml = `<text x="${cx}" y="${cy - 6}" font-family="system-ui,sans-serif" font-size="22" fill="#1a1a1a" text-anchor="middle" font-weight="600" opacity="0"><animate attributeName="opacity" from="0" to="1" dur="0.5s" begin="${centerBegin}s" fill="freeze"/>$${(totalSpend / 1000).toFixed(1)}M</text><text x="${cx}" y="${cy + 14}" font-family="system-ui,sans-serif" font-size="11" fill="#666" text-anchor="middle" font-style="italic" opacity="0"><animate attributeName="opacity" from="0" to="1" dur="0.5s" begin="${(Number(centerBegin) + 0.2).toFixed(3)}s" fill="freeze"/>annual spend</text>`;
  children.push({ at: { x: 0, y: 0 }, mark: "raw-svg", rawSvg: { xml: centerXml } });

  writeSpec("marketing-sunburst.spec.json", {
    compose: {
      viewBox: { width: 640, height: 600 },
      title: "Marketing spend — annual budget (animated sweep)",
      description:
        "On load, the outer ring of channel wedges fades in clockwise starting at 12 o'clock. The 3 category wedges in the inner ring fade in next, then the outer labels and the center total.",
      children,
    },
  });
}

// ============================================================================
// 4. Circle packing — bubbles pop in with stagger
// ============================================================================
{
  const data = [
    {
      name: "Cloud",
      color: "#4c78a8",
      cx: 220,
      cy: 240,
      r: 130,
      children: [
        { name: "Compute", value: 6.8 },
        { name: "Storage", value: 4.2 },
        { name: "Network", value: 2.1 },
      ],
    },
    {
      name: "Pro Tools",
      color: "#f58518",
      cx: 480,
      cy: 220,
      r: 110,
      children: [
        { name: "IDE", value: 3.4 },
        { name: "Debug", value: 1.8 },
        { name: "Seats", value: 2.6 },
      ],
    },
    {
      name: "Edge",
      color: "#54a24b",
      cx: 380,
      cy: 430,
      r: 90,
      children: [
        { name: "CDN", value: 1.9 },
        { name: "Workers", value: 1.1 },
        { name: "DDoS", value: 0.6 },
      ],
    },
  ];
  const W = 700;
  const H = 580;
  const children = [];
  children.push({
    at: { x: W / 2, y: 30 },
    mark: "text",
    textMark: {
      text: "Circle packing — Q3 revenue hierarchy (animated)",
      fontSize: 17,
      fill: "#1a1a1a",
      italic: false,
      anchor: "middle",
    },
  });
  children.push({
    at: { x: W / 2, y: 52 },
    mark: "text",
    textMark: {
      text: "On load, each category bubble grows from the center, then its children pop in.",
      fontSize: 11.5,
      fill: "#666",
      italic: true,
      anchor: "middle",
    },
  });

  // Each bubble animates its `r` from 0 → final. Text labels follow
  // with opacity fade after the bubble is fully rendered. Direct
  // attribute animation avoids the transform-list interpolation
  // quirks that broke the radar polygon's scale-in.
  let parentDelay = 0.2;
  for (const cat of data) {
    const parentXml = `<circle cx="${cat.cx}" cy="${cat.cy}" r="0" fill="${cat.color}"><animate attributeName="r" from="0" to="${cat.r}" dur="0.55s" begin="${parentDelay.toFixed(2)}s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.22 1 0.36 1"/></circle><text x="${cat.cx}" y="${cat.cy - cat.r - 10}" font-family="system-ui,sans-serif" font-size="13" fill="${cat.color}" text-anchor="middle" opacity="0"><animate attributeName="opacity" from="0" to="1" dur="0.3s" begin="${(parentDelay + 0.4).toFixed(2)}s" fill="freeze"/>${cat.name}</text>`;
    children.push({ at: { x: 0, y: 0 }, mark: "raw-svg", rawSvg: { xml: parentXml } });

    const childAreaR = cat.r * 0.55;
    const N = cat.children.length;
    for (let i = 0; i < N; i++) {
      const ch = cat.children[i];
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / N;
      const ccx = cat.cx + childAreaR * Math.cos(angle);
      const ccy = cat.cy + childAreaR * Math.sin(angle);
      const cr = 18 + 22 * Math.sqrt(ch.value / Math.max(...cat.children.map((c) => c.value)));
      const begin = (parentDelay + 0.55 + i * 0.12).toFixed(2);
      const labelBegin = (Number(begin) + 0.25).toFixed(2);
      const childXml = `<circle cx="${ccx}" cy="${ccy}" r="0" fill="#ffffff" stroke="${cat.color}" stroke-width="2.5"><animate attributeName="r" from="0" to="${cr.toFixed(2)}" dur="0.4s" begin="${begin}s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.22 1 0.36 1"/></circle><text x="${ccx}" y="${ccy - 2}" font-family="system-ui,sans-serif" font-size="11" fill="#1a1a1a" text-anchor="middle" opacity="0"><animate attributeName="opacity" from="0" to="1" dur="0.3s" begin="${labelBegin}s" fill="freeze"/>${ch.name}</text><text x="${ccx}" y="${ccy + 12}" font-family="system-ui,sans-serif" font-size="10" fill="#666" text-anchor="middle" opacity="0"><animate attributeName="opacity" from="0" to="1" dur="0.3s" begin="${labelBegin}s" fill="freeze"/>$${ch.value}M</text>`;
      children.push({ at: { x: 0, y: 0 }, mark: "raw-svg", rawSvg: { xml: childXml } });
    }
    parentDelay += 0.35;
  }

  writeSpec("circle-packing.spec.json", {
    compose: {
      viewBox: { width: W, height: H },
      title: "Circle packing — Q3 revenue (animated)",
      description:
        "On load, the three product-line bubbles scale up sequentially. After each parent settles, its child products pop in around it with stagger.",
      children,
    },
  });
}

// ============================================================================
// 5. Conversion funnel — bars cascade in top-to-bottom
// ============================================================================
// Was chart-spec; now compose so each stage can animate its own width
// from 0 → final, with begin times staggered top-to-bottom.
{
  const stages = [
    { name: "Visit", count: 10000 },
    { name: "Sign-up", count: 3200 },
    { name: "Activate", count: 1450 },
    { name: "Subscribe", count: 620 },
    { name: "Renew", count: 380 },
  ];
  const W = 720;
  const H = 420;
  const padL = 130;
  const padR = 80;
  const padT = 70;
  const padB = 50;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const rowH = plotH / stages.length;
  const barH = rowH * 0.62;
  const maxCount = stages[0].count;

  const children = [];
  children.push({
    at: { x: W / 2, y: 30 },
    mark: "text",
    textMark: {
      text: "Conversion funnel — visit → renew (animated)",
      fontSize: 17,
      fill: "#1a1a1a",
      italic: false,
      anchor: "middle",
    },
  });
  children.push({
    at: { x: W / 2, y: 52 },
    mark: "text",
    textMark: {
      text: "Stages cascade in top-to-bottom; conversion % labels follow each bar.",
      fontSize: 11.5,
      fill: "#666",
      italic: true,
      anchor: "middle",
    },
  });

  for (let i = 0; i < stages.length; i++) {
    const s = stages[i];
    const yMid = padT + (i + 0.5) * rowH;
    const yTop = yMid - barH / 2;
    const finalW = (s.count / maxCount) * plotW;
    const begin = (0.15 + i * 0.18).toFixed(2);
    const xml = `<rect x="${padL}" y="${yTop}" width="0" height="${barH}" rx="3" fill="#4c78a8"><animate attributeName="width" from="0" to="${finalW.toFixed(2)}" dur="0.7s" begin="${begin}s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.22 1 0.36 1"/></rect><text x="${padL + finalW + 6}" y="${(yMid + 4).toFixed(2)}" font-family="system-ui,sans-serif" font-size="12" fill="#1a1a1a" text-anchor="start" opacity="0"><animate attributeName="opacity" from="0" to="1" dur="0.3s" begin="${(Number(begin) + 0.6).toFixed(2)}s" fill="freeze"/>${s.count.toLocaleString()}${i > 0 ? `  ·  ${((s.count / stages[i - 1].count) * 100).toFixed(0)}%` : ""}</text>`;
    children.push({ at: { x: 0, y: 0 }, mark: "raw-svg", rawSvg: { xml } });
    // Stage name on the left.
    children.push({
      at: { x: padL - 12, y: yMid + 4 },
      mark: "text",
      textMark: {
        text: s.name,
        fontSize: 12.5,
        fill: "#1a1a1a",
        italic: false,
        anchor: "end",
      },
    });
  }

  writeSpec("conversion-funnel.spec.json", {
    compose: {
      viewBox: { width: W, height: H },
      title: "Conversion funnel — visit → renew (animated cascade)",
      description:
        "Each stage's bar animates its width from 0 to its final size, staggered top-to-bottom. After each bar lands, its count + conversion % label fades in.",
      children,
    },
  });
}

// ---------------------------------------------------------------------------
// Smoke render + verify every spec actually contains at least one
// <animate> tag with a `begin=` time (i.e. an entrance animation).
// ---------------------------------------------------------------------------
const bundleUrl = pathToFileURL(join(ROOT, "site/play/glyph-bundle.js")).href;
const { compileCompose, parseComposeSpec, renderSvg } = await import(bundleUrl);
const want = [
  "index-chart",
  "kpi-radar",
  "marketing-sunburst",
  "circle-packing",
  "conversion-funnel",
];
console.log("\nSmoke render:");
for (const stem of want) {
  const spec = JSON.parse(readFileSync(join(BIZ, `${stem}.spec.json`), "utf8"));
  const svg = renderSvg(compileCompose(parseComposeSpec(spec)));
  const animateCount = (svg.match(/<animate[^>]*\bbegin=/g) || []).length;
  const ok =
    animateCount > 0 ? `✓ ${animateCount} entrance animations` : "⚠ no entrance animations";
  console.log(`  ${stem.padEnd(22)} → ${svg.length} bytes  ${ok}`);
}
