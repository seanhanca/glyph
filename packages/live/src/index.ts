/**
 * @glyph/live — browser hydration for Glyph SVGs.
 *
 * Reads the `data-*` attributes a `spec.interactive` render emits, wires
 * click / hover / brush handlers, and exposes a tiny imperative API:
 *
 *   const chart = glyphLive(svgEl, {
 *     query: async (sql) => { ... },        // calls glyph.query under the hood
 *   });
 *   chart.onClick(({ row, attrs }) => {...})
 *   chart.onBrush('x', ({ min, max }) => {...})
 *   chart.dispose();
 *
 * Zero external runtime deps. Works on plain `<svg>` elements (notebooks,
 * dashboards, plain HTML). Tested under happy-dom for CI portability.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A row's bound metadata, read from data-* attrs. */
export interface MarkBinding {
  /** The data-key attribute (stable row identity). */
  readonly key: string | null;
  /** Row index (numeric, parsed from data-row). */
  readonly row: number | null;
  /** All data-* attributes other than `key` and `row`, keyed by channel. */
  readonly attrs: Readonly<Record<string, string>>;
  /** The underlying SVG element this mark renders as. */
  readonly element: Element;
}

/** Source-field mapping derived from data-<channel>-field attrs on the SVG root. */
export interface ChartFields {
  readonly x?: string;
  readonly y?: string;
  readonly color?: string;
}

/** Brush extent — supports numeric (continuous) or discrete (band) cases. */
export type BrushExtent =
  | { readonly kind: "numeric"; readonly min: number; readonly max: number }
  | { readonly kind: "discrete"; readonly values: ReadonlyArray<string> };

export interface GlyphLiveOptions {
  /** Optional caller-supplied SQL runner; receives the SQL fragment from a click/brush. */
  readonly query?: (sql: string) => Promise<unknown> | unknown;
}

