#!/usr/bin/env node
// Eight advanced business chart examples inspired by the canonical
// Observable D3 examples list (choropleth, bar chart race, Gapminder,
// stacked area, index chart, moving average, streamgraph, circle
// packing). Writes CSV + spec pairs into site/play/examples/business/
// and prints a smoke-render byte count for each.
//
// Run from repo root:
//   node scripts/gen-advanced-charts.mjs
//
// Determinism comes from a Park-Miller LCG (no Math.random) so re-runs
// produce byte-identical files.
//
// The hand-crafted compose scenes (streamgraph, circle packing, index
// chart) compute geometry in JS up front, then emit ready-to-render
// JSON — keeps the spec files small and the code easy to audit.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

function writeCsv(name, rows) {
  const csv = `${rows.map((r) => r.join(",")).join("\n")}\n`;
  writeFileSync(join(OUT, name), csv);
}
function writeSpec(name, spec) {
  const json = `${JSON.stringify(spec, null, 2)}\n`;
  writeFileSync(join(OUT, name), json);
}

// ============================================================================
// 1. Choropleth — sales by US region
// ============================================================================
// Five hand-drawn US-region polygons in approximate (lon, lat) space.
// equirectangular projection centered on the contiguous US. Each region
// carries a `region` id matched against the CSV's `region` column.
{
  // Coarse, stylized polygons — not real state borders. The point is to
  // demonstrate `geo-region` + per-region color encoding without dragging
  // in a 50 KB GeoJSON dependency.
  const features = [
    {
      type: "Feature",
      properties: { id: "Pacific" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-124, 32],
            [-114, 32],
            [-114, 49],
            [-124, 49],
            [-124, 32],
          ],
        ],
      },
    },
    {
      type: "Feature",
      properties: { id: "Mountain" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-114, 32],
            [-103, 32],
            [-103, 49],
            [-114, 49],
            [-114, 32],
          ],
        ],
      },
    },
    {
      type: "Feature",
      properties: { id: "Midwest" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-103, 36],
            [-82, 36],
            [-82, 49],
            [-103, 49],
            [-103, 36],
          ],
        ],
      },
    },
    {
      type: "Feature",
      properties: { id: "South" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-103, 25],
            [-77, 25],
            [-77, 36],
            [-103, 36],
            [-103, 25],
          ],
        ],
      },
    },
    {
      type: "Feature",
      properties: { id: "Northeast" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-82, 36],
            [-67, 36],
            [-67, 47],
            [-82, 47],
            [-82, 36],
          ],
        ],
      },
    },
  ];
  const rows = [
    ["region", "sales"],
    ["Pacific", 4.8],
    ["Mountain", 2.1],
    ["Midwest", 3.6],
    ["South", 5.2],
    ["Northeast", 4.1],
  ];
  writeCsv("sales-by-region.csv", rows);
  writeSpec("sales-by-region.spec.json", {
    version: "glyph/0.1",
    title: "US sales by region ($M, Q3)",
    width: 720,
    height: 420,
    // `scale` is in pixels-per-degree (not per radian). At width 720 with
    // ~60° lon span across the contiguous US, 11 px/° fills the frame
    // without clipping; the equirectangular projection is centered on the
    // geographic center of the US.
    projection: { type: "equirectangular", center: [-97, 38], scale: 11 },
    geojson: { features },
    layers: [
      {
        mark: "geo-region",
        encoding: {
          region: { field: "region", type: "nominal" },
          color: { field: "sales", type: "quantitative" },
        },
      },
    ],
  });
}

