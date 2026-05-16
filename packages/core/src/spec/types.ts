/**
 * Glyph spec — TypeScript types.
 *
 * These types describe the wire format an agent writes. They are derived from
 * the Zod schemas in `./schemas.ts` — keep both in sync by always editing the
 * schema and inferring the type via `z.infer`.
 *
 * Design principles (token-efficient agent surface):
 *   - Short, meaningful field names.
 *   - Most fields optional with sensible inferred defaults.
 *   - Single-field shorthands (e.g. encoding can be a bare field name string).
 *   - Layers stack — every plot is one or more layers.
 *   - No alternate config files; one JSON object describes everything.
 */

import type { z } from "zod";
import type {
  ChannelSchema,
  DataSourceSchema,
  EncodingSchema,
  GlyphSpecSchema,
  LayerSchema,
  MarkSchema,
  ScaleSchema,
  StatSchema,
} from "./schemas.js";

/** Top-level Glyph spec. */
export type GlyphSpec = z.infer<typeof GlyphSpecSchema>;

/** A data source: a path/URL plus an optional SQL transform. */
export type DataSource = z.infer<typeof DataSourceSchema>;

/** One drawing layer: mark + encoding (+ optional stat/position). */
export type Layer = z.infer<typeof LayerSchema>;

/** The mark type — what shape gets drawn for each row. */
export type Mark = z.infer<typeof MarkSchema>;

/** The encoding maps fields to visual channels. */
export type Encoding = z.infer<typeof EncodingSchema>;

/** A single channel value: either a bare field name or a fully-specified channel. */
export type Channel = z.infer<typeof ChannelSchema>;

/** Per-channel scale override. */
export type Scale = z.infer<typeof ScaleSchema>;

/** Aggregation/binning statistic applied before drawing. */
export type Stat = z.infer<typeof StatSchema>;

/**
 * A QueryHandle is returned alongside the rendered chart. It identifies the
 * materialized DuckDB view that backs the chart so the agent can issue
 * follow-up queries without re-uploading data.
 */
export interface QueryHandle {
  readonly id: string;
  readonly viewName: string;
  readonly schema: ReadonlyArray<{ name: string; type: string }>;
}
