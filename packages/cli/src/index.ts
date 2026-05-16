/**
 * Glyph CLI — `glyph render | describe | query | check`.
 *
 * Designed to be both human-friendly and agent-friendly:
 *   - exit 0 on success, 1 on user error, 2 on internal error
 *   - errors go to stderr with a one-line summary an LLM can act on
 *   - `--json` flag on every command emits machine-readable output
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type GlyphSpec, compileSpec, renderSvg, safeParseSpecJson } from "@glyph/core";
import { createDuckDBEngine, materializeSpec } from "@glyph/duckdb";

const HELP = `glyph — chart-and-compute CLI

Usage:
  glyph render <spec.json> [-o file.svg] [--json]
  glyph describe <data-file>                     # CSV/Parquet/JSON
  glyph query   <spec.json> <sql>                # follow-up query
  glyph check   <spec.json> <baseline.svg>       # determinism check
  glyph --help

Spec format: see https://github.com/seanhanca/glyph/blob/main/mvp.md
`;

function readSpec(path: string): GlyphSpec {
  const raw = readFileSync(resolve(path), "utf8");
  // Strip an optional $schema editor hint.
  const parsed = safeParseSpecJson(raw);
  if (!parsed.ok) {
    throw new Error(parsed.error.message);
  }
  return parsed.spec;
}

/** Rewrite the spec's top-level data.source to be absolute relative to the spec file. */
function resolveSourcePaths(spec: GlyphSpec, specPath: string): GlyphSpec {
  if (!spec.data) return spec;
  const specDir = resolve(specPath, "..");
  return {
    ...spec,
    data: { ...spec.data, source: resolve(specDir, spec.data.source) },
  };
}

async function withEngine<T>(
  fn: (engine: Awaited<ReturnType<typeof createDuckDBEngine>>) => Promise<T>,
): Promise<T> {
  const engine = await createDuckDBEngine();
  try {
    return await fn(engine);
  } finally {
    await engine.close();
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdRender(args: string[]): Promise<number> {
  let specPath: string | undefined;
  let outPath: string | undefined;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-o" || a === "--output") {
      outPath = args[++i];
    } else if (a === "--json") {
      json = true;
    } else if (!specPath && a) {
      specPath = a;
    }
  }
  if (!specPath) {
    process.stderr.write("glyph render: missing <spec.json>\n");
    return 1;
  }
  const spec = resolveSourcePaths(readSpec(specPath), specPath);

  const svg = await withEngine(async (engine) => {
    const m = await materializeSpec(engine, spec);
    const scene = compileSpec({ spec, rows: m.result.rows, schema: m.handle.schema });
    return renderSvg(scene);
  });

  if (outPath) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(outPath, svg, "utf8");
    if (json) {
      process.stdout.write(`${JSON.stringify({ ok: true, output: outPath })}\n`);
    } else {
      process.stdout.write(`Wrote ${outPath}\n`);
    }
  } else {
    process.stdout.write(svg);
  }
  return 0;
}

async function cmdDescribe(args: string[]): Promise<number> {
  let dataPath: string | undefined;
  let json = false;
  for (const a of args) {
    if (a === "--json") json = true;
    else if (!dataPath) dataPath = a;
  }
  if (!dataPath) {
    process.stderr.write("glyph describe: missing <data-file>\n");
    return 1;
  }

  const summary = await withEngine(async (engine) => {
    await engine.register({ source: resolve(dataPath) }, "src");
    return engine.describe("src");
  });

  if (json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    process.stdout.write(`${summary.rowCount} rows\n`);
    for (const c of summary.columns) {
      process.stdout.write(
        `  ${c.name.padEnd(24)} ${c.type.padEnd(16)} ${c.suggestedType.padEnd(13)} ~${c.distinct} distinct\n`,
      );
    }
  }
  return 0;
}

async function cmdQuery(args: string[]): Promise<number> {
  const [specPath, ...rest] = args;
  const sql = rest.join(" ").trim();
  if (!specPath || !sql) {
    process.stderr.write("glyph query: usage: glyph query <spec.json> <sql>\n");
    return 1;
  }
  const spec = resolveSourcePaths(readSpec(specPath), specPath);
  const result = await withEngine(async (engine) => {
    const m = await materializeSpec(engine, spec);
    return engine.queryHandle(m.handle, sql);
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        columns: result.columns.map((c) => c.name),
        rowCount: result.rowCount,
        rows: result.rows,
      },
      bigIntReplacer,
      2,
    )}\n`,
  );
  return 0;
}

/** JSON.stringify replacer that converts BigInt → Number (DuckDB BIGINT columns). */
function bigIntReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? Number(value) : value;
}

async function cmdCheck(args: string[]): Promise<number> {
  const [specPath, baselinePath] = args;
  if (!specPath || !baselinePath) {
    process.stderr.write("glyph check: usage: glyph check <spec.json> <baseline.svg>\n");
    return 1;
  }
  const spec = resolveSourcePaths(readSpec(specPath), specPath);
  const baseline = readFileSync(resolve(baselinePath), "utf8");
  const svg = await withEngine(async (engine) => {
    const m = await materializeSpec(engine, spec);
    const scene = compileSpec({ spec, rows: m.result.rows, schema: m.handle.schema });
    return renderSvg(scene);
  });
  if (svg === baseline) {
    process.stdout.write("OK — byte-identical\n");
    return 0;
  }
  process.stdout.write("DIFF — output does not match baseline\n");
  return 1;
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
    process.stdout.write(HELP);
    return 0;
  }
  switch (cmd) {
    case "render":
      return cmdRender(rest);
    case "describe":
      return cmdDescribe(rest);
    case "query":
      return cmdQuery(rest);
    case "check":
      return cmdCheck(rest);
    default:
      process.stderr.write(`glyph: unknown command '${cmd}'\n${HELP}`);
      return 1;
  }
}
