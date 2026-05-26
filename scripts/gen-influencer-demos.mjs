#!/usr/bin/env node
/**
 * Generate per-influencer demo pages under site/demos/for-{handle}.html.
 *
 * The launch plan's influencer engine drafts cold emails and timeline
 * replies. Each one becomes ~10× more shareable when it links to a
 * page built around that specific person's stated interests (taken
 * from scripts/launch/influencers.yaml).
 *
 * This script produces those pages. Each is small, focused, and links
 * to one primary demo + 2 secondary demos chosen for that person.
 *
 * Run: node scripts/gen-influencer-demos.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "site", "demos");
mkdirSync(outDir, { recursive: true });

/**
 * @typedef {Object} InfluencerDemo
 * @property {string} handle      slug for filename (matches influencers.yaml)
 * @property {string} name        human name
 * @property {string} x           X/Twitter handle (no @)
 * @property {string} angle       one-sentence pitch personalised to them
 * @property {string} primarySvg  hero image filename in site/math/
 * @property {string} primaryAlt  alt text describing the primary image
 * @property {string} primaryCaption  bold + body caption
 * @property {string[]} secondarySvgs two more relevant SVGs for context
 * @property {string} pitch       1-paragraph "why Glyph might interest you"
 * @property {string} prompt      a Claude prompt they can paste to run a demo themselves
 * @property {string} cta         link text + url ("read the essay", "browse the gallery")
 */

