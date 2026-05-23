/**
 * Batch-locks all 7 Life-in-Glyph hero scenes — each one a compose
 * spec that produces a complete byte-stable SVG end-to-end from
 * Glyph's compiler alone. Replaces the hand-authored hero <svg>
 * blocks in the corresponding draw-me-*.html pages.
 *
 * Coverage:
 *   - Orion (function shape inside compose + Earth/Moon decorations)
 *   - Heartbeat (FHN trajectory + pulsing heart icon)
 *   - Leopard (Gray-Scott PDE + frame label)
 *   - Sunflower (golden-angle recurrence + petal/head decoration)
 *   - Steam engine (slider-crank mechanism + piston-position curve)
 *   - Wankel (epitrochoid + triangular rotor with rotate-loop)
 *   - Antikythera (compound epicycle + nested gears with rotate-loop)
 *
 * Each scene is tested for:
 *   1. byte-stable across two compileCompose+renderSvg calls
 *   2. snapshot locked at packages/core/__fixtures__/compose/<scene>.svg
 *   3. contains the expected schematic structure (animations, paths, etc.)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileCompose } from "../../src/compiler/compose.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseComposeSpec } from "../../src/spec/compose-schema.js";

interface Scene {
  name: string;
  expect: (svg: string) => void;
}

const SCENES: Scene[] = [
  {
    name: "orion-scene",
    expect: (svg) => {
      expect(svg).toContain("Earth");
      expect(svg).toContain("Moon");
      expect(svg).toContain("Artemis");
      expect(svg).toContain("<path");
    },
  },
  {
    name: "heartbeat-scene",
    expect: (svg) => {
      expect(svg).toContain("60 BPM");
      expect(svg).toContain("FitzHugh");
      expect(svg).toContain('type="scale"'); // pulse animation
      expect(svg).toContain("<path");
    },
  },
  {
    name: "leopard-scene",
    expect: (svg) => {
      expect(svg).toContain("leopard");
      expect(svg).toContain("Gray-Scott");
      expect(svg).toContain("<rect");
    },
  },
  {
    name: "sunflower-scene",
    expect: (svg) => {
      expect(svg).toContain("golden angle");
      expect(svg).toContain("<circle");
    },
  },
  {
    name: "steam-engine-scene",
    expect: (svg) => {
      expect(svg).toContain("Watt");
      expect(svg).toContain("piston");
      expect(svg).toContain("<rect");
    },
  },
  {
    name: "wankel-scene",
    expect: (svg) => {
      expect(svg).toContain("epitrochoid");
      expect(svg).toContain('type="rotate"');
    },
  },
  {
    name: "antikythera-scene",
    expect: (svg) => {
      expect(svg).toContain("epicycle");
      expect(svg).toContain('type="rotate"');
    },
  },
];

describe("compose — all 7 Life-in-Glyph hero scenes", () => {
  for (const scene of SCENES) {
    it(`renders ${scene.name} deterministically + locks the snapshot`, async () => {
      const fixtureUrl = new URL(`./${scene.name}.json`, import.meta.url);
      const fixturePath = fileURLToPath(fixtureUrl);
      const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
      const spec = parseComposeSpec(raw);
      const svg = renderSvg(compileCompose(spec));
      const svg2 = renderSvg(compileCompose(parseComposeSpec(raw)));
      expect(svg2).toBe(svg);
      scene.expect(svg);
      await expect(svg).toMatchFileSnapshot(`./${scene.name}.svg`);
    });
  }
});
