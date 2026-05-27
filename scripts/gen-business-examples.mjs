#!/usr/bin/env node
// One-shot generator for the six "advanced" business playground examples.
// Writes CSV + spec pairs into site/play/examples/business/ and prints a
// smoke-render byte count for each so a regression jumps out immediately.
//
// Run from repo root:
//   node scripts/gen-business-examples.mjs
//
// Idempotent. Determinism comes from a Park-Miller LCG (no Math.random) so
// CI gets byte-identical output on every checkout.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "site/play/examples/business");
mkdirSync(OUT, { recursive: true });

// ---- deterministic RNG ----------------------------------------------------
function lcg(seed) {
  let s = seed % 0x7fffffff;
  if (s <= 0) s += 0x7ffffffe;
  return () => {
    s = (s * 48271) % 0x7fffffff;
    return s / 0x7fffffff;
  };
}

// ---- helpers --------------------------------------------------------------
function writeCsv(name, rows) {
  const csv = `${rows.map((r) => r.join(",")).join("\n")}\n`;
  writeFileSync(join(OUT, name), csv);
  return csv.length;
}
function writeSpec(name, spec) {
  const json = `${JSON.stringify(spec, null, 2)}\n`;
  writeFileSync(join(OUT, name), json);
  return json.length;
}

// ===========================================================================
// 1. Cohort retention heatmap
// ===========================================================================
// Realistic SaaS shape: ~82% week-1 retention decaying ~6% per week, with
// older cohorts averaging slightly lower (the "free trial era was rough"
// pattern most B2B charts show).
{
  const cohorts = [
    "2025-01",
    "2025-02",
    "2025-03",
    "2025-04",
    "2025-05",
    "2025-06",
    "2025-07",
    "2025-08",
  ];
  const weeks = [1, 2, 3, 4, 5, 6, 7, 8];
  const rand = lcg(11);
  const rows = [["cohort", "week", "retention"]];
  for (let c = 0; c < cohorts.length; c++) {
    for (const w of weeks) {
      // Base curve: 82 → 28 across 8 weeks, ±5 jitter, +0..6 boost for newer cohorts.
      const decay = 82 - (82 - 28) * ((w - 1) / 7);
      const cohortBoost = c * 0.7; // newer cohort = bigger c index = better retention
      const jitter = (rand() - 0.5) * 6;
      const v = Math.max(8, Math.min(95, decay + cohortBoost + jitter));
      rows.push([cohorts[c], w, Math.round(v * 10) / 10]);
    }
  }
  writeCsv("cohort-retention.csv", rows);
  writeSpec("cohort-retention.spec.json", {
    version: "glyph/0.1",
    title: "Cohort retention — weekly % retained",
    width: 640,
    height: 320,
    layers: [
      {
        mark: "heatmap",
        encoding: {
          x: { field: "week", type: "ordinal" },
          y: { field: "cohort", type: "ordinal" },
          color: { field: "retention", type: "quantitative" },
        },
      },
    ],
  });
}

// ===========================================================================
// 2. Revenue treemap (self-contained, data.hierarchy)
// ===========================================================================
// $24.5M Q3 revenue, broken into 3 product lines and ~3 products each. Sized
// so the visual hierarchy reads at a glance (Cloud dominates, Pro mid, Edge
// thin).
{
  const hierarchy = {
    name: "Q3 revenue",
    children: [
      {
        name: "Cloud",
        children: [
          { name: "Compute", value: 6.8 },
          { name: "Storage", value: 4.2 },
          { name: "Network", value: 2.1 },
        ],
      },
      {
        name: "Pro Tools",
        children: [
          { name: "IDE Pro", value: 3.4 },
          { name: "Debug Cloud", value: 1.8 },
          { name: "Team Seats", value: 2.6 },
        ],
      },
      {
        name: "Edge",
        children: [
          { name: "CDN", value: 1.9 },
          { name: "Workers", value: 1.1 },
          { name: "DDoS", value: 0.6 },
        ],
      },
    ],
  };
  writeSpec("revenue-treemap.spec.json", {
    version: "glyph/0.1",
    title: "Q3 revenue by product line ($M)",
    width: 720,
    height: 440,
    data: { hierarchy },
    layers: [{ mark: "treemap", encoding: {} }],
  });
}

