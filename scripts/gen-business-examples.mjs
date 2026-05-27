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
// $4.2M annual marketing budget. Three top-level categories, each broken
// into 2-3 channels so the sunburst rings read clearly.
{
  const hierarchy = {
    name: "Marketing $4.2M",
    children: [
      {
        name: "Performance",
        children: [
          { name: "Paid search", value: 720 },
          { name: "Paid social", value: 480 },
          { name: "Display", value: 240 },
          { name: "Retargeting", value: 180 },
        ],
      },
      {
        name: "Brand",
        children: [
          { name: "Content", value: 540 },
          { name: "PR", value: 220 },
          { name: "Events", value: 380 },
          { name: "Sponsorships", value: 140 },
        ],
      },
      {
        name: "Lifecycle",
        children: [
          { name: "Email", value: 320 },
          { name: "Webinars", value: 280 },
          { name: "Referral", value: 240 },
          { name: "Community", value: 160 },
        ],
      },
    ],
  };
  writeSpec("marketing-sunburst.spec.json", {
    version: "glyph/0.1",
    title: "Marketing spend — annual budget ($K)",
    width: 560,
    height: 560,
    data: { hierarchy },
    layers: [{ mark: "sunburst", encoding: {} }],
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
// 8. Radar chart (polar line) — product KPI scorecard
// ===========================================================================
// Six KPI axes scored 0-100. Line mark + polar coords = a closed radar
// polygon — the canonical PM scorecard.
{
  const data = [
    { metric: "Performance", score: 86 },
    { metric: "Reliability", score: 92 },
    { metric: "Security", score: 78 },
    { metric: "Cost", score: 64 },
    { metric: "UX", score: 88 },
    { metric: "Velocity", score: 74 },
  ];
  const rows = [["metric", "score"]];
  for (const d of data) rows.push([d.metric, d.score]);
  writeCsv("kpi-radar.csv", rows);
  writeSpec("kpi-radar.spec.json", {
    version: "glyph/0.1",
    title: "Product KPI scorecard — Q3",
    width: 520,
    height: 520,
    coordinates: { type: "polar" },
    layers: [
      {
        mark: "line",
        encoding: {
          x: { field: "metric", type: "ordinal" },
          y: {
            field: "score",
            type: "quantitative",
            scale: { domain: [0, 100] },
          },
        },
      },
      {
        mark: "point",
        encoding: {
          x: { field: "metric", type: "ordinal" },
          y: { field: "score", type: "quantitative" },
        },
      },
    ],
  });
}

// ===========================================================================
// 9. Force-directed org graph (self-contained, data.graph)
// ===========================================================================
// 9-person engineering org. CEO at the top, two managers, six ICs split
// across two groups. The seed pins layout so screenshots are reproducible.
{
  const graph = {
    nodes: [
      { id: "CEO", group: "exec" },
      { id: "VP Eng", group: "exec" },
      { id: "Mgr Platform", group: "platform" },
      { id: "Mgr Product", group: "product" },
      { id: "Eng A", group: "platform" },
      { id: "Eng B", group: "platform" },
      { id: "Eng C", group: "platform" },
      { id: "Eng D", group: "product" },
      { id: "Eng E", group: "product" },
      { id: "Eng F", group: "product" },
    ],
    edges: [
      { source: "CEO", target: "VP Eng" },
      { source: "VP Eng", target: "Mgr Platform" },
      { source: "VP Eng", target: "Mgr Product" },
      { source: "Mgr Platform", target: "Eng A" },
      { source: "Mgr Platform", target: "Eng B" },
      { source: "Mgr Platform", target: "Eng C" },
      { source: "Mgr Product", target: "Eng D" },
      { source: "Mgr Product", target: "Eng E" },
      { source: "Mgr Product", target: "Eng F" },
      { source: "Eng A", target: "Eng D" },
      { source: "Eng B", target: "Eng E" },
    ],
  };
  writeSpec("org-graph.spec.json", {
    version: "glyph/0.1",
    title: "Engineering org — reporting + cross-team links",
    width: 640,
    height: 480,
    data: { graph },
    seed: 42,
    layers: [{ mark: "force", encoding: {} }],
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
const { compileSpec, renderSvg } = await import(bundleUrl);

function inferSchema(headers, sampleRow) {
  return headers.map((h, i) => {
    const v = sampleRow[i];
    const isNum = typeof v === "number" || (v != null && /^-?\d/.test(String(v)));
    return { name: h, type: isNum ? "DOUBLE" : "VARCHAR", nullable: false };
  });
}

const want = [
  ["cohort-retention", true],
  ["revenue-treemap", false],
  ["cac-vs-ltv", true],
  ["api-latency", true],
  ["sales-calendar", true],
  ["marketing-sunburst", false],
  ["revenue-donut", true],
  ["kpi-radar", true],
  ["org-graph", false],
  ["density-contour", false],
];

console.log("\nSmoke render:");
for (const [stem, hasCsv] of want) {
  const spec = JSON.parse(readFileSync(join(OUT, `${stem}.spec.json`), "utf8"));
  let svg;
  if (hasCsv) {
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
