#!/usr/bin/env node
// Four canonical Whyboard templates — the answers to the four
// questions agents most often need to explain. Each renders as a
// compose scene showing the kind of tree `glyph_whyboard` returns:
// a root + three diagnostic branches (anomaly, decompose, forecast),
// each leaf carrying a real DataHandle URI.
//
//   1. revenue-miss      "Why did Q3 revenue miss target?"
//   2. conversion-drop   "Why did conversion drop last week?"
//   3. latency-spike     "Why is API latency spiking?"
//   4. churn-spike       "Why did churn spike this month?"
//
// The rides spike template ships separately as sample-whyboard.json;
// these four extend the catalog into the most-requested incident /
// review scenarios.
//
// Run from repo root:
//   node scripts/gen-whyboard-templates.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "site/play/examples/whyboard");
mkdirSync(OUT, { recursive: true });

function writeSpec(name, spec) {
  writeFileSync(join(OUT, name), `${JSON.stringify(spec, null, 2)}\n`);
}

/**
 * Shared whyboard layout. Each template provides:
 *   - question:   one line at the top
 *   - root:       { kind label, headline, subline, raw-svg chart }
 *   - branches:   [{ kind, color, headline, subline, raw-svg chart, uri }]
 *   - footer:     the MCP invocation snippet
 *
 * Layout matches sample-whyboard.json (rides spike) so the templates
 * read as a family.
 */
function buildWhyboard({ question, root, branches, footer }) {
  const W = 1200;
  const H = 760;
  const children = [];

  // Question line.
  children.push({
    at: { x: W / 2, y: 32 },
    mark: "text",
    textMark: {
      text: `User: "${question}"`,
      fontSize: 14,
      fill: "#4a3f30",
      italic: true,
      anchor: "middle",
    },
  });

  // Root card chrome.
  children.push({
    at: { x: 60, y: 60 },
    mark: "raw-svg",
    rawSvg: {
      xml: `<rect x="0" y="0" width="1080" height="220" rx="12" fill="#ffffff" stroke="#e6e6e6" stroke-width="1"/><rect x="16" y="16" width="54" height="20" rx="4" fill="#4c78a8"/><text x="43" y="30" font-family="system-ui, sans-serif" font-size="11" fill="#ffffff" text-anchor="middle" font-weight="600" letter-spacing="0.04em">ROOT</text><text x="82" y="31" font-family="system-ui, sans-serif" font-size="15" fill="#1a1a1a" font-weight="600">${root.headline}</text><text x="16" y="54" font-family="system-ui, sans-serif" font-size="11.5" fill="#666">${root.subline}</text>`,
    },
  });

  // Root mini-chart sits inside the root card.
  children.push({
    at: { x: 90, y: 130 },
    mark: "raw-svg",
    rawSvg: { xml: root.chartXml },
  });

  // Tree connectors from root to 3 branches.
  children.push({
    at: { x: 0, y: 0 },
    mark: "silhouette-path",
    silhouettePath: {
      d: "M 600 282 L 240 310 M 600 282 L 600 310 M 600 282 L 960 310",
      fill: "none",
      stroke: "#bcc4cf",
      strokeWidth: 1.5,
    },
  });

  // Three branches.
  const branchPositions = [60, 420, 780];
  for (let i = 0; i < 3; i++) {
    const b = branches[i];
    const px = branchPositions[i];
    children.push({
      at: { x: px, y: 318 },
      mark: "raw-svg",
      rawSvg: {
        xml: `<rect x="0" y="0" width="340" height="360" rx="10" fill="#ffffff" stroke="#e6e6e6"/><rect x="16" y="16" width="${b.kind.length * 8 + 18}" height="20" rx="4" fill="${b.color}"/><text x="${(b.kind.length * 8 + 18) / 2 + 16}" y="30" font-family="system-ui, sans-serif" font-size="11" fill="#ffffff" text-anchor="middle" font-weight="600" letter-spacing="0.04em">${b.kind.toUpperCase()}</text><text x="16" y="68" font-family="system-ui, sans-serif" font-size="14" fill="#1a1a1a" font-weight="600">${b.headline1}</text>${
          b.headline2
            ? `<text x="16" y="88" font-family="system-ui, sans-serif" font-size="14" fill="#1a1a1a" font-weight="600">${b.headline2}</text>`
            : ""
        }<text x="16" y="${b.headline2 ? 112 : 92}" font-family="system-ui, sans-serif" font-size="11.5" fill="#666">${b.subline}</text><rect x="16" y="132" width="308" height="160" fill="#fafbfd" stroke="#eef0f4"/>${b.chartXml}<line x1="16" y1="310" x2="324" y2="310" stroke="#eee"/><text x="16" y="330" font-family="system-ui, sans-serif" font-size="11" fill="#666">relation: ${b.relation}</text><text x="16" y="346" font-family="ui-monospace, Menlo, monospace" font-size="10" fill="#888">${b.uri}</text>`,
      },
    });
  }

  // Footer.
  children.push({
    at: { x: 600, y: 712 },
    mark: "text",
    textMark: {
      text: footer,
      fontSize: 12,
      fill: "#4a3f30",
      italic: true,
      anchor: "middle",
    },
  });
  children.push({
    at: { x: 600, y: 736 },
    mark: "text",
    textMark: {
      text: "Deterministic · Auditable · Same source rows → same tree, every time.",
      fontSize: 11,
      fill: "#888",
      italic: true,
      anchor: "middle",
    },
  });

  return { viewBox: { width: W, height: H }, title: question, children };
}