/** @type {InfluencerDemo[]} */
const demos = [
  {
    handle: "simon-willison",
    name: "Simon Willison",
    x: "simonw",
    angle:
      "MCP + DuckDB + LLM tool-use in one small library — your weekly notes hit all three regularly.",
    primarySvg: "../math/two-agents-v2.svg",
    primaryAlt:
      "A bar chart of bike rides by hour, byte-locked, generated via the two-agent collaboration demo (Agent A renders → Agent B audits → Agent A patches).",
    primaryCaption:
      "<strong>Two agents on a chart.</strong> Agent A drafts a spec, Agent B audits it via <code>glyph_audit_spec</code> and emits an RFC 6902 patch, Agent A applies + re-renders. Byte-stable end-to-end. The demo no other chart library can run.",
    secondarySvgs: ["../math/bio-circulation.svg", "../math/leopard-spots.svg"],
    pitch:
      "Glyph compiles JSON to byte-identical SVG, ships as a 52-verb MCP server, and has DuckDB embedded so <code>data.source: 'rides.csv'</code> just works. The repo is maintained by Claude (Cowork) on a schedule — the whole launch is itself a demo of the thesis. If you want a small example to put in TIL, the two-agents demo is the cleanest single artifact.",
    prompt:
      "Render a bike-rides-by-hour bar chart from a CSV, then audit the spec and emit an RFC 6902 patch that pins the y-axis to [0, ...]. Apply the patch and re-render — both SVGs should be byte-stable across runs.",
    cta: 'Read the AGENTS.md and the two-agents demo — <a href="https://github.com/seanhanca/glyph/blob/main/AGENTS.md">AGENTS.md</a> · <a href="../math/two-agents.html">two-agents.html</a>',
  },
  {
    handle: "swyx",
    name: "Shawn @ Latent Space",
    x: "swyx",
    angle: "Agent-native visualisation as a category. Nobody owns it yet; Glyph is the first move.",
    primarySvg: "../math/ext-orrery.svg",
    primaryAlt:
      "An animated 2D orrery of the solar system, six planet circles riding concentric orbital ellipses, each carrying a SMIL rotate-loop scaled by its real orbital year.",
    primaryCaption:
      "<strong>One JSON spec → six synchronised SMIL animations.</strong> Mercury whips once per ~1.9s, Saturn once per ~3m55s. The whole orrery is declared, not scripted — six <code>animation</code> blocks, no JS.",
    secondarySvgs: ["../math/eng-locomotive.svg", "../math/two-agents-v1.svg"],
    pitch:
      "Most viz tools were designed for humans typing code. Glyph was designed for LLMs typing prompts. The JSON spec fits in an LLM context window, Zod's schema errors give the model a clear repair signal, and the SVG output is byte-stable enough to test in CI. Worth a single slot in the next AI Engineer rundown — angle: the byte-determinism + MCP server combination is unusual.",
    prompt:
      "Show me what AI-native infra looks like for visualisation. Use Glyph's MCP server to render a solar-system orrery with six animated planets; print the JSON spec you used.",
    cta: 'Read the magazine-style essay — <a href="../math/strengths.html">The five things Glyph does best</a>',
  },
  {
    handle: "harrison-chase",
    name: "Harrison Chase",
    x: "hwchase17",
    angle:
      "A LangChain tool wrapper for Glyph runs the Analyst+Auditor pattern in ~40 LOC. Clean integration, byte-stable output.",
    primarySvg: "../math/two-agents-v2.svg",
    primaryAlt:
      "A bar chart produced by the two-agent collaboration (Agent A renders, Agent B audits, Agent A patches).",
    primaryCaption:
      "<strong>LangChain tool wrapper pattern.</strong> Two LangChain agents wrap <code>glyph_render</code> and <code>glyph_audit_spec</code>. They exchange RFC 6902 patches against a stable JSON schema. No code generation; the agents pass specs, not Python.",
    secondarySvgs: ["../math/bio-circulation.svg", "../math/ext-orrery.svg"],
    pitch:
      "LangChain's strength is the multi-agent shape. Glyph's strength is the byte-stable JSON-spec contract that makes the multi-agent shape verifiable. Combining them gives you charts that two agents can collaboratively improve, where each step is auditable. The wrapper is small enough to drop in a langchain examples PR.",
    prompt:
      "Build a LangChain Analyst+Auditor pair where the Analyst uses Glyph's glyph_render tool and the Auditor uses glyph_audit_spec. They iterate on a bar chart until the audit returns zero warnings. Print the JSON patches at each step.",
    cta: 'Read the two-agents canonical demo — <a href="../math/two-agents.html">two-agents.html</a>',
  },
  {
    handle: "joao-moura",
    name: "João Moura",
    x: "joaomdmoura",
    angle:
      "A CrewAI Analyst+Auditor crew that produces byte-stable charts. The audit step is built into Glyph as an MCP verb, not bolted on.",
    primarySvg: "../math/two-agents-v2.svg",
    primaryAlt:
      "A bar chart produced by the two-agent collaboration, after the auditor's patch was applied.",
    primaryCaption:
      "<strong>CrewAI Analyst+Auditor demo.</strong> Two-role crew: Analyst writes the spec, Auditor calls <code>glyph_audit_spec</code> and proposes JSON-patch fixes. The Analyst applies them and re-renders. Same bytes every CI run.",
    secondarySvgs: ["../math/bio-circulation.svg", "../math/leopard-spots.svg"],
    pitch:
      "CrewAI's design assumes agents can pass structured outputs between roles. Glyph's specs ARE that structured output. The CrewAI example would be ~50 LOC, demonstrate the byte-determinism story end-to-end, and fit naturally in crewAI-examples.",
    prompt:
      "Build a CrewAI crew with an Analyst and an Auditor that collaboratively improve a Glyph bar chart. The Analyst renders, the Auditor finds issues, they iterate until the audit is clean. Print the final SVG path.",
    cta: 'Read AGENTS.md for the agent-collaboration contract — <a href="https://github.com/seanhanca/glyph/blob/main/AGENTS.md">AGENTS.md</a>',
  },
  {
    handle: "jerry-liu",
    name: "Jerry Liu",
    x: "jerryjliu0",
    angle:
      "Glyph's <code>data.source</code> field accepts paths into the DuckDB engine — making it a clean tail for LlamaIndex query engines.",
    primarySvg: "../math/leopard-spots.svg",
    primaryAlt:
      "Gray-Scott reaction-diffusion leopard-spots pattern computed by Glyph's PDE solver from a JSON spec.",
    primaryCaption:
      '<strong>Math-data is data too.</strong> Glyph\'s <code>data.shape: "pde-solve"</code> integrates the equation in the renderer. Same shape for ODEs, recurrences, and streamlines. A LlamaIndex query engine can pipe rows in via <code>data.source</code> and get a deterministic SVG out.',
    secondarySvgs: ["../math/bio-dna.svg", "../math/ext-particles.svg"],
    pitch:
      "Most chart libraries assume tabular data and bar/line marks. Glyph also accepts equation-shaped data (ODE, PDE, recurrence, streamline) and renders them deterministically. For agent-driven data-grounded visualisations — LlamaIndex's sweet spot — the same JSON contract scales from a CSV bar chart to a reaction-diffusion plate.",
    prompt:
      "Wire a LlamaIndex query engine to Glyph. After the query returns rows, write a Glyph spec that renders them as a bar chart. Print the SVG path and the spec.",
    cta: 'Read the math-data-shapes doc — <a href="https://github.com/seanhanca/glyph/blob/main/docs/MATH.md">docs/MATH.md</a>',
  },
  {
    handle: "yohei-nakajima",
    name: "Yohei Nakajima",
    x: "yoheinakajima",
    angle:
      "BabyAGI's loop topology applied to chart-making: render → audit → patch → re-render. You'll recognize the pattern.",
    primarySvg: "../math/two-agents-v1.svg",
    primaryAlt: "Agent A's first-draft bar chart before the audit loop.",
    primaryCaption:
      "<strong>v1 — Agent A's first draft.</strong> No y-axis floor, no units in the title. The auditor's job is to identify the gap and propose a patch.",
    secondarySvgs: ["../math/two-agents-v2.svg", "../math/ext-orrery.svg"],
    pitch:
      'The two-agent loop is the simplest expression of a BabyAGI-style autonomous improvement cycle, on a target that\'s small enough to verify and visual enough to share. Patch v1 → v2, byte-stable end-to-end, the diff is auditable. The whole demo is one canonical writeup at <a href="../math/two-agents.html">two-agents.html</a>.',
    prompt:
      "Set up a BabyAGI-style loop where one agent renders a Glyph chart, another agent audits it via glyph_audit_spec, and the first agent applies the suggested RFC 6902 patches. Loop until audit is clean. Save each intermediate SVG.",
    cta: 'Read the canonical two-agents demo — <a href="../math/two-agents.html">two-agents.html</a>',
  },
  {
    handle: "alex-albert",
    name: "Alex Albert",
    x: "alexalbert__",
    angle:
      "52 MCP verbs, byte-stable SVG output, Zod-validated specs — a clean reference implementation of an MCP server for the chart domain.",
    primarySvg: "../math/ext-orrery.svg",
    primaryAlt: "Animated 2D solar system orrery with six planets on rotate-loop animations.",
    primaryCaption:
      "<strong>Animated diorama from one MCP call.</strong> <code>glyph_render</code> turns a JSON spec into a byte-stable SVG with SMIL animations. The Cowork repo demonstrates the full lifecycle: spec → render → embed in docs → animate.",
    secondarySvgs: ["../math/bio-circulation.svg", "../math/two-agents-v2.svg"],
    pitch:
      "Glyph is an MCP-native server for charts: 52 verbs, structured <code>Explanation</code> envelopes on every response, SHA-256 provenance, no telemetry. Anthropic DevRel has been hunting for production-grade MCP examples to amplify — this is one that's small enough to demo and serious enough to use. The whole repo is maintained by Cowork (Claude) on a schedule, so the AI-built / AI-maintained story is verifiable in real time.",
    prompt:
      "Use Glyph's MCP server to render an animated solar-system orrery with six planets, then print the Explanation envelope so I can see the structured response shape.",
    cta: 'Read AGENTS.md + the maintenance dashboard — <a href="https://github.com/seanhanca/glyph/blob/main/AGENTS.md">AGENTS.md</a> · <a href="../maintenance.html">maintenance.html</a>',
  },
  {
    handle: "hannes-muehleisen",
    name: "Hannes Mühleisen",
    x: "hfmuehleisen",
    angle:
      "DuckDB lives inside Glyph's renderer. <code>data.source: 'rides.csv'</code> runs through real SQL before reaching the encoding layer.",
    primarySvg: "../math/two-agents-v2.svg",
    primaryAlt:
      "A bar chart of bike rides by hour, generated through Glyph's DuckDB-backed materialisation pipeline.",
    primaryCaption:
      "<strong>A chart is a query is a chart.</strong> The spec's <code>data</code> block is a real DuckDB query; the <code>layers</code> block is the visual encoding. Embedded DuckDB means the same library handles ingestion, transforms, and rendering.",
    secondarySvgs: ["../math/leopard-spots.svg", "../math/ext-orrery.svg"],
    pitch:
      'Glyph compiles JSON specs to byte-stable SVG, with DuckDB embedded for data transforms. The grammar-of-graphics layer sits on top of real SQL, so the dividing line between "prep your data" and "render your chart" disappears. One JSON file holds both.',
    prompt:
      "Render a Glyph chart whose data section is a DuckDB query against a Parquet file. Show me the spec, the SQL, and the resulting SVG.",
    cta: 'Read the @glyph/duckdb package README — <a href="https://github.com/seanhanca/glyph/tree/main/packages/duckdb">packages/duckdb</a>',
  },
  {
    handle: "hadley-wickham",
    name: "Hadley Wickham",
    x: "hadleywickham",
    angle:
      "Grammar of graphics for AI agents. The same compositional shape ggplot2 introduced, expressed as JSON so an LLM can author it directly.",
    primarySvg: "../math/two-agents-v2.svg",
    primaryAlt:
      "A bar chart with a stable y-axis domain and units in the title, after a JSON-patch audit.",
    primaryCaption:
      "<strong>Grammar of graphics, declared in JSON.</strong> <code>data</code> + <code>layers</code> + <code>encoding</code>. The same compositional shape as ggplot2 — but written by an LLM as JSON, not by a human as R.",
    secondarySvgs: ["../math/leopard-spots.svg", "../math/bio-circulation.svg"],
    pitch:
      'Glyph is an attempt to take the grammar-of-graphics idea and apply it to the agent-authoring world. The spec is JSON (validated by Zod), the data shapes include tabular + function + ODE + PDE, and the output is byte-stable SVG. We\'d be honoured by any feedback on whether the grammar holds up — <a href="https://github.com/seanhanca/glyph/blob/main/docs/LEARN.md">docs/LEARN.md</a> is the 30-minute tour.',
    prompt:
      "Show me Glyph's grammar of graphics in one example: faceted bar chart of rides by hour, broken out by day-of-week, with a color encoding for weekday-vs-weekend. Print the spec.",
    cta: 'Read the LEARN tutorial — <a href="https://github.com/seanhanca/glyph/blob/main/docs/LEARN.md">docs/LEARN.md</a>',
  },
  {
    handle: "mike-bostock",
    name: "Mike Bostock",
    x: "mbostock",
    angle:
      "Byte-stable SVG. Same spec → same bytes on Linux, macOS, Windows × Node 20 / 22. Verifiable visual regression.",
    primarySvg: "../math/ext-particles.svg",
    primaryAlt:
      "A particle-field streamline visualisation produced deterministically by Glyph from one JSON spec.",
    primaryCaption:
      "<strong>Same spec → same bytes.</strong> Every Glyph render carries a SHA-256 hash over <code>(spec, rows, schema)</code>. Snapshot once, assert byte-equality in CI. No subpixel drift, no generated IDs, no timestamp embedding.",
    secondarySvgs: ["../math/two-agents-v2.svg", "../math/leopard-spots.svg"],
    pitch:
      "Most SVG-producing libraries (Vega, Plotly, D3) drift between platforms. Glyph went the other direction: the renderer is byte-stable by construction. That makes the output diffable in git, hashable, and testable in CI as if it were code. The 819 snapshot tests in the repo are exactly that — pixel-level regression on visual artifacts.",
    prompt:
      "Show me a deterministic streamline visualization through a curl-noise field, with 100 trajectories. Print the spec and the SHA-256 seal of the output.",
    cta: 'Read the determinism contract in CONTRIBUTING — <a href="https://github.com/seanhanca/glyph/blob/main/CONTRIBUTING.md">CONTRIBUTING.md</a>',
  },
  {
    handle: "matt-rickard",
    name: "Matt Rickard",
    x: "mattrickard",
    angle:
      "AI-built, AI-maintained infrastructure for the AI-engineering ecosystem. The repo demonstrates its own thesis.",
    primarySvg: "../math/eng-locomotive.svg",
    primaryAlt:
      "A pencil-on-parchment engineering schematic of a steam locomotive, rendered by Glyph from a JSON spec.",
    primaryCaption:
      "<strong>A library that explains itself.</strong> Every page on the demo site is a Glyph render. The maintenance dashboard is a Glyph render. The roadmap will eventually be a Glyph render. Eat your own dog food.",
    secondarySvgs: ["../math/arch-cathedral.svg", "../math/two-agents-v2.svg"],
    pitch:
      'Glyph is one of the first OSS projects where the launch itself is a proof point. Cowork (an instance of Claude) wrote this page, maintains the repo, and triages incoming issues — see the <a href="../maintenance.html">live maintenance dashboard</a>. The thesis is "AI-built infrastructure for AI engineering"; the repo is the demo.',
    prompt:
      "Show me what AI-maintained OSS looks like in practice. Walk me through the Cowork workflow in this repo: what does an issue lifecycle look like, and where does the human owner actually have to intervene?",
    cta: 'Read the AI-maintained section of CONTRIBUTING — <a href="https://github.com/seanhanca/glyph/blob/main/CONTRIBUTING.md#ai-maintained">CONTRIBUTING.md#ai-maintained</a>',
  },
  {
    handle: "nutlope",
    name: "Hassan El Mghari",
    x: "nutlope",
    angle:
      "Clean OSS demo with a playground link. Joy of Math has nine interactive demos in the browser — perfect to drop in a tweet.",
    primarySvg: "../math/bio-jellyfish.svg",
    primaryAlt:
      "A bioluminescent moon jellyfish rendered by Glyph from a single English-language prompt.",
    primaryCaption:
      "<strong>From English prompt → JSON spec → byte-stable SVG.</strong> One Claude turn produced this. The whole Life-in-Glyph gallery (21 cards) was authored prompt-by-prompt.",
    secondarySvgs: ["../math/sunflower-seeds.svg", "../math/bio-dna.svg"],
    pitch:
      'The shareable artifact here is the live playground: <a href="https://seanhanca.github.io/glyph/play/">playground</a> + <a href="https://seanhanca.github.io/glyph/math/joy.html">joy.html</a>. Open the joy page and you have nine interactive demos in-browser — sliders for Lissajous, ripples on the wave-equation canvas, Gray-Scott Turing patterns. Worth a 2-minute screen capture.',
    prompt:
      "Open the Glyph playground and the Joy of Math page. Screen-capture three interactions: drag the hypotrochoid slider, click the wave-equation canvas, and watch the reaction-diffusion field develop. Save the clips.",
    cta: 'Open the playground + Joy of Math — <a href="https://seanhanca.github.io/glyph/play/">playground</a> · <a href="https://seanhanca.github.io/glyph/math/joy.html">joy.html</a>',
  },
];

