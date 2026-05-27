// site/play/playground.js
// Main controller. PR2 wires CSV upload + DuckDB-wasm; PR3 mounts the
// Monaco spec editor; PR4 turns the (spec, dataset) pair into a live
// SVG chart. Later PRs add audit panel + share.
import { describeTable, getDuckDb, loadCsv, queryRows } from "./duckdb.js";
import * as glyph from "./glyph-bundle.js";
import { compileAndRender, isSelfContainedSpec, runAudit } from "./glyph-runtime.js";
import { mountSpecEditor } from "./monaco-bootstrap.js";
import {
  GistRateLimitError,
  createAnonymousGist,
  decodeShareUrl,
  encodeShareUrl,
  fetchGist,
  openSaveToMyAccount,
} from "./share.js";

console.log("playground booting…");
console.log("@glyph/core exports:", Object.keys(glyph).slice(0, 10));

// Default spec used on first paint. Stringified once so the editor's
// model and our local `currentSpec` start in lockstep.
const DEFAULT_SPEC = JSON.stringify(
  { layers: [{ mark: "bar", encoding: { x: "hour", y: "rides" } }] },
  null,
  2,
);
let currentSpec = DEFAULT_SPEC;

// 10 MB cap on pasted/uploaded CSVs. Anything larger hangs the tab while
// DuckDB-wasm tries to parse + materialize the file; a public playground
// should fail fast with a readable message instead.
const CSV_SIZE_CAP_BYTES = 10 * 1024 * 1024;

function mountCsvUpload(host, onLoaded, onSpec) {
  host.innerHTML = `
    <input type="file" id="csv-file" accept=".csv,text/csv" />
    <p class="hint">or paste:</p>
    <textarea id="csv-paste" placeholder="hour,rides&#10;0,42&#10;1,38&#10;..." rows="8"></textarea>
    <p id="csv-status" class="hint">Initializing DuckDB…</p>
    <p class="hint" style="margin-top:12px"><strong>Built-in examples</strong> — pick a category, then an example:</p>
    <select id="csv-example" disabled>
      <option value="">— pick an example —</option>
    </select>
    <p id="csv-example-desc" class="hint" style="min-height:1.2em;margin-top:6px;font-style:italic"></p>
  `;
  const status = host.querySelector("#csv-status");
  const selectExample = host.querySelector("#csv-example");
  const exampleDesc = host.querySelector("#csv-example-desc");

  /** @type {Array<{id:string,category:string,name:string,description:string,csv:string|null,spec:string|null}>} */
  let manifest = [];

  // Eagerly warm DuckDB so the user finds out about wasm/SAB/COEP problems
  // immediately on page load, not on first paste. Also fetch the example
  // manifest in parallel — neither blocks the other.
  Promise.all([
    getDuckDb().then(
      () => "duckdb-ok",
      (e) => `DuckDB init failed: ${e.message ?? e}`,
    ),
    fetch("examples/index.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []),
  ]).then(([duckResult, examples]) => {
    if (duckResult !== "duckdb-ok") {
      status.textContent = duckResult;
      // Still allow examples — many don't need DuckDB.
    } else {
      status.textContent = "Ready — paste, upload, or pick an example.";
    }
    manifest = Array.isArray(examples) ? examples : [];
    populateDropdown();
    selectExample.disabled = false;
  });

  // Build a grouped <optgroup> structure from the manifest. Categories
  // are inserted in the order they first appear, so the manifest
  // controls the visual ordering.
  function populateDropdown() {
    const categories = [];
    const seen = new Set();
    for (const item of manifest) {
      if (!seen.has(item.category)) {
        seen.add(item.category);
        categories.push(item.category);
      }
    }
    // Wipe the existing children and re-add the placeholder + groups.
    selectExample.innerHTML = '<option value="">— pick an example —</option>';
    for (const cat of categories) {
      const group = document.createElement("optgroup");
      group.label = cat;
      for (const item of manifest.filter((m) => m.category === cat)) {
        const opt = document.createElement("option");
        opt.value = item.id;
        opt.textContent = item.name;
        group.appendChild(opt);
      }
      selectExample.appendChild(group);
    }
  }

  // In-flight token. Each load increments; stale callbacks are dropped.
  // Prevents a paste-then-pick-example race from emitting onLoaded out of
  // order or against a stale CREATE OR REPLACE target.
  let loadToken = 0;

  const handle = async (csv) => {
    if (csv.length > CSV_SIZE_CAP_BYTES) {
      const mb = (csv.length / 1024 / 1024).toFixed(1);
      status.textContent = `CSV too large (${mb} MB, max 10 MB).`;
      return;
    }
    const myToken = ++loadToken;
    status.textContent = "Loading…";
    try {
      const table = await loadCsv("data", csv);
      const cols = await describeTable(table);
      const count = (await queryRows(`SELECT COUNT(*) AS n FROM ${table}`))[0].n;
      const rows = await queryRows(`SELECT * FROM ${table}`);
      if (myToken !== loadToken) return; // a newer load won; drop this one
      status.textContent = `Loaded ${count} rows, ${cols.length} columns`;
      onLoaded({ table, rows, columns: cols });
    } catch (e) {
      if (myToken !== loadToken) return;
      status.textContent = `Error: ${e.message ?? e}`;
    }
  };

  host.querySelector("#csv-file").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (file) handle(await file.text());
  });
  host.querySelector("#csv-paste").addEventListener("blur", (e) => {
    if (e.target.value) handle(e.target.value);
  });
  selectExample.addEventListener("change", async (e) => {
    const id = e.target.value;
    if (!id) {
      exampleDesc.textContent = "";
      return;
    }
    const item = manifest.find((m) => m.id === id);
    if (!item) return;
    exampleDesc.textContent = item.description || "";

    try {
      // Spec first (if any). Always set the editor to the example spec so the
      // user sees the JSON that produces the chart. The onSpec callback
      // pushes the new text into the Monaco model + triggers rerender.
      if (item.spec) {
        const r = await fetch(item.spec, { cache: "no-store" });
        if (r.ok) {
          const specText = await r.text();
          onSpec?.(specText);
        }
      }
      // CSV (if any). Some examples are self-contained (compose / function /
      // PDE) and don't need a dataset — skip the CSV load in that case.
      if (item.csv) {
        const r = await fetch(item.csv, { cache: "no-store" });
        if (r.ok) {
          const csv = await r.text();
          host.querySelector("#csv-paste").value = csv;
          handle(csv);
        }
      } else {
        // Self-contained spec: clear the textarea + reset the status line.
        host.querySelector("#csv-paste").value = "";
        status.textContent = `Example loaded · ${item.name} (self-contained — no CSV needed)`;
        // Force a rerender even though dataset hasn't changed, because the
        // spec may have. Done by `onSpec` upstream.
      }
    } catch (err) {
      status.textContent = `Example load failed: ${err.message ?? err}`;
    }
  });
}

