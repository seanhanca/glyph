import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ComputeEngine } from "@glyph/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDuckDBEngine } from "./engine.js";
import { materializeSpec } from "./materialize.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "..", "test-fixtures", "taxi.csv");

describe("DuckDBEngine — registration + query", () => {
  let engine: ComputeEngine;

  beforeEach(async () => {
    engine = await createDuckDBEngine();
  });

  afterEach(async () => {
    await engine.close();
  });

  it("registers a CSV source and returns its row count", async () => {
    await engine.register({ source: fixture, format: "csv" }, "taxi");
    const r = await engine.query("SELECT COUNT(*) AS n FROM taxi");
    expect(r.rowCount).toBe(1);
    expect(Number(r.rows[0]?.[0])).toBe(12);
  });

  it("describe() returns schema with suggested encoding types", async () => {
    await engine.register({ source: fixture, format: "csv" }, "taxi");
    const s = await engine.describe("taxi");
    expect(s.rowCount).toBe(12);
    const colNames = s.columns.map((c) => c.name);
    expect(colNames).toEqual(["pickup_hour", "fare", "rides"]);
    const fare = s.columns.find((c) => c.name === "fare");
    expect(fare?.suggestedType).toBe("quantitative");
  });

  it("materialize() creates a queryable view; queryHandle() returns its rows", async () => {
    await engine.register({ source: fixture, format: "csv" }, "taxi");
    const probe = await engine.query("SELECT * FROM taxi LIMIT 0");
    const handle = await engine.materialize(
      "SELECT pickup_hour, rides FROM taxi WHERE pickup_hour < 10",
      probe.columns,
    );
    expect(handle.viewName).toMatch(/^glyph_view_/);

    const all = await engine.queryHandle(handle);
    expect(all.rowCount).toBe(7);

    const filtered = await engine.queryHandle(handle, "WHERE rides > 100");
    expect(filtered.rowCount).toBe(4);
  });

  it("rejects unsafe identifiers", async () => {
    await expect(
      engine.register({ source: fixture, format: "csv" }, "taxi; DROP TABLE x"),
    ).rejects.toThrow(/Unsafe identifier/);
  });
});

describe("materializeSpec — spec to handle, end-to-end", () => {
  let engine: ComputeEngine;

  beforeEach(async () => {
    engine = await createDuckDBEngine();
  });

  afterEach(async () => {
    await engine.close();
  });

  it("materializes a spec with an inline SQL transform", async () => {
    const m = await materializeSpec(engine, {
      data: {
        source: fixture,
        format: "csv",
        transform: "SELECT pickup_hour, rides FROM glyph_src_main WHERE pickup_hour < 10",
      },
      layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
    });
    expect(m.result.rowCount).toBe(7);
    expect(m.handle.schema.map((c) => c.name)).toEqual(["pickup_hour", "rides"]);
  });

  it("materializes a spec without a transform (raw source)", async () => {
    const m = await materializeSpec(engine, {
      data: { source: fixture, format: "csv" },
      layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
    });
    expect(m.result.rowCount).toBe(12);
  });

  it("allows follow-up queries against the materialized handle", async () => {
    const m = await materializeSpec(engine, {
      data: { source: fixture, format: "csv" },
      layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
    });
    const filtered = await engine.queryHandle(m.handle, "WHERE rides > 200");
    // Fixture has 5 rows with rides > 200: hours 7, 8, 17, 18, 19.
    expect(filtered.rowCount).toBe(5);
  });
});