// ===========================================================================
// 1. Revenue miss
// ===========================================================================
writeSpec("template-revenue-miss.json", {
  compose: buildWhyboard({
    question: "Why did Q3 revenue miss target?",
    root: {
      headline: "Q3 revenue $4.1M vs $5.0M target — 18% miss.",
      subline: "Source forecast · 8 quarters · confidence: high · gdf://rev/q3-source",
      // 8 quarters as bars; Q3 shortfall highlighted in red.
      chartXml:
        `<rect x="0" y="0" width="1020" height="140" fill="#fafbfd" stroke="#eef0f4"/>` +
        `<g fill="#aac1d8"><rect x="40" y="60" width="60" height="60"/><rect x="120" y="44" width="60" height="76"/><rect x="200" y="40" width="60" height="80"/><rect x="280" y="32" width="60" height="88"/><rect x="360" y="20" width="60" height="100"/><rect x="440" y="24" width="60" height="96"/></g>` +
        `<rect x="520" y="60" width="60" height="60" fill="#c0392b" stroke="#1a1a1a" stroke-width="1.5"/>` +
        `<rect x="600" y="38" width="60" height="82" fill="#aac1d8"/>` +
        `<line x1="30" y1="6" x2="900" y2="6" stroke="#1f7a39" stroke-dasharray="4,4"/>` +
        `<text x="910" y="10" font-family="system-ui, sans-serif" font-size="10" fill="#1f7a39">target $5M</text>` +
        `<line x1="20" y1="120" x2="900" y2="120" stroke="#ccc"/>` +
        `<text x="550" y="58" font-family="system-ui, sans-serif" font-size="11" fill="#c0392b" text-anchor="middle" font-weight="600">Q3 ↓</text>`,
    },
    branches: [
      {
        kind: "anomaly",
        color: "#c0392b",
        headline1: "APAC tier-1 down 31%",
        subline: "outlier · 3.1σ from rolling-4Q mean",
        relation: "filter",
        uri: "gdf://rev/a-apac-tier1",
        chartXml:
          `<line x1="16" y1="212" x2="324" y2="212" stroke="#e6e6e6" stroke-dasharray="2,3"/>` +
          `<g fill="#aac1d8"><circle cx="50" cy="208" r="3"/><circle cx="80" cy="214" r="3"/><circle cx="110" cy="206" r="3"/><circle cx="140" cy="212" r="3"/><circle cx="170" cy="210" r="3"/><circle cx="200" cy="214" r="3"/><circle cx="230" cy="208" r="3"/><circle cx="260" cy="216" r="3"/></g>` +
          `<circle cx="295" cy="272" r="6" fill="#c0392b" stroke="#1a1a1a" stroke-width="1.5"/>` +
          `<text x="295" y="260" font-family="system-ui, sans-serif" font-size="10" fill="#c0392b" text-anchor="middle" font-weight="600">APAC ↓</text>`,
      },
      {
        kind: "decompose",
        color: "#d4a017",
        headline1: "Region explains 64% of variance.",
        subline: "Top factor: region (η² 0.64) · segment 0.22",
        relation: "agg",
        uri: "gdf://rev/d-region",
        chartXml:
          `<text x="32" y="180" font-family="system-ui, sans-serif" font-size="12" fill="#333">region</text>` +
          `<rect x="100" y="166" width="200" height="22" fill="#d4a017"/>` +
          `<text x="310" y="182" font-family="system-ui, sans-serif" font-size="11" fill="#ffffff" text-anchor="end" font-weight="600">64%</text>` +
          `<text x="32" y="232" font-family="system-ui, sans-serif" font-size="12" fill="#333">segment</text>` +
          `<rect x="100" y="218" width="68" height="22" fill="#e8d09b"/>` +
          `<text x="174" y="234" font-family="system-ui, sans-serif" font-size="11" fill="#7a6730" font-weight="600">22%</text>` +
          `<text x="32" y="272" font-family="system-ui, sans-serif" font-size="12" fill="#333">other</text>` +
          `<rect x="100" y="258" width="44" height="22" fill="#f2e3b9"/>` +
          `<text x="150" y="274" font-family="system-ui, sans-serif" font-size="11" fill="#7a6730">14%</text>`,
      },
      {
        kind: "forecast",
        color: "#2ea84d",
        headline1: "Q4 forecast: $4.4M",
        headline2: "(below target $4.8M)",
        subline: "Holt-Winters · season=4 · residual σ 0.2M",
        relation: "transform",
        uri: "gdf://rev/f-q4",
        chartXml:
          `<path d="M 30 240 L 70 220 L 110 230 L 150 215 L 190 205 L 210 195" fill="none" stroke="#4c78a8" stroke-width="2.5"/>` +
          `<path d="M 210 170 L 305 160 L 305 220 L 210 200 Z" fill="#d4edda" opacity="0.65"/>` +
          `<path d="M 210 185 L 305 190" fill="none" stroke="#2ea84d" stroke-width="2.5" stroke-dasharray="5,3"/>` +
          `<line x1="210" y1="140" x2="210" y2="285" stroke="#bbb" stroke-dasharray="2,3"/>` +
          `<line x1="20" y1="172" x2="320" y2="172" stroke="#1f7a39" stroke-dasharray="3,3"/>` +
          `<text x="218" y="152" font-family="system-ui, sans-serif" font-size="10" fill="#2ea84d" font-weight="600">Q4 forecast ↓</text>` +
          `<text x="320" y="170" font-family="system-ui, sans-serif" font-size="9" fill="#1f7a39" text-anchor="end">target</text>`,
      },
    ],
    footer:
      'glyph_whyboard({ handle: "rev_q3", question: "Why did Q3 revenue miss target?", link_group: "qbr-q3" }) → one tree.',
  }),
});

