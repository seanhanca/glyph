/**
 * RFC #9 — smoke test exercising every new decorative primitive
 * shipped in this RFC. The fixture composes a scene that includes:
 *
 *   - <defs> block with 2 gradients + 1 pattern
 *   - starfield (30 stars from seed 42, deterministic)
 *   - circle with gradient fill
 *   - glow (radial gradient halo)
 *   - silhouette-path (raw d-string) with stroke gradient + id attr
 *   - icon (heart from library, scaled)
 *   - ellipse with pattern fill
 *   - polygon (triangle)
 *   - polyline (dashed zig-zag)
 *   - raw-svg escape hatch
 *
 * Asserts byte-stability + the presence of every expected SVG
 * construct in the rendered output. Snapshot is locked.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileCompose } from "../../src/compiler/compose.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseComposeSpec } from "../../src/spec/compose-schema.js";

const fixtureUrl = new URL("./rfc9-primitives.json", import.meta.url);
const fixturePath = fileURLToPath(fixtureUrl);

describe("compose — RFC #9 decorative primitives", () => {
  it("renders every new primitive deterministically", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseComposeSpec(raw);
    const svg = renderSvg(compileCompose(spec));
    const svg2 = renderSvg(compileCompose(parseComposeSpec(raw)));
    expect(svg2).toBe(svg);

    // <defs> wraps the gradient + pattern definitions
    expect(svg).toContain("<defs>");
    expect(svg).toContain('<radialGradient id="g-blue"');
    expect(svg).toContain('<linearGradient id="g-trail"');
    expect(svg).toContain('<pattern id="p-hatch"');
    expect(svg).toContain('patternTransform="rotate(45)"');

    // gradient references in fills
    expect(svg).toContain('fill="url(#g-blue)"');
    expect(svg).toContain('stroke="url(#g-trail)"');
    expect(svg).toContain('fill="url(#p-hatch)"');

    // starfield emitted as 30 circles (deterministic from seed 42).
    // Tolerance: regular SceneMark circles also exist in the scene
    // (Earth disc, glow halo, icon library, etc.), so check ≥ 30.
    const circleCount = (svg.match(/<circle /g) ?? []).length;
    expect(circleCount).toBeGreaterThanOrEqual(30);

    // id on the silhouette-path's wrapping group
    expect(svg).toContain('id="trail-path"');

    // ellipse + polygon + polyline + raw-svg all present
    expect(svg).toContain("<ellipse");
    expect(svg).toContain("<polygon");
    expect(svg).toContain("<polyline");
    expect(svg).toContain("raw-svg escape hatch");

    // Heart icon (path) with scaled coords + red fill
    expect(svg).toContain('fill="#ef4444"');

    await expect(svg).toMatchFileSnapshot("./rfc9-primitives.svg");
  });

  it("starfield with the same seed produces identical positions", () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const svg1 = renderSvg(compileCompose(parseComposeSpec(raw)));
    const svg2 = renderSvg(compileCompose(parseComposeSpec(raw)));
    expect(svg1).toBe(svg2);
  });

  it("rejects raw-svg containing forbidden tags", () => {
    expect(() =>
      parseComposeSpec({
        compose: {
          viewBox: { width: 200, height: 200 },
          children: [
            {
              at: { x: 0, y: 0 },
              mark: "raw-svg",
              rawSvg: { xml: "<script>alert('xss')</script>" },
            },
          ],
        },
      }),
    ).toThrow(/forbidden/);
  });

  it("rejects raw-svg containing onclick handlers", () => {
    expect(() =>
      parseComposeSpec({
        compose: {
          viewBox: { width: 200, height: 200 },
          children: [
            {
              at: { x: 0, y: 0 },
              mark: "raw-svg",
              rawSvg: { xml: "<rect onclick=\"alert(1)\"/>" },
            },
          ],
        },
      }),
    ).toThrow(/forbidden/);
  });
});
