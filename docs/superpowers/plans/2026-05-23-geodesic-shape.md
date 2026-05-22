# RFC #3 Implementation Plan — `data.shape: "geodesic"`

**Goal:** Add a `data.shape: "geodesic"` that integrates photon paths through the equatorial plane of a Schwarzschild black hole, so the joy.html gravity-lens demo becomes a Glyph spec.

**Architecture:** New data shape under `packages/core/src/data/shapes/geodesic.ts`. Each spec defines a `metric`, a `mass`, and a list of `seeds` (initial 2D position + velocity). The integrator RK4-walks the photon's `(x, y, vx, vy)` state through the gravitational field and emits one row per step. Output schema: `[seed_id, lambda, x, y]` — `seed_id` first so `encoding.color` can hue by ray, `lambda` second so `animation.kind: "scrub"` works the same way the trajectory shape does it.

**Scope v1 — weak-field Schwarzschild only.** The acceleration term is `a = -2·G·M·r̂ / r²`, the Newtonian magnitude with the famous factor-of-2 enhancement that reproduces GR's `4M/b` light-bending in the weak field. Matches the full geodesic equation to first order in `M/r`, which is the regime the gravity-lens demo lives in. Full strong-field Binet-equation integration is queued for a follow-up.

**Tech Stack:** TypeScript, Zod, vitest, existing `clampSamplerPrecision` helper. Zero new dependencies.

---

## Design — answers to objections

**Q: Why weak-field, not the full strong-field geodesic equation?**
A: Two reasons. (1) The joy.html demo and the typical gravitational-lens visualization run at impact parameters >> 1.5·rs (the photon sphere), where weak-field is accurate to <0.1%. Strong-field deflection becomes infinite as b → 1.5·rs, which would need event-horizon detection + tangent-asymptote handling — fragile for v1. (2) Strong-field Schwarzschild requires Christoffel-symbol bookkeeping in 4D `(t, r, θ, φ)` coords with an `equatorial-plane` projection. That's a separate followup; we ship the easy correct version now.

**Q: Why a new data shape instead of extending `trajectory`?**
A: `trajectory` is a 2-state ODE (`x, y`) integrated in `t`. Geodesic is a 4-state ODE (`x, y, vx, vy`) integrated in affine parameter `λ`, with potentially many seeds in one spec. Smashing them into one shape would over-parameterize trajectory; a dedicated shape with `seeds: [{...}]` is more agent-readable.

**Q: Determinism?**
A: Same recipe as the rest of the math shapes. Every RK4 step's output goes through `clampSamplerPrecision`. `Math.sqrt` is bit-exact across libm (the only transcendental is hidden inside the multiplication, which is exactly rounded). The `seeds` array order is the iteration order.

**Q: What happens when a photon falls into the event horizon?**
A: We truncate that seed's polyline at the step where `r < 1.5·M` (the photon sphere — light at that radius orbits indefinitely; below is captured). Documented in the JSDoc; the test exercises a captured-photon case.

---

## File structure

| Path | Action | Why |
|------|--------|-----|
| `packages/core/src/data/shapes/geodesic.ts` | Create | RK4 integrator + validation + the weak-field acceleration term |
| `packages/core/src/data/shapes/geodesic.test.ts` | Create | Unit tests: deflection formula, capture truncation, multi-seed determinism |
| `packages/core/src/spec/schemas.ts` | Modify | `GeodesicDataSchema` + add to `DataSourceSchema` |
| `packages/core/src/compiler/compile.ts` | Modify | `materializeGeodesicInput` + dispatch |
| `packages/core/__fixtures__/math/gravity-lens.{json,test,svg}` | Create | The joy.html demo as a Glyph spec; byte-locked snapshot |
| `site/math/joy.html` | Modify | "This is already a Glyph spec" caption link |

---

## Tasks

### Task 1: Write the geodesic sampler (TDD red)

- [ ] Write `geodesic.test.ts` with 4 unit tests:
  1. **Straight ray, M=0** — no deflection, output is a straight line.
  2. **Weak-field deflection** — ray at b=10, M=1, integrated past the lens, deflection angle ≈ 4M/b within 2%.
  3. **Photon-sphere truncation** — ray aimed directly at lens (b=0, M=1) gets captured; polyline truncates.
  4. **Determinism** — same spec → identical row bytes across two calls.
- [ ] Verify they fail with "iterateGeodesic is not defined."

### Task 2: Implement `iterateGeodesic`

- [ ] Validation: finite seeds, mass > 0, step > 0, max_lambda > 0.
- [ ] State: `(x, y, vx, vy)` per seed.
- [ ] `dvx/dλ = -2·M·x / r³`, `dvy/dλ = -2·M·y / r³`. (Identical to Newton's law with M scaled 2× — the GR weak-field correction.)
- [ ] RK4 with the same precision-clamp loop the trajectory sampler uses.
- [ ] Truncate per-seed at `r < 1.5·M` (photon sphere) OR `lambda > max_lambda`.
- [ ] Emit rows `{ seed_id, lambda, x, y }` per integration step.

### Task 3: Schema + compiler wiring

- [ ] `GeodesicDataSchema` (Zod) — strict object, metric enum (`"schwarzschild-weak"` only), mass `.positive()`, seeds array (min 1 max 200), step + max_lambda positive numbers.
- [ ] Add `geodesic` to `DataSourceSchema` + the data-key refinement.
- [ ] `materializeGeodesicInput` in `compile.ts` mirrors `materializeTrajectoryInput`. Schema is `[seed_id (BIGINT), lambda (DOUBLE), x (DOUBLE), y (DOUBLE)]`. Uses `TRAJECTORY_SOURCE` sentinel so line marks preserve insertion order (geodesics with bending are non-monotone in x).
- [ ] Compile-spec dispatch `if (spec.data?.geodesic) ...`.

### Task 4: End-to-end fixture

- [ ] `gravity-lens.json` — five rays at impact parameters {-1.0, -0.3, 0, 0.3, 1.0} around a unit mass.
- [ ] `gravity-lens.test.ts` — byte-stable snapshot + sanity (≥4 paths emit; the central ray gets captured so it may emit fewer points).
- [ ] Generate snapshot, eyeball that the SVG has the expected fan of light rays bending toward the lens.

### Task 5: joy.html caption + ship

- [ ] Update the gravity-lens demo caption to link the new fixture.
- [ ] Full core suite green.
- [ ] Lint clean.
- [ ] Commit, PR, CI green, merge.

---

## Self-review

- [ ] **RFC coverage**: yes — extension 4's spec shape simplified to a 2D Cartesian formulation for v1, full Schwarzschild Binet-equation queued as follow-up.
- [ ] **Determinism**: clampSamplerPrecision applied per step. No external state.
- [ ] **Schema-clean**: new shape follows existing trajectory/recurrence pattern.
- [ ] **Agent-readable**: Zod schema's JSDoc names the units (M=G=c=1), the supported metric, and the v1 limitation explicitly.
- [ ] **Cross-platform**: same precision clamp as other shapes. No `atan2`/`exp` — only `sqrt` and arithmetic.
