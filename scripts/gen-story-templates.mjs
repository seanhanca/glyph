#!/usr/bin/env node
// Three canonical Story templates — multi-frame narrative storyboards
// that show what `glyph_story` produces. Each template lays out 4
// chart panels in sequence (left-to-right + wrap), with the narrative
// caption above each frame and the storyboard tag on the side.
//
//   1. quarterly-review   ARR snapshot → growth driver → forecast → next-quarter actions
//   2. incident-retro     incident timeline → impact → root cause → preventive action
//   3. ab-test-readout    setup → primary metric → segment cuts → recommendation
//
// Run from repo root:
//   node scripts/gen-story-templates.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "site/play/examples/stories");
mkdirSync(OUT, { recursive: true });

function writeSpec(name, spec) {
  writeFileSync(join(OUT, name), `${JSON.stringify(spec, null, 2)}\n`);
}

/**
 * 4-panel storyboard layout. Panels arranged 2×2.
 * Each panel: caption strip on top, chart area below.
 */
function buildStoryboard({ title, subtitle, panels, footer }) {
  const W = 1200;
  const H = 760;
  const children = [];

  // Title strip.
  children.push({
    at: { x: W / 2, y: 32 },
    mark: "text",
    textMark: {
      text: title,
      fontSize: 18,
      fill: "#1a1a1a",
      italic: false,
      anchor: "middle",
    },
  });
  children.push({
    at: { x: W / 2, y: 54 },
    mark: "text",
    textMark: {
      text: subtitle,
      fontSize: 12,
      fill: "#666",
      italic: true,
      anchor: "middle",
    },
  });

  // 2x2 panel grid. Each panel is 540 wide × 290 tall with 24px gap.
  const positions = [
    { x: 60, y: 90 },
    { x: 620, y: 90 },
    { x: 60, y: 400 },
    { x: 620, y: 400 },
  ];
  for (let i = 0; i < 4; i++) {
    const p = panels[i];
    const pos = positions[i];
    children.push({
      at: { x: pos.x, y: pos.y },
      mark: "raw-svg",
      rawSvg: {
        xml:
          // Panel chrome.
          `<rect x="0" y="0" width="520" height="290" rx="10" fill="#ffffff" stroke="#e6e6e6"/><rect x="14" y="14" width="32" height="20" rx="4" fill="${p.color}"/><text x="30" y="28" font-family="system-ui, sans-serif" font-size="11" fill="#ffffff" text-anchor="middle" font-weight="600">${i + 1}</text><text x="56" y="29" font-family="system-ui, sans-serif" font-size="14" fill="#1a1a1a" font-weight="600">${p.caption}</text><text x="14" y="50" font-family="system-ui, sans-serif" font-size="11.5" fill="#666">${p.subcaption}</text><rect x="14" y="64" width="492" height="210" fill="#fafbfd" stroke="#eef0f4"/>${p.chartXml}`,
      },
    });
  }

  // Footer.
  children.push({
    at: { x: W / 2, y: 712 },
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
    at: { x: W / 2, y: 736 },
    mark: "text",
    textMark: {
      text: "Deterministic · Auditable · One MCP call produces the full storyboard.",
      fontSize: 11,
      fill: "#888",
      italic: true,
      anchor: "middle",
    },
  });

  return { viewBox: { width: W, height: H }, title, children };
}

