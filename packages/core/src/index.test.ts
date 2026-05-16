import { describe, expect, it } from "vitest";
import { VERSION } from "./index.js";

describe("@glyph/core", () => {
  it("exports a version constant", () => {
    expect(typeof VERSION).toBe("string");
    expect(VERSION.length).toBeGreaterThan(0);
  });
});