const csvHost = document.getElementById("csv-upload");
const chartHost = document.getElementById("chart-preview");
const auditHost = document.getElementById("audit-findings");
const trustHost = document.getElementById("trust");
let dataset = null;

// Compile + render the current spec against the current dataset and
// paint the result into the chart pane. Called whenever either input
// changes. We swallow errors here (not via the editor's validation)
// because the spec is still legal JSON Schema-wise but might point at
// a column that doesn't exist in the user's CSV — that's a runtime
// concern, surfaced as a readable message in the chart pane.
function rerender() {
  // Parse first — both chart and audit need the spec object. If the editor
  // contents aren't legal JSON, surface the error in both panes (chart pane
  // gets a red pre; audit pane gets a placeholder + the trust chip cleared)
  // and bail before touching the dataset path.
  let spec;
  try {
    spec = JSON.parse(currentSpec);
  } catch (e) {
    if (chartHost) {
      chartHost.innerHTML = `<pre class="error">JSON parse error: ${escapeHtml(e.message)}</pre>`;
    }
    renderAuditError(`JSON parse error: ${e.message}`);
    return;
  }

  // Audit is dataset-independent — runs on the spec alone. Row count is
  // passed when available so AUDIT-04 (excessive aggregation) can fire.
  renderAuditPanel(spec, dataset?.rows?.length);

  // Self-contained specs (compose scenes, function/trajectory/PDE data
  // shapes) bring their own data — render them with empty rows/schema
  // and skip the dataset binding entirely. Glyph-in-Life + Joy of Math
  // + Whyboard examples all hit this branch.
  if (isSelfContainedSpec(spec)) {
    try {
      const svg = compileAndRender(spec, [], []);
      chartHost.innerHTML = svg;
    } catch (e) {
      const raw = String(e?.message ?? e);
      const msg =
        raw.length > 1000
          ? `${raw.slice(0, 1000)}\n\n… (truncated, see DevTools console for full message)`
          : raw;
      if (raw.length > 1000) console.error("Glyph compile error (full):", e);
      chartHost.innerHTML = `<pre class="error">Compile error: ${escapeHtml(msg)}</pre>`;
    }
    return;
  }

  // Defensive guard: a malformed dataset (e.g. an upstream PR's onLoaded
  // callback firing before rows/columns are set) would otherwise throw
  // an uncaught TypeError inside the compile block below and leave the
  // previous chart visible. Fail soft: just no-op the chart render until
  // the next call — audit panel already updated above.
  if (!dataset || !Array.isArray(dataset.columns) || !Array.isArray(dataset.rows)) {
    return;
  }
  try {
    // DuckDB DESCRIBE returns `column_name` / `column_type`; the @glyph/core
    // compiler expects `name` / `type`. Translate here so PR2's dataset
    // shape stays opaque to glyph-runtime.js.
    const schema = dataset.columns.map((c) => ({
      name: c.column_name ?? c.name,
      type: c.column_type ?? c.type ?? "VARCHAR",
    }));
    // duckdb-wasm's `queryRows` returns each row as an OBJECT keyed by
    // column name (see site/play/duckdb.js — the `toArray().map(...
    // Object.fromEntries)` shape is deliberate so the share-CSV writer
    // can read `row[col]`). But @glyph/core's `compileSpec` expects
    // rows as POSITIONAL value arrays, indexed by the matching slot in
    // `schema`. Mismatch was silent — mark compilers read `row[fieldIdx]`
    // which on an object returns `undefined`, so 12 rides rows → 0 bars,
    // no error, just an empty chart. Convert here, against the same
    // `schema` order the compiler is about to use.
    const positionalRows = dataset.rows.map((row) => schema.map((col) => row[col.name]));
    const svg = compileAndRender(spec, positionalRows, schema);
    chartHost.innerHTML = svg;
  } catch (e) {
    // Compile errors from @glyph/core (Zod paths in particular) can be
    // hundreds of lines of JSON-ish issues. Clamp at 1 KB so the chart
    // pane doesn't get overwhelmed; full error is still in DevTools console.
    const raw = String(e?.message ?? e);
    const msg =
      raw.length > 1000
        ? `${raw.slice(0, 1000)}\n\n… (truncated, see DevTools console for full message)`
        : raw;
    if (raw.length > 1000) console.error("Glyph compile error (full):", e);
    chartHost.innerHTML = `<pre class="error">Compile error: ${escapeHtml(msg)}</pre>`;
  }
}

