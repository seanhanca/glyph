import { describe, expect, it } from "vitest";
import {
  DEFAULT_SPEC_VERSION,
  LIBRARY_VERSION,
  SUPPORTED_ENGINES,
  SUPPORTED_MARKS,
  SUPPORTED_RENDERERS,
  SUPPORTED_SPEC_VERSIONS,
  getCapabilities,
} from "./index.js";

describe("capabilities", () => {
  it("reports a non-empty library version", () => {
    expect(typeof LIBRARY_VERSION).toBe("string");
    expect(LIBRARY_VERSION.length).toBeGreaterThan(0);
  });

  it("knows about glyph/0.1 as the default spec version", () => {
    expect(DEFAULT_SPEC_VERSION).toBe("glyph/0.1");
    expect(SUPPORTED_SPEC_VERSIONS).toContain("glyph/0.1");
  });

  it("reports the marks the Phase 0 compiler supports", () => {
    expect(SUPPORTED_MARKS).toEqual(["bar", "point"]);
  });

  it("getCapabilities() returns a fully populated object", () => {
    const c = getCapabilities();
    expect(c.libraryVersion).toBe(LIBRARY_VERSION);
    expect(c.specVersions).toEqual(SUPPORTED_SPEC_VERSIONS);
    expect(c.defaultSpecVersion).toBe(DEFAULT_SPEC_VERSION);
    expect(c.marks).toEqual(SUPPORTED_MARKS);
    expect(c.renderers).toEqual(SUPPORTED_RENDERERS);
    expect(c.engines).toEqual(SUPPORTED_ENGINES);
    expect(c.mcpTools).toBeUndefined();
  });

  it("getCapabilities() merges extras when provided", () => {
    const tools = [
      { name: "glyph_describe", since: "0.0.0" },
      { name: "glyph_render", since: "0.0.0" },
    ];
    const c = getCapabilities({ mcpTools: tools });
    expect(c.mcpTools).toEqual(tools);
  });
});