// ============================================================================
// 2. Bar chart race — top products by year
// ============================================================================
// 6 products × 6 years. The `race` animation interpolates each bar's
// width between frames so the leaderboard shuffles year by year.
{
  const products = ["Compute", "Storage", "IDE Pro", "CDN", "Debug", "Workers"];
  const start = {
    Compute: 1.2,
    Storage: 0.9,
    "IDE Pro": 0.6,
    CDN: 0.4,
    Debug: 0.3,
    Workers: 0.1,
  };
  // Different growth rates so positions shuffle realistically.
  const cagr = {
    Compute: 1.18,
    Storage: 1.22,
    "IDE Pro": 1.35,
    CDN: 1.4,
    Debug: 1.5,
    Workers: 1.8,
  };
  const rand = lcg(31);
  const rows = [["product", "year", "revenue"]];
  for (const p of products) {
    let v = start[p];
    for (let y = 2020; y <= 2025; y++) {
      const jitter = 1 + (rand() - 0.5) * 0.06;
      v = v * cagr[p] * jitter;
      rows.push([p, y, Math.round(v * 100) / 100]);
    }
  }
  writeCsv("bar-race.csv", rows);
  writeSpec("bar-race.spec.json", {
    version: "glyph/0.1",
    title: "Top products by revenue — 2020-2025 race ($M)",
    width: 700,
    height: 420,
    animation: { kind: "race", frame_field: "year", duration_ms: 8000 },
    layers: [
      {
        mark: "bar",
        encoding: {
          x: { field: "product", type: "ordinal" },
          y: { field: "revenue", type: "quantitative" },
          color: { field: "product", type: "nominal" },
        },
      },
    ],
  });
}

