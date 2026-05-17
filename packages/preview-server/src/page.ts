/**
 * The single-page app served at `GET /`.
 *
 * Self-contained: one HTML document with an inline `<script>` that:
 *   1. Parses `?t=<token>` + optional `?h=<handle>` from the URL.
 *   2. Fetches the rendered SVG from `/api/charts/<handle>.svg` (with header
 *      `X-Glyph-Token: <token>`).
 *   3. Mounts the SVG into the DOM.
 *   4. Wires click / mouseenter / mousedown+mouseup → POST to
 *      `/api/interactions/<handle>` with the bound row info.
 *
 * The hydration logic is a minimum-viable subset of `@glyph/live` — enough
 * to demo click + hover + brush from the embedded page. A follow-up will
 * swap this for the full `@glyph/live` IIFE bundle.
 */

/** HMR-safe; the page string is generated once per server start. */
export function renderPage(): string {
  return /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Glyph preview</title>
<style>
  html, body { margin: 0; padding: 0; background: #f7f7f8; font-family: system-ui, -apple-system, sans-serif; color: #1a1a1a; }
  header { padding: 12px 16px; background: #fff; border-bottom: 1px solid #e6e6e6; display: flex; justify-content: space-between; align-items: center; font-size: 13px; }
  header .status { color: #666; }
  header .status .ok { color: #2a8a4a; }
  header .status .err { color: #c33; }
  main { padding: 16px; }
  #chart { background: #fff; border: 1px solid #e6e6e6; border-radius: 6px; display: inline-block; padding: 8px; }
  .glyph-marks > * { transition: filter .12s ease-out; cursor: pointer; }
  .glyph-marks > *:hover { filter: brightness(1.08); outline: 1px solid #00000044; outline-offset: 1px; }
  #log { margin-top: 16px; padding: 12px; background: #fff; border: 1px solid #e6e6e6; border-radius: 6px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; max-height: 240px; overflow: auto; }
  #log .row { padding: 2px 0; border-bottom: 1px dotted #eee; }
  #log .row:last-child { border-bottom: none; }
</style>
</head>
<body>
<header>
  <strong>Glyph preview</strong>
  <div class="status"><span id="conn">starting…</span></div>
</header>
<main>
  <div id="chart">Loading…</div>
  <div id="log"><div class="row">No interactions yet. Click, hover, or drag the chart to send events back to the agent.</div></div>
</main>
<script>
(function() {
  const params = new URLSearchParams(location.search);
  const token = params.get("t") || "";
  const handle = params.get("h") || "";
  const conn = document.getElementById("conn");
  const chartEl = document.getElementById("chart");
  const logEl = document.getElementById("log");

  function setStatus(text, kind) {
    if (!conn) return;
    conn.innerHTML = '<span class="' + (kind || "") + '">' + text + "</span>";
  }
  function log(line) {
    if (!logEl) return;
    const row = document.createElement("div");
    row.className = "row";
    row.textContent = new Date().toLocaleTimeString() + " — " + line;
    logEl.insertBefore(row, logEl.firstChild);
  }

  if (!token) {
    setStatus("no token in URL", "err");
    chartEl.textContent = "Missing ?t= token.";
    return;
  }
  if (!handle) {
    setStatus("no handle in URL", "err");
    chartEl.textContent = "Missing ?h= handle. Call glyph_preview with a handle_id.";
    return;
  }

  async function fetchSvg() {
    const r = await fetch("/api/charts/" + encodeURIComponent(handle) + ".svg", {
      headers: { "X-Glyph-Token": token }
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.text();
  }

  function readBinding(el) {
    const attrs = {};
    for (const a of el.attributes) {
      if (!a.name.startsWith("data-")) continue;
      const n = a.name.slice(5);
      if (n === "key" || n === "row") continue;
      attrs[n] = a.value;
    }
    const rowAttr = el.getAttribute("data-row");
    return {
      key: el.getAttribute("data-key") || undefined,
      row: rowAttr === null ? undefined : Number(rowAttr),
      attrs
    };
  }

  function quoteIdent(s) { return '"' + String(s).replace(/"/g, '""') + '"'; }
  function quoteLit(v) {
    if (/^-?\\d+(\\.\\d+)?$/.test(v)) return v;
    return "'" + String(v).replace(/'/g, "''") + "'";
  }

  function readFields(svg) {
    return {
      x: svg.getAttribute("data-x-field") || undefined,
      y: svg.getAttribute("data-y-field") || undefined,
      color: svg.getAttribute("data-color-field") || undefined
    };
  }

  function whereForBinding(fields, binding) {
    const parts = [];
    if (fields.x && binding.attrs.x !== undefined) {
      parts.push(quoteIdent(fields.x) + " = " + quoteLit(binding.attrs.x));
    }
    return parts.length ? "WHERE " + parts.join(" AND ") : "";
  }

  async function postEvent(payload) {
    try {
      const r = await fetch("/api/interactions/" + encodeURIComponent(handle), {
        method: "POST",
        headers: { "X-Glyph-Token": token, "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
    } catch (err) {
      log("send failed: " + (err && err.message ? err.message : err));
    }
  }

  function hydrate(svgEl) {
    const fields = readFields(svgEl);
    const marks = svgEl.querySelectorAll(".glyph-marks > *");
    log("hydrated " + marks.length + " marks");

    svgEl.addEventListener("click", function(e) {
      const t = e.target;
      if (!(t instanceof Element)) return;
      const m = t.closest(".glyph-marks > *");
      if (!m) return;
      const binding = readBinding(m);
      const where = whereForBinding(fields, binding);
      log("click row=" + binding.row + " " + (where || "(no field map)"));
      postEvent({ kind: "click", binding: binding, whereSql: where });
    });

    let downAt = null;
    svgEl.addEventListener("mousedown", function(e) { downAt = e.clientX; });
    svgEl.addEventListener("mouseup", function(e) {
      if (downAt === null) return;
      const dx = Math.abs(e.clientX - downAt);
      downAt = null;
      if (dx < 6) return; // treat as click, handled above
      const rect = svgEl.getBoundingClientRect();
      const a = Math.min(e.clientX - rect.left, downAt - rect.left);
      const b = Math.max(e.clientX - rect.left, e.clientX - rect.left);
      log("brush dx=" + Math.round(dx) + "px");
      postEvent({ kind: "brush", extent: { kind: "numeric", min: a, max: b } });
    });
  }

  fetchSvg()
    .then(function(svgText) {
      chartEl.innerHTML = svgText;
      const svgEl = chartEl.querySelector("svg");
      if (!svgEl) throw new Error("response was not an SVG");
      setStatus("ready", "ok");
      hydrate(svgEl);
    })
    .catch(function(err) {
      setStatus("error", "err");
      chartEl.textContent = "Failed to load chart: " + (err && err.message ? err.message : err);
    });
})();
</script>
</body>
</html>
`;
}