// ===========================================================================
// 3. CAC vs LTV scatter — channel efficiency
// ===========================================================================
// Each channel has a deterministic placement; size = monthly_signups.
// Spreads channels diagonally so the cheap-and-loyal ones land top-left.
{
  const data = [
    { channel: "Organic search", cac: 18, ltv: 920, monthly_signups: 4200 },
    { channel: "Content", cac: 42, ltv: 1100, monthly_signups: 1800 },
    { channel: "Referral", cac: 26, ltv: 1450, monthly_signups: 980 },
    { channel: "Webinar", cac: 88, ltv: 2100, monthly_signups: 540 },
    { channel: "Paid social", cac: 145, ltv: 680, monthly_signups: 2400 },
    { channel: "Paid search", cac: 210, ltv: 1180, monthly_signups: 1650 },
    { channel: "Sales-led", cac: 380, ltv: 4800, monthly_signups: 220 },
    { channel: "Partner", cac: 65, ltv: 1850, monthly_signups: 720 },
  ];
  const rows = [["channel", "cac", "ltv", "monthly_signups"]];
  for (const d of data) rows.push([d.channel, d.cac, d.ltv, d.monthly_signups]);
  writeCsv("cac-vs-ltv.csv", rows);
  writeSpec("cac-vs-ltv.spec.json", {
    version: "glyph/0.1",
    title: "CAC vs LTV by acquisition channel",
    width: 640,
    height: 420,
    layers: [
      {
        mark: "point",
        encoding: {
          x: {
            field: "cac",
            type: "quantitative",
            scale: { domain: [0, 420] },
          },
          y: {
            field: "ltv",
            type: "quantitative",
            scale: { domain: [0, 5200] },
          },
          color: { field: "channel", type: "nominal" },
          size: { field: "monthly_signups", type: "quantitative" },
        },
      },
    ],
  });
}

// ===========================================================================
// 4. API latency boxplot — distribution by endpoint
// ===========================================================================
// 5 endpoints × 40 deterministic samples. Distribution shape encodes the
// "story": GET /me is fast and tight, POST /upload has a long right tail,
// /search has higher median + a couple of outliers.
{
  const endpoints = [
    { name: "GET /me", center: 32, spread: 6, outliers: 0 },
    { name: "GET /feed", center: 84, spread: 22, outliers: 1 },
    { name: "POST /search", center: 145, spread: 38, outliers: 2 },
    { name: "POST /upload", center: 210, spread: 90, outliers: 3 },
    { name: "GET /report", center: 320, spread: 60, outliers: 1 },
  ];
  const rand = lcg(7);
  const rows = [["endpoint", "latency_ms"]];
  for (const ep of endpoints) {
    // 40 normal-ish samples + a handful of outliers.
    for (let i = 0; i < 40; i++) {
      // Box-Muller for a more box-plot-shaped distribution.
      const u1 = Math.max(1e-9, rand());
      const u2 = rand();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      const v = Math.max(2, ep.center + z * ep.spread);
      rows.push([ep.name, Math.round(v)]);
    }
    for (let i = 0; i < ep.outliers; i++) {
      const v = ep.center + ep.spread * (4 + rand() * 3);
      rows.push([ep.name, Math.round(v)]);
    }
  }
  writeCsv("api-latency.csv", rows);
  writeSpec("api-latency.spec.json", {
    version: "glyph/0.1",
    title: "API latency by endpoint (ms) — boxplot",
    width: 640,
    height: 400,
    layers: [
      {
        mark: "boxplot",
        encoding: {
          x: { field: "endpoint", type: "ordinal" },
          y: { field: "latency_ms", type: "quantitative" },
        },
      },
    ],
  });
}

