/**
 * Integration tests for @glyph/preview-server.
 *
 * Spins a real HTTP server on an ephemeral port, exercises:
 *   - 401 on missing/wrong token (page + /api/*)
 *   - 200 on page load with valid token
 *   - 404 on unknown chart id
 *   - 202 on POST interactions; long-poll resolves
 *   - 401 / 400 / 404 boundaries
 *   - server.stop() releases any parked long-pollers
 *   - urlFor() produces a valid deep-link URL
 *   - queue overflow drops oldest
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type PreviewServer, createPreviewServer } from "./index.js";
import { MAX_QUEUED_PER_HANDLE } from "./queue.js";

const SAMPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60" data-x-field="hour"><g class="glyph-marks"><rect data-key="0" data-row="0" data-x="7"/></g></svg>`;

describe("@glyph/preview-server", () => {
  let ps: PreviewServer;
  let baseUrl: string;
  let token: string;

  beforeEach(async () => {
    ps = createPreviewServer();
    await ps.start();
    const u = ps.urlFor();
    baseUrl = new URL(u.url).origin;
    token = u.token;
  });

  afterEach(async () => {
    await ps.stop();
  });

  // ---- auth ---------------------------------------------------------------
  it("page load returns 401 without a token", async () => {
    const r = await fetch(baseUrl);
    expect(r.status).toBe(401);
  });

  it("page load returns 200 with a valid token", async () => {
    const r = await fetch(`${baseUrl}/?t=${token}`);
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toMatch(/Glyph preview/);
  });

  it("page load with the wrong token returns 401", async () => {
    const r = await fetch(`${baseUrl}/?t=wrongwrongwrongwrongwrongwrongwr`);
    expect(r.status).toBe(401);
  });

  it("/api/* requires the X-Glyph-Token header", async () => {
    const r = await fetch(`${baseUrl}/api/charts/abc.svg`);
    expect(r.status).toBe(401);
  });

  // ---- chart serving -------------------------------------------------------
  it("returns 404 for an unknown chart id", async () => {
    const r = await fetch(`${baseUrl}/api/charts/unknown.svg`, {
      headers: { "X-Glyph-Token": token },
    });
    expect(r.status).toBe(404);
  });

  it("returns the registered SVG for a known chart id", async () => {
    ps.registerChart("abc", SAMPLE_SVG);
    const r = await fetch(`${baseUrl}/api/charts/abc.svg`, {
      headers: { "X-Glyph-Token": token },
    });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("image/svg+xml");
    expect(await r.text()).toBe(SAMPLE_SVG);
  });

  // ---- interactions --------------------------------------------------------
  it("POSTed click is delivered to awaitInteraction()", async () => {
    const waiter = ps.awaitInteraction("abc", 1000);
    const r = await fetch(`${baseUrl}/api/interactions/abc`, {
      method: "POST",
      headers: { "X-Glyph-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "click",
        binding: { key: "k7", row: 7, attrs: { x: "7" } },
        whereSql: 'WHERE "hour" = 7',
      }),
    });
    expect(r.status).toBe(202);
    const event = await waiter;
    expect(event?.kind).toBe("click");
    expect(event?.binding?.attrs?.x).toBe("7");
    expect(event?.whereSql).toBe('WHERE "hour" = 7');
  });

  it("awaitInteraction times out with null when no event arrives", async () => {
    const event = await ps.awaitInteraction("idle", 80);
    expect(event).toBeNull();
  });

  it("interactions queue up when no waiter is parked", async () => {
    await fetch(`${baseUrl}/api/interactions/q1`, {
      method: "POST",
      headers: { "X-Glyph-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "click" }),
    });
    expect(ps.pendingInteractions("q1")).toBe(1);
    const event = await ps.awaitInteraction("q1", 10);
    expect(event?.kind).toBe("click");
    expect(ps.pendingInteractions("q1")).toBe(0);
  });

  it("rejects POST with unknown kind", async () => {
    const r = await fetch(`${baseUrl}/api/interactions/abc`, {
      method: "POST",
      headers: { "X-Glyph-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "blink" }),
    });
    expect(r.status).toBe(400);
  });

  it("queue overflow drops oldest beyond MAX_QUEUED_PER_HANDLE", async () => {
    for (let i = 0; i < MAX_QUEUED_PER_HANDLE + 5; i++) {
      await fetch(`${baseUrl}/api/interactions/over`, {
        method: "POST",
        headers: { "X-Glyph-Token": token, "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "click", binding: { row: i } }),
      });
    }
    expect(ps.pendingInteractions("over")).toBe(MAX_QUEUED_PER_HANDLE);
  });

  // ---- lifecycle ----------------------------------------------------------
  it("stop() releases parked long-pollers with null", async () => {
    const waiter = ps.awaitInteraction("park", 10_000);
    await ps.stop();
    const event = await waiter;
    expect(event).toBeNull();
    // Re-start for afterEach symmetry: spin up a fresh one.
    ps = createPreviewServer();
    await ps.start();
  });

  it("isRunning() reflects state", async () => {
    expect(ps.isRunning()).toBe(true);
    await ps.stop();
    expect(ps.isRunning()).toBe(false);
    ps = createPreviewServer();
    await ps.start();
  });

  // ---- URL building -------------------------------------------------------
  it("urlFor() emits a /?t=<token>&h=<handle> deep link", async () => {
    const u = ps.urlFor("xyz");
    const parsed = new URL(u.url);
    expect(parsed.hostname).toBe("127.0.0.1");
    expect(parsed.searchParams.get("t")).toBe(token);
    expect(parsed.searchParams.get("h")).toBe("xyz");
  });

  it("urlFor() without a handle omits the h parameter", async () => {
    const u = ps.urlFor();
    const parsed = new URL(u.url);
    expect(parsed.searchParams.get("h")).toBeNull();
  });

  // ---- security ----------------------------------------------------------
  it("binds only to 127.0.0.1", async () => {
    const u = ps.urlFor();
    expect(new URL(u.url).hostname).toBe("127.0.0.1");
  });
});