// Paint the audit panel + trust chip for a (already-parsed) spec.
// Lives outside rerender() so it stays single-purpose and so PR6's share
// flow can call it directly after restoring a spec from a URL hash.
function renderAuditPanel(spec, rowCount) {
  if (!auditHost || !trustHost) return;
  let result;
  try {
    result = runAudit(spec, { rowCount });
  } catch (e) {
    renderAuditError(`audit error: ${e.message ?? e}`);
    return;
  }
  paintTrustChip(result.trust);
  if (result.findings.length === 0) {
    auditHost.innerHTML = '<li class="clean">✓ no findings</li>';
    return;
  }
  // Findings are already sorted high → low by @glyph/core. Render each as
  // a list item carrying the severity class (consumed by styles.css) plus
  // the rule_id, message, and optional suggestion + JSON pointer.
  auditHost.innerHTML = result.findings
    .map((f) => {
      const sev =
        f.severity === "high" || f.severity === "medium" || f.severity === "low"
          ? f.severity
          : "low";
      const suggestionHtml = f.suggestion
        ? `<div class="audit-suggestion">${escapeHtml(f.suggestion)}</div>`
        : "";
      const pathHtml = f.path ? `<code class="audit-path">${escapeHtml(f.path)}</code>` : "";
      return `<li class="severity-${sev}">
        <div class="audit-head"><strong>${escapeHtml(f.rule_id)}</strong> <span class="audit-sev">${sev}</span></div>
        <div class="audit-msg">${escapeHtml(f.message)}</div>
        ${suggestionHtml}
        ${pathHtml}
      </li>`;
    })
    .join("");
}

// Paint the `#trust` chip. Wrapped in helpers so PR6's screenshot can hook
// the `.trust-score` span specifically. Severity bands match the plan:
// red < 50, amber < 80, green ≥ 80.
function paintTrustChip(trust) {
  const color = trust < 50 ? "var(--red)" : trust < 80 ? "#d4a017" : "var(--green)";
  trustHost.innerHTML = `<span class="trust-score">${trust}</span><span class="trust-label"> / 100</span>`;
  trustHost.style.color = color;
}