// ===========================================================================
// 2. Conversion drop
// ===========================================================================
writeSpec("template-conversion-drop.json", {
  compose: buildWhyboard({
    question: "Why did conversion drop last week?",
    root: {
      headline: "Sign-up conversion fell from 8.2% to 5.4% (−34%).",
      subline: "Source funnel · 7 days · confidence: high · gdf://conv/week-source",
      chartXml:
        `<rect x="0" y="0" width="1020" height="140" fill="#fafbfd" stroke="#eef0f4"/>` +
        `<g fill="#aac1d8"><rect x="40" y="40" width="60" height="80"/><rect x="120" y="36" width="60" height="84"/><rect x="200" y="42" width="60" height="78"/><rect x="280" y="40" width="60" height="80"/><rect x="360" y="38" width="60" height="82"/></g>` +
        `<rect x="440" y="70" width="60" height="50" fill="#c0392b" stroke="#1a1a1a" stroke-width="1.5"/>` +
        `<rect x="520" y="72" width="60" height="48" fill="#c0392b" stroke="#1a1a1a" stroke-width="1.5"/>` +
        `<line x1="20" y1="120" x2="600" y2="120" stroke="#ccc"/>` +
        `<text x="470" y="64" font-family="system-ui, sans-serif" font-size="11" fill="#c0392b" text-anchor="middle" font-weight="600">drop</text>` +
        `<text x="20" y="135" font-family="system-ui, sans-serif" font-size="10" fill="#666">M  T  W  Th  F  Sa  Su</text>`,
    },
    branches: [
      {
        kind: "anomaly",
        color: "#c0392b",
        headline1: "Bounce rate jumped",
        headline2: "+18 pp on landing page",
        subline: "outlier · 4.2σ from baseline",
        relation: "filter",
        uri: "gdf://conv/a-bounce",
        chartXml:
          `<g fill="#aac1d8"><rect x="30" y="200" width="20" height="60"/><rect x="60" y="195" width="20" height="65"/><rect x="90" y="205" width="20" height="55"/><rect x="120" y="200" width="20" height="60"/><rect x="150" y="195" width="20" height="65"/></g>` +
          `<rect x="180" y="140" width="20" height="120" fill="#c0392b" stroke="#1a1a1a" stroke-width="1.5"/>` +
          `<rect x="210" y="145" width="20" height="115" fill="#c0392b" stroke="#1a1a1a" stroke-width="1.5"/>` +
          `<text x="200" y="132" font-family="system-ui, sans-serif" font-size="10" fill="#c0392b" text-anchor="middle" font-weight="600">+18 pp</text>`,
      },
      {
        kind: "decompose",
        color: "#d4a017",
        headline1: "Device explains 58% of drop.",
        subline: "Mobile down 62% · desktop −8% · tablet flat",
        relation: "agg",
        uri: "gdf://conv/d-device",
        chartXml:
          `<text x="32" y="180" font-family="system-ui, sans-serif" font-size="12" fill="#333">mobile</text>` +
          `<rect x="100" y="166" width="180" height="22" fill="#d4a017"/>` +
          `<text x="290" y="182" font-family="system-ui, sans-serif" font-size="11" fill="#ffffff" text-anchor="end" font-weight="600">58%</text>` +
          `<text x="32" y="232" font-family="system-ui, sans-serif" font-size="12" fill="#333">desktop</text>` +
          `<rect x="100" y="218" width="74" height="22" fill="#e8d09b"/>` +
          `<text x="180" y="234" font-family="system-ui, sans-serif" font-size="11" fill="#7a6730" font-weight="600">24%</text>` +
          `<text x="32" y="272" font-family="system-ui, sans-serif" font-size="12" fill="#333">tablet</text>` +
          `<rect x="100" y="258" width="56" height="22" fill="#f2e3b9"/>` +
          `<text x="162" y="274" font-family="system-ui, sans-serif" font-size="11" fill="#7a6730">18%</text>`,
      },
      {
        kind: "forecast",
        color: "#2ea84d",
        headline1: "Next 7-day forecast: 5.7%",
        headline2: "(if mobile bug not fixed)",
        subline: "ARIMA(1,1,1) · residual σ 0.4%",
        relation: "transform",
        uri: "gdf://conv/f-7day",
        chartXml:
          `<path d="M 30 200 L 60 195 L 90 210 L 120 215 L 150 220 L 180 240 L 210 250" fill="none" stroke="#4c78a8" stroke-width="2.5"/>` +
          `<path d="M 210 235 L 305 250 L 305 270 L 210 265 Z" fill="#d4edda" opacity="0.65"/>` +
          `<path d="M 210 250 L 305 258" fill="none" stroke="#2ea84d" stroke-width="2.5" stroke-dasharray="5,3"/>` +
          `<line x1="210" y1="140" x2="210" y2="285" stroke="#bbb" stroke-dasharray="2,3"/>` +
          `<text x="218" y="152" font-family="system-ui, sans-serif" font-size="10" fill="#2ea84d" font-weight="600">forecast →</text>`,
      },
    ],
    footer:
      'glyph_whyboard({ handle: "conv_w23", question: "Why did conversion drop last week?", link_group: "growth-w23" }) → one tree.',
  }),
});

