#!/usr/bin/env node
// Adds:
//   - 1 composite chart (bar + line + outlier markers) to Business charts
//   - 7 charts to a new "Advanced" category, inspired by the Observable
//     D3 examples list the user pointed at:
//       1. Ridgeline plot (overlapping density curves)
//       2. Dot plot / strip plot (latency by endpoint)
//       3. Diverging bar chart (NPS responses, centered on 0)
//       4. Horizontal stacked bar (population by age group, by country)
//       5. Year calendar heatmap (365-day daily activity)
//       6. Parallel coordinates (feature comparison across products)
//       7. Difference chart (Y1 vs Y2 with shaded diff band)
//
// Skipped from the user's list (would need either a new Glyph mark or
// runtime interactivity the playground doesn't have):
//   - realtime-horizon-chart  (needs live scroll / animation tick)
//   - parallel-sets / sankey  (no native mark, complex compose)
//   - spike-map / bubble-map  (geo + size; size→radius gap pending)
//   - hertzsprung-russell     (log-scale + dense scatter — separate PR)
//
// All emitted as compose scenes (silhouette-path + polygon + circle +
// text marks) so we get pixel-precise control over colors, labels, and
// outlier highlighting. Deterministic via a Park-Miller LCG.
//
// Run from repo root:
//   node scripts/gen-composite-and-advanced.mjs

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const BIZ = join(ROOT, "site/play/examples/business");
const ADV = join(ROOT, "site/play/examples/advanced");
mkdirSync(BIZ, { recursive: true });
mkdirSync(ADV, { recursive: true });

function lcg(seed) {
  let s = seed % 0x7fffffff;
  if (s <= 0) s += 0x7ffffffe;
  return () => {
    s = (s * 48271) % 0x7fffffff;
    return s / 0x7fffffff;
  };
}
function writeSpec(dir, name, spec) {
  const json = `${JSON.stringify(spec, null, 2)}\n`;
  writeFileSync(join(dir, name), json);
}

// Compose has a 64-child cap. These helpers let us bundle many same-color
// rects/circles into ONE silhouette-path child, since a `d` string can
// contain any number of `M ... L ... Z` subpaths.
function rectPath(x, y, w, h) {
  return `M ${x.toFixed(2)} ${y.toFixed(2)} L ${(x + w).toFixed(2)} ${y.toFixed(2)} L ${(x + w).toFixed(2)} ${(y + h).toFixed(2)} L ${x.toFixed(2)} ${(y + h).toFixed(2)} Z`;
}
function circlePath(cx, cy, r) {
  // SVG arc trick: M cx-r,cy a r,r 0 1,0 2r,0 a r,r 0 1,0 -2r,0
  return `M ${(cx - r).toFixed(2)} ${cy.toFixed(2)} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0`;
}

