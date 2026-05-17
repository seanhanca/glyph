/**
 * Tests for DataHandle promotion (PR32 — Phase 3 Tier A foundation).
 *
 * materializeSpec now returns a DataHandle (still satisfies QueryHandle for
 * back-compat). Verifies the new GDF fields are populated correctly.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ComputeEngine } from "@glyph/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDuckDBEngine } from "./engine.js";
import { materializeSpec } from "./materialize.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "..", "test-fixtures", "taxi.csv");

describe("materializeSpec — DataHandle promotion (PR32)", () => {
  let engine: ComputeEngine;

  beforeEach(async () => {
    engine = await createDuckDBEngine();
  });

  afterEach(async () => {
    await engine.close();
  });

  it("retains the Phase-0 fields (id / viewName / schema)", async () => {
    const m = await materializeSpec(engine, {
      data: { source: fixture, format: "csv" },
      layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
    });
    expect(typeof m.handle.id).toBe("string");
    expect(m.handle.id.length).toBeGreaterThan(0);
    expect(m.handle.viewName).toMatch(/^glyph_view_/);
    expect(Array.isArray(m.handle.schema)).toBe(true);
  });

  it("populates a gdf:// URI", async () => {
    const m = await materializeSpec(engine, {
      data: { source: fixture, format: "csv" },
      layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
    });
    expect(m.handle.uri).toBeDefined();
    expect(m.handle.uri).toMatch(/^gdf:\/\/local\/[0-9a-f]+$/);
  });

  it("uses the caller-supplied sessionId in the URI", async () => {
    const m = await materializeSpec(
      engine,
      {
        data: { source: fixture, format: "csv" },
        layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
      },
      { sessionId: "test-abc" },
    );
    expect(m.handle.uri?.startsWith("gdf://test-abc/")).toBe(true);
  });

  it("attaches lineage with the SQL + a producer record", async () => {
    const m = await materializeSpec(engine, {
      data: {
        source: fixture,
        format: "csv",
        transform: "SELECT pickup_hour, rides FROM glyph_src_main WHERE rides > 100",
      },
      layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
    });
    expect(m.handle.lineage?.sql).toContain("WHERE rides > 100");
    expect(m.handle.lineage?.producer.tool).toBe("materializeSpec");
    expect(m.handle.lineage?.producer.agent).toBe("glyph");
    expect(m.handle.lineage?.producer.sessionId).toBe("local");
    // Freshness should parse as a valid ISO timestamp.
    expect(Number.isNaN(Date.parse(m.handle.lineage?.producer.at ?? ""))).toBe(false);
  });

  it("populates provenance with sampleRows = rowCount", async () => {
    const m = await materializeSpec(engine, {
      data: { source: fixture, format: "csv" },
      layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
    });
    expect(m.handle.provenance?.sampleRows).toBe(m.result.rowCount);
    expect(m.handle.provenance?.confidence).toBe("high");
    expect(m.handle.provenance?.filteredOut).toBe(0);
  });

  it("emits a duckdb-view binding pointing at the engine's view name", async () => {
    const m = await materializeSpec(engine, {
      data: { source: fixture, format: "csv" },
      layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
    });
    expect(m.handle.binding?.kind).toBe("duckdb-view");
    expect(m.handle.binding?.location).toBe(m.handle.viewName);
  });

  it("version starts at 1; subscribable defaults to false", async () => {
    const m = await materializeSpec(engine, {
      data: { source: fixture, format: "csv" },
      layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
    });
    expect(m.handle.version).toBe(1);
    expect(m.handle.subscribable).toBe(false);
    expect(m.handle.subscriptionUri).toBeUndefined();
  });
});