// ===========================================================================
// 3. Latency spike
// ===========================================================================
writeSpec("template-latency-spike.json", {
  compose: buildWhyboard({
    question: "Why is API latency spiking?",
    root: {
      headline: "p95 latency jumped 145ms → 480ms at 14:22 UTC.",
      subline: "Source latency · 24h window · confidence: high · gdf://lat/source",
      chartXml:
        `<rect x="0" y="0" width="1020" height="140" fill="#fafbfd" stroke="#eef0f4"/>` +
        `<path d="M 30 100 L 60 102 L 90 96 L 120 100 L 150 98 L 180 102 L 210 100 L 240 105 L 270 102 L 300 100 L 330 98 L 360 104 L 390 102 L 420 98 L 450 100 L 480 102 L 510 100 L 540 98 L 570 100 L 600 96 L 630 30" fill="none" stroke="#4c78a8" stroke-width="2"/>` +
        `<path d="M 630 30 L 660 35 L 690 25 L 720 38 L 750 22 L 780 30 L 810 28 L 840 25 L 870 20 L 900 24" fill="none" stroke="#c0392b" stroke-width="2.5"/>` +
        `<circle cx="630" cy="30" r="6" fill="#c0392b" stroke="#1a1a1a" stroke-width="1.5"/>` +
        `<line x1="630" y1="6" x2="630" y2="120" stroke="#c0392b" stroke-dasharray="3,3"/>` +
        `<text x="635" y="20" font-family="system-ui, sans-serif" font-size="11" fill="#c0392b" font-weight="600">14:22 UTC ↑</text>` +
        `<line x1="20" y1="120" x2="900" y2="120" stroke="#ccc"/>` +
        `<text x="930" y="10" font-family="system-ui, sans-serif" font-size="10" fill="#666">500ms</text>` +
        `<text x="930" y="125" font-family="system-ui, sans-serif" font-size="10" fill="#666">0ms</text>`,
    },
    branches: [
      {
        kind: "anomaly",
        color: "#c0392b",
        headline1: "/search +320ms,",
        headline2: "/feed +180ms",
        subline: "2 endpoints · 3.8σ above baseline",
        relation: "filter",
        uri: "gdf://lat/a-endpoints",
        chartXml:
          `<g><text x="32" y="180" font-family="system-ui, sans-serif" font-size="11" fill="#333">/search</text>` +
          `<rect x="100" y="170" width="200" height="14" fill="#c0392b"/>` +
          `<text x="305" y="180" font-family="system-ui, sans-serif" font-size="10" fill="#c0392b" font-weight="600">+320ms</text></g>` +
          `<g><text x="32" y="210" font-family="system-ui, sans-serif" font-size="11" fill="#333">/feed</text>` +
          `<rect x="100" y="200" width="120" height="14" fill="#c0392b"/>` +
          `<text x="225" y="210" font-family="system-ui, sans-serif" font-size="10" fill="#c0392b" font-weight="600">+180ms</text></g>` +
          `<g><text x="32" y="240" font-family="system-ui, sans-serif" font-size="11" fill="#333">/me</text>` +
          `<rect x="100" y="230" width="14" height="14" fill="#aac1d8"/>` +
          `<text x="119" y="240" font-family="system-ui, sans-serif" font-size="10" fill="#666">+5ms</text></g>` +
          `<g><text x="32" y="270" font-family="system-ui, sans-serif" font-size="11" fill="#333">/report</text>` +
          `<rect x="100" y="260" width="22" height="14" fill="#aac1d8"/>` +
          `<text x="127" y="270" font-family="system-ui, sans-serif" font-size="10" fill="#666">+8ms</text></g>`,
      },
      {
        kind: "decompose",
        color: "#d4a017",
        headline1: "DB query time explains 78%.",
        subline: "Top factor: db_p95 (η² 0.78) · net 0.12",
        relation: "agg",
        uri: "gdf://lat/d-db",
        chartXml:
          `<text x="32" y="180" font-family="system-ui, sans-serif" font-size="12" fill="#333">db_p95</text>` +
          `<rect x="100" y="166" width="234" height="22" fill="#d4a017"/>` +
          `<text x="324" y="182" font-family="system-ui, sans-serif" font-size="11" fill="#ffffff" text-anchor="end" font-weight="600">78%</text>` +
          `<text x="32" y="232" font-family="system-ui, sans-serif" font-size="12" fill="#333">net_rtt</text>` +
          `<rect x="100" y="218" width="36" height="22" fill="#e8d09b"/>` +
          `<text x="142" y="234" font-family="system-ui, sans-serif" font-size="11" fill="#7a6730">12%</text>` +
          `<text x="32" y="272" font-family="system-ui, sans-serif" font-size="12" fill="#333">cache</text>` +
          `<rect x="100" y="258" width="30" height="22" fill="#f2e3b9"/>` +
          `<text x="136" y="274" font-family="system-ui, sans-serif" font-size="11" fill="#7a6730">10%</text>`,
      },
      {
        kind: "forecast",
        color: "#2ea84d",
        headline1: "Recovery ETA: ~22 min",
        headline2: "(if cache backfill stays nominal)",
        subline: "exponential decay · half-life 8 min",
        relation: "transform",
        uri: "gdf://lat/f-recovery",
        chartXml:
          `<path d="M 30 30 L 50 25 L 70 32 L 90 28 L 110 35 L 130 30 L 150 25 L 170 30 L 190 28 L 210 30" fill="none" stroke="#4c78a8" stroke-width="2.5"/>` +
          `<path d="M 210 30 L 230 60 L 250 100 L 270 140 L 290 180 L 310 220 L 320 240" fill="none" stroke="#2ea84d" stroke-width="2.5" stroke-dasharray="5,3"/>` +
          `<line x1="210" y1="140" x2="210" y2="285" stroke="#bbb" stroke-dasharray="2,3"/>` +
          `<line x1="20" y1="240" x2="320" y2="240" stroke="#1f7a39" stroke-dasharray="3,3"/>` +
          `<text x="218" y="42" font-family="system-ui, sans-serif" font-size="10" fill="#2ea84d" font-weight="600">recovery ↓</text>` +
          `<text x="320" y="238" font-family="system-ui, sans-serif" font-size="9" fill="#1f7a39" text-anchor="end">SLO</text>`,
      },
    ],
    footer:
      'glyph_whyboard({ handle: "lat_now", question: "Why is API latency spiking?", link_group: "incident-1422" }) → one tree.',
  }),
});