// ============================================================================
// COMPOSITE — Monthly revenue bars + 3mo MA trend + outlier highlights
// ============================================================================
// Combines three things on one frame: value (bars), trend (line),
// anomalies (red outlier bars + annotation arrow). The bread-and-butter
// of a monthly business review.
{
  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  // Stylized monthly revenue ($K). Two intentional outliers: a
  // disappointing Apr and an above-trend Aug (launch month).
  const rev = [310, 340, 355, 215, 380, 395, 410, 540, 430, 445, 460, 470];
  // 3-month trailing moving average.
  const ma = rev.map((_, i) => {
    if (i < 2) return null;
    return Math.round((rev[i] + rev[i - 1] + rev[i - 2]) / 3);
  });
  // Z-score per month vs the rolling mean for outlier detection.
  const mean = rev.reduce((s, v) => s + v, 0) / rev.length;
  const sd = Math.sqrt(rev.reduce((s, v) => s + (v - mean) ** 2, 0) / rev.length);
  const isOutlier = rev.map((v) => Math.abs(v - mean) > 1.6 * sd);

  const W = 760;
  const H = 440;
  const padL = 70;
  const padR = 30;
  const padT = 80;
  const padB = 70;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const yMin = 0;
  const yMax = 600;
  const xBand = plotW / rev.length;
  const barW = xBand * 0.62;
  const xCenter = (i) => padL + (i + 0.5) * xBand;
  const yAt = (v) => padT + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  const children = [];
  children.push({
    at: { x: W / 2, y: 32 },
    mark: "text",
    textMark: {
      text: "Monthly revenue + 3-month trend (outliers in red)",
      fontSize: 17,
      fill: "#1a1a1a",
      italic: false,
      anchor: "middle",
    },
  });
  children.push({
    at: { x: W / 2, y: 54 },
    mark: "text",
    textMark: {
      text: "Bars = monthly $K · solid line = 3-month moving average · red bars > 1.6σ from the mean",
      fontSize: 11.5,
      fill: "#666",
      italic: true,
      anchor: "middle",
    },
  });

  // Gridlines + y-tick labels.
  let gridD = "";
  for (let g = 0; g <= 6; g++) {
    const y = padT + plotH - (g / 6) * plotH;
    gridD += ` M ${padL} ${y} L ${padL + plotW} ${y}`;
  }
  children.push({
    at: { x: 0, y: 0 },
    mark: "silhouette-path",
    silhouettePath: { d: gridD.trim(), fill: "none", stroke: "#eef0f4", strokeWidth: 1 },
  });
  for (let g = 0; g <= 6; g++) {
    const v = yMin + (g / 6) * (yMax - yMin);
    const y = padT + plotH - (g / 6) * plotH;
    children.push({
      at: { x: padL - 8, y: y + 4 },
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

  // Bars: group into two paths (normal blue + outlier red) so we stay
  // under the 64-child cap. Each path's `d` concatenates multiple
  // M..L..Z subpaths, one per bar of that color.
  let normalD = "";
  let outlierD = "";
  for (let i = 0; i < rev.length; i++) {
    const cx = xCenter(i);
    const top = yAt(rev[i]);
    const bot = yAt(0);
    const x0 = cx - barW / 2;
    const d = ` ${rectPath(x0, top, barW, bot - top)}`;
    if (isOutlier[i]) outlierD += d;
    else normalD += d;
  }
  children.push({
    at: { x: 0, y: 0 },
    mark: "silhouette-path",
    silhouettePath: { d: normalD.trim(), fill: "#4c78a8", stroke: "#ffffff", strokeWidth: 0.6 },
  });
  if (outlierD.trim()) {
    children.push({
      at: { x: 0, y: 0 },
      mark: "silhouette-path",
      silhouettePath: { d: outlierD.trim(), fill: "#c0392b", stroke: "#ffffff", strokeWidth: 0.6 },
    });
  }
  // Month + value labels — keep separate text marks (12 + 12 = 24).
  for (let i = 0; i < rev.length; i++) {
    const cx = xCenter(i);
    const top = yAt(rev[i]);
    children.push({
      at: { x: cx, y: padT + plotH + 16 },
      mark: "text",
      textMark: {
        text: monthNames[i],
        fontSize: 10.5,
        fill: "#888",
        italic: false,
        anchor: "middle",
      },
    });
    children.push({
      at: { x: cx, y: top - 6 },
      mark: "text",
      textMark: {
        text: String(rev[i]),
        fontSize: 10,
        fill: isOutlier[i] ? "#c0392b" : "#555",
        italic: false,
        anchor: "middle",
      },
    });
  }

  // 3-month moving average polyline.
  const maPts = [];
  for (let i = 0; i < rev.length; i++) {
    if (ma[i] == null) continue;
    maPts.push([Number(xCenter(i).toFixed(2)), Number(yAt(ma[i]).toFixed(2))]);
  }
  children.push({
    at: { x: 0, y: 0 },
    mark: "polyline",
    polyline: { points: maPts, stroke: "#f58518", strokeWidth: 2.5 },
  });
  // MA dots — bundled into one path for child-count discipline.
  let maDotD = "";
  for (let i = 0; i < rev.length; i++) {
    if (ma[i] == null) continue;
    maDotD += ` ${circlePath(xCenter(i), yAt(ma[i]), 3.2)}`;
  }
  if (maDotD.trim()) {
    children.push({
      at: { x: 0, y: 0 },
      mark: "silhouette-path",
      silhouettePath: { d: maDotD.trim(), fill: "#f58518", stroke: "#ffffff", strokeWidth: 1.2 },
    });
  }

  // Annotation arrow + label pointing to the Aug outlier.
  const augIdx = 7;
  const augX = xCenter(augIdx);
  const augY = yAt(rev[augIdx]);
  children.push({
    at: { x: 0, y: 0 },
    mark: "silhouette-path",
    silhouettePath: {
      d: `M ${augX + 50} ${augY - 30} L ${augX + 8} ${augY - 6}`,
      stroke: "#1a1a1a",
      strokeWidth: 1,
      fill: "none",
    },
  });
  children.push({
    at: { x: augX + 55, y: augY - 26 },
    mark: "text",
    textMark: {
      text: "v3.0 launch · +35% MoM",
      fontSize: 11,
      fill: "#1a1a1a",
      italic: true,
      anchor: "start",
    },
  });

  // Legend.
  const legY = H - 18;
  children.push({
    at: { x: 60, y: legY },
    mark: "silhouette-path",
    silhouettePath: { d: "M -8 -4 L 8 -4 L 8 4 L -8 4 Z", fill: "#4c78a8" },
  });
  children.push({
    at: { x: 72, y: legY + 4 },
    mark: "text",
    textMark: { text: "Monthly $K", fontSize: 11, fill: "#1a1a1a", italic: false, anchor: "start" },
  });
  children.push({
    at: { x: 175, y: legY },
    mark: "silhouette-path",
    silhouettePath: { d: "M -8 -4 L 8 -4 L 8 4 L -8 4 Z", fill: "#c0392b" },
  });
  children.push({
    at: { x: 187, y: legY + 4 },
    mark: "text",
    textMark: { text: "Outlier", fontSize: 11, fill: "#1a1a1a", italic: false, anchor: "start" },
  });
  children.push({
    at: { x: 248, y: legY },
    mark: "silhouette-path",
    silhouettePath: { d: "M -12 0 L 12 0", stroke: "#f58518", strokeWidth: 3, fill: "none" },
  });
  children.push({
    at: { x: 264, y: legY + 4 },
    mark: "text",
    textMark: { text: "3-mo MA", fontSize: 11, fill: "#1a1a1a", italic: false, anchor: "start" },
  });

  writeSpec(BIZ, "monthly-composite.spec.json", {
    compose: {
      viewBox: { width: W, height: H },
      title: "Monthly revenue + trend + outliers",
      description:
        "Composite chart: monthly revenue bars in accent blue, 3-month trailing moving average overlay in orange, outlier months (>1.6σ from the mean) called out in red with a launch-month annotation. Hand-laid in compose so each bar's fill can be set per-row.",
      children,
    },
  });
}

// ============================================================================
// ADVANCED #1 — Ridgeline plot — daily response time by endpoint
// ============================================================================
// Six endpoints stacked vertically, each band a smoothed kernel-density-
// like profile of its latency distribution. Common for "compare many
// distributions" reports.
{
  const W = 760;
  const H = 480;
  const padL = 110;
  const padR = 40;
  const padT = 70;
  const padB = 60;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const endpoints = [
    { name: "GET /me", center: 30, spread: 8 },
    { name: "GET /feed", center: 85, spread: 22 },
    { name: "POST /search", center: 145, spread: 38 },
    { name: "GET /report", center: 320, spread: 60 },
    { name: "POST /upload", center: 410, spread: 95 },
    { name: "GET /export", center: 540, spread: 70 },
  ];
  const xMin = 0;
  const xMax = 800;
  const rowH = plotH / endpoints.length;
  // Each ridgeline can overshoot its row by ~80% so adjacent ones overlap a
  // little — that overlap is the ridgeline aesthetic.
  const peakH = rowH * 1.5;
  const N = 80;
  const rand = lcg(13);

  const children = [];
  children.push({
    at: { x: W / 2, y: 30 },
    mark: "text",
    textMark: {
      text: "API latency by endpoint — ridgeline plot (ms)",
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
      text: "Each curve = approximate density of one endpoint's latency. Stacked top-to-bottom by typical speed.",
      fontSize: 11.5,
      fill: "#666",
      italic: true,
      anchor: "middle",
    },
  });

  // x axis ticks.
  for (let v = 0; v <= 800; v += 200) {
    const x = padL + ((v - xMin) / (xMax - xMin)) * plotW;
    children.push({
      at: { x, y: padT + plotH + 16 },
      mark: "text",
      textMark: { text: `${v}ms`, fontSize: 10.5, fill: "#888", italic: false, anchor: "middle" },
    });
  }

  for (let r = 0; r < endpoints.length; r++) {
    const ep = endpoints[r];
    // Approximate a normal density bump centered at ep.center.
    const baselineY = padT + (r + 0.95) * rowH;
    // Compute density at N evenly-spaced x positions.
    const samples = [];
    for (let i = 0; i < N; i++) {
      const x = xMin + (i / (N - 1)) * (xMax - xMin);
      // Two-bump pseudo-density: main gaussian + a smaller secondary bump
      // for endpoints with longer tails (so they don't all look identical).
      const z = (x - ep.center) / ep.spread;
      let d = Math.exp(-(z ** 2) / 2);
      // Secondary bump for slower endpoints (long-tail).
      if (ep.center > 200) {
        const z2 = (x - ep.center * 1.4) / (ep.spread * 0.9);
        d += 0.35 * Math.exp(-(z2 ** 2) / 2);
      }
      // Light deterministic jitter for organic look.
      d *= 0.96 + rand() * 0.08;
      samples.push(d);
    }
    // Normalize so max sample = 1 then scale by peakH.
    const peak = Math.max(...samples);
    const points = samples.map((d, i) => {
      const x = padL + (i / (N - 1)) * plotW;
      const y = baselineY - (d / peak) * peakH;
      return [Number(x.toFixed(2)), Number(y.toFixed(2))];
    });
    // Close to baseline for a filled ridge polygon.
    const closed = [
      [points[0][0], baselineY],
      ...points,
      [points[points.length - 1][0], baselineY],
    ];
    // Pale fill tinted blue → deeper for faster endpoints (gradient by tier).
    const tone = 0.4 + (r / (endpoints.length - 1)) * 0.4;
    const fill = `rgba(76,120,168,${tone.toFixed(2)})`;
    children.push({
      at: { x: 0, y: 0 },
      mark: "polygon",
      polygon: { points: closed, fill, stroke: "#1a3855", strokeWidth: 1 },
    });
    // Row label on the left.
    children.push({
      at: { x: padL - 10, y: baselineY - 4 },
      mark: "text",
      textMark: {
        text: ep.name,
        fontSize: 11.5,
        fill: "#1a1a1a",
        italic: false,
        anchor: "end",
      },
    });
  }

  writeSpec(ADV, "ridgeline.spec.json", {
    compose: {
      viewBox: { width: W, height: H },
      title: "Ridgeline plot — API latency distribution by endpoint",
      description:
        "Six API endpoints stacked vertically, each ridge a smoothed density-like profile of its latency distribution. Bumps for slower endpoints have a secondary right-tail. Hand-laid in compose because Glyph doesn't yet ship a density / KDE mark.",
      children,
    },
  });
}

// ============================================================================
// ADVANCED #2 — Dot plot / strip plot — feature usage by role
// ============================================================================
// 5 product roles × ~12 individual users each; one dot per user per role.
// Dots colored by tenure (new vs veteran). The "strip" form makes it easy
// to spot per-role outliers and ranges.
{
  const W = 720;
  const H = 440;
  const padL = 140;
  const padR = 60;
  const padT = 70;
  const padB = 60;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const roles = [
    { name: "Admin", base: 14, spread: 3 },
    { name: "Developer", base: 28, spread: 6 },
    { name: "Analyst", base: 18, spread: 5 },
    { name: "Operator", base: 8, spread: 4 },
    { name: "Designer", base: 22, spread: 5 },
  ];
  const rand = lcg(29);
  const rowH = plotH / roles.length;

  const children = [];
  children.push({
    at: { x: W / 2, y: 30 },
    mark: "text",
    textMark: {
      text: "Daily feature usage by role — dot plot",
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
      text: "Each dot = one user's average feature touches per day. Dark = veteran (>1 yr), light = newer.",
      fontSize: 11.5,
      fill: "#666",
      italic: true,
      anchor: "middle",
    },
  });

  const xMin = 0;
  const xMax = 50;
  for (let v = 0; v <= xMax; v += 10) {
    const x = padL + ((v - xMin) / (xMax - xMin)) * plotW;
    children.push({
      at: { x, y: padT + plotH + 16 },
      mark: "text",
      textMark: { text: String(v), fontSize: 10.5, fill: "#888", italic: false, anchor: "middle" },
    });
  }
  children.push({
    at: { x: padL + plotW / 2, y: H - 26 },
    mark: "text",
    textMark: {
      text: "Feature touches per day",
      fontSize: 11.5,
      fill: "#1a1a1a",
      italic: false,
      anchor: "middle",
    },
  });

  // Collect dots into two by-color buckets, emitted as a single child
  // each at the bottom of this section.
  const veteranDotsD = [];
  const newDotsD = [];
  // Row separators collapsed into one silhouette-path with all 5 lines.
  let separatorsD = "";

  for (let r = 0; r < roles.length; r++) {
    const role = roles[r];
    const yMid = padT + (r + 0.5) * rowH;
    // Row label.
    children.push({
      at: { x: padL - 12, y: yMid + 4 },
      mark: "text",
      textMark: {
        text: role.name,
        fontSize: 12,
        fill: "#1a1a1a",
        italic: false,
        anchor: "end",
      },
    });
    // Row separator collected into one path below the loop.
    separatorsD += ` M ${padL} ${yMid + rowH / 2} L ${padL + plotW} ${yMid + rowH / 2}`;
    // 12 users per role. Collect dots into the by-color buckets defined
    // below so we can emit one path per color (instead of 60 separate
    // circle children, which would blow the 64-child cap).
    for (let i = 0; i < 12; i++) {
      const u1 = Math.max(1e-9, rand());
      const u2 = rand();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      const v = Math.max(0, Math.min(xMax, role.base + z * role.spread));
      const isVeteran = rand() > 0.55;
      const x = padL + ((v - xMin) / (xMax - xMin)) * plotW;
      const jitterY = (rand() - 0.5) * rowH * 0.45;
      (isVeteran ? veteranDotsD : newDotsD).push(` ${circlePath(x, yMid + jitterY, 5)}`);
    }
  }
  // Row separators (single path containing all 5 rule lines).
  children.push({
    at: { x: 0, y: 0 },
    mark: "silhouette-path",
    silhouettePath: { d: separatorsD.trim(), stroke: "#eef0f4", strokeWidth: 1, fill: "none" },
  });
  children.push({
    at: { x: 0, y: 0 },
    mark: "silhouette-path",
    silhouettePath: {
      d: newDotsD.join("").trim(),
      fill: "#aac1d8",
      stroke: "#1a3855",
      strokeWidth: 0.8,
    },
  });
  children.push({
    at: { x: 0, y: 0 },
    mark: "silhouette-path",
    silhouettePath: {
      d: veteranDotsD.join("").trim(),
      fill: "#2c5683",
      stroke: "#1a3855",
      strokeWidth: 0.8,
    },
  });

  writeSpec(ADV, "dot-plot.spec.json", {
    compose: {
      viewBox: { width: W, height: H },
      title: "Dot plot — feature usage by role",
      description:
        "Strip plot: one dot per user per role. Dark dots are veterans (>1 yr), light dots are newer. Useful for spotting outliers and ranges per category without binning.",
      children,
    },
  });
}

// ============================================================================
// ADVANCED #3 — Diverging bar chart — NPS responses
// ============================================================================
// 9 product features, each scored by Detractors (left, red) vs Promoters
// (right, green). The zero line down the middle makes "net" obvious.
{
  const W = 760;
  const H = 460;
  const padL = 160;
  const padR = 80;
  const padT = 70;
  const padB = 40;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const features = [
    { name: "Onboarding", det: 8, pro: 62 },
    { name: "Performance", det: 14, pro: 70 },
    { name: "Pricing clarity", det: 38, pro: 22 },
    { name: "Documentation", det: 12, pro: 48 },
    { name: "Mobile app", det: 32, pro: 28 },
    { name: "Reliability", det: 6, pro: 75 },
    { name: "Customer support", det: 18, pro: 55 },
    { name: "Search UX", det: 22, pro: 40 },
    { name: "Integrations", det: 26, pro: 50 },
  ];
  const rowH = plotH / features.length;
  const barH = rowH * 0.6;
  const maxAbs = 80;
  const xCenter = padL + plotW / 2;
  const halfW = plotW / 2;

  const children = [];
  children.push({
    at: { x: W / 2, y: 30 },
    mark: "text",
    textMark: {
      text: "NPS responses — diverging bar chart",
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
      text: "Detractors stretch left (red); Promoters stretch right (green); 0 line down the middle.",
      fontSize: 11.5,
      fill: "#666",
      italic: true,
      anchor: "middle",
    },
  });

  // Center 0 line.
  children.push({
    at: { x: 0, y: 0 },
    mark: "silhouette-path",
    silhouettePath: {
      d: `M ${xCenter} ${padT - 6} L ${xCenter} ${padT + plotH + 6}`,
      stroke: "#bcc4cf",
      strokeWidth: 1,
      fill: "none",
    },
  });
  // Tick marks at ±20, ±40, ±60, ±80.
  for (const v of [-80, -60, -40, -20, 20, 40, 60, 80]) {
    const x = xCenter + (v / maxAbs) * halfW;
    children.push({
      at: { x, y: padT - 6 },
      mark: "silhouette-path",
      silhouettePath: {
        d: `M 0 0 L 0 ${plotH + 12}`,
        stroke: "#eef0f4",
        strokeWidth: 1,
        fill: "none",
      },
    });
    children.push({
      at: { x, y: padT - 12 },
      mark: "text",
      textMark: {
        text: `${Math.abs(v)}%`,
        fontSize: 10.5,
        fill: "#888",
        italic: false,
        anchor: "middle",
      },
    });
  }
  // Det / Pro headers.
  children.push({
    at: { x: padL + halfW / 2, y: padT - 30 },
    mark: "text",
    textMark: {
      text: "Detractors",
      fontSize: 12,
      fill: "#c0392b",
      italic: false,
      anchor: "middle",
    },
  });
  children.push({
    at: { x: padL + halfW + halfW / 2, y: padT - 30 },
    mark: "text",
    textMark: {
      text: "Promoters",
      fontSize: 12,
      fill: "#1f7a39",
      italic: false,
      anchor: "middle",
    },
  });

  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    const yMid = padT + (i + 0.5) * rowH;
    const yTop = yMid - barH / 2;
    // Detractor bar (extends LEFT from center).
    const detW = (f.det / maxAbs) * halfW;
    children.push({
      at: { x: 0, y: 0 },
      mark: "silhouette-path",
      silhouettePath: {
        d: `M ${xCenter - detW} ${yTop} L ${xCenter} ${yTop} L ${xCenter} ${yTop + barH} L ${xCenter - detW} ${yTop + barH} Z`,
        fill: "#e8b3aa",
        stroke: "#c0392b",
        strokeWidth: 0.8,
      },
    });
    // Promoter bar (extends RIGHT from center).
    const proW = (f.pro / maxAbs) * halfW;
    children.push({
      at: { x: 0, y: 0 },
      mark: "silhouette-path",
      silhouettePath: {
        d: `M ${xCenter} ${yTop} L ${xCenter + proW} ${yTop} L ${xCenter + proW} ${yTop + barH} L ${xCenter} ${yTop + barH} Z`,
        fill: "#aedab7",
        stroke: "#1f7a39",
        strokeWidth: 0.8,
      },
    });
    // Feature name on the far left.
    children.push({
      at: { x: padL - 12, y: yMid + 4 },
      mark: "text",
      textMark: {
        text: f.name,
        fontSize: 12,
        fill: "#1a1a1a",
        italic: false,
        anchor: "end",
      },
    });
    // Net score on the right.
    const net = f.pro - f.det;
    children.push({
      at: { x: padL + plotW + 12, y: yMid + 4 },
      mark: "text",
      textMark: {
        text: `${net >= 0 ? "+" : ""}${net}`,
        fontSize: 12,
        fill: net >= 0 ? "#1f7a39" : "#c0392b",
        italic: false,
        anchor: "start",
      },
    });
  }
  writeSpec(ADV, "diverging-bar.spec.json", {
    compose: {
      viewBox: { width: W, height: H },
      title: "Diverging bar chart — NPS responses",
      description:
        "9 product features, each showing the share of Detractors (red, extends left) vs Promoters (green, extends right) from the 0 line down the middle. The 'net' column at the right is `promoters - detractors`.",
      children,
    },
  });
}

// ============================================================================
// ADVANCED #4 — Horizontal stacked bar — population by age group
// ============================================================================
// 6 countries × 4 age brackets. Bars normalized to 100% so the eye reads
// the share of each bracket directly, regardless of total population.
{
  const W = 740;
  const H = 420;
  const padL = 140;
  const padR = 40;
  const padT = 70;
  const padB = 70;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const countries = [
    { name: "Nordica", under18: 17, age18_34: 22, age35_64: 41, over65: 20 },
    { name: "Latinia", under18: 27, age18_34: 28, age35_64: 35, over65: 10 },
    { name: "Saharia", under18: 41, age18_34: 30, age35_64: 24, over65: 5 },
    { name: "Maharashtra", under18: 28, age18_34: 28, age35_64: 36, over65: 8 },
    { name: "Pacificana", under18: 19, age18_34: 21, age35_64: 41, over65: 19 },
    { name: "Albion", under18: 18, age18_34: 22, age35_64: 42, over65: 18 },
  ];
  const brackets = [
    { key: "under18", label: "< 18", color: "#4c78a8" },
    { key: "age18_34", label: "18–34", color: "#54a24b" },
    { key: "age35_64", label: "35–64", color: "#f58518" },
    { key: "over65", label: "65+", color: "#c0392b" },
  ];
  const rowH = plotH / countries.length;
  const barH = rowH * 0.62;

  const children = [];
  children.push({
    at: { x: W / 2, y: 30 },
    mark: "text",
    textMark: {
      text: "Population by age bracket — horizontal stacked bar (%)",
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
      text: "Each row sums to 100% — the share of total population in each age bracket.",
      fontSize: 11.5,
      fill: "#666",
      italic: true,
      anchor: "middle",
    },
  });
  // X axis: 0, 25, 50, 75, 100.
  for (const pct of [0, 25, 50, 75, 100]) {
    const x = padL + (pct / 100) * plotW;
    children.push({
      at: { x, y: padT + plotH + 16 },
      mark: "text",
      textMark: { text: `${pct}%`, fontSize: 10.5, fill: "#888", italic: false, anchor: "middle" },
    });
  }
  // Buckets so all rects of the same bracket color are emitted as one path.
  const bucket = {};
  for (const b of brackets) bucket[b.key] = "";
  for (let i = 0; i < countries.length; i++) {
    const c = countries[i];
    const yMid = padT + (i + 0.5) * rowH;
    const yTop = yMid - barH / 2;
    let cursor = padL;
    for (const b of brackets) {
      const w = (c[b.key] / 100) * plotW;
      bucket[b.key] += ` ${rectPath(cursor, yTop, w, barH)}`;
      if (w > 40) {
        children.push({
          at: { x: cursor + w / 2, y: yMid + 4 },
          mark: "text",
          textMark: {
            text: `${c[b.key]}%`,
            fontSize: 10.5,
            fill: "#ffffff",
            italic: false,
            anchor: "middle",
          },
        });
      }
      cursor += w;
    }
    children.push({
      at: { x: padL - 12, y: yMid + 4 },
      mark: "text",
      textMark: {
        text: c.name,
        fontSize: 12,
        fill: "#1a1a1a",
        italic: false,
        anchor: "end",
      },
    });
  }
  // Emit one path per age bracket (4 paths total instead of 24 separate rects).
  for (const b of brackets) {
    children.push({
      at: { x: 0, y: 0 },
      mark: "silhouette-path",
      silhouettePath: {
        d: bucket[b.key].trim(),
        fill: b.color,
        stroke: "#ffffff",
        strokeWidth: 0.6,
      },
    });
  }
  // Legend.
  const legY = H - 18;
  let lx = padL;
  for (const b of brackets) {
    children.push({
      at: { x: lx, y: legY },
      mark: "circle",
      circle: { radius: 5.5, fill: b.color },
    });
    children.push({
      at: { x: lx + 10, y: legY + 4 },
      mark: "text",
      textMark: { text: b.label, fontSize: 11, fill: "#1a1a1a", italic: false, anchor: "start" },
    });
    lx += 110;
  }
  writeSpec(ADV, "horizontal-stacked-bar.spec.json", {
    compose: {
      viewBox: { width: W, height: H },
      title: "Population by age bracket — horizontal stacked bar",
      description:
        "Six countries, each row normalized to 100% so the share of each age bracket reads directly. Bracket totals are labeled when their slice is wide enough.",
      children,
    },
  });
}

// ============================================================================
// ADVANCED #5 — Year calendar heatmap — daily activity
// ============================================================================
// 53 weeks × 7 days = ~365 cells. GitHub-contribution style — one cell
// per day, colored by activity level. Weekly seasonality + a couple of
// dead vacation weeks pop out.
{
  const W = 920;
  const H = 240;
  const padL = 50;
  const padR = 30;
  const padT = 60;
  const padB = 30;
  const cellSize = 14;
  const gap = 2;
  const weeks = 53;
  const rand = lcg(401);
  // Generate ~365 days starting at week 0 (Sun-Sat). Realistic-ish
  // distribution: weekday peaks, weekend quieter, 2 dead weeks (vacation).
  const activity = []; // [week][dayOfWeek] = 0..1
  for (let w = 0; w < weeks; w++) {
    const wk = [];
    for (let d = 0; d < 7; d++) {
      let v = 0.15 + rand() * 0.25;
      if (d > 0 && d < 6) v += 0.4 + rand() * 0.3;
      // Two vacation weeks (8 and 26) — keep activity floor.
      if (w === 8 || w === 26) v *= 0.15;
      // Slight ramp upward through the year (signups grew).
      v += w * 0.005;
      wk.push(Math.min(1, v));
    }
    activity.push(wk);
  }
  // Color stops — light → dark accent.
  const colors = ["#ebedf0", "#c7d6e6", "#9fbad6", "#6b94c3", "#4c78a8", "#1f3e64"];
  const colorFor = (v) => colors[Math.min(colors.length - 1, Math.floor(v * colors.length))];

  const children = [];
  children.push({
    at: { x: W / 2, y: 28 },
    mark: "text",
    textMark: {
      text: "Year calendar heatmap — daily signups",
      fontSize: 17,
      fill: "#1a1a1a",
      italic: false,
      anchor: "middle",
    },
  });
  children.push({
    at: { x: W / 2, y: 50 },
    mark: "text",
    textMark: {
      text: "53 weeks × 7 days. Light = low. Dark = high. Two vacation gaps visible mid-year.",
      fontSize: 11.5,
      fill: "#666",
      italic: true,
      anchor: "middle",
    },
  });
  // Day-of-week labels.
  const dayLabels = ["Mon", "Wed", "Fri"];
  const dayIdx = [1, 3, 5];
  for (let i = 0; i < 3; i++) {
    children.push({
      at: { x: padL - 6, y: padT + (dayIdx[i] + 0.7) * (cellSize + gap) },
      mark: "text",
      textMark: { text: dayLabels[i], fontSize: 9.5, fill: "#888", italic: false, anchor: "end" },
    });
  }
  // Month labels — every ~4 weeks.
  const monthLabels = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  for (let m = 0; m < 12; m++) {
    const wIdx = Math.round((m * (weeks - 1)) / 11);
    children.push({
      at: { x: padL + wIdx * (cellSize + gap), y: padT - 6 },
      mark: "text",
      textMark: {
        text: monthLabels[m],
        fontSize: 10,
        fill: "#888",
        italic: false,
        anchor: "start",
      },
    });
  }
  // Cells: bucket by color tier so we emit just 6 silhouette-paths
  // instead of 371 — the 64-child cap means we can't ship one path per
  // day.
  const tierBuckets = colors.map(() => "");
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const x = padL + w * (cellSize + gap);
      const y = padT + d * (cellSize + gap);
      const tier = Math.min(colors.length - 1, Math.floor(activity[w][d] * colors.length));
      tierBuckets[tier] += ` ${rectPath(x, y, cellSize, cellSize)}`;
    }
  }
  for (let i = 0; i < colors.length; i++) {
    if (!tierBuckets[i].trim()) continue;
    children.push({
      at: { x: 0, y: 0 },
      mark: "silhouette-path",
      silhouettePath: {
        d: tierBuckets[i].trim(),
        fill: colors[i],
        stroke: "#ffffff",
        strokeWidth: 0.5,
      },
    });
  }
  // Legend.
  const legX = padL + plotwidth() - 200;
  function plotwidth() {
    return weeks * (cellSize + gap);
  }
  const legY = padT + 7 * (cellSize + gap) + 14;
  children.push({
    at: { x: padL, y: legY + 4 },
    mark: "text",
    textMark: { text: "Less", fontSize: 10, fill: "#888", italic: false, anchor: "start" },
  });
  // Legend swatches — also collapsed into one path per color.
  for (let i = 0; i < colors.length; i++) {
    const x = padL + 32 + i * (cellSize + 1);
    children.push({
      at: { x: 0, y: 0 },
      mark: "silhouette-path",
      silhouettePath: {
        d: rectPath(x, legY - 4, cellSize, cellSize),
        fill: colors[i],
        stroke: "#ffffff",
        strokeWidth: 0.5,
      },
    });
  }
  children.push({
    at: { x: padL + 32 + colors.length * (cellSize + 1) + 4, y: legY + 4 },
    mark: "text",
    textMark: { text: "More", fontSize: 10, fill: "#888", italic: false, anchor: "start" },
  });
  // suppress unused-var lint
  void legX;
  writeSpec(ADV, "year-calendar.spec.json", {
    compose: {
      viewBox: { width: W, height: H },
      title: "Year calendar heatmap — daily activity",
      description:
        "53-week × 7-day grid. One cell per day, colored by activity level. The two clearly-cooler vertical strips around weeks 8 and 26 are vacation gaps.",
      children,
    },
  });
}

