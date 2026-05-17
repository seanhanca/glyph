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

describe("materializeSpec — gdf:// URI resolution (PR34)", () => {
  let engine: ComputeEngine;

  beforeEach(async () => {
    engine = await createDuckDBEngine();
  });

  afterEach(async () => {
    await engine.close();
  });

  it("resolves a gdf:// data.source via the supplied resolver and records parent lineage", async () => {
    // First materialization: a "published" handle, scoped to the test session id.
    const upstream = await materializeSpec(
      engine,
      {
        data: { source: fixture, format: "csv" },
        layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
      },
      { sessionId: "agent-a" },
    );
    expect(upstream.handle.uri).toBeDefined();
    const registry = new Map<string, typeof upstream.handle>();
    // biome-ignore lint/style/noNonNullAssertion: just asserted above.
    registry.set(upstream.handle.uri!, upstream.handle);

    // Downstream materialization: references the published handle by URI.
    const downstream = await materializeSpec(
      engine,
      {
        data: {
          // biome-ignore lint/style/noNonNullAssertion: just asserted above.
          source: upstream.handle.uri!,
          transform: "SELECT pickup_hour, rides FROM glyph_src_main WHERE rides > 200",
        },
        layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
      },
      {
        sessionId: "agent-b",
        resolveHandleByUri: (uri) => registry.get(uri),
      },
    );

    // Rows are the filter applied to the upstream view.
    expect(downstream.result.rowCount).toBe(5);
    // Lineage records the upstream URI as a parent.
    expect(downstream.handle.lineage?.parents).toHaveLength(1);
    expect(downstream.handle.lineage?.parents[0]?.uri).toBe(upstream.handle.uri);
    expect(downstream.handle.lineage?.parents[0]?.relation).toBe("transform");
    // The downstream URI is a fresh handle, distinct from the parent.
    expect(downstream.handle.uri).not.toBe(upstream.handle.uri);
    expect(downstream.handle.uri?.startsWith("gdf://agent-b/")).toBe(true);
  });

  it("works without a transform — gdf:// source alone yields a SELECT * passthrough", async () => {
    const upstream = await materializeSpec(
      engine,
      {
        data: { source: fixture, format: "csv" },
        layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
      },
      { sessionId: "agent-a" },
    );
    const registry = new Map<string, typeof upstream.handle>();
    // biome-ignore lint/style/noNonNullAssertion: minted above.
    registry.set(upstream.handle.uri!, upstream.handle);

    const downstream = await materializeSpec(
      engine,
      {
        // biome-ignore lint/style/noNonNullAssertion: minted above.
        data: { source: upstream.handle.uri! },
        layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
      },
      {
        sessionId: "agent-b",
        resolveHandleByUri: (uri) => registry.get(uri),
      },
    );

    // Row count matches the upstream — no transform, no filter.
    expect(downstream.result.rowCount).toBe(upstream.result.rowCount);
    expect(downstream.handle.lineage?.parents[0]?.uri).toBe(upstream.handle.uri);
  });

  it("throws when a gdf:// URI is given but no resolver was supplied", async () => {
    await expect(
      materializeSpec(engine, {
        data: { source: "gdf://nope/abc123" },
        layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
      }),
    ).rejects.toThrow(/no handle resolver was supplied/);
  });

  it("throws when the resolver returns undefined", async () => {
    await expect(
      materializeSpec(
        engine,
        {
          data: { source: "gdf://nope/abc123" },
          layers: [{ mark: "bar", encoding: { x: "pickup_hour", y: "rides" } }],
        },
        { resolveHandleByUri: () => undefined },
      ),
    ).rejects.toThrow(/Unknown gdf:\/\/ URI/);
  });
});
