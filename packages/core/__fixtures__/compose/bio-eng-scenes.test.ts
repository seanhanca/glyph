/**
 * Bio + Engineering showcases extending Life in Glyph (without touching
 * any of the existing 8 hand-authored heroes). Each fixture exercises
 * the RFC #9 decorative primitives (gradients, patterns, starfield,
 * glow, silhouette-path, icon, ellipse, polygon, polyline, raw-svg)
 * to test whether the compose grammar can match the quality bar the
 * hand-authored heroes set.
 *
 * Asserts byte-stability + key SVG constructs per scene. Snapshots are
 * locked in `.svg` siblings.
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
    label: "bio · DNA helix",
    file: "./bio-dna.json",
    expects: [
      'id="g-strand-a"',
      'id="g-strand-b"',
      'stroke="url(#g-strand-a)"',
      'stroke="url(#g-strand-b)"',
      "<defs>",
      "<polyline",
      "Deoxyribonucleic",
    ],
  },
  {
    label: "bio · jellyfish",
    file: "./bio-jellyfish.json",
    expects: ['id="g-bell"', 'id="g-tentacle"', "<ellipse", "Aurelia aurita", "<circle "],
  },
  {
    label: "eng · hydraulic press",
    file: "./eng-hydraulic.json",
    expects: [
      'id="p-fluid"',
      'id="p-piston"',
      "<pattern",
      'fill="url(#p-fluid)"',
      "A₁",
      "A₂",
      "Pressure equalizes",
    ],
  },
  {
    label: "eng · windmill",
    file: "./eng-windmill.json",
    expects: [
      'id="p-stone"',
      'id="g-sky"',
      'id="g-sun"',
      "<polygon",
      "<ellipse",
      '<animateTransform attributeName="transform" type="rotate"',
      "Netherlands",
    ],
  },
];

describe("compose — bio + engineering RFC #9 showcases", () => {
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
