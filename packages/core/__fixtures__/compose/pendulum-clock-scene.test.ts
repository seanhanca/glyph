/**
 * RFC #5–#8 CAPSTONE — the full pendulum-clock hero rendered ENTIRELY
 * from one Glyph compose spec. No hand-authored HTML scaffolding,
 * no decorative SVG outside Glyph's compiler.
 *
 * This proves the answer to "can Glyph do the pendulum-clock page
 * end-to-end?" is **yes** for the hero animation, after this PR.
 *
 * What's composed:
 *  - frame: the clock case "Horologium · 1656"
 *  - pendulum: swinging at 32° amplitude with a 6.28-second period
 *    (matches the underlying ODE's natural period 2π s)
 *  - gear: 30-tooth escapement rotating CCW once per minute
 *  - 3 annotation-leaders: pivot, bob, escapement gear
 *  - chart: an embedded trajectory plot of the same damped pendulum
 *    ODE that the existing `pendulum-clock.json` fixture compiles
 *  - pencil-parchment theme + graph-paper grid
 *
 * Determinism: byte-identical SVG across runs and platforms. The
 * SMIL `<animateTransform>` elements are emitted by the loop
 * emitters in `src/animation/loops.ts` with `additive="sum"` so the
 * loop layers on top of each group's translate.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileCompose } from "../../src/compiler/compose.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseComposeSpec } from "../../src/spec/compose-schema.js";

const fixtureUrl = new URL("./pendulum-clock-scene.json", import.meta.url);
const fixturePath = fileURLToPath(fixtureUrl);

describe("compose — RFC #5–#8 capstone (pendulum-clock-scene)", () => {
  it("renders the full pendulum-clock hero from one compose spec", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseComposeSpec(raw);
    const scene = compileCompose(spec);
    const svg = renderSvg(scene);
    const svg2 = renderSvg(compileCompose(parseComposeSpec(raw)));
    expect(svg2).toBe(svg);
    // Sanity: clock-case title, all three annotations, swing + rotate
    // SMIL animations, the trajectory chart's polyline, parchment fill,
    // and the graph-paper grid all present in one SVG.
    expect(svg).toContain("Horologium");
    expect(svg).toContain("pivot");
    expect(svg).toContain("bob");
    expect(svg).toContain("escapement gear");
    expect(svg).toContain('<animateTransform attributeName="transform" type="rotate"');
    expect(svg).toContain("#f5edd9");
    expect(svg).toContain("rgba(80,110,160,.08)");
    // Embedded trajectory chart contributes at least one path mark.
    expect(svg).toContain("<path");
    await expect(svg).toMatchFileSnapshot("./pendulum-clock-scene.svg");
  });
});