// ===========================================================================
// 5. Sales calendar heatmap — day-of-week × hour-of-day
// ===========================================================================
// Realistic e-commerce pattern: weekday lunchtime + evening peaks, weekends
// shifted later, dead overnight 1–6am.
{
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const rand = lcg(91);
  const rows = [["day", "hour", "orders"]];
  for (const day of days) {
    const isWeekend = day === "Sat" || day === "Sun";
    for (let h = 0; h < 24; h++) {
      // Two-bump curve per day. Weekend bump shifts ~2h later, lower amplitude.
      const noon = isWeekend ? 14 : 12;
      const eve = isWeekend ? 21 : 19;
      const noonPeak = Math.exp(-((h - noon) ** 2) / 8) * (isWeekend ? 38 : 62);
      const evePeak = Math.exp(-((h - eve) ** 2) / 6) * (isWeekend ? 52 : 44);
      const baseline = h < 6 || h > 23 ? 1 : 6;
      const jitter = rand() * 4;
      const v = Math.max(0, Math.round(noonPeak + evePeak + baseline + jitter));
      rows.push([day, h, v]);
    }
  }
  writeCsv("sales-calendar.csv", rows);
  writeSpec("sales-calendar.spec.json", {
    version: "glyph/0.1",
    title: "Orders by day of week × hour of day",
    width: 700,
    height: 340,
    layers: [
      {
        mark: "heatmap",
        encoding: {
          x: { field: "hour", type: "ordinal" },
          y: { field: "day", type: "ordinal" },
          color: { field: "orders", type: "quantitative" },
        },
      },
    ],
  });
}

// ===========================================================================
// 6. Marketing-spend sunburst — annual budget breakdown
// ===========================================================================
// $3.9M annual marketing budget. Three top-level categories, each broken
// into four channels. Hand-laid sunburst (compose `silhouette-path` arcs
// + `text` labels) so every slice has its name + $-amount inline —
// the bare `mark: "sunburst"` doesn't yet ship labels.
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
  const innerR0 = 70; // center hole
  const innerR1 = 145; // boundary between rings
  const outerR1 = 215; // outer edge
  const totalValue = data.reduce((s, d) => s + d.children.reduce((s2, c) => s2 + c.value, 0), 0);

  // SVG path string for an arc segment between two radii and two angles.
  // Angles in radians, with -π/2 = top of the circle (12 o'clock).
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
      text: "Marketing spend — annual budget",
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
      text: "3 categories · 12 channels · sized by % of total spend",
      fontSize: 12,
      fill: "#666",
      italic: true,
      anchor: "middle",
    },
  });

  // Walk categories left to right around the ring.
  let theta = -Math.PI / 2;
  for (const cat of data) {
    const catTotal = cat.children.reduce((s, c) => s + c.value, 0);
    const catSpan = (catTotal / totalValue) * Math.PI * 2;
    const catEnd = theta + catSpan;

    // Inner ring slice for the category.
    children.push({
      at: { x: 0, y: 0 },
      mark: "silhouette-path",
      silhouettePath: {
        d: arcPath(innerR0, innerR1, theta, catEnd),
        fill: cat.fill,
        stroke: "#ffffff",
        strokeWidth: 2,
      },
    });

    // Outer ring slices for each child.
    let childTheta = theta;
    for (const ch of cat.children) {
      const span = (ch.value / catTotal) * catSpan;
      const childEnd = childTheta + span;
      children.push({
        at: { x: 0, y: 0 },
        mark: "silhouette-path",
        silhouettePath: {
          d: arcPath(innerR1, outerR1, childTheta, childEnd),
          fill: cat.tint,
          stroke: "#ffffff",
          strokeWidth: 1.5,
        },
      });

      // Outer-ring label: name + $-value at the slice midpoint, just
      // outside the outer radius so it doesn't fight with the fill.
      const midA = (childTheta + childEnd) / 2;
      const lx = cx + (outerR1 + 16) * Math.cos(midA);
      const ly = cy + (outerR1 + 16) * Math.sin(midA);
      const dx = Math.cos(midA);
      const anchor = Math.abs(dx) < 0.25 ? "middle" : dx > 0 ? "start" : "end";
      children.push({
        at: { x: lx, y: ly + 4 },
        mark: "text",
        textMark: {
          text: `${ch.label} · $${ch.value}K`,
          fontSize: 11,
          fill: "#1a1a1a",
          italic: false,
          anchor,
        },
      });
      childTheta = childEnd;
    }

    // Inner-ring label: category name centered along its midpoint.
    const midA = (theta + catEnd) / 2;
    const r = (innerR0 + innerR1) / 2;
    const lx = cx + r * Math.cos(midA);
    const ly = cy + r * Math.sin(midA);
    children.push({
      at: { x: lx, y: ly + 5 },
      mark: "text",
      textMark: {
        text: cat.label,
        fontSize: 13,
        fill: "#ffffff",
        italic: false,
        anchor: "middle",
      },
    });

    theta = catEnd;
  }

  // Center label — total budget.
  children.push({
    at: { x: cx, y: cy - 6 },
    mark: "text",
    textMark: {
      text: `$${(totalValue / 1000).toFixed(1)}M`,
      fontSize: 22,
      fill: "#1a1a1a",
      italic: false,
      anchor: "middle",
    },
  });
  children.push({
    at: { x: cx, y: cy + 14 },
    mark: "text",
    textMark: {
      text: "annual spend",
      fontSize: 11,
      fill: "#666",
      italic: true,
      anchor: "middle",
    },
  });

  writeSpec("marketing-sunburst.spec.json", {
    compose: {
      viewBox: { width: 640, height: 600 },
      title: "Marketing spend — annual budget",
      description:
        'Two-ring sunburst with full labels: inner ring shows the three categories (Performance, Brand, Lifecycle) sized by share of total spend; outer ring breaks each into channels, each labeled inline with name + $-value. Hand-laid in compose because the bare `mark: "sunburst"` doesn\'t yet ship labels.',
      children,
    },
  });
}