// ===========================================================================
// 1. Quarterly review
// ===========================================================================
writeSpec("template-quarterly-review.json", {
  compose: buildStoryboard({
    title: "Q3 Business Review — storyboard",
    subtitle: "glyph_story → 4-panel narrative · same MCP verb chain every quarter",
    panels: [
      {
        color: "#4c78a8",
        caption: "ARR landed at $14.2M",
        subcaption: "Up 18% YoY · just short of $14.6M target",
        chartXml:
          `<g fill="#aac1d8" transform="translate(40, 80)"><rect x="0" y="100" width="40" height="80"/><rect x="50" y="84" width="40" height="96"/><rect x="100" y="68" width="40" height="112"/><rect x="150" y="52" width="40" height="128"/><rect x="200" y="40" width="40" height="140"/><rect x="250" y="28" width="40" height="152"/><rect x="300" y="16" width="40" height="164"/></g>` +
          `<rect x="390" y="96" width="40" height="164" fill="#c0392b" stroke="#1a1a1a" stroke-width="1.5"/>` +
          `<text x="410" y="92" font-family="system-ui, sans-serif" font-size="10" fill="#c0392b" text-anchor="middle" font-weight="600">$14.2M</text>` +
          `<line x1="40" y1="92" x2="440" y2="92" stroke="#1f7a39" stroke-dasharray="4,4"/>` +
          `<text x="448" y="96" font-family="system-ui, sans-serif" font-size="10" fill="#1f7a39">target</text>`,
      },
      {
        color: "#d4a017",
        caption: "Mid-market drove all growth",
        subcaption: "Enterprise flat · SMB down 6% · MM +42%",
        chartXml:
          `<text x="60" y="120" font-family="system-ui, sans-serif" font-size="11" fill="#333">Mid-market</text>` +
          `<rect x="160" y="108" width="280" height="20" fill="#d4a017"/>` +
          `<text x="448" y="124" font-family="system-ui, sans-serif" font-size="11" fill="#ffffff" text-anchor="end" font-weight="600">+42%</text>` +
          `<text x="60" y="165" font-family="system-ui, sans-serif" font-size="11" fill="#333">Enterprise</text>` +
          `<rect x="160" y="153" width="20" height="20" fill="#e8d09b"/>` +
          `<text x="185" y="169" font-family="system-ui, sans-serif" font-size="10" fill="#7a6730">+1%</text>` +
          `<text x="60" y="210" font-family="system-ui, sans-serif" font-size="11" fill="#333">SMB</text>` +
          `<rect x="120" y="198" width="40" height="20" fill="#f4cfc7"/>` +
          `<text x="116" y="214" font-family="system-ui, sans-serif" font-size="10" fill="#c0392b" text-anchor="end" font-weight="600">−6%</text>`,
      },
      {
        color: "#54a24b",
        caption: "Q4 forecast: $16.8M",
        subcaption: "Holt-Winters · 90% CI [16.2, 17.4]",
        chartXml:
          `<path d="M 40 200 L 80 195 L 120 190 L 160 180 L 200 170 L 240 160" fill="none" stroke="#4c78a8" stroke-width="2.5"/>` +
          `<path d="M 240 145 L 320 130 L 320 170 L 240 175 Z" fill="#d4edda" opacity="0.65"/>` +
          `<path d="M 240 158 L 320 150" fill="none" stroke="#2ea84d" stroke-width="2.5" stroke-dasharray="5,3"/>` +
          `<line x1="240" y1="80" x2="240" y2="260" stroke="#bbb" stroke-dasharray="2,3"/>` +
          `<text x="248" y="95" font-family="system-ui, sans-serif" font-size="10" fill="#2ea84d" font-weight="600">Q4 →</text>` +
          `<text x="330" y="154" font-family="system-ui, sans-serif" font-size="11" fill="#2ea84d" font-weight="600">$16.8M</text>`,
      },
      {
        color: "#1a1a1a",
        caption: "Next quarter: 3 actions",
        subcaption: "Sales + retention + product · owners + ETAs assigned",
        chartXml:
          `<g font-family="system-ui, sans-serif"><text x="40" y="110" font-size="13" fill="#1a1a1a" font-weight="600">1. Hire 4 mid-market AEs</text>` +
          `<text x="40" y="128" font-size="11" fill="#666">Sasha · ETA Oct 15</text></g>` +
          `<g font-family="system-ui, sans-serif"><text x="40" y="160" font-size="13" fill="#1a1a1a" font-weight="600">2. SMB retention playbook</text>` +
          `<text x="40" y="178" font-size="11" fill="#666">Maya · ETA Oct 22</text></g>` +
          `<g font-family="system-ui, sans-serif"><text x="40" y="210" font-size="13" fill="#1a1a1a" font-weight="600">3. Compete v2 enablement</text>` +
          `<text x="40" y="228" font-size="11" fill="#666">Devon · ETA Nov 1</text></g>`,
      },
    ],
    footer:
      'glyph_story({ template: "quarterly-review", handle_id: "arr_q3" }) → 4-panel storyboard.',
  }),
});

