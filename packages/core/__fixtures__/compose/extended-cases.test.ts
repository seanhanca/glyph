/**
 * Extended Cases — Glyph-shaped versions of harder visualizations
 * (Physarum chemistry, particle field, solar-system orrery, ISS schematic).
 * Snapshot-locked.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileCompose } from "../../src/compiler/compose.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseComposeSpec } from "../../src/spec/compose-schema.js";

interface Scene {
  label: string;
  file: string;
  expects: string[];
}

const scenes: Scene[] = [
  {
    label: "ext · physarum",
    file: "./ext-physarum.json",
    expects: ["Physarum", "pde-solve", "reaction-diffusion"],
  },
  {
    label: "ext · particles",
    file: "./ext-particles.json",
    expects: ["Particle field", "ODE integration"],
  },
  {
    label: "ext · orrery",
    file: "./ext-orrery.json",
    expects: [
      "Sol",
      "orrery",
      "Mercury",
      "Saturn",
      '<animateTransform attributeName="transform" type="rotate"',
    ],
  },
  {
    label: "ext · iss",
    file: "./ext-iss.json",
    expects: [
      "International Space Station",
      "Integrated Truss",
      "solar array",
      "Destiny",
      'id="g-solar"',
    ],
  },
];

describe("compose — extended cases (Glyph-shaped versions of harder demos)", () => {
  for (const scene of scenes) {
    it(`renders ${scene.label} deterministically`, async () => {
      const url = new URL(scene.file, import.meta.url);
      const raw = JSON.parse(readFileSync(fileURLToPath(url), "utf8"));
      const spec = parseComposeSpec(raw);
      const svg = renderSvg(compileCompose(spec));
      const svg2 = renderSvg(compileCompose(parseComposeSpec(raw)));
      expect(svg2).toBe(svg);
      for (const needle of scene.expects) {
        expect(svg, `expected to contain: ${needle}`).toContain(needle);
      }
      const snapshotPath = scene.file.replace(/\.json$/, ".svg");
      await expect(svg).toMatchFileSnapshot(snapshotPath);
    });
  }
});