function renderAuditError(message) {
  if (!auditHost || !trustHost) return;
  auditHost.innerHTML = `<li class="severity-high">${escapeHtml(message)}</li>`;
  trustHost.innerHTML = "";
  trustHost.style.color = "";
}

// Minimal HTML escape for error messages. Errors from the compiler can
// echo back user-supplied identifiers; we don't want a craftily-named
// column to inject markup into the chart pane.
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

mountCsvUpload(
  csvHost,
  (loaded) => {
    dataset = loaded;
    console.log("data loaded:", dataset);
    rerender();
  },
  // onSpec — fires when the user picks an example that ships a spec. Push the
  // text into the Monaco editor (if it has booted) and into our local
  // `currentSpec` mirror so rerender() picks it up. For self-contained
  // examples (compose / function / PDE) the spec drives the render
  // entirely — no CSV needed.
  (specText) => {
    currentSpec = specText;
    if (specEditor && typeof specEditor.setValue === "function") {
      specEditor.setValue(specText);
    }
    // Clear the previous dataset so self-contained specs don't try to
    // bind to stale columns. rerender() handles either case.
    dataset = null;
    rerender();
  },
);

// Mount the Monaco spec editor. The onChange handler updates the
// in-memory copy of the spec and triggers a re-render against the
// most recent dataset.
const specHost = document.getElementById("spec-editor");
// Remembers the editor handle from mountSpecEditor so the share-load flow
// (URL hash / ?gist=) can replace the editor contents after the page has
// already booted with the default spec.
let specEditor = null;

mountSpecEditor(specHost, DEFAULT_SPEC, (next) => {
  currentSpec = next;
  console.log("spec changed:", currentSpec.length, "chars");
  rerender();
})
  .then(async (handle) => {
    specEditor = handle ?? null;
    // Monaco fires onChange only on user edits, so the default-spec audit
    // wouldn't render until the first keystroke. Paint once on successful
    // mount so the user sees the audit panel populated immediately.
    rerender();
    // Now that the editor is live, try to hydrate from a shared URL.
    await tryHydrateFromUrl();
  })
  .catch((e) => {
    console.error("monaco mount failed:", e);
    specHost.innerHTML = `<p class="placeholder">Editor failed to load: ${e.message ?? e}</p>`;
  });

// ---------- Share buttons (PR6) ----------

// Build the `{spec, csv}` payload that share.js round-trips. The CSV is
// serialized from the in-memory dataset rather than the raw textarea so we
// always share the exact rows DuckDB materialized — keeps gist + URL hash
// reproducible even if the user pasted a CSV with stray blank lines.
function currentPayload() {
  let spec;
  try {
    spec = JSON.parse(currentSpec);
  } catch {
    spec = currentSpec; // fall back to the raw string; share is best-effort
  }
  const csv = dataset?.rows
    ? toCsv(
        dataset.rows,
        dataset.columns.map((c) => c.column_name ?? c.name),
      )
    : null;
  return { spec, csv };
}

// Minimal RFC-4180-ish CSV writer. Handles commas, quotes, newlines. Good
// enough for the playground share path; the playground itself uses DuckDB
// for parsing on the read side so any encoding it can't read isn't worth
// us emitting here.
function toCsv(rows, columns) {
  const header = columns.join(",");
  const body = rows
    .map((r) =>
      columns
        .map((c) => {
          const v = r[c];
          if (v === null || v === undefined) return "";
          const s = String(v);
          return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    )
    .join("\n");
  return `${header}\n${body}\n`;
}

// Lightweight toast for share-button feedback. Lives at the bottom-right
// for ~2.5s so the user sees confirmation without a modal dialog.
function flashStatus(msg, kind = "ok") {
  const el = document.createElement("div");
  el.className = `flash flash-${kind}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => {
    el.classList.add("flash-out");
    setTimeout(() => el.remove(), 250);
  }, 2500);
}

const shareUrlBtn = document.getElementById("share-url");
const shareGistBtn = document.getElementById("share-gist");

if (shareUrlBtn) {
  shareUrlBtn.addEventListener("click", async () => {
    const payload = currentPayload();
    let hash;
    try {
      hash = encodeShareUrl(payload);
    } catch (e) {
      flashStatus(`Encode error: ${e.message ?? e}`, "err");
      return;
    }
    const url = `${location.origin}${location.pathname}#h=${hash}`;
    // URL safe budget is ~8 KB; most browsers/servers handle 8192 but some
    // chat tools mangle anything over ~7.5 KB. Past that, push the user to
    // the Gist path which has effectively no length limit.
    if (url.length > 7500) {
      const useGist = confirm(
        `URL is ${url.length} chars — that's bigger than is reliable for most chat clients.\n\nSave as a public Gist instead?`,
      );
      if (useGist) shareGistBtn?.click();
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      flashStatus(`Copied ${url.length}-char share URL`);
    } catch (e) {
      // Fall back to a prompt so the user can copy by hand if clipboard is
      // blocked (Safari, certain iframe sandboxes).
      console.warn("clipboard.writeText failed:", e);
      window.prompt("Copy this URL:", url);
    }
  });
}

