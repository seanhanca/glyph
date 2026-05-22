# RFC #4 v2 Implementation Plan — `pde-solve` adds `kind: "wave"` + `kind: "reaction-diffusion"`

**Goal:** Add the two PDE kinds the v1 RFC scoped out: 2D wave equation (`∂²u/∂t² = c²·∇²u − γ·∂u/∂t`) and the Gray-Scott reaction-diffusion two-species system (`∂U/∂t = Dᵤ·∇²U − UV² + F(1−U)`, `∂V/∂t = Dᵥ·∇²V + UV² − (F+k)V`).

**Architecture:** Reuse v1's `pde_solve` data key + materialize dispatch. Solver becomes a switch over `kind`. Wave uses two ping-pong grids (u, u_prev). Reaction-diffusion uses two species buffers per ping-pong pair (U, V). Output schema unchanged: `[x, y, u]` — for RD we emit `V` as `u` (V is the species that produces the visible pattern; explicit choice documented in JSDoc).

**Tech Stack:** Same as v1 — TypeScript, Zod, vitest, `clampSamplerPrecision`. Zero new dependencies.

---

## Design

### Wave equation

```
∂²u/∂t² = c²·∇²u − γ·∂u/∂t
```

Second-order in time, so we need TWO previous states (`u` at current step, `u_prev` at previous step). Update via the standard leapfrog scheme:

```
u_new = 2·u − u_prev + dt²·c²·∇²u/dx² − γ·dt·(u − u_prev)
```

**CFL stability** (the Courant condition): `c·dt/dx ≤ 1`. We enforce this at schema validation.

**Initial conditions:** caller provides `u(x, y, 0)` AND `∂u/∂t(x, y, 0)`. The schema introduces a NEW field `initial_velocity` (optional, defaults to 0 — a "stone dropped into still water" mental model). Internally we synthesize `u_prev = u_initial − dt·u_initial_velocity` so the first leapfrog step has both required inputs.

**Visualization:** the joy.html demo shows ripples expanding and reflecting; the Glyph-spec version emits a snapshot at `steps · dt`, which captures one moment in the propagating wavefront.

### Reaction-diffusion (Gray-Scott)

```
∂U/∂t = Dᵤ·∇²U − U·V² + F·(1 − U)
∂V/∂t = Dᵥ·∇²V + U·V² − (F + k)·V
```

Two species coupled through the reaction term `U·V²`. The classic visualization. New schema fields: `params.Du, Dv, F, k`. Output emits V (the species whose pattern is visually striking; U is its "fuel," largely uniform).

**Initial conditions:** caller provides `initial_U` and `initial_V` expressions. Defaults: `U = 1` everywhere, `V = 0` everywhere with a small Gaussian "seed" at the center — exactly how the joy.html demo bootstraps the pattern. We give the user explicit expression control though, so a recipe can engineer specific patterns.

**Stability:** explicit Euler on diffusion alone requires `max(Du,Dv)·dt/dx² ≤ 0.25`. Schema validates.

**Patterns:** `(F, k)` parameter combinations produce dramatically different patterns:
- `(F=0.062, k=0.062)` → leopard spots
- `(F=0.029, k=0.057)` → zebra stripes
- `(F=0.055, k=0.062)` → coral worms

We don't bake presets into the schema; the user picks `params.F` and `params.k` directly. The joy.html demo's preset names go into the fixture's documentation.

---

## File structure

| Path | Action | Why |
|------|--------|-----|
| `packages/core/src/data/shapes/pde-solve.ts` | Modify | Add `kind: "wave"` + `kind: "reaction-diffusion"` solver branches; new optional fields (`initial_velocity`, `initial_U`, `initial_V`) on the spec type; widen CFL validator per kind |
| `packages/core/src/data/shapes/pde-solve.test.ts` | Modify | 4 new tests per kind (validation, value correctness, stability boundary, determinism) |
| `packages/core/src/spec/schemas.ts` | Modify | Widen `kind` enum to `"heat" \| "wave" \| "reaction-diffusion"`; add the optional initial-condition fields |
| `packages/core/__fixtures__/math/wave-ripples.{json,test,svg}` | Create | A Gaussian pulse propagating outward + reflecting; byte-locked |
| `packages/core/__fixtures__/math/rd-spots.{json,test,svg}` | Create | Gray-Scott with the leopard-spots `(F, k)` parameters |
| `site/math/joy.html` | Modify | "This is now a Glyph spec" captions on wave-ripples + reaction-diffusion demos |

---

## Self-review

- **RFC coverage:** v1 explicitly scoped these out; this plan delivers them on the same data key + materialize path.
- **Determinism:** same `clampSamplerPrecision` per-cell-per-step contract. No new transcendentals.
- **Schema-clean:** `kind` enum widens; new fields are optional with sane defaults so v1 specs continue to parse + render identically.
- **Performance:** Wave at 32×32 × 200 steps = 200K cell-updates; RD at 32×32 × 200 steps × 2 species = 400K. Both <100 ms in JS.
- **Snapshot churn:** zero existing fixtures touched. Two new fixtures locked.