// ===========================================================================
// 7. Donut chart (polar bar) — revenue mix by department
// ===========================================================================
// Three segments. Bar + polar with innerRadius:0.5 = donut, the canonical
// "share of pie" board-meeting chart.
{
  const data = [
    { department: "Engineering", share: 45 },
    { department: "Sales", share: 30 },
    { department: "Marketing", share: 25 },
  ];
  const rows = [["department", "share"]];
  for (const d of data) rows.push([d.department, d.share]);
  writeCsv("revenue-donut.csv", rows);
  writeSpec("revenue-donut.spec.json", {
    version: "glyph/0.1",
    title: "Revenue share by department",
    width: 560,
    height: 420,
    coordinates: { type: "polar", innerRadius: 0.5 },
    layers: [
      {
        mark: "bar",
        encoding: {
          x: { field: "department", type: "ordinal" },
          y: { field: "share", type: "quantitative" },
          color: { field: "department", type: "nominal" },
        },
      },
    ],
  });
}

// ===========================================================================
// 8. Radar chart — product KPI scorecard
// ===========================================================================
// Six KPI axes scored 0-100, drawn as a proper radar: concentric grid
// rings, spokes, axis labels, ring-value labels, filled polygon + dots.
// Hand-laid in compose so we get the labels the bare-bones polar+line
// mark doesn't ship. Self-contained — no CSV.
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
  // Spokes start at -π/2 (top) and go clockwise.
  const angleAt = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / N;

  // Grid: 4 concentric circles at 25/50/75/100 + 6 spokes — single path.
  const ringRadii = [0.25, 0.5, 0.75, 1].map((f) => f * maxR);
  let gridD = "";
  for (const r of ringRadii) {
    // SVG circle via two arcs.
    gridD += ` M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0`;
  }
  for (let i = 0; i < N; i++) {
    const a = angleAt(i);
    gridD += ` M ${cx} ${cy} L ${(cx + maxR * Math.cos(a)).toFixed(2)} ${(cy + maxR * Math.sin(a)).toFixed(2)}`;
  }

  // Polygon vertices, ordered around the ring.
  const polyPts = metrics.map((m, i) => {
    const a = angleAt(i);
    const r = (m.score / 100) * maxR;
    return [Number((cx + r * Math.cos(a)).toFixed(2)), Number((cy + r * Math.sin(a)).toFixed(2))];
  });

  const children = [];
  // Title + subtitle.
  children.push({
    at: { x: cx, y: 36 },
    mark: "text",
    textMark: {
      text: "Product KPI scorecard — Q3",
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
      text: "Each axis 0–100. Higher = better. Last 90 days.",
      fontSize: 12,
      fill: "#666",
      italic: true,
      anchor: "middle",
    },
  });

  // Grid + spokes.
  children.push({
    at: { x: 0, y: 0 },
    mark: "silhouette-path",
    silhouettePath: {
      d: gridD.trim(),
      fill: "none",
      stroke: "#dde3ec",
      strokeWidth: 1,
    },
  });

  // Ring value labels along the top spoke (so they don't collide with data).
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

  // Data polygon — fill + stroke.
  children.push({
    at: { x: 0, y: 0 },
    mark: "polygon",
    polygon: {
      points: polyPts,
      fill: "rgba(76,120,168,0.22)",
      stroke: "#4c78a8",
      strokeWidth: 2,
    },
  });

  // Data dots + value labels next to each.
  for (let i = 0; i < N; i++) {
    const [px, py] = polyPts[i];
    const a = angleAt(i);
    children.push({
      at: { x: px, y: py },
      mark: "circle",
      circle: { radius: 4.5, fill: "#4c78a8", stroke: "#1a1a1a", strokeWidth: 1 },
    });
    // Value label, nudged outward along the spoke direction.
    const vx = px + 12 * Math.cos(a);
    const vy = py + 12 * Math.sin(a);
    children.push({
      at: { x: vx, y: vy + 4 },
      mark: "text",
      textMark: {
        text: String(metrics[i].score),
        fontSize: 11,
        fill: "#1a1a1a",
        italic: false,
        anchor: "middle",
      },
    });
  }

  // Axis labels outside the outermost ring.
  for (let i = 0; i < N; i++) {
    const a = angleAt(i);
    const lx = cx + (maxR + 28) * Math.cos(a);
    const ly = cy + (maxR + 28) * Math.sin(a);
    // Pick anchor by horizontal position so labels don't slam into the chart.
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
      title: "Product KPI scorecard — Q3",
      description:
        "Six KPI axes (0–100) drawn as a labeled radar: concentric grid rings, spokes, axis labels, ring-value tick marks, filled polygon + dots. Hand-laid in compose so it ships with the labels the bare polar-line mark doesn't yet emit.",
      children,
    },
  });
}

