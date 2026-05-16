/**
 * CLI integration tests. Exercises the dispatcher with real fixtures.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "./index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "..", "..", "duckdb", "test-fixtures", "taxi.csv");
const snapshotSpec = join(
  here,
  "..",
  "..",
  "duckdb",
  "test-fixtures",
  "snapshots",
  "specs",
  "taxi-bar.json",
);
const snapshotBaseline = join(
  here,
  "..",
  "..",
  "duckdb",
  "test-fixtures",
  "snapshots",
  "baselines",
  "taxi-bar.svg",
);

describe("glyph CLI", () => {
  let tmpDir: string;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let stdoutChunks: string[];
  let stderrChunks: string[];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "glyph-cli-"));
    stdoutChunks = [];
    stderrChunks = [];
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      // biome-ignore lint/suspicious/noExplicitAny: spy
      .mockImplementation(((data: any) => {
        stdoutChunks.push(String(data));
        return true;
      }) as never);
    stderrSpy = vi
      .spyOn(process.stderr, "write")
      // biome-ignore lint/suspicious/noExplicitAny: spy
      .mockImplementation(((data: any) => {
        stderrChunks.push(String(data));
        return true;
      }) as never);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("--help prints usage and exits 0", async () => {
    const code = await main(["--help"]);
    expect(code).toBe(0);
    expect(stdoutChunks.join("")).toMatch(/glyph render/);
  });

  it("unknown command exits 1", async () => {
    const code = await main(["zoom"]);
    expect(code).toBe(1);
    expect(stderrChunks.join("")).toMatch(/unknown command/);
  });

  it("describe reports row count + column types", async () => {
    const code = await main(["describe", fixture, "--json"]);
    expect(code).toBe(0);
    const out = JSON.parse(stdoutChunks.join(""));
    expect(out.rowCount).toBe(12);
    expect(out.columns.map((c: { name: string }) => c.name)).toEqual([
      "pickup_hour",
      "fare",
      "rides",
    ]);
  });

  it("render writes to -o file", async () => {
    const out = join(tmpDir, "out.svg");
    const code = await main(["render", snapshotSpec, "-o", out]);
    expect(code).toBe(0);
    expect(readFileSync(out, "utf8")).toContain("<svg");
  });

  it("check returns 0 for byte-identical output", async () => {
    const code = await main(["check", snapshotSpec, snapshotBaseline]);
    expect(code).toBe(0);
    expect(stdoutChunks.join("")).toContain("OK");
  });

  it("check returns 1 when output differs", async () => {
    // Write a tampered baseline.
    const fake = join(tmpDir, "fake.svg");
    writeFileSync(fake, "<svg>NOT MATCHING</svg>", "utf8");
    const code = await main(["check", snapshotSpec, fake]);
    expect(code).toBe(1);
    expect(stdoutChunks.join("")).toContain("DIFF");
  });

  it("query returns rows from the materialized view", async () => {
    const code = await main(["query", snapshotSpec, "WHERE rides > 200"]);
    expect(code).toBe(0);
    const out = JSON.parse(stdoutChunks.join(""));
    expect(out.rowCount).toBe(5);
  });
});
