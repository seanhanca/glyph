# RFC #3 v2 Implementation Plan — `geodesic` adds `metric: "schwarzschild-strong"`

**Goal:** Extend the geodesic shape from the weak-field Schwarzschild approximation (v1) to the full equatorial-plane Schwarzschild geodesic equations, capturing strong-field effects like photon orbits near `r = 3M` and capture at the event horizon `r = 2M`.

**Architecture:** Reuse v1's `geodesic` data key + materialize dispatch. Solver becomes a switch over `metric`. Strong-field branch integrates in (r, φ, ṙ) state via RK4, derived from the conserved E/L formulation for null geodesics. Output schema unchanged: `[seed_id, lambda, x, y]`.

**Tech Stack:** Same as v1 — TypeScript, Zod, vitest, `clampSamplerPrecision`. Zero new dependencies.

---

## Design

### The strong-field equations

For a null geodesic in Schwarzschild spacetime, restricted to the equatorial plane (θ = π/2), conservation of energy and angular momentum give

```
dt/dλ = E / (1 − 2M/r)
dφ/dλ = L / r²
(dr/dλ)² = E² − L²(1 − 2M/r)/r²
```

Differentiating the third equation with respect to λ:

```
d²r/dλ² = L²(r − 3M)/r⁴
```

This is a beautifully clean 2nd-order ODE in `r`. Combined with `dφ/dλ = L/r²`, it gives us a 3-state system `(r, φ, ṙ)` that's autonomous in λ and integrates cleanly with RK4. No turning-point sign-flips, no sqrt singularities, no special-casing radial trajectories (L=0 just makes φ constant and the radial equation reduces to `d²r/dλ² = 0` — straight radial fall, correct).

The radial restoring term `(r − 3M)/r⁴` flips sign at `r = 3M` — the photon sphere. Photons at r > 3M with sufficient L scatter; photons at r < 3M with inward ṙ are captured. This is the headline strong-field effect.

### State translation

The spec gives initial conditions in Cartesian `(x0, y0, vx0, vy0)`. We convert to `(r0, φ0, ṙ0)` plus the conserved `L`:

```
r0  = sqrt(x0² + y0²)
φ0  = atan2(y0, x0)
ṙ0  = (x0·vx0 + y0·vy0) / r0
L   = x0·vy0 − y0·vx0
```

At each emit step, convert back to Cartesian: `x = r·cos(φ)`, `y = r·sin(φ)`.

### Truncation

Two stops:
- `r ≤ 2.01·M` — the event horizon plus a thin shell. The metric component `(1 − 2M/r)` flips sign at r = 2M; the simulation is well-defined only above. The 0.01 slack avoids a final-step blow-up.
- non-finite state → terminate seed (defense in depth).

The v1 weak-field truncation at `r < 1.5·M` is unchanged; the two branches use their own truncations.

### Determinism

Same contract as v1: `clampSamplerPrecision` on every emitted `lambda`, `x`, `y`. The strong-field formula introduces `Math.cos` and `Math.sin` (via the (r, φ) → (x, y) conversion), so the precision clamp does real work here, unlike the weak-field branch where only `sqrt` was in play. The clamp is the same one used across function/trajectory/recurrence — proven bit-identical on Ubuntu/macOS/Windows by the CI matrix.

---

## File structure

| Path | Action | Why |
|------|--------|-----|
| `packages/core/src/data/shapes/geodesic.ts` | Modify | Widen `metric` to `"schwarzschild-weak" \| "schwarzschild-strong"`; add `iterateStrongField(spec)` branch; preserve weak-field code path bit-for-bit |
| `packages/core/src/data/shapes/geodesic.test.ts` | Modify | 4 new tests for strong-field (validation, value correctness at photon sphere, capture trajectory, determinism) |
| `packages/core/src/spec/schemas.ts` | Modify | Widen `GeodesicDataSchema.metric` enum to accept the new value |
| `packages/core/__fixtures__/math/black-hole-orbits.{json,test,svg}` | Create | Photon trajectories near the photon sphere — some scatter, some loop, some capture; byte-locked |
| `site/math/joy.html` | Modify | Add a caption to the gravity-lens demo (or add a second demo) noting v2's strong-field option |

---

## Task breakdown

### Task 1: Widen the schema enum

**Files:**
- Modify: `packages/core/src/spec/schemas.ts:331`

- [ ] **Step 1: Open schema, change literal to enum**

Change:
```ts
metric: z.literal("schwarzschild-weak"),
```
to:
```ts
metric: z.enum(["schwarzschild-weak", "schwarzschild-strong"]),
```

- [ ] **Step 2: Run schema tests**

```bash
cd packages/core && npx vitest run src/spec/schemas
```
Expected: PASS (the literal-vs-enum change is backwards-compatible).

### Task 2: Widen the spec type + add strong-field solver

**Files:**
- Modify: `packages/core/src/data/shapes/geodesic.ts`

- [ ] **Step 1: Widen the metric field on `GeodesicDataSpec`**

Change `metric: "schwarzschild-weak";` to `metric: "schwarzschild-weak" | "schwarzschild-strong";`.

- [ ] **Step 2: Extract weak-field branch into a helper**