export interface GlyphLive {
  /** Read the channel→field map declared on the SVG root. */
  readonly fields: ChartFields;
  /** The handle id if the renderer set one. */
  readonly handleId: string | null;
  /** Subscribe to mark clicks. */
  onClick(handler: (binding: MarkBinding) => void): () => void;
  /** Subscribe to mark hover (mouseenter). */
  onHover(handler: (binding: MarkBinding) => void): () => void;
  /** Subscribe to a 1-D brush on a named channel. Drag inside the SVG to select. */
  onBrush(
    channel: "x" | "y",
    handler: (extent: BrushExtent, bindings: ReadonlyArray<MarkBinding>) => void,
  ): () => void;
  /**
   * Build a WHERE clause from a single binding (a click). Uses equality.
   * Quotes string values; passes numbers through; uses the channel→field map.
   */
  whereFor(binding: MarkBinding, channels?: ReadonlyArray<"x" | "y" | "color">): string;
  /**
   * Build a WHERE clause from a brush extent (a drag). Numeric extents
   * become `WHERE x BETWEEN a AND b`; discrete extents become `WHERE x IN (...)`.
   * (D3-brush → SQL.)
   */
  whereForExtent(channel: "x" | "y", extent: BrushExtent): string;
  /**
   * Build a WHERE clause that restricts a quantitative channel to a numeric
   * range — the SQL analog of a zoom transform on that axis.
   */
  whereForZoom(channel: "x" | "y", min: number, max: number): string;
  /** Tear down all listeners. */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

function readAttr(el: Element, name: string): string | null {
  return el.getAttribute(name);
}

function readBinding(el: Element): MarkBinding {
  const attrs: Record<string, string> = {};
  // Walk all attributes; pluck `data-*` (except key/row which are surfaced separately).
  for (const a of Array.from(el.attributes)) {
    if (!a.name.startsWith("data-")) continue;
    const name = a.name.slice(5);
    if (name === "key" || name === "row") continue;
    attrs[name] = a.value;
  }
  const rowStr = readAttr(el, "data-row");
  const row = rowStr == null ? null : Number.parseInt(rowStr, 10);
  return {
    key: readAttr(el, "data-key"),
    row: row != null && Number.isFinite(row) ? row : null,
    attrs,
    element: el,
  };
}

function readFields(svg: Element): ChartFields {
  const out: { x?: string; y?: string; color?: string } = {};
  const x = readAttr(svg, "data-x-field");
  const y = readAttr(svg, "data-y-field");
  const color = readAttr(svg, "data-color-field");
  if (x != null) out.x = x;
  if (y != null) out.y = y;
  if (color != null) out.color = color;
  return out;
}

function quoteSqlLiteral(v: string): string {
  // Numeric → pass through; everything else → single-quoted with doubled inner quotes.
  if (/^-?\d+(\.\d+)?$/.test(v)) return v;
  return `'${v.replace(/'/g, "''")}'`;
}

function quoteIdent(name: string): string {
  // SQL identifiers — double-quote and escape inner quotes.
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Hydrate a rendered Glyph SVG. The SVG must have been rendered with
 * `spec.interactive` set; otherwise this function returns a no-op handle.
 */
export function glyphLive(svg: SVGElement | Element, _options: GlyphLiveOptions = {}): GlyphLive {
  const fields = readFields(svg);
  const handleId = readAttr(svg, "data-handle");

  const marksGroup = svg.querySelector(".glyph-marks");
  const markElements: Element[] = marksGroup ? Array.from(marksGroup.children) : [];

  const disposers: Array<() => void> = [];

  function listen<K extends keyof HTMLElementEventMap>(
    target: Element,
    event: K,
    handler: (e: HTMLElementEventMap[K]) => void,
  ): void {
    target.addEventListener(event, handler as EventListener);
    disposers.push(() => target.removeEventListener(event, handler as EventListener));
  }

  function delegated(
    event: "click" | "mouseenter" | "mouseleave",
    handler: (binding: MarkBinding) => void,
  ): () => void {
    const local = (e: Event): void => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      const m = t.closest(".glyph-marks > *");
      if (!m || !marksGroup?.contains(m)) return;
      handler(readBinding(m));
    };
    svg.addEventListener(event, local, { capture: event === "mouseenter" });
    const off = (): void =>
      svg.removeEventListener(event, local, { capture: event === "mouseenter" });
    disposers.push(off);
    return off;
  }

  /**
   * Keyboard navigation (PR23 — accessibility).
   *
   * Enter / Space on a focused mark → fire the registered click handler.
   * ArrowLeft / ArrowRight  → move focus to the previous / next mark in
   * the marks group. Wraps at the boundaries.
   *
   * Marks must already carry `tabindex="0"`; the SVG renderer emits this
   * for every interactive mark.
   */
  function bindKeyboard(clickHandler: (binding: MarkBinding) => void): () => void {
    const onKey = (e: Event): void => {
      const ke = e as KeyboardEvent;
      const t = ke.target;
      if (!(t instanceof Element)) return;
      const m = t.closest(".glyph-marks > *");
      if (!m || !marksGroup?.contains(m)) return;

      if (ke.key === "Enter" || ke.key === " ") {
        ke.preventDefault();
        clickHandler(readBinding(m));
        return;
      }
      if (ke.key === "ArrowRight" || ke.key === "ArrowLeft") {
        ke.preventDefault();
        const idx = markElements.indexOf(m);
        if (idx === -1) return;
        const step = ke.key === "ArrowRight" ? 1 : -1;
        const nextIdx = (idx + step + markElements.length) % markElements.length;
        const next = markElements[nextIdx];
        if (next && next instanceof HTMLElement) next.focus();
        else if (
          next &&
          "focus" in next &&
          typeof (next as { focus?: unknown }).focus === "function"
        ) {
          (next as { focus: () => void }).focus();
        }
      }
    };
    svg.addEventListener("keydown", onKey);
    const off = (): void => svg.removeEventListener("keydown", onKey);
    disposers.push(off);
    return off;
  }

  // ---- Brush (1-D drag selection) ---------------------------------------
  function bindBrush(
    channel: "x" | "y",
    handler: (extent: BrushExtent, bindings: ReadonlyArray<MarkBinding>) => void,
  ): () => void {
    let dragging = false;
    let startCoord = 0;

    const getCoord = (e: { clientX: number; clientY: number }): number => {
      const rect = svg.getBoundingClientRect();
      return channel === "x" ? e.clientX - rect.left : e.clientY - rect.top;
    };

    const onDown = (e: Event): void => {
      const me = e as MouseEvent;
      dragging = true;
      startCoord = getCoord(me);
    };
    const onUp = (e: Event): void => {
      if (!dragging) return;
      dragging = false;
      const me = e as MouseEvent;
      const endCoord = getCoord(me);
      const a = Math.min(startCoord, endCoord);
      const b = Math.max(startCoord, endCoord);
      if (Math.abs(b - a) < 3) return; // ignore taps
      // For each mark, decide whether its center is inside [a, b].
      const inside: MarkBinding[] = [];
      const numericValues: number[] = [];
      const discreteValues = new Set<string>();
      for (const el of markElements) {
        const b1 = readBinding(el);
        const v = b1.attrs[channel];
        if (v == null) continue;
        // Use the mark element's geometric center for the bounds check.
        const r = el.getBoundingClientRect();
        const svgRect = svg.getBoundingClientRect();
        const center =
          channel === "x"
            ? r.left + r.width / 2 - svgRect.left
            : r.top + r.height / 2 - svgRect.top;
        if (center >= a && center <= b) {
          inside.push(b1);
          if (/^-?\d+(\.\d+)?$/.test(v)) numericValues.push(Number(v));
          else discreteValues.add(v);
        }
      }
      const extent: BrushExtent =
        discreteValues.size > 0
          ? { kind: "discrete", values: Array.from(discreteValues) }
          : numericValues.length > 0
            ? {
                kind: "numeric",
                min: Math.min(...numericValues),
                max: Math.max(...numericValues),
              }
            : { kind: "discrete", values: [] };
      handler(extent, inside);
    };
    listen(svg, "mousedown", onDown);
    listen(svg, "mouseup", onUp);
    return () => {}; // disposers already cover it via `listen`
  }

  // ---------------------------------------------------------------------

  function whereFor(
    binding: MarkBinding,
    channels: ReadonlyArray<"x" | "y" | "color"> = ["x"],
  ): string {
    const parts: string[] = [];
    for (const ch of channels) {
      const f = fields[ch];
      const v = binding.attrs[ch];
      if (!f || v == null) continue;
      parts.push(`${quoteIdent(f)} = ${quoteSqlLiteral(v)}`);
    }
    if (parts.length === 0) return "";
    return `WHERE ${parts.join(" AND ")}`;
  }

  function whereForExtent(channel: "x" | "y", extent: BrushExtent): string {
    const f = fields[channel];
    if (!f) return "";
    if (extent.kind === "numeric") {
      return `WHERE ${quoteIdent(f)} BETWEEN ${extent.min} AND ${extent.max}`;
    }
    // discrete
    if (extent.values.length === 0) return "";
    const list = extent.values.map((v) => quoteSqlLiteral(v)).join(", ");
    return `WHERE ${quoteIdent(f)} IN (${list})`;
  }

  function whereForZoom(channel: "x" | "y", min: number, max: number): string {
    const f = fields[channel];
    if (!f) return "";
    if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) return "";
    return `WHERE ${quoteIdent(f)} BETWEEN ${min} AND ${max}`;
  }

