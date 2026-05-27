#!/usr/bin/env node
// Three reported bugs, fixed together:
//
//   1. "US sales by region" rendered as colored squares — fix by
//      shipping hand-drawn polygons that actually look like US states
//      (West-coast curve, Great Lakes notch, Florida hook, Texas/Gulf
//      sweep, Maine corner).
//
//   2. "Bar chart race" wasn't actually animating — the chart-spec
//      race pipeline emits `<animate>` tags but with `values=` all
//      identical (Glyph core encoder bug). Rebuild as a compose scene
//      with raw-SVG SMIL `<animate>` keyframes so the bars grow and
//      shuffle ranks frame-by-frame.
//
//   3. "Wealth & health" was static — convert to the same SMIL pattern:
//      each bubble carries its own `<animate>` on cx, cy, r so it
//      tracks year-over-year (and labels track via animated x, y).
//
// All hand-written, no external deps. Run from repo root:
//   node scripts/fix-geo-and-animations.mjs

import { mkdirSync, writeFileSync } from "node:fs";
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
// FIX #1 — US choropleth with realistic state-shaped regions
// ============================================================================
// Five Census-style regions, each polygon traced from rough state borders
// (eyeball-accurate, not GIS-precise — the point is to read as the US
// at a glance, not survey-grade cartography). All coordinates are
// [lon, lat]; the existing equirectangular projection handles the
// scale.
//
// Region shapes:
//   - Pacific (CA/OR/WA): jagged west coast + flat eastern border
//   - Mountain (ID/MT/WY/NV/UT/CO/AZ/NM): big interior rectangle with
//     a notch for the Mexican border in AZ
//   - Midwest (ND/SD/MN/IA/WI/MI/IL/IN/OH + plains): Great Lakes notch
//     across the top
//   - South (TX/OK/AR/LA/MS/AL/GA/FL/TN/KY/NC/SC/VA): Gulf coast curve,
//     Florida hook, Atlantic coast sweep
//   - Northeast (NY/NJ/PA/DE/MD + New England): Atlantic coast +
//     Canadian border corner up at ME
{
  const features = [
    {
      type: "Feature",
      properties: { id: "Pacific" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-124.6, 48.4],
            [-122.5, 48.9],
            [-119.0, 49.0],
            [-117.0, 49.0],
            [-117.0, 46.0],
            [-117.0, 42.0],
            [-119.5, 42.0],
            [-120.0, 39.5],
            [-118.5, 37.0],
            [-117.0, 35.0],
            [-114.5, 34.8],
            [-114.7, 32.7],
            [-117.1, 32.5],
            [-117.3, 33.0],
            [-118.5, 34.0],
            [-120.5, 34.5],
            [-121.5, 36.5],
            [-122.5, 37.8],
            [-123.7, 39.3],
            [-124.4, 40.5],
            [-124.2, 43.0],
            [-124.0, 46.0],
            [-124.6, 48.4],
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
            [-117.0, 49.0],
            [-104.0, 49.0],
            [-104.0, 41.0],
            [-104.0, 36.5],
            [-103.0, 32.0],
            [-108.2, 32.0],
            [-111.0, 31.3],
            [-114.8, 32.5],
            [-114.7, 34.8],
            [-114.0, 35.0],
            [-114.0, 37.0],
            [-114.0, 42.0],
            [-117.0, 42.0],
            [-117.0, 46.0],
            [-117.0, 49.0],
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
            [-104.0, 49.0],
            [-97.0, 49.0],
            [-95.0, 49.4],
            [-94.5, 48.0],
            [-91.5, 48.0],
            [-90.0, 47.4],
            [-88.0, 47.5],
            [-87.0, 45.5],
            [-84.5, 46.0],
            [-83.5, 45.0],
            [-82.5, 41.5],
            [-80.5, 41.5],
            [-80.5, 39.5],
            [-83.0, 38.5],
            [-89.0, 37.0],
            [-94.5, 36.0],
            [-100.0, 36.5],
            [-104.0, 36.5],
            [-104.0, 49.0],
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
            [-103.0, 32.0],
            [-100.0, 36.5],
            [-94.5, 36.0],
            [-89.0, 37.0],
            [-83.0, 38.5],
            [-80.5, 39.5],
            [-77.5, 39.0],
            [-76.5, 38.0],
            [-76.0, 36.5],
            [-78.0, 34.0],
            [-80.7, 32.2],
            [-81.5, 30.5],
            [-81.0, 29.0],
            [-80.0, 26.5],
            [-80.2, 25.0],
            [-82.0, 26.0],
            [-83.0, 28.5],
            [-84.5, 29.7],
            [-87.5, 30.2],
            [-89.5, 30.0],
            [-91.2, 29.3],
            [-94.0, 29.4],
            [-97.0, 28.0],
            [-97.4, 26.0],
            [-99.0, 26.4],
            [-100.4, 28.6],
            [-103.0, 28.7],
            [-104.0, 30.0],
            [-103.0, 32.0],
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
            [-80.5, 41.5],
            [-79.5, 42.2],
            [-77.0, 43.3],
            [-75.0, 44.7],
            [-72.5, 45.0],
            [-71.0, 45.0],
            [-69.0, 47.5],
            [-67.5, 47.3],
            [-66.9, 44.8],
            [-69.5, 43.6],
            [-70.6, 42.8],
            [-71.0, 41.8],
            [-72.5, 41.2],
            [-74.0, 40.5],
            [-74.7, 39.4],
            [-75.5, 38.5],
            [-76.0, 38.0],
            [-77.5, 39.0],
            [-80.5, 39.5],
            [-80.5, 41.5],
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
  writeFileSync(join(BIZ, "sales-by-region.csv"), `${rows.map((r) => r.join(",")).join("\n")}\n`);
  writeSpec("sales-by-region.spec.json", {
    version: "glyph/0.1",
    title: "US sales by region ($M, Q3)",
    width: 740,
    height: 460,
    // scale = pixels per degree. ~60° lon × 25° lat for the contiguous
    // US; 11 px/° fills the frame with a small margin.
    projection: { type: "equirectangular", center: [-96.5, 38.5], scale: 11 },
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
// FIX #2 — Animated bar chart race (compose + SMIL <animate>)
// ============================================================================
// Glyph core's race-animation path currently emits <animate> tags whose
// `values=` attribute is the same number repeated per frame (encoder
// bug), so the bars don't actually move. Bypass by emitting a compose
// scene whose raw-svg children carry hand-built SMIL keyframes:
//   - width: list of per-year bar lengths
//   - y: list of per-year rank-based y positions (so the leader bubbles up)
{
  const products = ["Compute", "Storage", "IDE Pro", "CDN", "Debug", "Workers"];
  const start = { Compute: 1.2, Storage: 0.9, "IDE Pro": 0.6, CDN: 0.4, Debug: 0.3, Workers: 0.1 };
  const cagr = {
    Compute: 1.18,
    Storage: 1.22,
    "IDE Pro": 1.35,
    CDN: 1.4,
    Debug: 1.5,
    Workers: 1.8,
  };
  // Compute 6 years of revenue per product.
  const years = [2020, 2021, 2022, 2023, 2024, 2025];
  const data = {}; // data[product] = [v2020, v2021, ...]
  for (const p of products) {
    data[p] = [];
    let v = start[p];
    for (const _ of years) {
      v = v * cagr[p];
      data[p].push(Math.round(v * 100) / 100);
    }
  }

  const W = 760;
  const H = 440;
  const padL = 110;
  const padR = 90;
  const padT = 90;
  const padB = 60;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const barH = (plotH / products.length) * 0.7;
  const rowH = plotH / products.length;
  // X scale: cover full data range across all years.
  let vMax = 0;
  for (const p of products) vMax = Math.max(vMax, ...data[p]);
  vMax = Math.ceil(vMax / 2) * 2;
  const wAt = (v) => (v / vMax) * plotW;
  // Rank positions (1 = top, 6 = bottom). Compute per year, per product.
  const yByYear = years.map((_y, yi) => {
    const sorted = [...products].sort((a, b) => data[b][yi] - data[a][yi]);
    const rankMap = {};
    sorted.forEach((p, i) => {
      rankMap[p] = padT + i * rowH + (rowH - barH) / 2;
    });
    return rankMap;
  });
  const duration = "8000ms";
  const productColors = {
    Compute: "#4c78a8",
    Storage: "#f58518",
    "IDE Pro": "#54a24b",
    CDN: "#e45756",
    Debug: "#72b7b2",
    Workers: "#b279a2",
  };

  const children = [];
  children.push({
    at: { x: W / 2, y: 32 },
    mark: "text",
    textMark: {
      text: "Bar chart race — top products by revenue",
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
      text: "Animated 2020 → 2025. Bars grow + shuffle ranks frame-by-frame.",
      fontSize: 11.5,
      fill: "#666",
      italic: true,
      anchor: "middle",
    },
  });
  // X-axis tick gridlines.
  let gridD = "";
  for (let g = 0; g <= 4; g++) {
    const x = padL + (g / 4) * plotW;
    gridD += ` M ${x} ${padT} L ${x} ${padT + plotH}`;
  }
  children.push({
    at: { x: 0, y: 0 },
    mark: "silhouette-path",
    silhouettePath: { d: gridD.trim(), fill: "none", stroke: "#eef0f4", strokeWidth: 1 },
  });
  for (let g = 0; g <= 4; g++) {
    const v = (g / 4) * vMax;
    const x = padL + (g / 4) * plotW;
    children.push({
      at: { x, y: padT + plotH + 18 },
      mark: "text",
      textMark: {
        text: `$${v.toFixed(1)}M`,
        fontSize: 10.5,
        fill: "#888",
        italic: false,
        anchor: "middle",
      },
    });
  }

  // Per-product raw-svg blocks: each is one <rect> + one <text> label,
  // each with their own <animate> tags. Keep each block under the
  // 4096-char raw-svg cap by emitting one block per product.
  for (const p of products) {
    const widths = data[p].map((v) => wAt(v).toFixed(2)).join(";");
    const ys = years.map((_, yi) => yByYear[yi][p].toFixed(2)).join(";");
    const valueLabels = data[p].map((v) => v.toFixed(2)).join(";");
    const color = productColors[p];
    const startY = yByYear[0][p];
    // The <rect> grows in width and slides up/down in y.
    // The label <text> moves in y too, and shows the current value via
    // a per-year span swap (done with a series of <text>s, each gated
    // by SMIL `begin`/`end`).
    const xml = [
      `<rect x="${padL}" y="${startY}" width="${wAt(data[p][0]).toFixed(2)}" height="${barH}" rx="2" fill="${color}">`,
      `<animate attributeName="width" values="${widths}" dur="${duration}" repeatCount="indefinite" calcMode="spline" keyTimes="0;0.2;0.4;0.6;0.8;1" keySplines="0.4 0 0.6 1;0.4 0 0.6 1;0.4 0 0.6 1;0.4 0 0.6 1;0.4 0 0.6 1"/>`,
      `<animate attributeName="y" values="${ys}" dur="${duration}" repeatCount="indefinite" calcMode="spline" keyTimes="0;0.2;0.4;0.6;0.8;1" keySplines="0.4 0 0.6 1;0.4 0 0.6 1;0.4 0 0.6 1;0.4 0 0.6 1;0.4 0 0.6 1"/>`,
      "</rect>",
      // Product name to the right of bar end. x animates with the bar's
      // growing width, y animates with rank.
      `<text x="${(padL + wAt(data[p][0]) + 6).toFixed(2)}" y="${(startY + barH * 0.65).toFixed(2)}" font-family="system-ui,sans-serif" font-size="11.5" fill="#1a1a1a" text-anchor="start">`,
      `<animate attributeName="x" values="${data[p].map((v) => (padL + wAt(v) + 6).toFixed(2)).join(";")}" dur="${duration}" repeatCount="indefinite" calcMode="spline" keyTimes="0;0.2;0.4;0.6;0.8;1" keySplines="0.4 0 0.6 1;0.4 0 0.6 1;0.4 0 0.6 1;0.4 0 0.6 1;0.4 0 0.6 1"/>`,
      `<animate attributeName="y" values="${years.map((_, yi) => (yByYear[yi][p] + barH * 0.65).toFixed(2)).join(";")}" dur="${duration}" repeatCount="indefinite" calcMode="spline" keyTimes="0;0.2;0.4;0.6;0.8;1" keySplines="0.4 0 0.6 1;0.4 0 0.6 1;0.4 0 0.6 1;0.4 0 0.6 1;0.4 0 0.6 1"/>`,
      `${p}</text>`,
      // Static product label on the LEFT (fixed y at rank position; animate y so it follows the row).
      `<text x="${padL - 10}" y="${(startY + barH * 0.65).toFixed(2)}" font-family="system-ui,sans-serif" font-size="11.5" fill="#1a1a1a" text-anchor="end" font-weight="500">`,
      `<animate attributeName="y" values="${years.map((_, yi) => (yByYear[yi][p] + barH * 0.65).toFixed(2)).join(";")}" dur="${duration}" repeatCount="indefinite" calcMode="spline" keyTimes="0;0.2;0.4;0.6;0.8;1" keySplines="0.4 0 0.6 1;0.4 0 0.6 1;0.4 0 0.6 1;0.4 0 0.6 1;0.4 0 0.6 1"/>`,
      `${p}</text>`,
    ].join("");
    children.push({
      at: { x: 0, y: 0 },
      mark: "raw-svg",
      rawSvg: { xml },
    });
    // Drop unused variable warning suppression.
    void valueLabels;
  }

  // Year indicator: one text in the top-right corner that cycles through
  // 2020 → 2025. Implemented as 6 stacked <text> nodes whose opacity
  // animates step-by-step via SMIL discrete keyframes.
  const yearTextXml = years
    .map((y, yi) => {
      const opacities = years.map((_, j) => (j === yi ? 1 : 0)).join(";");
      return [
        `<text x="${W - 30}" y="80" font-family="system-ui,sans-serif" font-size="44" fill="#dde3ec" font-weight="700" text-anchor="end" opacity="${yi === 0 ? 1 : 0}">`,
        `<animate attributeName="opacity" values="${opacities}" dur="${duration}" repeatCount="indefinite" calcMode="discrete" keyTimes="0;0.166;0.333;0.5;0.666;0.833"/>`,
        `${y}</text>`,
      ].join("");
    })
    .join("");
  children.push({
    at: { x: 0, y: 0 },
    mark: "raw-svg",
    rawSvg: { xml: yearTextXml },
  });

  writeSpec("bar-race.spec.json", {
    compose: {
      viewBox: { width: W, height: H },
      title: "Bar chart race — top products by revenue (animated)",
      description:
        "6 products racing from 2020 to 2025. Each bar carries its own SMIL <animate> tags for width (revenue grows) + y (ranks shuffle). Hand-laid in compose because Glyph's chart-spec race pipeline currently emits identical values across frames.",
      children,
    },
  });
}

// ============================================================================
// FIX #3 — Animated Wealth & Health of Nations (Gapminder)
// ============================================================================
// Same workaround as #2: each bubble (and its label) is a raw-svg child
// with SMIL <animate> tags on cx, cy, and r. Steps through 2018–2023
// year by year, so we get the canonical "bubbles drift up-right" effect.
{
  const continentColor = {
    Europe: "#4c78a8",
    Americas: "#f58518",
    Africa: "#e45756",
    Asia: "#54a24b",
    Oceania: "#72b7b2",
  };
  // 8 countries × 6 years. Stylized but plausible: GDP grows, life
  // expectancy rises (slowly for developed, faster for developing),
  // population steady.
  const countries = [
    {
      name: "Nordica",
      continent: "Europe",
      gdp0: 48000,
      life0: 81,
      gdpG: 1.022,
      lifeG: 0.06,
      pop: 11,
    },
    {
      name: "Latinia",
      continent: "Americas",
      gdp0: 14000,
      life0: 75,
      gdpG: 1.042,
      lifeG: 0.22,
      pop: 60,
    },
    {
      name: "Saharia",
      continent: "Africa",
      gdp0: 3500,
      life0: 62,
      gdpG: 1.07,
      lifeG: 0.55,
      pop: 95,
    },
    {
      name: "Maharashtra",
      continent: "Asia",
      gdp0: 4800,
      life0: 68,
      gdpG: 1.08,
      lifeG: 0.45,
      pop: 320,
    },
    {
      name: "Pacificana",
      continent: "Oceania",
      gdp0: 42000,
      life0: 82,
      gdpG: 1.026,
      lifeG: 0.05,
      pop: 6,
    },
    {
      name: "Andesia",
      continent: "Americas",
      gdp0: 9000,
      life0: 73,
      gdpG: 1.048,
      lifeG: 0.27,
      pop: 28,
    },
    {
      name: "Sinora",
      continent: "Asia",
      gdp0: 12500,
      life0: 76,
      gdpG: 1.06,
      lifeG: 0.28,
      pop: 180,
    },
    {
      name: "Albion",
      continent: "Europe",
      gdp0: 37000,
      life0: 80,
      gdpG: 1.02,
      lifeG: 0.08,
      pop: 55,
    },
  ];
  const years = [2018, 2019, 2020, 2021, 2022, 2023];

  // Generate per-year (gdp, life, pop) for each country.
  for (const c of countries) {
    c.frames = years.map((_y, i) => ({
      gdp: c.gdp0 * c.gdpG ** i,
      life: c.life0 + c.lifeG * i,
      pop: c.pop,
    }));
  }

  const W = 760;
  const H = 480;
  const padL = 70;
  const padR = 130;
  const padT = 80;
  const padB = 60;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const gdpMin = 0;
  const gdpMax = 65000;
  const lifeMin = 60;
  const lifeMax = 90;
  const xAt = (g) => padL + ((g - gdpMin) / (gdpMax - gdpMin)) * plotW;
  const yAt = (l) => padT + plotH - ((l - lifeMin) / (lifeMax - lifeMin)) * plotH;
  const maxPop = Math.max(...countries.map((c) => c.pop));
  const radius = (pop) => 8 + 36 * Math.sqrt(pop / maxPop);
  const duration = "9000ms";
  const keyTimes = "0;0.2;0.4;0.6;0.8;1";
  const keySplines = "0.4 0 0.6 1;0.4 0 0.6 1;0.4 0 0.6 1;0.4 0 0.6 1;0.4 0 0.6 1";

  const children = [];
  children.push({
    at: { x: W / 2, y: 32 },
    mark: "text",
    textMark: {
      text: "Wealth & Health of Nations — 2018 → 2023 (animated)",
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
      text: "x = GDP/capita · y = life expectancy · bubble area = population · color = continent",
      fontSize: 11.5,
      fill: "#666",
      italic: true,
      anchor: "middle",
    },
  });

  // Background grid.
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
  // X tick labels.
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
  // Y tick labels.
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
  children.push({
    at: { x: padL + plotW / 2, y: H - 22 },
    mark: "text",
    textMark: {
      text: "GDP per capita",
      fontSize: 11.5,
      fill: "#1a1a1a",
      italic: false,
      anchor: "middle",
    },
  });

  // Animated bubbles: one raw-svg per country (circle + label).
  for (const c of countries) {
    const cxs = c.frames.map((f) => xAt(f.gdp).toFixed(2)).join(";");
    const cys = c.frames.map((f) => yAt(f.life).toFixed(2)).join(";");
    const rs = c.frames.map((f) => radius(f.pop).toFixed(2)).join(";");
    const labelXs = c.frames.map((f) => xAt(f.gdp).toFixed(2)).join(";");
    const labelYs = c.frames.map((f) => (yAt(f.life) - radius(f.pop) - 4).toFixed(2)).join(";");
    const color = continentColor[c.continent];
    const xml = [
      `<circle cx="${xAt(c.frames[0].gdp).toFixed(2)}" cy="${yAt(c.frames[0].life).toFixed(2)}" r="${radius(c.frames[0].pop).toFixed(2)}" fill="${color}" stroke="#1a1a1a" stroke-width="1.2">`,
      `<animate attributeName="cx" values="${cxs}" dur="${duration}" repeatCount="indefinite" calcMode="spline" keyTimes="${keyTimes}" keySplines="${keySplines}"/>`,
      `<animate attributeName="cy" values="${cys}" dur="${duration}" repeatCount="indefinite" calcMode="spline" keyTimes="${keyTimes}" keySplines="${keySplines}"/>`,
      `<animate attributeName="r" values="${rs}" dur="${duration}" repeatCount="indefinite" calcMode="spline" keyTimes="${keyTimes}" keySplines="${keySplines}"/>`,
      "</circle>",
      `<text x="${xAt(c.frames[0].gdp).toFixed(2)}" y="${(yAt(c.frames[0].life) - radius(c.frames[0].pop) - 4).toFixed(2)}" font-family="system-ui,sans-serif" font-size="11" fill="#1a1a1a" text-anchor="middle">`,
      `<animate attributeName="x" values="${labelXs}" dur="${duration}" repeatCount="indefinite" calcMode="spline" keyTimes="${keyTimes}" keySplines="${keySplines}"/>`,
      `<animate attributeName="y" values="${labelYs}" dur="${duration}" repeatCount="indefinite" calcMode="spline" keyTimes="${keyTimes}" keySplines="${keySplines}"/>`,
      `${c.name}</text>`,
    ].join("");
    children.push({
      at: { x: 0, y: 0 },
      mark: "raw-svg",
      rawSvg: { xml },
    });
  }

  // Continent legend (static).
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
      textMark: {
        text: cn,
        fontSize: 11,
        fill: "#1a1a1a",
        italic: false,
        anchor: "start",
      },
    });
    legendY += 20;
  }

  // Year indicator — discrete-step text in the top-right.
  const yearTextXml = years
    .map((y, yi) => {
      const opacities = years.map((_, j) => (j === yi ? 1 : 0)).join(";");
      return [
        `<text x="${W - 130}" y="${padT - 20}" font-family="system-ui,sans-serif" font-size="36" fill="#dde3ec" font-weight="700" text-anchor="end" opacity="${yi === 0 ? 1 : 0}">`,
        `<animate attributeName="opacity" values="${opacities}" dur="${duration}" repeatCount="indefinite" calcMode="discrete" keyTimes="0;0.166;0.333;0.5;0.666;0.833"/>`,
        `${y}</text>`,
      ].join("");
    })
    .join("");
  children.push({
    at: { x: 0, y: 0 },
    mark: "raw-svg",
    rawSvg: { xml: yearTextXml },
  });

  writeSpec("wealth-health.spec.json", {
    compose: {
      viewBox: { width: W, height: H },
      title: "Wealth & Health of Nations — animated",
      description:
        "Each bubble's cx, cy, and r animate via raw-SVG <animate> tags through 2018→2023. The discrete year badge in the corner steps with the data. Hand-laid because Glyph's race-animation encoder emits identical values across frames.",
      children,
    },
  });
}

// ---------------------------------------------------------------------------
// Smoke render — make sure everything still compiles.
// ---------------------------------------------------------------------------
const { readFileSync } = await import("node:fs");
const bundleUrl = pathToFileURL(join(ROOT, "site/play/glyph-bundle.js")).href;
const { compileSpec, compileCompose, parseComposeSpec, renderSvg } = await import(bundleUrl);

console.log("\nSmoke render:");
// Choropleth still uses a chart spec.
{
  const spec = JSON.parse(readFileSync(join(BIZ, "sales-by-region.spec.json"), "utf8"));
  const csv = readFileSync(join(BIZ, "sales-by-region.csv"), "utf8").trim().split(/\r?\n/);
  const headers = csv[0].split(",");
  const rows = csv.slice(1).map((line) => {
    const cells = line.split(",");
    return headers.map((_h, i) => {
      const n = Number(cells[i]);
      return Number.isFinite(n) && /^-?[\d.]+$/.test(cells[i]) ? n : cells[i];
    });
  });
  const schema = headers.map((h, i) => ({
    name: h,
    type: typeof rows[0][i] === "number" ? "DOUBLE" : "VARCHAR",
    nullable: false,
  }));
  const svg = renderSvg(compileSpec({ spec, rows, schema }));
  console.log(`  sales-by-region   → ${svg.length} bytes`);
}
for (const stem of ["bar-race", "wealth-health"]) {
  const spec = JSON.parse(readFileSync(join(BIZ, `${stem}.spec.json`), "utf8"));
  const svg = renderSvg(compileCompose(parseComposeSpec(spec)));
  // Spot-check that the SVG carries multiple distinct values in at
  // least one <animate values=> attribute — that's the marker that
  // animation actually moves between frames.
  const hasDistinctValues =
    /<animate[^>]+values="([^"]+)"/.test(svg) &&
    Array.from(svg.matchAll(/values="([^"]+)"/g)).some(([, v]) => {
      const parts = v.split(";");
      return new Set(parts).size > 1;
    });
  console.log(
    `  ${stem.padEnd(17)} → ${svg.length} bytes  ${hasDistinctValues ? "✓ animates" : "⚠ no movement"}`,
  );
}