/**
 * Render one influencer demo page.
 * @param {InfluencerDemo} d
 */
function renderPage(d) {
  const secondarySvgRow = d.secondarySvgs
    .map(
      (src, i) => `      <a class="thumb" href="${src}">
        <img src="${src}" alt="Secondary demo ${i + 1}" loading="lazy">
      </a>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>Glyph · for ${d.name}</title>
<meta name="description" content="${d.angle.replace(/<[^>]+>/g, "")}">
<meta property="og:title" content="Glyph · for ${d.name}">
<meta property="og:description" content="${d.angle.replace(/<[^>]+>/g, "")}">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{
    background:#0a0d18;
    color:#e2dccb;
    font-family:"Iowan Old Style","Palatino Linotype",Georgia,serif;
    line-height:1.7;
    -webkit-font-smoothing:antialiased;
  }
  a{color:#c4b5fd;text-underline-offset:3px;text-decoration-thickness:1px}
  a:hover{color:#ddd6fe}
  .wrap{max-width:760px;margin:0 auto;padding:48px 24px 96px}
  .meta{font-family:-apple-system,system-ui,sans-serif;font-size:.78rem;text-transform:uppercase;letter-spacing:.18em;color:#6b7280;margin-bottom:32px}
  .meta a{color:#6b7280;text-decoration:none;border-bottom:1px dashed transparent;transition:color .15s,border-color .15s}
  .meta a:hover{color:#e2dccb;border-bottom-color:#e2dccb}
  .salutation{
    font-family:-apple-system,system-ui,sans-serif;
    font-size:.92rem;
    text-transform:uppercase;
    letter-spacing:.12em;
    color:#a78bfa;
    margin-bottom:14px;
  }
  h1{
    font-family:"Iowan Old Style","Palatino Linotype",Georgia,serif;
    font-size:clamp(2.2rem,5vw,3.2rem);
    font-weight:600;
    letter-spacing:-.015em;
    line-height:1.1;
    color:#f5f0e0;
    margin-bottom:16px;
    text-wrap:balance;
  }
  h1 .accent{color:#c4b5fd;font-style:italic}
  .angle{
    font-family:-apple-system,system-ui,sans-serif;
    font-size:1.12rem;
    line-height:1.6;
    color:#9ca3af;
    margin-bottom:48px;
  }
  .stage{
    background:#020617;
    border:1px solid #1f2937;
    border-radius:8px;
    overflow:hidden;
    margin-bottom:14px;
  }
  .stage img{display:block;width:100%;height:auto}
  .caption{
    font-family:-apple-system,system-ui,sans-serif;
    font-size:.92rem;
    color:#9ca3af;
    margin-bottom:48px;
    line-height:1.6;
  }
  .caption strong{color:#e2dccb;font-weight:500}
  .caption code{font-family:"SF Mono","Cascadia Code",ui-monospace,monospace;font-size:.9em;background:#13192a;padding:.12em .42em;border-radius:3px;color:#c4b5fd}
  .thumbs{
    display:grid;
    grid-template-columns:1fr 1fr;
    gap:14px;
    margin-bottom:48px;
  }
  .thumb{
    display:block;
    background:#020617;
    border:1px solid #1f2937;
    border-radius:6px;
    overflow:hidden;
    aspect-ratio:1;
  }
  .thumb img{display:block;width:100%;height:100%;object-fit:contain}
  h2{
    font-family:"Iowan Old Style",Georgia,serif;
    font-size:1.5rem;
    font-weight:600;
    color:#f5f0e0;
    margin:48px 0 14px;
    text-wrap:balance;
  }
  p{font-size:1.04rem;line-height:1.75;color:#cdc4b0;margin-bottom:18px}
  p code,p a code{font-family:"SF Mono","Cascadia Code",ui-monospace,monospace;font-size:.9em;background:#13192a;padding:.12em .42em;border-radius:3px;color:#c4b5fd}
  blockquote{
    border-left:3px solid #a78bfa;
    padding:8px 20px;
    margin:24px 0;
    font-style:italic;
    color:#cdc4b0;
    font-size:1.02rem;
    font-family:-apple-system,system-ui,sans-serif;
  }
  blockquote .who{
    display:block;
    margin-top:8px;
    font-style:normal;
    font-size:.82rem;
    color:#8b9bb4;
  }
  .cta{
    font-family:-apple-system,system-ui,sans-serif;
    font-size:.94rem;
    color:#cdc4b0;
    margin-top:48px;
    padding:18px 22px;
    background:rgba(167,139,250,.05);
    border:1px solid rgba(167,139,250,.2);
    border-radius:8px;
  }
  footer{
    margin-top:64px;
    padding:24px 0;
    border-top:1px solid #1f2937;
    font-family:-apple-system,system-ui,sans-serif;
    font-size:.84rem;
    color:#6b7280;
    text-align:center;
  }
  footer a{color:#6b7280}
</style>
</head>
<body>

<div class="wrap">

  <div class="meta">
    <a href="../math/life-in-glyph.html">← Life in Glyph</a> · <a href="../math/strengths.html">Essay</a> · <a href="https://github.com/seanhanca/glyph">repo</a>
  </div>

  <p class="salutation">For <a href="https://x.com/${d.x}">@${d.x}</a></p>
  <h1>${d.name}, this is for <span class="accent">you</span></h1>
  <p class="angle">${d.angle}</p>

  <div class="stage">
    <img src="${d.primarySvg}" alt="${d.primaryAlt}" loading="lazy">
  </div>
  <p class="caption">${d.primaryCaption}</p>

  <h2>Why I'm sending this</h2>
  <p>${d.pitch}</p>

  <h2>Two more, while you're here</h2>
  <div class="thumbs">
${secondarySvgRow}
  </div>

  <h2>If you have 60 seconds</h2>
  <p>Paste this into Claude (or any MCP client with Glyph installed via <code>claude mcp add glyph -- npx -y @glyph/mcp</code>):</p>
  <blockquote>
    ${d.prompt}
    <span class="who">— for Claude / Cursor / Codex / any MCP client</span>
  </blockquote>

  <div class="cta">
    ${d.cta}
  </div>

  <footer>
    Drawn by Glyph · Maintained by <a href="../maintenance.html">Cowork</a> · Apache 2.0 · <a href="https://github.com/seanhanca/glyph">github.com/seanhanca/glyph</a>
  </footer>

</div>

</body>
</html>
`;
}

let count = 0;
for (const d of demos) {
  const path = join(outDir, `for-${d.handle}.html`);
  writeFileSync(path, renderPage(d));
  console.log(`wrote ${path}`);
  count++;
}
console.log(`\n${count} influencer demo pages generated.`);
