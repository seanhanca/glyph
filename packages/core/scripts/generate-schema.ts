/**
 * Generate a JSON Schema for the Glyph spec from the Zod source of truth.
 *
 * Output: dist/spec.schema.json — published with the package so editors and
 * agent tool descriptions can pick it up via `$schema`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import { GlyphSpecSchema } from "../src/spec/schemas.js";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "..", "dist", "spec.schema.json");

const schema = zodToJsonSchema(GlyphSpecSchema, {
  name: "GlyphSpec",
  $refStrategy: "root",
});

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(schema, null, 2)}\n`, "utf8");

console.log(`Wrote ${out}`);