// ===========================================================================
// 9. Engineering org graph — hand-laid hierarchy with labels
// ===========================================================================
// 10-person engineering org. Hand-positioned in a clean 4-tier layout
// instead of running a force simulation, so labels are reliably
// readable and cross-team edges are obvious.
//
// The seeded force layout we shipped first looked fine in tests but in
// practice converged into a single blob with no labels. For a 10-node
// real-world chart, hand placement reads better — and the spec is
// shorter, too.
{
  const GROUPS = {
    exec: { fill: "#4c78a8", label: "Executive" },
    platform: { fill: "#f58518", label: "Platform" },
    product: { fill: "#54a24b", label: "Product" },
  };
  const nodes = [
    { id: "CEO", group: "exec", x: 360, y: 80 },
    { id: "VP Eng", group: "exec", x: 360, y: 170 },
    { id: "Mgr Platform", group: "platform", x: 200, y: 270 },
    { id: "Mgr Product", group: "product", x: 520, y: 270 },
    { id: "Eng A", group: "platform", x: 90, y: 380 },
    { id: "Eng B", group: "platform", x: 200, y: 380 },
    { id: "Eng C", group: "platform", x: 310, y: 380 },
    { id: "Eng D", group: "product", x: 420, y: 380 },
    { id: "Eng E", group: "product", x: 530, y: 380 },
    { id: "Eng F", group: "product", x: 640, y: 380 },
  ];
  const edgesSolid = [
    ["CEO", "VP Eng"],
    ["VP Eng", "Mgr Platform"],
    ["VP Eng", "Mgr Product"],
    ["Mgr Platform", "Eng A"],
    ["Mgr Platform", "Eng B"],
    ["Mgr Platform", "Eng C"],
    ["Mgr Product", "Eng D"],
    ["Mgr Product", "Eng E"],
    ["Mgr Product", "Eng F"],
  ];
  // Cross-team collaboration — drawn dashed so the reporting tree stays clean.
  const edgesDashed = [
    ["Eng A", "Eng D"],
    ["Eng B", "Eng E"],
  ];
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const children = [];
  children.push({
    at: { x: 360, y: 30 },
    mark: "text",
    textMark: {
      text: "Engineering org — reporting + cross-team links",
      fontSize: 17,
      fill: "#1a1a1a",
      italic: false,
      anchor: "middle",
    },
  });

  // Solid reporting edges — one silhouette-path per polyline segment.
  let solidD = "";
  for (const [a, b] of edgesSolid) {
    const na = byId.get(a);
    const nb = byId.get(b);
    solidD += ` M ${na.x} ${na.y} L ${nb.x} ${nb.y}`;
  }
  children.push({
    at: { x: 0, y: 0 },
    mark: "silhouette-path",
    silhouettePath: {
      d: solidD.trim(),
      fill: "none",
      stroke: "#99a4b3",
      strokeWidth: 1.5,
    },
  });
  let dashedD = "";
  for (const [a, b] of edgesDashed) {
    const na = byId.get(a);
    const nb = byId.get(b);
    dashedD += ` M ${na.x} ${na.y} L ${nb.x} ${nb.y}`;
  }
  children.push({
    at: { x: 0, y: 0 },
    mark: "silhouette-path",
    silhouettePath: {
      d: dashedD.trim(),
      fill: "none",
      stroke: "#aab2bd",
      strokeWidth: 1.2,
      strokeDasharray: "5,4",
    },
  });

  // Nodes — circle + label per node. Labels above tier-1/2 nodes,
  // below tier-3/4 nodes, so they don't collide with the edges.
  for (const n of nodes) {
    const isManager = /Mgr|VP|CEO/.test(n.id);
    const radius = isManager ? 22 : 17;
    children.push({
      at: { x: n.x, y: n.y },
      mark: "circle",
      circle: {
        radius,
        fill: GROUPS[n.group].fill,
        stroke: "#1a1a1a",
        strokeWidth: 1.5,
      },
    });
    // Position label: above for top tiers, below for engineers.
    const labelY = n.y < 250 ? n.y - radius - 8 : n.y + radius + 14;
    children.push({
      at: { x: n.x, y: labelY },
      mark: "text",
      textMark: {
        text: n.id,
        fontSize: 11.5,
        fill: "#1a1a1a",
        italic: false,
        anchor: "middle",
      },
    });
  }

  // Legend along the bottom: 3 swatches + group names.
  const legendY = 460;
  const legendStart = 200;
  const gap = 130;
  const groupOrder = ["exec", "platform", "product"];
  for (let i = 0; i < groupOrder.length; i++) {
    const g = groupOrder[i];
    const lx = legendStart + i * gap;
    children.push({
      at: { x: lx, y: legendY },
      mark: "circle",
      circle: { radius: 7, fill: GROUPS[g].fill, stroke: "#1a1a1a", strokeWidth: 1 },
    });
    children.push({
      at: { x: lx + 14, y: legendY + 4 },
      mark: "text",
      textMark: {
        text: GROUPS[g].label,
        fontSize: 12,
        fill: "#1a1a1a",
        italic: false,
        anchor: "start",
      },
    });
  }
  // Dashed-line legend entry.
  children.push({
    at: { x: 0, y: 0 },
    mark: "silhouette-path",
    silhouettePath: {
      d: `M ${legendStart + 3 * gap} ${legendY} L ${legendStart + 3 * gap + 28} ${legendY}`,
      fill: "none",
      stroke: "#aab2bd",
      strokeWidth: 1.2,
      strokeDasharray: "5,4",
    },
  });
  children.push({
    at: { x: legendStart + 3 * gap + 34, y: legendY + 4 },
    mark: "text",
    textMark: {
      text: "cross-team",
      fontSize: 12,
      fill: "#1a1a1a",
      italic: false,
      anchor: "start",
    },
  });

  writeSpec("org-graph.spec.json", {
    compose: {
      viewBox: { width: 720, height: 500 },
      title: "Engineering org — reporting + cross-team links",
      description:
        "10-node hierarchy with three groups (Executive, Platform, Product) plus two dashed cross-team collaboration edges. Hand-laid in compose: a labeled, deterministic alternative to running the seeded force layout, which produced a tight blob without labels.",
      children,
    },
  });
}