if (shareGistBtn) {
  shareGistBtn.addEventListener("click", async () => {
    const payload = currentPayload();
    try {
      flashStatus("Creating gist…");
      const gist = await createAnonymousGist({
        ...payload,
        description: "Glyph playground",
      });
      const shareUrl = `${location.origin}${location.pathname}?gist=${gist.id}`;
      try {
        await navigator.clipboard.writeText(shareUrl);
        flashStatus(`Saved gist · URL copied (${shareUrl.length} chars)`);
      } catch {
        window.prompt("Copy this URL:", shareUrl);
      }
    } catch (e) {
      if (e instanceof GistRateLimitError) {
        const ok = confirm(
          `${e.message}\n\nOpen GitHub to save manually? (Your spec + CSV will be copied to the clipboard.)`,
        );
        if (ok) await openSaveToMyAccount(payload);
        return;
      }
      flashStatus(`Gist error: ${e.message ?? e}`, "err");
    }
  });
}

// ---------- Restore from share URL on load ----------

// Applies a `{spec, csv}` payload to the live editor + CSV textarea. Used by
// both URL-hash and `?gist=<id>` entry points. Swallows missing fields so a
// payload with only a spec (no data) still hydrates the editor.
async function applyPayload({ spec, csv }) {
  if (spec) {
    const text = typeof spec === "string" ? spec : JSON.stringify(spec, null, 2);
    // Defensive cap on the spec JSON itself — a malicious share could ship
    // a deeply-nested spec that hangs JSON.parse or Monaco's setValue.
    if (text.length > 1_000_000) {
      flashStatus(`Refusing to load — spec is ${(text.length / 1024).toFixed(0)} KB (cap 1 MB).`);
      return;
    }
    currentSpec = text;
    if (specEditor && typeof specEditor.setValue === "function") {
      specEditor.setValue(text);
    }
  }
  if (csv) {
    // Mirror the CSV_SIZE_CAP_BYTES guard on the paste path so a hostile
    // gist or share URL can't ship a 50 MB CSV and brick the visitor's tab.
    if (csv.length > CSV_SIZE_CAP_BYTES) {
      const mb = (csv.length / 1024 / 1024).toFixed(1);
      flashStatus(`Refusing to load — shared CSV is ${mb} MB (cap 10 MB).`);
      return;
    }
    const csvPaste = document.getElementById("csv-paste");
    if (csvPaste) {
      csvPaste.value = csv;
      // The CSV upload widget listens for `blur` to ingest pasted text;
      // synthesize one so DuckDB picks the rows up without a user gesture.
      csvPaste.dispatchEvent(new Event("blur"));
    }
  }
  // Force a rerender in case the editor doesn't fire onChange for setValue.
  rerender();
}

async function tryHydrateFromUrl() {
  const hashMatch = location.hash.match(/#h=(.+)/);
  if (hashMatch) {
    try {
      const payload = decodeShareUrl(hashMatch[1]);
      await applyPayload(payload);
      flashStatus("Loaded from shared URL");
    } catch (e) {
      console.warn("Bad share hash:", e);
      flashStatus(`Bad share URL: ${e.message ?? e}`, "err");
    }
    return;
  }
  const gistId = new URLSearchParams(location.search).get("gist");
  if (gistId) {
    try {
      flashStatus("Loading gist…");
      const payload = await fetchGist(gistId);
      await applyPayload(payload);
      flashStatus(`Loaded gist ${gistId.slice(0, 8)}…`);
    } catch (e) {
      console.warn("Failed to load gist:", e);
      flashStatus(`Failed to load gist: ${e.message ?? e}`, "err");
    }
  }
}
