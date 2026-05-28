# Learn Glyph in 30 minutes

This is a hands-on tour of Glyph's key features. Every section ends
with a thing you can run, click, or read on GitHub. By the end you'll
have:

1. Made an LLM agent draw you a math story.
2. Rendered a chart from a JSON spec, locally.
3. Caught a chart-correctness bug via the auditor.
4. Verified an SVG's cryptographic provenance.
5. Built a chart in the browser playground.
6. Found your first PR-able issue.

**No install required for steps 1, 4, and 5 — you can do them entirely
on GitHub + a browser.** Steps 2, 3, 6 need Node 20+ and ~2 minutes
of `pnpm install`.

> 🎯 **You don't have to read this top-to-bottom.** Each section is
> standalone. Pick the path that matches your interest.

---

## 0. The 30-second tour

Glyph is a deterministic chart-and-compute library where:
- **Charts are JSON specs** an LLM can author, diff, and patch.
- **Compilation is a pure function**: same spec → same SVG bytes,
  every platform, every run.
- **The agent surface is the primary API**: 53 MCP verbs Claude /
  ChatGPT / Gemini can call directly.

When an agent asks Glyph to "show a sine wave for an 8-year-old," it
gets back a self-contained animated SVG (no JS, no CDN, no embed
code) — the artifact IS the demo:

<p align="center">
<img alt="Sine wave for an 8-year-old — composed by glyph_story" src="https://raw.githubusercontent.com/seanhanca/glyph/main/packages/core/__fixtures__/story/sine-wave-for-an-8yo.svg" width="560">
</p>

That SVG is rendering live in your browser right now. Same bytes a
Claude Desktop user would get back from `glyph_story`.

---

## 1. Make an agent draw you a story

**Time:** 2 minutes · **Setup:** Claude Desktop or Claude Code (or any
MCP client) · **No clone required.**

```bash
claude mcp add glyph -- npx -y @glyph/mcp
```

Then in Claude, ask:

> Use `glyph_story` to show me a parabola for an 8-year-old. Save the
> SVG to `./parabola.svg`.

Claude calls `glyph_story({ intent: "parabola", audience: "kid" })`.
Open `parabola.svg` in any browser. Curve draws, dot travels, vertex
annotation lands. **All from one MCP call.**

Want to vary it? Try these prompts:

> Show me a cosine wave for an 8-year-old.
> Draw a circle and explain pi.
> Show me a vector field with three arrows.