// ============================================================================
// ADVANCED #6 — Parallel coordinates — product feature comparison
// ============================================================================
// 5 products × 6 attributes. Each product is one polyline crossing the
// axes; the eye picks up which axes correlate and which don't.
{
  const W = 780;
  const H = 440;
  const padL = 60;
  const padR = 140;
  const padT = 80;
  const padB = 50;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const axes = [
    { key: "perf", label: "Performance", min: 50, max: 100 },
    { key: "cost", label: "Cost ($M)", min: 0.5, max: 5 },
    { key: "ux", label: "UX", min: 60, max: 100 },
    { key: "sec", label: "Security", min: 60, max: 100 },
    { key: "rel", label: "Reliability", min: 80, max: 100 },
    { key: "rev", label: "Revenue ($M)", min: 0, max: 10 },
  ];
  const products = [
    { name: "Compute", color: "#4c78a8", perf: 92, cost: 3.8, ux: 78, sec: 86, rel: 99, rev: 8.5 },
    { name: "Storage", color: "#f58518", perf: 88, cost: 2.6, ux: 82, sec: 91, rel: 98, rev: 5.0 },
    { name: "IDE Pro", color: "#54a24b", perf: 76, cost: 1.2, ux: 95, sec: 73, rel: 94, rev: 3.4 },
    { name: "Debug", color: "#e45756", perf: 81, cost: 0.9, ux: 88, sec: 70, rel: 90, rev: 1.8 },
    { name: "Workers", color: "#72b7b2", perf: 95, cost: 1.6, ux: 80, sec: 84, rel: 97, rev: 1.1 },
  ];
  const xAt = (i) => padL + (i / (axes.length - 1)) * plotW;
  const yAt = (axis, v) => padT + plotH - ((v - axis.min) / (axis.max - axis.min)) * plotH;

  const children = [];
  children.push({
    at: { x: W / 2, y: 32 },
    mark: "text",
    textMark: {
      text: "Parallel coordinates — product feature comparison",
      fontSize: 17,
      fill: "#1a1a1a",
      italic: false,
      anchor: "middle",
    },
  });
  children.push({
    at: { x: W / 2, y: 54 },
    mark: "text",
    textMark: {
      text: "Six attributes laid out as vertical axes. Each colored line is one product crossing them.",
      fontSize: 11.5,
      fill: "#666",
      italic: true,
      anchor: "middle",
    },
  });
  // Axes.
  for (let i = 0; i < axes.length; i++) {
    const x = xAt(i);
    children.push({
      at: { x: 0, y: 0 },
      mark: "silhouette-path",
      silhouettePath: {
        d: `M ${x} ${padT} L ${x} ${padT + plotH}`,
        stroke: "#bcc4cf",
        strokeWidth: 1,
        fill: "none",
      },
    });
    children.push({
      at: { x, y: padT - 10 },
      mark: "text",
      textMark: {
        text: axes[i].label,
        fontSize: 11.5,
        fill: "#1a1a1a",
        italic: false,
        anchor: "middle",
      },
    });
    // Min/max tick labels.
    children.push({
      at: { x: x - 6, y: padT + 4 },
      mark: "text",
      textMark: {
        text: String(axes[i].max),
        fontSize: 9.5,
        fill: "#888",
        italic: false,
        anchor: "end",
      },
    });
    children.push({
      at: { x: x - 6, y: padT + plotH + 4 },
      mark: "text",
      textMark: {
        text: String(axes[i].min),
        fontSize: 9.5,
        fill: "#888",
        italic: false,
        anchor: "end",
      },
    });
  }
  // Polylines per product.
  for (const p of products) {
    const pts = axes.map((axis, i) => [
      Number(xAt(i).toFixed(2)),
      Number(yAt(axis, p[axis.key]).toFixed(2)),
    ]);
    children.push({
      at: { x: 0, y: 0 },
      mark: "polyline",
      polyline: { points: pts, stroke: p.color, strokeWidth: 2 },
    });
    // Label at the right edge using the last axis's value.
    const lastY = pts[pts.length - 1][1];
    children.push({
      at: { x: padL + plotW + 10, y: lastY + 4 },
      mark: "text",
      textMark: {
        text: p.name,
        fontSize: 12,
        fill: p.color,
        italic: false,
        anchor: "start",
      },
    });
  }
  writeSpec(ADV, "parallel-coordinates.spec.json", {
    compose: {
      viewBox: { width: W, height: H },
      title: "Parallel coordinates — multi-attribute product comparison",
      description:
        "Six attribute axes laid out vertically. Each colored polyline is one product crossing all six. Correlated attributes show parallel lines; tradeoffs show crossing lines.",
      children,
    },
  });
}

