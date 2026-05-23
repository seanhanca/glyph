/**
 * Second wave of Life-in-Glyph showcases: 3 bio + 3 engineering + 3
 * architecture pages. Same test pattern as bio-eng-scenes.test.ts —
 * parse, compile, render, assert presence of expected SVG constructs,
 * lock SVG snapshot.
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
    label: "bio · neuron",
    file: "./bio-neuron.json",
    expects: [
      'id="g-cell"',
      'id="g-soma"',
      'id="g-pulse"',
      "<ellipse",
      "<path",
      "dendrites",
      "soma",
      "synapse",
    ],
  },
  {
    label: "bio · butterfly",
    file: "./bio-butterfly.json",
    expects: [
      'id="g-wing-r"',
      'id="g-wing-l"',
      'id="g-hind-r"',
      'id="g-hind-l"',
      "<path",
      "Lepidoptera",
      "bilateral symmetry",
    ],
  },
  {
    label: "bio · heart + circulation",
    file: "./bio-circulation.json",
    expects: [
      'id="g-heart"',
      'id="g-lung"',
      "<path",
      "Cor humanum",
      "RA",
      "RV",
      "LA",
      "LV",
      "aorta",
      '<animateTransform attributeName="transform" type="scale"',
    ],
  },
  {
    label: "eng · suspension bridge",
    file: "./eng-bridge.json",
    expects: [
      'id="g-sky"',
      'id="g-water"',
      'id="g-tower"',
      "<polyline",
      "parabolic main cable",
      "tower",
    ],
  },
  {
    label: "eng · steam locomotive",
    file: "./eng-locomotive.json",
    expects: [
      'id="g-boiler"',
      'id="g-smoke"',
      'id="g-wheel"',
      '<animateTransform attributeName="transform" type="rotate"',
      "connecting rods",
    ],
  },
  {
    label: "eng · radio waves",
    file: "./eng-radio.json",
    expects: [
      'id="g-tip"',
      'id="g-bg"',
      "<ellipse",
      "<polyline",
      "broadcasting",
      "electromagnetic",
    ],
  },
  {
    label: "arch · greek temple",
    file: "./arch-temple.json",
    expects: [
      'id="p-flute"',
      'id="p-marble"',
      'id="g-sky"',
      "<pattern",
      "<polygon",
      "Templum Doricum",
      "stylobate",
    ],
  },
  {
    label: "arch · gothic cathedral",
    file: "./arch-cathedral.json",
    expects: [
      'id="g-dawn"',
      'id="g-rose"',
      'id="g-stone"',
      "<circle",
      "<polygon",
      "Ecclesia Cathedralis",
      "rose window",
    ],
  },
  {
    label: "arch · modern skyscraper",
    file: "./arch-skyscraper.json",
    expects: [
      'id="g-dusk"',
      'id="g-tower"',
      'id="g-reflect"',
      'id="p-windows"',
      "<pattern",
      "form follows function",
      "steel frame",
    ],
  },
];

describe("compose — showcase extensions (bio + eng + arch)", () => {
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