// ===========================================================================
// 2. Incident retro
// ===========================================================================
writeSpec("template-incident-retro.json", {
  compose: buildStoryboard({
    title: "Incident Retro — INC-0847 · checkout 5xx spike",
    subtitle:
      "glyph_story → 4-panel post-incident review · timeline + impact + root cause + prevention",
    panels: [
      {
        color: "#c0392b",
        caption: "Timeline · 14:22 → 16:08 UTC",
        subcaption: "Detect 14:22 · ack 14:25 · mitigate 15:14 · resolve 16:08",
        chartXml:
          `<line x1="40" y1="170" x2="460" y2="170" stroke="#999" stroke-width="2"/>` +
          `<g><circle cx="60" cy="170" r="6" fill="#c0392b"/><text x="60" y="155" font-family="system-ui, sans-serif" font-size="10" fill="#1a1a1a" text-anchor="middle" font-weight="600">14:22</text><text x="60" y="195" font-family="system-ui, sans-serif" font-size="10" fill="#666" text-anchor="middle">detect</text></g>` +
          `<g><circle cx="160" cy="170" r="5" fill="#d4a017"/><text x="160" y="155" font-family="system-ui, sans-serif" font-size="10" fill="#1a1a1a" text-anchor="middle" font-weight="600">14:25</text><text x="160" y="195" font-family="system-ui, sans-serif" font-size="10" fill="#666" text-anchor="middle">ack</text></g>` +
          `<g><circle cx="290" cy="170" r="5" fill="#4c78a8"/><text x="290" y="155" font-family="system-ui, sans-serif" font-size="10" fill="#1a1a1a" text-anchor="middle" font-weight="600">15:14</text><text x="290" y="195" font-family="system-ui, sans-serif" font-size="10" fill="#666" text-anchor="middle">mitigate</text></g>` +
          `<g><circle cx="440" cy="170" r="6" fill="#1f7a39"/><text x="440" y="155" font-family="system-ui, sans-serif" font-size="10" fill="#1a1a1a" text-anchor="middle" font-weight="600">16:08</text><text x="440" y="195" font-family="system-ui, sans-serif" font-size="10" fill="#666" text-anchor="middle">resolve</text></g>` +
          `<text x="250" y="240" font-family="system-ui, sans-serif" font-size="11" fill="#666" text-anchor="middle" font-style="italic">total: 1h 46m · MTTM 52min</text>`,
      },
      {
        color: "#c0392b",
        caption: "Impact: 3,420 failed checkouts",
        subcaption: "~$84K GMV at risk · 12% of session volume",
        chartXml:
          `<g fill="#aac1d8"><rect x="40" y="180" width="40" height="80"/><rect x="90" y="170" width="40" height="90"/><rect x="140" y="172" width="40" height="88"/></g>` +
          `<rect x="190" y="92" width="40" height="168" fill="#c0392b" stroke="#1a1a1a" stroke-width="1.5"/>` +
          `<rect x="240" y="98" width="40" height="162" fill="#c0392b" stroke="#1a1a1a" stroke-width="1.5"/>` +
          `<g fill="#aac1d8"><rect x="290" y="170" width="40" height="90"/><rect x="340" y="172" width="40" height="88"/><rect x="390" y="170" width="40" height="90"/></g>` +
          `<text x="210" y="84" font-family="system-ui, sans-serif" font-size="11" fill="#c0392b" text-anchor="middle" font-weight="600">5xx spike</text>` +
          `<text x="40" y="280" font-family="system-ui, sans-serif" font-size="10" fill="#666">13h  14h  15h  16h  17h</text>`,
      },
      {
        color: "#d4a017",
        caption: "Root cause · cache config bug",
        subcaption: "Stale TTL drove repeat upstream calls · 78% of failures",
        chartXml:
          `<text x="40" y="115" font-family="system-ui, sans-serif" font-size="11" fill="#333">Cache TTL bug</text>` +
          `<rect x="160" y="102" width="252" height="22" fill="#d4a017"/>` +
          `<text x="420" y="118" font-family="system-ui, sans-serif" font-size="11" fill="#ffffff" text-anchor="end" font-weight="600">78%</text>` +
          `<text x="40" y="165" font-family="system-ui, sans-serif" font-size="11" fill="#333">DB pool exhausted</text>` +
          `<rect x="160" y="152" width="56" height="22" fill="#e8d09b"/>` +
          `<text x="220" y="168" font-family="system-ui, sans-serif" font-size="11" fill="#7a6730" font-weight="600">17%</text>` +
          `<text x="40" y="215" font-family="system-ui, sans-serif" font-size="11" fill="#333">other</text>` +
          `<rect x="160" y="202" width="20" height="22" fill="#f2e3b9"/>` +
          `<text x="185" y="218" font-family="system-ui, sans-serif" font-size="11" fill="#7a6730">5%</text>`,
      },
      {
        color: "#1a1a1a",
        caption: "Preventive actions · 3 follow-ups",
        subcaption: "Owners assigned · linked to JIRA epic PREV-217",
        chartXml:
          `<g font-family="system-ui, sans-serif"><text x="40" y="110" font-size="13" fill="#1a1a1a" font-weight="600">1. Cache-config validation in CI</text>` +
          `<text x="40" y="128" font-size="11" fill="#666">Priya · ETA Oct 18 · PREV-217.1</text></g>` +
          `<g font-family="system-ui, sans-serif"><text x="40" y="160" font-size="13" fill="#1a1a1a" font-weight="600">2. Runbook: stale-TTL detection</text>` +
          `<text x="40" y="178" font-size="11" fill="#666">Diego · ETA Oct 25 · PREV-217.2</text></g>` +
          `<g font-family="system-ui, sans-serif"><text x="40" y="210" font-size="13" fill="#1a1a1a" font-weight="600">3. DB pool size alarm at 80%</text>` +
          `<text x="40" y="228" font-size="11" fill="#666">Sasha · ETA Nov 1 · PREV-217.3</text></g>`,
      },
    ],
    footer:
      'glyph_story({ template: "incident-retro", handle_id: "inc_0847" }) → 4-panel storyboard.',
  }),
});