// ===========================================================================
// 4. Churn spike
// ===========================================================================
writeSpec("template-churn-spike.json", {
  compose: buildWhyboard({
    question: "Why did churn spike this month?",
    root: {
      headline: "Monthly churn rose 2.1% → 4.6% — 1.3-year recurrence.",
      subline: "Source subs · 13 months · confidence: high · gdf://churn/source",
      chartXml:
        `<rect x="0" y="0" width="1020" height="140" fill="#fafbfd" stroke="#eef0f4"/>` +
        `<g fill="#aac1d8"><rect x="40" y="90" width="60" height="30"/><rect x="120" y="92" width="60" height="28"/><rect x="200" y="88" width="60" height="32"/><rect x="280" y="90" width="60" height="30"/><rect x="360" y="86" width="60" height="34"/><rect x="440" y="92" width="60" height="28"/><rect x="520" y="88" width="60" height="32"/><rect x="600" y="86" width="60" height="34"/><rect x="680" y="90" width="60" height="30"/><rect x="760" y="92" width="60" height="28"/></g>` +
        `<rect x="840" y="38" width="60" height="82" fill="#c0392b" stroke="#1a1a1a" stroke-width="1.5"/>` +
        `<text x="870" y="32" font-family="system-ui, sans-serif" font-size="11" fill="#c0392b" text-anchor="middle" font-weight="600">+2.5pp</text>` +
        `<line x1="20" y1="120" x2="900" y2="120" stroke="#ccc"/>` +
        `<text x="930" y="120" font-family="system-ui, sans-serif" font-size="10" fill="#666">M-12 .. M</text>`,
    },
    branches: [
      {
        kind: "anomaly",
        color: "#c0392b",
        headline1: "Trial-to-paid drop:",
        headline2: "32% → 17% (−47%)",
        subline: "cohort outlier · 3.6σ",
        relation: "filter",
        uri: "gdf://churn/a-cohort",
        chartXml:
          `<g fill="#aac1d8"><circle cx="40" cy="200" r="3"/><circle cx="65" cy="195" r="3"/><circle cx="90" cy="202" r="3"/><circle cx="115" cy="198" r="3"/><circle cx="140" cy="200" r="3"/><circle cx="165" cy="195" r="3"/><circle cx="190" cy="200" r="3"/><circle cx="215" cy="202" r="3"/></g>` +
          `<circle cx="280" cy="260" r="6" fill="#c0392b" stroke="#1a1a1a" stroke-width="1.5"/>` +
          `<text x="280" y="248" font-family="system-ui, sans-serif" font-size="10" fill="#c0392b" text-anchor="middle" font-weight="600">17% ↓</text>`,
      },
      {
        kind: "decompose",
        color: "#d4a017",
        headline1: "Price-test cohort explains 71%.",
        subline: "Top factor: price_tier (η² 0.71) · region 0.12",
        relation: "agg",
        uri: "gdf://churn/d-price",
        chartXml:
          `<text x="32" y="180" font-family="system-ui, sans-serif" font-size="12" fill="#333">price tier</text>` +
          `<rect x="100" y="166" width="212" height="22" fill="#d4a017"/>` +
          `<text x="320" y="182" font-family="system-ui, sans-serif" font-size="11" fill="#ffffff" text-anchor="end" font-weight="600">71%</text>` +
          `<text x="32" y="232" font-family="system-ui, sans-serif" font-size="12" fill="#333">region</text>` +
          `<rect x="100" y="218" width="36" height="22" fill="#e8d09b"/>` +
          `<text x="142" y="234" font-family="system-ui, sans-serif" font-size="11" fill="#7a6730">12%</text>` +
          `<text x="32" y="272" font-family="system-ui, sans-serif" font-size="12" fill="#333">other</text>` +
          `<rect x="100" y="258" width="50" height="22" fill="#f2e3b9"/>` +
          `<text x="156" y="274" font-family="system-ui, sans-serif" font-size="11" fill="#7a6730">17%</text>`,
      },
      {
        kind: "forecast",
        color: "#2ea84d",
        headline1: "Next 3-month forecast: 4.2%",
        headline2: "(if price tier reverted)",
        subline: "Bayesian · MAP 4.2% · CI [3.7, 4.8]",
        relation: "transform",
        uri: "gdf://churn/f-3mo",
        chartXml:
          `<path d="M 30 80 L 60 78 L 90 84 L 120 80 L 150 78 L 180 84 L 210 50" fill="none" stroke="#4c78a8" stroke-width="2.5"/>` +
          `<path d="M 210 30 L 305 75 L 305 90 L 210 70 Z" fill="#d4edda" opacity="0.65"/>` +
          `<path d="M 210 50 L 305 85" fill="none" stroke="#2ea84d" stroke-width="2.5" stroke-dasharray="5,3"/>` +
          `<line x1="210" y1="140" x2="210" y2="285" stroke="#bbb" stroke-dasharray="2,3"/>` +
          `<text x="218" y="42" font-family="system-ui, sans-serif" font-size="10" fill="#2ea84d" font-weight="600">forecast →</text>`,
      },
    ],
    footer:
      'glyph_whyboard({ handle: "churn_mo", question: "Why did churn spike?", link_group: "growth-mo" }) → one tree.',
  }),
});

// ---------------------------------------------------------------------------
// Smoke render — every template must compile.
// ---------------------------------------------------------------------------
const { readFileSync } = await import("node:fs");
const bundleUrl = pathToFileURL(join(ROOT, "site/play/glyph-bundle.js")).href;
const { compileCompose, parseComposeSpec, renderSvg } = await import(bundleUrl);
console.log("\nSmoke render:");
for (const stem of [
  "template-revenue-miss",
  "template-conversion-drop",
  "template-latency-spike",
  "template-churn-spike",
]) {
  const spec = JSON.parse(readFileSync(join(OUT, `${stem}.json`), "utf8"));
  const svg = renderSvg(compileCompose(parseComposeSpec(spec)));
  console.log(`  ${stem.padEnd(28)} → ${svg.length} bytes`);
}
