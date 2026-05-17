/**
 * End-to-end stats tests for materializeSpec (PR21).
 *
 * Verifies a layer's `stat` rewrites the SQL and that DuckDB executes the
 * resulting query correctly. count + sum + mean covered; bin/median are
 * deferred and surface a clear error.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ComputeEngine, GlyphSpec } from "@glyph/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDuckDBEngine } from "./engine.js";
import { materializeSpec } from "./materialize.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "..", "test-fixtures", "taxi.csv");

describe("materializeSpec — stats (PR21)", () => {
  let engine: ComputeEngine;

  beforeEach(async () => {
    engine = await createDuckDBEngine();
  });

  afterEach(async () => {
    await engine.close();
  });

  it("stat: count groups by x and counts rows per group", async () => {
    // Use the taxi fixture; count rows per pickup_hour (each row is 1 hour).
    const spec: GlyphSpec = {
      data: { source: fixture, format: "csv" },
      layers: [
        {
          mark: "bar",
          encoding: { x: "pickup_hour" },
          stat: { type: "count" },
        },
      ],
    };
    const m = await materializeSpec(engine, spec);
    expect(m.result.rowCount).toBe(12);
    // Schema should now be (pickup_hour, _count) — the synthetic column.
    const colNames = m.handle.schema.map((c) => c.name);
    expect(colNames).toEqual(["pickup_hour", "_count"]);
  });

  it("stat: count honors explicit y encoding for the count column", async () => {
    const spec: GlyphSpec = {
      data: { source: fixture, format: "csv" },
      layers: [
        {
          mark: "bar",
          encoding: { x: "pickup_hour", y: "rides" },
          stat: { type: "count" },
        },
      ],
    };
    const m = await materializeSpec(engine, spec);
    const colNames = m.handle.schema.map((c) => c.name);
    expect(colNames).toEqual(["pickup_hour", "rides"]);
  });

  it("stat: sum aggregates y per group", async () => {
    const spec: GlyphSpec = {
      data: { source: fixture, format: "csv" },
      layers: [
        {
          mark: "bar",
          encoding: { x: "pickup_hour", y: "rides" },
          stat: { type: "sum" },
        },
      ],
    };
    const m = await materializeSpec(engine, spec);
    expect(m.result.rowCount).toBe(12);
    // The fixture has 1 row per hour, so SUM(rides) per pickup_hour equals
    // the original rides column.
    const colNames = m.handle.schema.map((c) => c.name);
    expect(colNames).toEqual(["pickup_hour", "rides"]);
  });

  it("stat: mean rewrites y to AVG(y)", async () => {
    const spec: GlyphSpec = {
      data: { source: fixture, format: "csv" },
      layers: [
        {
          mark: "line",
          encoding: { x: "pickup_hour", y: "fare" },
          stat: { type: "mean" },
        },
      ],
    };
    const m = await materializeSpec(engine, spec);
    expect(m.result.rowCount).toBe(12);
  });

  it("stat: bin returns a clear 'not yet implemented' error", async () => {
    const spec: GlyphSpec = {
      data: { source: fixture, format: "csv" },
      layers: [
        {
          mark: "bar",
          encoding: { x: "fare", y: "rides" },
          stat: { type: "bin" },
        },
      ],
    };
    await expect(materializeSpec(engine, spec)).rejects.toThrow(/not yet implemented/);
  });
});