// ===========================================================================
// 3. A/B test readout
// ===========================================================================
writeSpec("template-ab-test-readout.json", {
  compose: buildStoryboard({
    title: "A/B test readout — EXP-114 · new checkout flow",
    subtitle:
      "glyph_story → 4-panel experiment summary · setup + primary + segments + recommendation",
    panels: [
      {
        color: "#4c78a8",
        caption: "Setup",
        subcaption: "Control vs new checkout · 14-day run · 50/50 split",
        chartXml:
          `<g font-family="system-ui, sans-serif"><text x="40" y="110" font-size="12" fill="#1a1a1a"><tspan font-weight="600">Sample size</tspan>: 184,210 users (92,105 / arm)</text>` +
          `<text x="40" y="138" font-size="12" fill="#1a1a1a"><tspan font-weight="600">Primary metric</tspan>: checkout conversion %</text>` +
          `<text x="40" y="166" font-size="12" fill="#1a1a1a"><tspan font-weight="600">Power</tspan>: 80% to detect ±0.5 pp</text>` +
          `<text x="40" y="194" font-size="12" fill="#1a1a1a"><tspan font-weight="600">Window</tspan>: 2025-09-01 → 2025-09-14</text>` +
          `<text x="40" y="222" font-size="12" fill="#1a1a1a"><tspan font-weight="600">Owner</tspan>: growth-experiments@</text></g>`,
      },
      {
        color: "#1f7a39",
        caption: "Primary: +0.84 pp (p < 0.001)",
        subcaption: "Control 7.2% · Variant 8.04% · 95% CI [+0.42, +1.26]",
        chartXml:
          `<g><text x="60" y="120" font-family="system-ui, sans-serif" font-size="11" fill="#333">Control</text>` +
          `<rect x="160" y="106" width="170" height="22" fill="#aac1d8"/>` +
          `<text x="338" y="122" font-family="system-ui, sans-serif" font-size="11" fill="#1a1a1a">7.20%</text></g>` +
          `<g><text x="60" y="170" font-family="system-ui, sans-serif" font-size="11" fill="#333">Variant</text>` +
          `<rect x="160" y="156" width="190" height="22" fill="#1f7a39"/>` +
          `<text x="358" y="172" font-family="system-ui, sans-serif" font-size="11" fill="#1a1a1a" font-weight="600">8.04%</text></g>` +
          `<text x="100" y="220" font-family="system-ui, sans-serif" font-size="11" fill="#1f7a39" font-weight="600" text-anchor="start">95% CI [+0.42, +1.26 pp]</text>` +
          `<text x="100" y="240" font-family="system-ui, sans-serif" font-size="10" fill="#666" text-anchor="start">p &lt; 0.001 · two-sided t-test</text>`,
      },
      {
        color: "#d4a017",
        caption: "Segments · effect concentrated mobile",
        subcaption: "Mobile +1.6pp · desktop +0.4pp · tablet +0.2pp",
        chartXml:
          `<text x="40" y="120" font-family="system-ui, sans-serif" font-size="11" fill="#333">Mobile</text>` +
          `<rect x="160" y="108" width="240" height="20" fill="#1f7a39"/>` +
          `<text x="408" y="122" font-family="system-ui, sans-serif" font-size="11" fill="#1f7a39" font-weight="600">+1.6 pp</text>` +
          `<text x="40" y="170" font-family="system-ui, sans-serif" font-size="11" fill="#333">Desktop</text>` +
          `<rect x="160" y="158" width="60" height="20" fill="#88c182"/>` +
          `<text x="228" y="172" font-family="system-ui, sans-serif" font-size="11" fill="#1f7a39">+0.4 pp</text>` +
          `<text x="40" y="220" font-family="system-ui, sans-serif" font-size="11" fill="#333">Tablet</text>` +
          `<rect x="160" y="208" width="30" height="20" fill="#aedab7"/>` +
          `<text x="198" y="222" font-family="system-ui, sans-serif" font-size="11" fill="#666">+0.2 pp</text>`,
      },
      {
        color: "#1f7a39",
        caption: "Recommendation: SHIP to mobile, hold desktop",
        subcaption: "Projected +$2.1M ARR · revisit desktop after dark-mode launch",
        chartXml:
          `<g font-family="system-ui, sans-serif"><rect x="40" y="86" width="440" height="44" rx="6" fill="#eaf6ee" stroke="#1f7a39"/>` +
          `<text x="56" y="108" font-size="12" fill="#1f7a39" font-weight="600">✓ Ship variant to 100% mobile</text>` +
          `<text x="56" y="124" font-size="11" fill="#1f7a39">Rollout: 25% Mon, 50% Wed, 100% Fri.</text></g>` +
          `<g font-family="system-ui, sans-serif"><rect x="40" y="148" width="440" height="44" rx="6" fill="#fbf2d8" stroke="#d4a017"/>` +
          `<text x="56" y="170" font-size="12" fill="#7a6730" font-weight="600">⊙ Hold variant on desktop</text>` +
          `<text x="56" y="186" font-size="11" fill="#7a6730">Effect smaller than desktop dark-mode noise — re-test in Q4.</text></g>` +
          `<g font-family="system-ui, sans-serif"><rect x="40" y="210" width="440" height="44" rx="6" fill="#e8eef5" stroke="#4c78a8"/>` +
          `<text x="56" y="232" font-size="12" fill="#4c78a8" font-weight="600">→ Projected impact: +$2.1M ARR</text>` +
          `<text x="56" y="248" font-size="11" fill="#666">Based on current mobile mix + retention; 90% CI [+1.5, +2.7M].</text></g>`,
      },
    ],
    footer:
      'glyph_story({ template: "ab-test-readout", handle_id: "exp_114" }) → 4-panel storyboard.',
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
  "template-quarterly-review",
  "template-incident-retro",
  "template-ab-test-readout",
]) {
  const spec = JSON.parse(readFileSync(join(OUT, `${stem}.json`), "utf8"));
  const svg = renderSvg(compileCompose(parseComposeSpec(spec)));
  console.log(`  ${stem.padEnd(28)} → ${svg.length} bytes`);
}