Rename the loop body in `iterateGeodesic` into `iterateWeakField(spec)` so the new strong-field branch slots cleanly next to it. (Pure refactor — should keep all v1 tests green.)

- [ ] **Step 3: Add `iterateStrongField(spec)` with RK4 over (r, φ, ṙ)**

Equations:
- dr/dλ = ṙ
- dφ/dλ = L/r²
- dṙ/dλ = L²(r − 3M)/r⁴

Initial conditions:
- r0 = sqrt(x0² + y0²); φ0 = atan2(y0, x0); ṙ0 = (x0·vx0 + y0·vy0)/r0
- L = x0·vy0 − y0·vx0

Truncate at `r ≤ 2.01·M` or non-finite state. Emit `clampSamplerPrecision` on lambda/x/y.

- [ ] **Step 4: Branch `iterateGeodesic` on `spec.metric`**

```ts
if (spec.metric === "schwarzschild-strong") return iterateStrongField(spec);
return iterateWeakField(spec);
```

- [ ] **Step 5: Run all geodesic tests**

```bash
cd packages/core && npx vitest run src/data/shapes/geodesic
```
Expected: all v1 tests pass (no regression). New strong-field tests added next.

### Task 3: Strong-field tests

**Files:**
- Modify: `packages/core/src/data/shapes/geodesic.test.ts`

- [ ] **Step 1: Add validation test (mass=0 still rejected, both metrics accepted)**

- [ ] **Step 2: Add value-correctness test — photon at large b deflects more than weak-field**

```ts
it("strong-field deflects more than weak-field at moderate r/M", () => {
  const baseSeed = { x0: -100, y0: 5, vx0: 1, vy0: 0 };
  const weak = iterateGeodesic({ ...common, metric: "schwarzschild-weak", seeds: [baseSeed] });
  const strong = iterateGeodesic({ ...common, metric: "schwarzschild-strong", seeds: [baseSeed] });
  // both end up bent downward (negative y exit). Strong-field exit
  // should be MORE deflected (more negative) than weak-field.
  expect(strong[strong.length-1].y).toBeLessThan(weak[weak.length-1].y);
});
```

- [ ] **Step 3: Add capture test — photon aimed at the event horizon stops at r ~ 2M**

```ts
it("captures a photon aimed at the event horizon", () => {
  const rows = iterateGeodesic({
    metric: "schwarzschild-strong",
    mass: 1, step: 0.1, max_lambda: 100,
    seeds: [{ x0: -10, y0: 0.01, vx0: 1, vy0: 0 }],  // tiny b, nearly radial
  });
  const lastR = Math.hypot(rows[rows.length-1].x, rows[rows.length-1].y);
  expect(lastR).toBeLessThan(3);  // captured well inside photon sphere
  expect(lastR).toBeGreaterThan(2);  // not below event horizon
});
```

- [ ] **Step 4: Add determinism test (two strong-field calls produce identical JSON)**

- [ ] **Step 5: Run tests, expect all pass**

```bash
cd packages/core && npx vitest run src/data/shapes/geodesic
```

### Task 4: Black-hole-orbits fixture

**Files:**
- Create: `packages/core/__fixtures__/math/black-hole-orbits.json`
- Create: `packages/core/__fixtures__/math/black-hole-orbits.test.ts`
- Create: `packages/core/__fixtures__/math/black-hole-orbits.svg` (generated)

- [ ] **Step 1: Author the fixture JSON**

Four photons at impact parameters chosen to illustrate the strong-field regime:
- b = 6 (scatters, larger deflection than weak field)
- b = 3.5 (near the photon-sphere — loops once or twice before scattering)
- b = 2.5 (captured)
- b = -4 (scatters from below)

mass = 1, step = 0.05, max_lambda = 100.

- [ ] **Step 2: Author the test (renders SVG twice, expects byte-identical)**

Pattern matches the existing `gravity-lens.test.ts`.

- [ ] **Step 3: Run test once to generate the snapshot, then run twice to lock**

```bash
cd packages/core && npx vitest run __fixtures__/math/black-hole-orbits
```

### Task 5: joy.html caption

**Files:**
- Modify: `site/math/joy.html`

- [ ] **Step 1: Add a caption near the gravity-lens demo**

Mention: "RFC #3 v2 shipped `metric: 'schwarzschild-strong'` — see black-hole-orbits.json for photon capture and orbits near the photon sphere."

### Task 6: CI cycle

- [ ] **Step 1: Commit + push the branch**
- [ ] **Step 2: Open PR**
- [ ] **Step 3: Watch CI (6-cell matrix + audit)**
- [ ] **Step 4: Squash-merge**
- [ ] **Step 5: Sync main**

---

## Self-review

- **RFC coverage:** v1 explicitly listed strong-field as a follow-up; this plan delivers it on the same data key + materialize path.
- **Determinism:** `cos`/`sin` are the new transcendentals; `clampSamplerPrecision` per emitted row covers libm drift just like trajectory/function.
- **Schema-clean:** `metric` literal widens to an enum; v1 specs (`metric: "schwarzschild-weak"`) continue to parse + render identically.
- **Performance:** RK4 over 3 state vars × max 2000 λ-steps × 200 max seeds = 1.2M arithmetic ops worst-case — well under 100 ms.
- **Snapshot churn:** zero existing fixtures touched. One new fixture locked.