// ============================================================================
// ADVANCED #7 — Difference chart — actual vs target, shaded gap
// ============================================================================
// Two lines (actual vs target) with the area between them filled —
// positive deltas tinted green, negative deltas tinted red.
{
  const W = 760;
  const H = 380;
  const padL = 70;
  const padR = 60;
  const padT = 70;
  const padB = 60;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const target = [320, 340, 360, 380, 400, 420, 440, 460, 480, 500, 520, 540];
  const actual = [310, 360, 340, 375, 430, 415, 470, 540, 510, 490, 530, 580];
  const yMin = 280;
  const yMax = 600;
  const xAt = (i) => padL + (i / (months.length - 1)) * plotW;
  const yAt = (v) => padT + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  const children = [];
  children.push({
    at: { x: W / 2, y: 30 },
    mark: "text",
    textMark: {
      text: "Actual vs target revenue — difference chart ($K)",
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
      text: "Green band = beat target. Red band = missed. Below: actual (solid), target (dashed).",
      fontSize: 11.5,
      fill: "#666",
      italic: true,
      anchor: "middle",
    },
  });
  // Grid + y labels.
  let gridD = "";
  for (let g = 0; g <= 4; g++) {
    const y = padT + plotH - (g / 4) * plotH;
    gridD += ` M ${padL} ${y} L ${padL + plotW} ${y}`;
  }
  children.push({
    at: { x: 0, y: 0 },
    mark: "silhouette-path",
    silhouettePath: { d: gridD.trim(), fill: "none", stroke: "#eef0f4", strokeWidth: 1 },
  });
  for (let g = 0; g <= 4; g++) {
    const v = yMin + (g / 4) * (yMax - yMin);
    const y = padT + plotH - (g / 4) * plotH;
    children.push({
      at: { x: padL - 8, y: y + 4 },
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
  // Month labels every other month.
  for (let i = 0; i < months.length; i += 2) {
    children.push({
      at: { x: xAt(i), y: padT + plotH + 16 },
      mark: "text",
      textMark: { text: months[i], fontSize: 10.5, fill: "#888", italic: false, anchor: "middle" },
    });
  }
  // Build the diff band as alternating green/red polygons. The simplest
  // way: emit one polygon between (actual, target) per month *segment*,
  // colored by whether actual >= target at both ends.
  for (let i = 0; i < months.length - 1; i++) {
    const x1 = xAt(i);
    const x2 = xAt(i + 1);
    const ya1 = yAt(actual[i]);
    const ya2 = yAt(actual[i + 1]);
    const yt1 = yAt(target[i]);
    const yt2 = yAt(target[i + 1]);
    const beats = actual[i] >= target[i] && actual[i + 1] >= target[i + 1];
    const fills = beats ? "#cce7d0" : "#f4cfc7";
    children.push({
      at: { x: 0, y: 0 },
      mark: "polygon",
      polygon: {
        points: [
          [x1, ya1],
          [x2, ya2],
          [x2, yt2],
          [x1, yt1],
        ],
        fill: fills,
        stroke: "none",
        strokeWidth: 0,
      },
    });
  }
  // Target line (dashed).
  const targetPts = target.map((v, i) => [xAt(i), yAt(v)]);
  let targetD = `M ${targetPts[0][0]} ${targetPts[0][1]}`;
  for (let i = 1; i < targetPts.length; i++) targetD += ` L ${targetPts[i][0]} ${targetPts[i][1]}`;
  children.push({
    at: { x: 0, y: 0 },
    mark: "silhouette-path",
    silhouettePath: {
      d: targetD,
      stroke: "#888",
      strokeWidth: 2,
      strokeDasharray: "6,4",
      fill: "none",
    },
  });
  // Actual line (solid).
  const actualPts = actual.map((v, i) => [xAt(i), yAt(v)]);
  children.push({
    at: { x: 0, y: 0 },
    mark: "polyline",
    polyline: { points: actualPts, stroke: "#1a3855", strokeWidth: 2.5 },
  });
  // Dots on actual.
  for (let i = 0; i < actual.length; i++) {
    children.push({
      at: { x: xAt(i), y: yAt(actual[i]) },
      mark: "circle",
      circle: { radius: 3, fill: "#1a3855" },
    });
  }
  // Legend.
  const legY = H - 16;
  children.push({
    at: { x: 60, y: legY },
    mark: "silhouette-path",
    silhouettePath: { d: "M -8 -4 L 8 -4 L 8 4 L -8 4 Z", fill: "#cce7d0" },
  });
  children.push({
    at: { x: 74, y: legY + 4 },
    mark: "text",
    textMark: {
      text: "Beat target",
      fontSize: 11,
      fill: "#1a1a1a",
      italic: false,
      anchor: "start",
    },
  });
  children.push({
    at: { x: 175, y: legY },
    mark: "silhouette-path",
    silhouettePath: { d: "M -8 -4 L 8 -4 L 8 4 L -8 4 Z", fill: "#f4cfc7" },
  });
  children.push({
    at: { x: 189, y: legY + 4 },
    mark: "text",
    textMark: {
      text: "Missed target",
      fontSize: 11,
      fill: "#1a1a1a",
      italic: false,
      anchor: "start",
    },
  });
  children.push({
    at: { x: 295, y: legY },
    mark: "silhouette-path",
    silhouettePath: { d: "M -12 0 L 12 0", stroke: "#1a3855", strokeWidth: 2.5, fill: "none" },
  });
  children.push({
    at: { x: 311, y: legY + 4 },
    mark: "text",
    textMark: { text: "Actual", fontSize: 11, fill: "#1a1a1a", italic: false, anchor: "start" },
  });
  children.push({
    at: { x: 365, y: legY },
    mark: "silhouette-path",
    silhouettePath: {
      d: "M -12 0 L 12 0",
      stroke: "#888",
      strokeWidth: 2,
      strokeDasharray: "5,3",
      fill: "none",
    },
  });
  children.push({
    at: { x: 381, y: legY + 4 },
    mark: "text",
    textMark: { text: "Target", fontSize: 11, fill: "#1a1a1a", italic: false, anchor: "start" },
  });
  writeSpec(ADV, "difference-chart.spec.json", {
    compose: {
      viewBox: { width: W, height: H },
      title: "Actual vs target — difference chart",
      description:
        "Two-line plot with the gap between actual and target shaded green (beats) or red (misses) per month-segment. Beats and misses are read at a glance from the band color.",
      children,
    },
  });
}

// ---------------------------------------------------------------------------
// Smoke render.
// ---------------------------------------------------------------------------
const bundleUrl = pathToFileURL(join(ROOT, "site/play/glyph-bundle.js")).href;
const { compileCompose, parseComposeSpec, renderSvg } = await import(bundleUrl);

const want = [
  ["business", "monthly-composite"],
  ["advanced", "ridgeline"],
  ["advanced", "dot-plot"],
  ["advanced", "diverging-bar"],
  ["advanced", "horizontal-stacked-bar"],
  ["advanced", "year-calendar"],
  ["advanced", "parallel-coordinates"],
  ["advanced", "difference-chart"],
];
console.log("\nSmoke render:");
for (const [bucket, stem] of want) {
  const dir = bucket === "business" ? BIZ : ADV;
  const spec = JSON.parse(readFileSync(join(dir, `${stem}.spec.json`), "utf8"));
  const svg = renderSvg(compileCompose(parseComposeSpec(spec)));
  console.log(`  ${bucket.padEnd(9)} · ${stem.padEnd(24)} → ${svg.length} bytes`);
}
