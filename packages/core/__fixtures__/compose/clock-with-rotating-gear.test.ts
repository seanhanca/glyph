/**
 * RFC #5–#8 capstone fixture: a compose scene containing a frame
 * + a swinging pendulum + a rotating gear + two annotation-leaders,
 * themed with pencil-parchment + graph-paper grid.
 *
 * This is the FIRST byte-locked Glyph fixture rendered ENTIRELY from
 * a compose spec — no chart-spec layers, no data, just schematic
 * marks composed on a parchment canvas. Proves the full pipeline:
 *
 *   parseComposeSpec(raw)
 *     → ComposeSpec (RFC #5 schema)
 *   compileCompose(spec)
 *     → Scene with `group` SceneMarks (RFC #5 compiler)
 *     → each group contains primitive marks from compileFrame /
 *       compileGear / compilePendulum / compileAnnotationLeader
 *       (RFC #7 schematic marks)
 *     → each group carries optional loopAnimationXml from
 *       emitSwing / emitRotateLoop / emitPulse (RFC #6 animations)
 *     → background + grid from pencil-parchment preset (RFC #8)
 *   renderSvg(scene)
 *     → byte-stable SVG with `<g transform>` wrappers and SMIL
 *       `<animateTransform>` elements
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileCompose } from "../../src/compiler/compose.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseComposeSpec } from "../../src/spec/compose-schema.js";

const fixtureUrl = new URL("./clock-with-rotating-gear.json", import.meta.url);
const fixturePath = fileURLToPath(fixtureUrl);

describe("compose — RFC #5–#8 capstone (clock-with-rotating-gear)", () => {
  it("renders the full compose scene deterministically", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseComposeSpec(raw);
    const scene = compileCompose(spec);
    const svg = renderSvg(scene);
    const svg2 = renderSvg(compileCompose(parseComposeSpec(raw)));
    expect(svg2).toBe(svg);
    // Sanity: at least one rect (frame), gear teeth (lines), a circle
    // (gear rim / pendulum bob), a group wrapper, and SMIL animations.
    expect(svg).toContain('<g transform="translate');
    expect(svg).toContain("<animateTransform");
    expect(svg).toContain("RFC #5"); // frame title
    expect(svg).toContain("gear · 24 teeth");
    expect(svg).toContain("swinging pendulum");
    // Background fill present (pencil-parchment)
    expect(svg).toContain("#f5edd9");
    // Graph paper grid pattern present (faint blue lines)
    expect(svg).toContain("rgba(80,110,160,.08)");
    await expect(svg).toMatchFileSnapshot("./clock-with-rotating-gear.svg");
  });
});