// ===========================================================================
// 10. Contour density (self-contained, data.grid)
// ===========================================================================
// 2D Gaussian bump centered at (0.6, 0.4) plus a smaller bump at (0.2, 0.8).
// Marching-squares isolines at five thresholds — the topographic / density
// pattern you'd use for "where do customers cluster on the map?".
{
  const COLS = 40;
  const ROWS = 28;
  const values = new Array(ROWS * COLS);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = c / (COLS - 1);
      const y = r / (ROWS - 1);
      // Two Gaussian bumps.
      const g1 = Math.exp(-(((x - 0.6) ** 2 + (y - 0.4) ** 2) / 0.04));
      const g2 = 0.55 * Math.exp(-(((x - 0.2) ** 2 + (y - 0.8) ** 2) / 0.02));
      values[r * COLS + c] = g1 + g2;
    }
  }
  writeSpec("density-contour.spec.json", {
    version: "glyph/0.1",
    title: "Customer density — two clusters, isolines at 5 levels",
    width: 640,
    height: 440,
    data: { grid: { rows: ROWS, cols: COLS, values } },
    thresholds: [0.1, 0.25, 0.45, 0.65, 0.85],
    layers: [{ mark: "contour", encoding: {} }],
  });
}

// ---------------------------------------------------------------------------
// Smoke render — make sure every spec turns into SVG before we ship them.
// ---------------------------------------------------------------------------
const { readFileSync, readdirSync } = await import("node:fs");
const bundleUrl = pathToFileURL(join(ROOT, "site/play/glyph-bundle.js")).href;
const { compileSpec, compileCompose, parseComposeSpec, renderSvg } = await import(bundleUrl);

