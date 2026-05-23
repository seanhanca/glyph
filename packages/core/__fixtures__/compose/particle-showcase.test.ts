/**
 * Particle showcase — the best Glyph can do for "particle field"
 * visualizations. Two variants (static + animated) share the same
 * vector-field spec; the animated one carries a SMIL rotate-loop.
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
    label: "particle showcase · static",
    file: "./particle-static.json",
    expects: ["Particle field", "static"],
  },
  {
    label: "particle showcase · animated",
    file: "./particle-animated.json",
    expects: [
      "Particle field",
      "animated",
      '<animateTransform attributeName="transform" type="rotate"',
    ],
  },
];

describe("compose — particle showcase (static + animated)", () => {
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
