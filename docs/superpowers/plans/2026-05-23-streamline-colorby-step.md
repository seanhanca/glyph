# RFC #2 v2 Implementation Plan — `streamline.colorBy: "step"`

**Goal:** Add a third `colorBy` mode to the streamline mark: `"step"`, which colors each polyline along its arc by step index — a rainbow trail from start (red) to end (purple).

**Architecture:** The existing `"angle"` / `"speed"` modes emit one color per polyline (set at the seed). `"step"` differs structurally: it requires one color per *segment* along the polyline. The compiler branches on `colorBy === "step"` to emit ONE `<path>` element per consecutive pair of points, each with its own `stroke` hsl. The `"angle"` and `"speed"` branches are untouched.

**Tech Stack:** Same as the existing streamline mark — TypeScript, vitest. Zero new dependencies.

---

## Design

### The hue mapping

For step index `i` ∈ [0, N-1] along a polyline of N points:

```
hue = (i / (N - 1)) × 270
```

Hue 0° (red) at the start, 270° (purple) at the end. Stopping at 270° rather than going all the way around to 360° (which is also red) preserves the monotone progression — the eye reads the trail as having a clear direction.

Lightness fixed at 55%, saturation fixed at 70% — same defaults as the other colorBy modes for visual consistency.

Hue rounded via `.toFixed(1)` for cross-platform byte stability — same precision contract used for the `"angle"` mode.

### Per-segment path emission

Standard streamline output is ONE `<path d="M x0 y0 L x1 y1 L x2 y2 ...">` per polyline. The step-gradient variant becomes a sequence of pair-of-point paths:

```
<path d="M x0 y0 L x1 y1" stroke="hsl(0.0,70%,55%)" />
<path d="M x1 y1 L x2 y2" stroke="hsl(2.7,70%,55%)" />
...
```

Two design choices:
- **strokeLinecap: "round"** so adjacent segments join smoothly. Without it, the segment ends would appear as visible cut lines at the polyline's joints.
- **Skip degenerate segments** — if two consecutive points round to the same pixel (e.g., near a slow region of the field), drop that segment rather than emit a zero-length path.

### Snapshot churn

The existing `streamline-colorby-angle` and `streamline-colorby-speed` fixtures stay byte-identical (the `"step"` branch is gated behind a strict enum check; the existing fallback path is the same code as before). One NEW fixture is locked.

### Schema + back-compat

The schema enum widens to `["angle", "speed", "step"]`. v1 specs that set `colorBy: "angle"` or `colorBy: "speed"` parse + render identically; v1 specs that omit colorBy continue to render with `theme.fg` strokes. Only specs that explicitly opt into `"step"` see the new behavior.

---

## File structure

| Path | Action | Why |
|------|--------|-----|
| `packages/core/src/spec/schemas.ts` | Modify | Widen `colorBy` enum to include `"step"`; expand JSDoc to describe the third mode |
| `packages/core/src/compiler/marks/streamline.ts` | Modify | Widen `StreamlineConfig.colorBy` type; add `"step"` branch in the per-polyline emission loop |
| `packages/core/__fixtures__/math/streamline-colorby-step.{json,test,svg}` | Create | Rotation field with `colorBy: "step"`; byte-locked SVG |
| `site/math/joy.html` | Modify | Caption update mentioning the v2 step-gradient option |

---

## Task breakdown

### Task 1: Widen the schema enum

**Files:**
- Modify: `packages/core/src/spec/schemas.ts:1006`

- [ ] **Step 1: Change enum to include `"step"`**

```ts
colorBy: z.enum(["angle", "speed", "step"]).optional(),
```

- [ ] **Step 2: Update the JSDoc with the new mode**

Add a `-` bullet describing `"step"`: hue rotates 0°→270° along the polyline, signalling arc-length progress through the trajectory.

### Task 2: Widen the compiler type + add the step branch

**Files:**
- Modify: `packages/core/src/compiler/marks/streamline.ts`

- [ ] **Step 1: Widen `StreamlineConfig.colorBy` type**

```ts
readonly colorBy: "angle" | "speed" | "step" | undefined;
```

- [ ] **Step 2: Update `readConfig` to accept `"step"`**

```ts
const colorBy: StreamlineConfig["colorBy"] =
  colorByRaw === "angle" || colorByRaw === "speed" || colorByRaw === "step"
    ? colorByRaw
    : undefined;
```

- [ ] **Step 3: In the per-polyline emit loop, branch on `"step"`**

When `colorBy === "step"`, emit one `<path>` per pair of consecutive points instead of one `<path>` per polyline. Each segment computes its own stroke hsl by step index.

Segments with both points rounding to the same pixel are skipped.

`strokeLinecap: "round"` set on each segment to join cleanly.

### Task 3: Unit tests

**Files:**
- Modify (if a streamline unit-test file exists) or rely on the fixture for regression coverage.

Skipping inline unit tests; the existing colorBy snapshot tests provide the regression contract. The new fixture test locks the step-gradient output.

### Task 4: streamline-colorby-step fixture

**Files:**
- Create: `packages/core/__fixtures__/math/streamline-colorby-step.json`
- Create: `packages/core/__fixtures__/math/streamline-colorby-step.test.ts`
- Create: `packages/core/__fixtures__/math/streamline-colorby-step.svg` (generated)

- [ ] **Step 1: Author the fixture (rotation field, 4×4 seeds for a compact snapshot)**

Mirror the existing `streamline-colorby-angle` fixture's `dxdt=-y, dydt=x` rotation field.

- [ ] **Step 2: Author the test (snapshot determinism + path-count sanity)**

Check that the emitted SVG contains many `<path>` elements (one per segment, hundreds total) and is byte-identical across two compile cycles.

- [ ] **Step 3: Run the test once to generate the snapshot, then twice to lock**

### Task 5: joy.html caption update

**Files:**
- Modify: `site/math/joy.html`

- [ ] **Step 1: Find the particle-flow / streamline demo caption**
- [ ] **Step 2: Add a mention of v2's step-gradient mode**

### Task 6: CI cycle

- [ ] **Step 1: Commit + push the branch**
- [ ] **Step 2: Open PR**
- [ ] **Step 3: Watch CI (6-cell matrix + audit)**
- [ ] **Step 4: Squash-merge**

---

## Self-review

- **RFC coverage:** v1 RFC #2 explicitly listed the gradient-along-polyline mode as a follow-up; this plan delivers it on the same `colorBy` enum.
- **Determinism:** hue values rounded via `.toFixed(1)` same as v1 modes; SVG output byte-identical across the CI matrix.
- **Schema-clean:** enum widens; v1 specs continue to parse + render bit-for-bit identically (existing fixtures untouched).
- **Performance:** worst-case ~5000 paths per chart at 5×5 seeds × 200 steps. SVG rendering at this scale stays well under typical document load limits.
- **Snapshot churn:** zero existing fixtures touched. One new fixture locked.