Five recipes ship in 0.3.0: `sine`, `cosine`, `circle`, `parabola`,
`vector field`. Three audiences: `kid`, `high-school`, `adult`. The
recipe registry is in [`packages/core/src/story/compose.ts`](../packages/core/src/story/compose.ts)
— adding a new one is the easiest PR in the project ([recipe-idea
template](https://github.com/seanhanca/glyph/issues/new?template=recipe_idea.yml)).

---

## 2. Render a chart from a JSON spec

**Time:** 3 minutes · **Setup:** Node 20+, pnpm 9.12+, this repo cloned.

```bash
git clone https://github.com/seanhanca/glyph
cd glyph
pnpm install
pnpm build
```

Now use the CLI to render any of the bundled fixtures:

```bash
pnpm --filter @glyph/cli exec glyph render \
  packages/core/__fixtures__/math/lissajous.json \
  -o lissajous.svg
open lissajous.svg
```

That's a Lissajous curve from this spec:

```json
{
  "data": {
    "shape": "trajectory",
    "parameter": { "name": "t", "min": 0, "max": 6.283185, "samples": 200 },
    "x": "sin(3*t)",
    "y": "cos(2*t)"
  },
  "layers": [{ "mark": "line", "encoding": { "x": "x", "y": "y" } }]
}
```

The whole spec format is in `packages/core/src/spec/types.ts` (TypeScript)
and `packages/core/dist/spec.schema.json` (JSON Schema, also served at
[seanhanca.github.io/glyph/play/spec.schema.json](https://seanhanca.github.io/glyph/play/spec.schema.json)
for editor autocomplete).

**Try modifying the spec.** Change `x` to `sin(5*t)` and re-render. The
shape changes; the rendering pipeline doesn't care.

---

## 3. Catch a chart bug — the auditor

**Time:** 2 minutes · **Setup:** the repo cloned (same as §2).

Charts can lie. A bar chart with a non-zero y-axis baseline visually
exaggerates differences; a pie chart with 30 slices is unreadable;
two categorical colors 4 units apart in deuteranopia space confuse a
common form of color-blindness. The auditor catches these before they
ship.

Run the auditor against a spec that's intentionally bad:

```bash
pnpm --filter @glyph/cli exec glyph render \
  packages/core/__fixtures__/missing-data/skip-default.json \
  -o /tmp/probe.svg
```

…and check the rendered SVG. Open it in a browser. The auditor's
findings are embedded as a structured `<metadata>` block (Moat 3 —
failure-aware rendering). For a structured Explanation envelope an
agent can chain to a follow-up, the MCP path is:

```bash
# Render via MCP, get back a handle_id
echo '{"data":{"source":"<inline:rides>"},"layers":[{"mark":"bar","encoding":{"x":"hour","y":"rides"}}]}' \
  | jq -c | pnpm --filter @glyph/mcp exec glyph_render
```

The audit rules live in [`packages/core/src/audit/`](../packages/core/src/audit/).
AUDIT-1..AUDIT-15 ship in 0.3.0. Adding an audit rule is a small PR
— see [CONTRIBUTING.md §4](../CONTRIBUTING.md#4-i-want-to-add-an-audit-rule--small).

---

## 4. Verify an SVG's provenance — no install

**Time:** 1 minute · **Setup:** a browser.

Every Glyph-rendered SVG embeds a cryptographic seal:

```xml
<metadata id="glyph-provenance"><![CDATA[{
  "format": "glyph-provenance/1",
  "specHash": "20b940795d11e164...",
  "dataHash": "f1c3ee5c630f7cfe...",
  "libraryVersion": "0.3.0",
  "rowCount": 120,
  "scaleDigest": "ba4e393d19a68aac..."
}]]></metadata>
```

The hashes commit to a specific (spec, rows, schema) tuple. Anyone
can recompute them and confirm the chart wasn't tampered with. **This
is what makes agent-generated charts auditable** — a downstream
recipient can verify "yes, Claude really did produce this SVG from
this spec on this version of Glyph."

To see one in the wild:
1. Open [`__fixtures__/story/sine-wave-for-an-8yo.svg`](https://raw.githubusercontent.com/seanhanca/glyph/main/packages/core/__fixtures__/story/sine-wave-for-an-8yo.svg)
   in your browser.
2. View source.
3. Search for `glyph-provenance`.

The MCP verb `glyph_verify` re-computes the seal against a (spec, rows,
schema, svg) tuple and tells you whether they match — that's the agent-
facing trust check.

---

## 5. Build a chart in the browser playground

**Time:** 5 minutes · **Setup:** a browser.

The playground lives at [seanhanca.github.io/glyph/play](https://seanhanca.github.io/glyph/play/)
(GitHub Pages — needs to be enabled in repo settings; htmlpreview
fallback works today).

You'll see:
- A Monaco editor on the left with the spec.
- The rendered chart on the right.
- An audit panel beneath showing any findings.
- A trust score at the top right.

Try this:
1. Paste a CSV into the data panel.
2. Watch the spec auto-suggest a mark.
3. Edit the spec — see the chart update.
4. Click "Share URL" — the spec + data is encoded in the URL hash.
5. Send the URL to someone; they see the same chart.

The playground bundles `@glyph/core` directly (browser ESM), so it's
running the **same compiler** the MCP server uses. Determinism contract
holds.

---

## 6. Animate a chart — Joy of Math

**Time:** 5 minutes · **Setup:** this repo cloned (same as §2).

Joy of Math is the kid-persona track. Five new marks + a multi-scene
animation system + two BrandKit presets. The killer demo is `glyph_story`
(§1) but the underlying primitives are usable on their own.

**Try the multi-scene timeline:**

```bash
cat packages/core/__fixtures__/timeline/circle-circumference.json
pnpm --filter @glyph/cli exec glyph render \
  packages/core/__fixtures__/timeline/circle-circumference.json \
  -o /tmp/circle.svg
open /tmp/circle.svg
```

You'll see three scenes play out:
1. A circle appears.
2. The radius is marked.
3. The circle unwraps into a straight line of length 2πr.

It's a multi-scene timeline, not a video file. The whole sequence is
SMIL `<animate>` elements inside the SVG. **Self-contained, no JS.**

**Try a traveler (a moving dot tracing a path):**

```bash
pnpm --filter @glyph/cli exec glyph render \
  packages/core/__fixtures__/traveler/sine-traveler.json \
  -o /tmp/traveler.svg
open /tmp/traveler.svg
```

The dot bounces along the sine curve continuously — no teleport, no
"appear and disappear" at the loop boundary. (We had a [bug](https://github.com/seanhanca/glyph/commit/be63646)
on that exact behavior in 0.2.0-dev; the fix is documented in
[`packages/core/src/render/svg.ts`](../packages/core/src/render/svg.ts#L156)
and is a good example of the kind of fix a community contributor can
own.)

Full Joy of Math walk-through: [`docs/MATH.md`](./MATH.md) (existing).

**More math beauty:** the [Joy of Math wow page](https://seanhanca.github.io/glyph/math/joy.html) renders nine interactive demos live in your browser — six parametric curves (Lissajous, hypotrochoid, curlicue, Archimedean spiral, butterfly, gravitational lens) plus three fluid / PDE simulations (particle flow field, 2D wave-equation ripples, Gray-Scott reaction-diffusion / Turing patterns). Drag the sliders, click the wave-ripples canvas to drop a stone, switch reaction-diffusion presets to see leopard spots become zebra stripes. Most of these can already be expressed as a Glyph spec via `data.shape: "trajectory"`; the page is a preview of what an agent-driven viz layer can do.

---

## 7. Where to go next

Pick whichever fits your interest:

| Interest | Next step |
|----------|-----------|
| **"I want to add a story recipe"** | [Recipe idea template](https://github.com/seanhanca/glyph/issues/new?template=recipe_idea.yml) — the easiest PR. |
| **"I want to add a mark"** | [Feature request](https://github.com/seanhanca/glyph/issues/new?template=feature_request.yml) — sankey, chord, hexbin, sunburst are all open. |
| **"I want to add an MCP verb"** | [MCP verb idea](https://github.com/seanhanca/glyph/issues/new?template=mcp_verb_idea.yml) — bar's high, bring receipts. |
| **"I want to show off a chart"** | [Discussions → Show & tell](https://github.com/seanhanca/glyph/discussions) — drop a playground URL. |
| **"I want to ask a question"** | [Discussions → Q&A](https://github.com/seanhanca/glyph/discussions) — open-ended threads live there. |
| **"I want to file a bug"** | [Bug report template](https://github.com/seanhanca/glyph/issues/new?template=bug_report.yml) — include the spec. |
| **"I want to read the source"** | [`packages/core/src/`](../packages/core/src/) — `compiler/`, `render/`, `spec/` are the three big subsystems. |
| **"I want to understand the architecture"** | [`mvp.md`](../mvp.md) (existing planning doc) and [`docs/MATH.md`](./MATH.md). |

---

## Found a typo in this guide?

The lowest-friction first PR you can send: fix a typo, edit a sentence,
add a missing link. Open this file on GitHub, hit the pencil icon, edit
in the web UI, "Propose changes." A maintainer will merge inside a few
days.

The whole Glyph project is built in the open. We see contributions
as the long-tail compounding force that turns a useful library into a
canonical one. Welcome.