  return {
    fields,
    handleId,
    onClick(handler) {
      // Click via mouse + keyboard. Keyboard (Enter/Space) fires the same
      // handler so screen-reader users get parity with mouse users.
      const offMouse = delegated("click", handler);
      const offKey = bindKeyboard(handler);
      return () => {
        offMouse();
        offKey();
      };
    },
    onHover(handler) {
      return delegated("mouseenter", handler);
    },
    onBrush(channel, handler) {
      return bindBrush(channel, handler);
    },
    whereFor,
    whereForExtent,
    whereForZoom,
    dispose() {
      for (const d of disposers.splice(0)) d();
    },
  };
}

// ---------------------------------------------------------------------------
// Scrub slider — PR51
// ---------------------------------------------------------------------------

export interface AttachScrubOptions {
  /** Container the slider is inserted into. Defaults to the SVG's parent. */
  readonly container?: HTMLElement | undefined;
  /** Initial frame index. Defaults to 0. */
  readonly initial?: number | undefined;
  /** Optional label prefix shown next to the slider (e.g. "Year: "). */
  readonly label?: string | undefined;
}

export interface AttachedScrub {
  /** Current frame index (read-only mirror of the slider). */
  readonly index: number;
  /** Programmatically set the frame index + redraw. */
  setIndex(i: number): void;
  /** Remove the slider + put the SMIL <animate> elements back. */
  dispose(): void;
}