function inferSchema(headers, sampleRow) {
  return headers.map((h, i) => {
    const v = sampleRow[i];
    const isNum = typeof v === "number" || (v != null && /^-?\d/.test(String(v)));
    return { name: h, type: isNum ? "DOUBLE" : "VARCHAR", nullable: false };
  });
}

const want = [
  ["cohort-retention", true, "chart"],
  ["revenue-treemap", false, "chart"],
  ["cac-vs-ltv", true, "chart"],
  ["api-latency", true, "chart"],
  ["sales-calendar", true, "chart"],
  // marketing-sunburst, kpi-radar, org-graph are now compose scenes —
  // they bring no CSV and use `compose` not `layers`.
  ["marketing-sunburst", false, "compose"],
  ["revenue-donut", true, "chart"],
  ["kpi-radar", false, "compose"],
  ["org-graph", false, "compose"],
  ["density-contour", false, "chart"],
];

console.log("\nSmoke render:");
for (const [stem, hasCsv, kind] of want) {
  const spec = JSON.parse(readFileSync(join(OUT, `${stem}.spec.json`), "utf8"));
  let svg;
  if (kind === "compose") {
    const scene = compileCompose(parseComposeSpec(spec));
    svg = renderSvg(scene);
  } else if (hasCsv) {
    const csv = readFileSync(join(OUT, `${stem}.csv`), "utf8")
      .trim()
      .split(/\r?\n/);
    const headers = csv[0].split(",");
    const rows = csv.slice(1).map((line) => {
      const cells = line.split(",");
      return headers.map((_, i) => {
        const v = cells[i];
        if (v == null || v === "") return null;
        const n = Number(v);
        return Number.isFinite(n) && /^-?[\d.]+$/.test(v) ? n : v;
      });
    });
    const schema = inferSchema(headers, rows[0]);
    const scene = compileSpec({ spec, rows, schema });
    svg = renderSvg(scene);
  } else {
    const scene = compileSpec({ spec, rows: [], schema: [] });
    svg = renderSvg(scene);
  }
  console.log(`  ${stem.padEnd(22)} → ${svg.length} bytes`);
}