// ============================================================================
// 3. Wealth-Health of Nations — bubble scatter (Gapminder snapshot)
// ============================================================================
// 8 stylized countries plotted at their latest year. Bubble area encodes
// population, color encodes continent. Hand-laid in compose because
// Glyph's `size` channel doesn't yet drive point radius (it's currently
// hardcoded to r=3 in the compiler), so the chart-spec route gave us
// uniform-radius bubbles — losing the visual "size = population" signal
// that makes the Gapminder chart famous.
{
  const continentColor = {
    Europe: "#4c78a8",
    Americas: "#f58518",
    Africa: "#e45756",
    Asia: "#54a24b",
    Oceania: "#72b7b2",
  };
  // 2023 snapshot — population (M), GDP/capita ($), life expectancy.
  const countries = [
    { name: "Nordica", continent: "Europe", gdp: 53000, life: 82, pop: 11 },
    { name: "Latinia", continent: "Americas", gdp: 17000, life: 76, pop: 60 },
    { name: "Saharia", continent: "Africa", gdp: 5200, life: 65, pop: 95 },
    { name: "Maharashtra", continent: "Asia", gdp: 7600, life: 71, pop: 320 },
    { name: "Pacificana", continent: "Oceania", gdp: 47000, life: 83, pop: 6 },
    { name: "Andesia", continent: "Americas", gdp: 11000, life: 75, pop: 28 },
    { name: "Sinora", continent: "Asia", gdp: 17500, life: 78, pop: 180 },
    { name: "Albion", continent: "Europe", gdp: 40000, life: 81, pop: 55 },
  ];

  const W = 760;
  const H = 480;
  const padL = 70;
  const padR = 40;
  const padT = 70;
  const padB = 60;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const gdpMin = 0;
  const gdpMax = 60000;
  const lifeMin = 60;
  const lifeMax = 90;
  const xAt = (g) => padL + ((g - gdpMin) / (gdpMax - gdpMin)) * plotW;
  const yAt = (l) => padT + plotH - ((l - lifeMin) / (lifeMax - lifeMin)) * plotH;
  // Bubble radius ∝ √population so visual *area* tracks population
  // (Tufte's rule — eyes read area, not radius).
  const maxPop = Math.max(...countries.map((c) => c.pop));
  const radius = (pop) => 8 + 38 * Math.sqrt(pop / maxPop);

  const children = [];
  children.push({
    at: { x: W / 2, y: 30 },
    mark: "text",
    textMark: {
      text: "Wealth & Health of Nations — 2023 snapshot",
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
      text: "x = GDP/capita · y = life expectancy · bubble area = population · color = continent",
      fontSize: 11.5,
      fill: "#666",
      italic: true,
      anchor: "middle",
    },
  });

  // Gridlines.
  let gridD = "";
  for (let g = 0; g <= 6; g++) {
    const x = padL + (g / 6) * plotW;
    gridD += ` M ${x} ${padT} L ${x} ${padT + plotH}`;
  }
  for (let g = 0; g <= 6; g++) {
    const y = padT + (g / 6) * plotH;
    gridD += ` M ${padL} ${y} L ${padL + plotW} ${y}`;
  }
  children.push({
    at: { x: 0, y: 0 },
    mark: "silhouette-path",
    silhouettePath: { d: gridD.trim(), fill: "none", stroke: "#eef0f4", strokeWidth: 1 },
  });
  // X-axis ticks.
  for (let g = 0; g <= 6; g++) {
    const v = gdpMin + (g / 6) * (gdpMax - gdpMin);
    children.push({
      at: { x: padL + (g / 6) * plotW, y: padT + plotH + 16 },
      mark: "text",
      textMark: {
        text: `$${(v / 1000).toFixed(0)}k`,
        fontSize: 10.5,
        fill: "#888",
        italic: false,
        anchor: "middle",
      },
    });
  }
  // Y-axis ticks.
  for (let g = 0; g <= 6; g++) {
    const v = lifeMin + (g / 6) * (lifeMax - lifeMin);
    children.push({
      at: { x: padL - 8, y: padT + plotH - (g / 6) * plotH + 4 },
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
  // Axis titles.
  children.push({
    at: { x: padL + plotW / 2, y: H - 26 },
    mark: "text",
    textMark: {
      text: "GDP per capita",
      fontSize: 11.5,
      fill: "#1a1a1a",
      italic: false,
      anchor: "middle",
    },
  });

  // Bubbles + country labels.
  for (const c of countries) {
    const cx = xAt(c.gdp);
    const cy = yAt(c.life);
    const r = radius(c.pop);
    children.push({
      at: { x: cx, y: cy },
      mark: "circle",
      circle: {
        radius: r,
        fill: continentColor[c.continent],
        stroke: "#1a1a1a",
        strokeWidth: 1.2,
      },
    });
    children.push({
      at: { x: cx, y: cy - r - 4 },
      mark: "text",
      textMark: {
        text: c.name,
        fontSize: 11,
        fill: "#1a1a1a",
        italic: false,
        anchor: "middle",
      },
    });
  }

  // Continent color legend, bottom-right.
  const continentList = ["Europe", "Americas", "Asia", "Africa", "Oceania"];
  let legendY = padT + 8;
  for (const cn of continentList) {
    children.push({
      at: { x: W - 110, y: legendY },
      mark: "circle",
      circle: { radius: 6, fill: continentColor[cn] },
    });
    children.push({
      at: { x: W - 98, y: legendY + 4 },
      mark: "text",
      textMark: { text: cn, fontSize: 11, fill: "#1a1a1a", italic: false, anchor: "start" },
    });
    legendY += 20;
  }

  writeSpec("wealth-health.spec.json", {
    compose: {
      viewBox: { width: W, height: H },
      title: "Wealth & Health of Nations — 2023 snapshot",
      description:
        "Gapminder-style bubble chart: x = GDP/capita, y = life expectancy, bubble area = population, color = continent. Hand-laid in compose because Glyph's chart-spec size channel doesn't yet drive point radius — losing the visual 'big bubble = big country' signal that makes the chart famous.",
      children,
    },
  });
}

// ============================================================================
// 4. Stacked area — revenue by customer segment
// ============================================================================
// 12 months × 4 segments. Hand-laid in compose so each band reads as a
// distinct color — Glyph's per-layer fill is encoding-driven and won't
// let us assign one color per layer from a 4-row schema. We compute
// each band's top/bottom edges per month and emit one polygon per
// segment with its own fill.
{
  const months = 12;
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
  const segments = [
    { name: "Enterprise", color: "#4c78a8", base: 380, growth: 1.06 },
    { name: "Mid-market", color: "#f58518", base: 220, growth: 1.045 },
    { name: "Startup", color: "#54a24b", base: 130, growth: 1.08 },
    { name: "Self-serve", color: "#e45756", base: 80, growth: 1.1 },
  ];
  const rand = lcg(53);
  // values[m][s] = revenue for month m, segment s
  const values = [];
  for (let m = 0; m < months; m++) {
    const row = segments.map((s) => {
      const v = s.base * s.growth ** m;
      const jitter = 1 + (rand() - 0.5) * 0.06;
      return Math.round(v * jitter);
    });
    values.push(row);
  }
  const totals = values.map((row) => row.reduce((a, b) => a + b, 0));
  const maxTotal = Math.max(...totals);

  const W = 720;
  const H = 420;
  const padL = 60;
  const padR = 30;
  const padT = 70;
  const padB = 60;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const xAt = (i) => padL + (i / (months - 1)) * plotW;
  const yAt = (v) => padT + plotH - (v / maxTotal) * plotH;

  const children = [];
  children.push({
    at: { x: W / 2, y: 30 },
    mark: "text",
    textMark: {
      text: "Revenue by segment — stacked area ($K monthly)",
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
      text: "Four customer segments, paint order back-to-front.",
      fontSize: 11.5,
      fill: "#666",
      italic: true,
      anchor: "middle",
    },
  });

  // Horizontal gridlines (4 of them at 0, ¼, ½, ¾, full).
  let gridD = "";
  for (let g = 0; g <= 4; g++) {
    const y = padT + plotH - (g / 4) * plotH;
    gridD += ` M ${padL} ${y} L ${padL + plotW} ${y}`;
  }
  children.push({
    at: { x: 0, y: 0 },
    mark: "silhouette-path",
    silhouettePath: { d: gridD.trim(), fill: "none", stroke: "#e6e9ee", strokeWidth: 1 },
  });
  // Y-axis labels.
  for (let g = 0; g <= 4; g++) {
    const v = (g / 4) * maxTotal;
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
  for (let m = 0; m < months; m += 2) {
    children.push({
      at: { x: xAt(m), y: padT + plotH + 16 },
      mark: "text",
      textMark: {
        text: monthNames[m],
        fontSize: 10.5,
        fill: "#888",
        italic: false,
        anchor: "middle",
      },
    });
  }

  // For each band, compute its top + bottom edges per month and emit
  // one closed polygon. Bands stack from the bottom up so segments[0]
  // sits at the bottom of the stack.
  for (let s = 0; s < segments.length; s++) {
    const topPts = [];
    const bottomPts = [];
    for (let m = 0; m < months; m++) {
      const below = values[m].slice(0, s).reduce((a, b) => a + b, 0);
      const above = values[m].slice(0, s + 1).reduce((a, b) => a + b, 0);
      topPts.push([Number(xAt(m).toFixed(2)), Number(yAt(above).toFixed(2))]);
      bottomPts.push([Number(xAt(m).toFixed(2)), Number(yAt(below).toFixed(2))]);
    }
    const points = [...topPts, ...bottomPts.reverse()];
    children.push({
      at: { x: 0, y: 0 },
      mark: "polygon",
      polygon: { points, fill: segments[s].color, stroke: "#ffffff", strokeWidth: 0.6 },
    });
  }
  // Legend along the bottom.
  const legendY = H - 18;
  let lx = 60;
  for (const s of segments) {
    children.push({
      at: { x: lx, y: legendY },
      mark: "circle",
      circle: { radius: 5.5, fill: s.color },
    });
    children.push({
      at: { x: lx + 10, y: legendY + 4 },
      mark: "text",
      textMark: { text: s.name, fontSize: 11, fill: "#1a1a1a", italic: false, anchor: "start" },
    });
    lx += 130;
  }

  writeSpec("revenue-stacked-area.spec.json", {
    compose: {
      viewBox: { width: W, height: H },
      title: "Revenue by segment — stacked area",
      description:
        "Four customer segments stacked from the bottom up: Enterprise (largest, dark blue) at the base, then Mid-market, Startup, and Self-serve on top. Hand-laid as compose polygons so each band carries its own color.",
      children,
    },
  });
}

// ============================================================================
// 5. Moving average — noisy daily series + 14-day MA
// ============================================================================
// 60 days of daily values + a 14-day trailing moving average. Hand-laid
// in compose so the two series read as distinct colors (raw light-blue
// dots + line, smoothed orange line); the chart-spec route gave us two
// blue lines that visually merged.
{
  const N = 60;
  const rand = lcg(73);
  const raw = [];
  let v = 1000;
  for (let i = 0; i < N; i++) {
    v += 6 + (rand() - 0.5) * 90;
    raw.push(Math.round(v));
  }
  const window = 14;
  const ma = raw.map((_, i) => {
    if (i + 1 < window) return null;
    const slice = raw.slice(i + 1 - window, i + 1);
    return Math.round(slice.reduce((s, x) => s + x, 0) / window);
  });

  const W = 720;
  const H = 400;
  const padL = 60;
  const padR = 30;
  const padT = 70;
  const padB = 60;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const yMin = Math.floor(Math.min(...raw) / 100) * 100;
  const yMax = Math.ceil(Math.max(...raw) / 100) * 100;
  const xAt = (d) => padL + ((d - 1) / (N - 1)) * plotW;
  const yAt = (v) => padT + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  const children = [];
  children.push({
    at: { x: W / 2, y: 30 },
    mark: "text",
    textMark: {
      text: "Daily signups + 14-day moving average",
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
      text: "Light blue: raw daily count. Orange: smoothed.",
      fontSize: 11.5,
      fill: "#666",
      italic: true,
      anchor: "middle",
    },
  });

  // Gridlines + Y labels.
  let gridD = "";
  for (let g = 0; g <= 4; g++) {
    const y = padT + plotH - (g / 4) * plotH;
    gridD += ` M ${padL} ${y} L ${padL + plotW} ${y}`;
  }
  children.push({
    at: { x: 0, y: 0 },
    mark: "silhouette-path",
    silhouettePath: { d: gridD.trim(), fill: "none", stroke: "#e6e9ee", strokeWidth: 1 },
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
  for (const d of [1, 15, 30, 45, 60]) {
    children.push({
      at: { x: xAt(d), y: padT + plotH + 16 },
      mark: "text",
      textMark: {
        text: `D${d}`,
        fontSize: 10.5,
        fill: "#888",
        italic: false,
        anchor: "middle",
      },
    });
  }

  // Raw series as a polyline + small dots.
  const rawPts = raw.map((v, i) => [Number(xAt(i + 1).toFixed(2)), Number(yAt(v).toFixed(2))]);
  children.push({
    at: { x: 0, y: 0 },
    mark: "polyline",
    polyline: { points: rawPts, stroke: "#a4c1e0", strokeWidth: 1.2 },
  });
  // 14-day MA — skip the first 13 null entries.
  const maPts = [];
  for (let i = 0; i < N; i++) {
    if (ma[i] == null) continue;
    maPts.push([Number(xAt(i + 1).toFixed(2)), Number(yAt(ma[i]).toFixed(2))]);
  }
  children.push({
    at: { x: 0, y: 0 },
    mark: "polyline",
    polyline: { points: maPts, stroke: "#f58518", strokeWidth: 2.5 },
  });
  // Small dots on the raw series, sparingly (every 3rd day) to keep
  // visual noise down.
  for (let i = 0; i < N; i += 3) {
    children.push({
      at: { x: xAt(i + 1), y: yAt(raw[i]) },
      mark: "circle",
      circle: { radius: 2.5, fill: "#4c78a8" },
    });
  }

  // Legend.
  const legendY = H - 18;
  children.push({
    at: { x: 60, y: legendY },
    mark: "circle",
    circle: { radius: 5, fill: "#4c78a8" },
  });
  children.push({
    at: { x: 70, y: legendY + 4 },
    mark: "text",
    textMark: { text: "Raw daily", fontSize: 11, fill: "#1a1a1a", italic: false, anchor: "start" },
  });
  children.push({
    at: { x: 180, y: legendY },
    mark: "silhouette-path",
    silhouettePath: { d: "M -10 0 L 10 0", stroke: "#f58518", strokeWidth: 3, fill: "none" },
  });
  children.push({
    at: { x: 195, y: legendY + 4 },
    mark: "text",
    textMark: { text: "14-day MA", fontSize: 11, fill: "#1a1a1a", italic: false, anchor: "start" },
  });

  writeSpec("moving-average.spec.json", {
    compose: {
      viewBox: { width: W, height: H },
      title: "Moving average",
      description:
        "60 days of noisy daily signups (light blue) overlaid with a 14-day trailing moving average (orange). Hand-laid in compose so the two series read as distinct colors.",
      children,
    },
  });
  // Keep the CSV around — useful for the user to inspect / re-run their
  // own MA window — even though the spec is now compose.
  const rows = [["day", "value", "ma14"]];
  for (let i = 0; i < N; i++) {
    rows.push([i + 1, raw[i], ma[i] ?? ""]);
  }
  writeCsv("moving-average.csv", rows);
}

// ============================================================================
// 6. Index chart — tech stocks normalized to 100 at start
// ============================================================================
// Five tickers × 24 monthly closes. Each series rebased to 100 on day 1
// so the lines show relative returns. Hand-laid in compose with one
// polyline per ticker (since Glyph's line mark doesn't yet split by a
// categorical color field).
{
  const tickers = [
    { name: "ACME", start: 100, drift: 0.013, vol: 0.045, color: "#4c78a8" },
    { name: "BRIX", start: 100, drift: 0.018, vol: 0.07, color: "#f58518" },
    { name: "COIL", start: 100, drift: 0.008, vol: 0.05, color: "#54a24b" },
    { name: "DYAD", start: 100, drift: -0.005, vol: 0.04, color: "#e45756" },
    { name: "ECHO", start: 100, drift: 0.025, vol: 0.09, color: "#72b7b2" },
  ];
  const months = 24;
  // Geometric random walk per ticker.
  const series = tickers.map((t) => {
    const rand = lcg(101 + t.name.charCodeAt(0));
    const vals = [t.start];
    for (let i = 1; i < months; i++) {
      const step = t.drift + (rand() - 0.5) * t.vol * 2;
      vals.push(vals[i - 1] * (1 + step));
    }
    return { ...t, vals };
  });

  // Layout in compose pixel space.
  const W = 720;
  const H = 420;
  const padL = 60;
  const padR = 140; // room for ticker labels at the right edge
  const padT = 70;
  const padB = 50;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  // Find overall y-range across all series.
  let yMin = Number.POSITIVE_INFINITY;
  let yMax = Number.NEGATIVE_INFINITY;
  for (const s of series) {
    for (const v of s.vals) {
      if (v < yMin) yMin = v;
      if (v > yMax) yMax = v;
    }
  }
  yMin = Math.floor(yMin / 10) * 10;
  yMax = Math.ceil(yMax / 10) * 10;
  const xAt = (i) => padL + (i / (months - 1)) * plotW;
  const yAt = (v) => padT + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  const children = [];
  // Title.
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
      text: "Each line normalized to its starting value (100). Higher = better total return.",
      fontSize: 12,
      fill: "#666",
      italic: true,
      anchor: "middle",
    },
  });

  // Plot frame + grid.
  let gridD = "";
  // 4 horizontal gridlines.
  const gridSteps = 4;
  for (let g = 0; g <= gridSteps; g++) {
    const y = padT + (g / gridSteps) * plotH;
    gridD += ` M ${padL} ${y} L ${padL + plotW} ${y}`;
  }
  children.push({
    at: { x: 0, y: 0 },
    mark: "silhouette-path",
    silhouettePath: {
      d: gridD.trim(),
      fill: "none",
      stroke: "#e6e9ee",
      strokeWidth: 1,
    },
  });
  // Y-axis labels.
  for (let g = 0; g <= gridSteps; g++) {
    const v = yMax - (g / gridSteps) * (yMax - yMin);
    const y = padT + (g / gridSteps) * plotH;
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
  // X-axis labels: month 1, 6, 12, 18, 24.
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
  // Baseline at 100.
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

  // Series polylines.
  for (const s of series) {
    const points = s.vals.map((v, i) => [Number(xAt(i).toFixed(2)), Number(yAt(v).toFixed(2))]);
    children.push({
      at: { x: 0, y: 0 },
      mark: "polyline",
      polyline: {
        points,
        stroke: s.color,
        strokeWidth: 2,
      },
    });
    // End-of-line label.
    const lastV = s.vals[s.vals.length - 1];
    children.push({
      at: { x: padL + plotW + 8, y: yAt(lastV) + 4 },
      mark: "text",
      textMark: {
        text: `${s.name}  ${lastV.toFixed(0)}`,
        fontSize: 11.5,
        fill: s.color,
        italic: false,
        anchor: "start",
      },
    });
  }

  writeSpec("index-chart.spec.json", {
    compose: {
      viewBox: { width: W, height: H },
      title: "Index chart — relative performance",
      description:
        "5 tech stocks normalized to a starting value of 100, so each line shows relative cumulative return. Hand-laid in compose because Glyph's line mark doesn't yet group rows by a categorical color field — every ticker is its own polyline child.",
      children,
    },
  });
}

// ============================================================================
// 7. Streamgraph — same data as the stacked area, centered baseline
// ============================================================================
// Stacked-area variant where each band's baseline is centered around 0
// instead of resting on the x-axis. Glyph's `area` mark only baselines
// at 0, so this is hand-laid in compose: one polygon per segment.
{
  const months = 12;
  const segments = [
    { name: "Enterprise", color: "#4c78a8" },
    { name: "Mid-market", color: "#f58518" },
    { name: "Startup", color: "#54a24b" },
    { name: "Self-serve", color: "#e45756" },
  ];
  const base = [380, 220, 130, 80];
  const growth = [1.06, 1.045, 1.08, 1.1];
  const rand = lcg(53);
  // 4-segment per-month values.
  const values = [];
  for (let m = 0; m < months; m++) {
    const row = segments.map((_, s) => {
      const v = base[s] * growth[s] ** m;
      const jitter = 1 + (rand() - 0.5) * 0.06;
      return Math.round(v * jitter);
    });
    values.push(row);
  }
  // Total per month, to center.
  const totals = values.map((row) => row.reduce((s, v) => s + v, 0));

  const W = 720;
  const H = 400;
  const padL = 60;
  const padR = 30;
  const padT = 70;
  const padB = 40;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const maxTotal = Math.max(...totals);
  // Map a value v to a half-height around the centerline.
  const halfH = plotH / 2;
  const yScale = (offset) => padT + halfH - (offset / maxTotal) * halfH;
  const xAt = (i) => padL + (i / (months - 1)) * plotW;

  const children = [];
  children.push({
    at: { x: W / 2, y: 30 },
    mark: "text",
    textMark: {
      text: "Revenue by segment — streamgraph (centered baseline)",
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
      text: "Same data as the stacked-area example; baseline centered so each band's thickness is what your eye reads.",
      fontSize: 11.5,
      fill: "#666",
      italic: true,
      anchor: "middle",
    },
  });
  // Center line.
  children.push({
    at: { x: 0, y: 0 },
    mark: "silhouette-path",
    silhouettePath: {
      d: `M ${padL} ${padT + halfH} L ${padL + plotW} ${padT + halfH}`,
      fill: "none",
      stroke: "#e6e9ee",
      strokeWidth: 1,
    },
  });

  // For each band, compute its top and bottom edges per month so we can
  // emit one closed polygon as a single child.
  for (let s = 0; s < segments.length; s++) {
    const topPts = [];
    const bottomPts = [];
    for (let m = 0; m < months; m++) {
      // Symmetric stacking: half the total goes above 0, half below.
      // Each band's top is the cumulative offset just above the band.
      const above = values[m].slice(0, s + 1).reduce((a, b) => a + b, 0);
      const below = values[m].slice(0, s).reduce((a, b) => a + b, 0);
      // Centered: total/2 is the top of the stack, -total/2 is the bottom.
      // Each band occupies [below - total/2, above - total/2].
      const total = totals[m];
      const yTop = padT + halfH - ((above - total / 2) / maxTotal) * halfH;
      const yBot = padT + halfH - ((below - total / 2) / maxTotal) * halfH;
      topPts.push([Number(xAt(m).toFixed(2)), Number(yTop.toFixed(2))]);
      bottomPts.push([Number(xAt(m).toFixed(2)), Number(yBot.toFixed(2))]);
    }
    // Polygon = topPts forward then bottomPts reversed (closed loop).
    const points = [...topPts, ...bottomPts.reverse()];
    children.push({
      at: { x: 0, y: 0 },
      mark: "polygon",
      polygon: {
        points,
        fill: segments[s].color,
        stroke: "#ffffff",
        strokeWidth: 0.6,
      },
    });
  }
  // Month labels.
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
  for (let m = 0; m < months; m++) {
    children.push({
      at: { x: xAt(m), y: padT + plotH + 16 },
      mark: "text",
      textMark: {
        text: monthNames[m],
        fontSize: 10.5,
        fill: "#888",
        italic: false,
        anchor: "middle",
      },
    });
  }
  // Legend.
  const legendY = H - 14;
  let lx = 60;
  for (const s of segments) {
    children.push({
      at: { x: lx, y: legendY },
      mark: "circle",
      circle: { radius: 5.5, fill: s.color },
    });
    children.push({
      at: { x: lx + 10, y: legendY + 4 },
      mark: "text",
      textMark: {
        text: s.name,
        fontSize: 11,
        fill: "#1a1a1a",
        italic: false,
        anchor: "start",
      },
    });
    lx += 130;
  }
  writeSpec("streamgraph.spec.json", {
    compose: {
      viewBox: { width: W, height: H },
      title: "Streamgraph — centered stacked bands",
      description:
        "Centered-baseline alternative to the stacked-area chart. Hand-laid as compose polygons because Glyph's `area` mark only supports a 0 baseline.",
      children,
    },
  });
}

// ============================================================================
// 8. Circle packing — categorical bubble hierarchy
// ============================================================================
// 3 product lines × 3-4 products. Bubbles sized by revenue; positioned
// by deterministic, simple hand-laid packing — each parent's children
// are arranged in a tight cluster around the parent's center.
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
      text: "Revenue circle packing — Q3 by product line",
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
      text: "Outer circles = product lines, inner circles = products. Radius ∝ √revenue.",
      fontSize: 11.5,
      fill: "#666",
      italic: true,
      anchor: "middle",
    },
  });

  for (const cat of data) {
    // Outer (parent) circle — pale tint of the category color.
    children.push({
      at: { x: cat.cx, y: cat.cy },
      mark: "circle",
      circle: {
        radius: cat.r,
        fill: cat.color,
        stroke: cat.color,
        strokeWidth: 0,
      },
    });
    // We want a semi-transparent appearance. The compose circle mark
    // doesn't expose opacity directly, so we layer a white halo polygon
    // — simpler: keep solid pale via tinted hex. For now, the outer
    // bubble uses the category color at full saturation; child bubbles
    // sit on top with a darker fill so they still read.
    // Layout children around parent center using polar arrangement.
    const totalChildVal = cat.children.reduce((s, c) => s + c.value, 0);
    const childAreaR = cat.r * 0.55; // ring radius for children
    const N = cat.children.length;
    for (let i = 0; i < N; i++) {
      const ch = cat.children[i];
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / N;
      const cx = cat.cx + childAreaR * Math.cos(angle);
      const cy = cat.cy + childAreaR * Math.sin(angle);
      // Radius ∝ √value scaled so the largest child has a sensible size.
      const cr = 18 + 22 * Math.sqrt(ch.value / Math.max(...cat.children.map((c) => c.value)));
      children.push({
        at: { x: cx, y: cy },
        mark: "circle",
        circle: {
          radius: cr,
          fill: "#ffffff",
          stroke: cat.color,
          strokeWidth: 2.5,
        },
      });
      children.push({
        at: { x: cx, y: cy - 2 },
        mark: "text",
        textMark: {
          text: ch.name,
          fontSize: 11,
          fill: "#1a1a1a",
          italic: false,
          anchor: "middle",
        },
      });
      children.push({
        at: { x: cx, y: cy + 12 },
        mark: "text",
        textMark: {
          text: `$${ch.value}M`,
          fontSize: 10,
          fill: "#666",
          italic: false,
          anchor: "middle",
        },
      });
    }
    // Parent label outside the parent circle.
    children.push({
      at: { x: cat.cx, y: cat.cy - cat.r - 10 },
      mark: "text",
      textMark: {
        text: cat.name,
        fontSize: 13,
        fill: cat.color,
        italic: false,
        anchor: "middle",
      },
    });
  }

  writeSpec("circle-packing.spec.json", {
    compose: {
      viewBox: { width: W, height: H },
      title: "Circle packing — Q3 revenue hierarchy",
      description:
        "Static circle-packing layout: three product-line bubbles, each surrounded by its three products. Child bubble radius is √revenue-scaled so visual size tracks impact.",
      children,
    },
  });
}

// ---------------------------------------------------------------------------
// Smoke render — make sure every spec turns into SVG before we ship them.
// ---------------------------------------------------------------------------
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
  ["sales-by-region", true, "chart"],
  ["bar-race", true, "chart"],
  ["wealth-health", false, "compose"],
  ["revenue-stacked-area", false, "compose"],
  ["moving-average", false, "compose"],
  ["index-chart", false, "compose"],
  ["streamgraph", false, "compose"],
  ["circle-packing", false, "compose"],
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
  console.log(`  ${stem.padEnd(24)} → ${svg.length} bytes`);
}