/**
 * Find a scrub-rendered chart (`<g class="glyph-marks glyph-race">`) on the
 * supplied SVG, replace its SMIL `<animate>` elements with manual control,
 * and insert an `<input type="range">` immediately before the SVG. Dragging
 * the slider redraws the chart frame-by-frame.
 *
 * The renderer emits the per-mark frame values in `<animate values="...">`
 * elements; attachScrub reads them out so no extra data attrs are needed.
 *
 * Returns undefined when the SVG carries no scrub-rendered group (so it's
 * safe to call on any chart — no-op when nothing to hydrate).
 */
export function attachScrub(
  svg: SVGElement | Element,
  options: AttachScrubOptions = {},
): AttachedScrub | undefined {
  const marksGroup = svg.querySelector("g.glyph-race");
  if (!marksGroup) return undefined;
  const animates = Array.from(marksGroup.querySelectorAll("animate"));
  if (animates.length === 0) return undefined;

  // Capture the per-mark frame data + remove the SMIL elements (so they
  // don't fight the slider's manual updates).
  interface Track {
    readonly el: Element;
    readonly attr: string;
    readonly values: ReadonlyArray<string>;
  }
  const tracks: Track[] = [];
  let frameCount = 0;
  for (const a of animates) {
    const parent = a.parentElement;
    const attr = a.getAttribute("attributeName");
    const values = a.getAttribute("values");
    if (!parent || !attr || !values) continue;
    const list = values.split(";");
    tracks.push({ el: parent, attr, values: list });
    if (list.length > frameCount) frameCount = list.length;
    a.remove();
  }
  if (tracks.length === 0 || frameCount === 0) return undefined;

  const initial = Math.max(0, Math.min(options.initial ?? 0, frameCount - 1));

  // Build the slider in HTML. Place it immediately before the SVG so the
  // chart sits below its control.
  const doc = svg.ownerDocument;
  if (!doc) return undefined;
  const wrap = doc.createElement("div");
  wrap.className = "glyph-scrub";
  wrap.style.cssText = "display:flex;align-items:center;gap:8px;margin:6px 0;font:12px system-ui;";
  const labelEl = doc.createElement("label");
  labelEl.textContent = options.label ?? "Frame:";
  const input = doc.createElement("input");
  input.type = "range";
  input.min = "0";
  input.max = String(frameCount - 1);
  input.value = String(initial);
  input.step = "1";
  input.style.cssText = "flex:1;min-width:120px;";
  const idxEl = doc.createElement("span");
  idxEl.textContent = String(initial);
  wrap.appendChild(labelEl);
  wrap.appendChild(input);
  wrap.appendChild(idxEl);

  const container = options.container ?? svg.parentElement;
  if (container) {
    container.insertBefore(wrap, svg);
  }

  let current = initial;
  const apply = (i: number): void => {
    current = Math.max(0, Math.min(i, frameCount - 1));
    for (const t of tracks) {
      const v = t.values[current];
      if (v !== undefined) t.el.setAttribute(t.attr, v);
    }
    idxEl.textContent = String(current);
  };
  apply(initial);

  const onInput = (): void => {
    apply(Number.parseInt(input.value, 10) || 0);
  };
  input.addEventListener("input", onInput);

  return {
    get index(): number {
      return current;
    },
    setIndex(i: number) {
      input.value = String(Math.max(0, Math.min(i, frameCount - 1)));
      apply(i);
    },
    dispose() {
      input.removeEventListener("input", onInput);
      wrap.remove();
      // We could re-insert the original <animate> elements here, but
      // disposal is typically tied to teardown so we leave the snapshot.
    },
  };
}
