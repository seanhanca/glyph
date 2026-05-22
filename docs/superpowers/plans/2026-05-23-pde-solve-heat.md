# RFC #4 Implementation Plan — `data.shape: "pde-solve"` v1 (heat equation)

**Goal:** Add a `data.shape: "pde-solve"` that solves a 2D partial differential equation on a fixed grid and emits one row per cell as `(x, y, u)` after `steps` integration steps. V1 ships **only `kind: "heat"`** — the simplest, most numerically stable, and lowest-determinism-risk PDE in the joy.html demo set. Wave + reaction-diffusion follow.

**Architecture:** New data shape under `packages/core/src/data/shapes/pde-solve.ts`. Discretizes the heat equation `∂u/∂t = D·∇²u` on a `cols × rows` grid via the explicit Euler scheme with a 5-point Laplacian stencil. Output schema: `[x, y, u]` — three columns, one row per grid cell after the final integration step. Paired with `mark: "heatmap"` for visual rendering.

**Tech Stack:** TypeScript, Zod, vitest, existing `clampSamplerPrecision` helper. Zero new dependencies.

**Scope cap (from the RFC):** Heat equation only for v1. Wave equation and reaction-diffusion both need ping-pong buffers + more care around numerical stability; they queue as v2. Heat is the natural starter because the explicit-Euler scheme is unconditionally stable when `D·dt / dx² < 0.25` (a constraint we enforce at schema validation).

---

## Design

### Spec shape

```jsonc
{
  "data": {
    "pde_solve": {
      "shape": "pde-solve",
      "kind": "heat",
      "domain": { "x": [-1, 1], "y": [-1, 1] },
      "grid": { "rows": 64, "cols": 64 },
      "initial": "exp(-50 * (x*x + y*y))",  // initial U(x, y, t=0)
      "params": { "D": 0.1 },                // diffusion coefficient
      "boundary": "clamp",                    // clamp | periodic
      "steps": 200,
      "dt": 0.001
    }
  },
  "layers": [{
    "mark": "heatmap",
    "encoding": { "x": "x", "y": "y", "color": "u" }
  }]
}
```

### What it generates

`rows × cols` rows total, one per grid cell after running the heat equation forward `steps` time-steps from the initial condition. Each row has columns `(x, y, u)` where `(x, y)` is the cell center in domain coordinates and `u` is the temperature at that cell at `t = steps · dt`.

### Numerical scheme

Explicit forward Euler with 5-point Laplacian:
```
u_new[i,j] = u[i,j] + D·dt · (u[i+1,j] + u[i-1,j] + u[i,j+1] + u[i,j-1] − 4·u[i,j]) / dx²
```
where `dx = (xMax − xMin) / cols`. CFL stability condition: `D·dt / dx² ≤ 0.25`. The schema validates this; an unstable spec is rejected with a clear error.

### Boundary conditions

- `"clamp"` (default): edge cells fix their values to the initial condition's edge values. Like a metal plate held at fixed temperature on its boundary.
- `"periodic"`: opposite edges wrap (`u[-1] = u[N-1]`). Like heat flowing on a torus.

### Determinism

Same per-step clamp story. Each `u_new[i,j]` goes through `clampSamplerPrecision`. No transcendentals beyond what's in the initial-condition expression (handled by the standard `expr-eval` evaluator with the existing per-row clamp).

### Why not ship wave + reaction-diffusion now

| Concern | Heat | Wave | RD |
|---------|------|------|-----|
| Order | 1st in time | 2nd in time | 1st × 2 species |
| State buffers | 1 grid | 2 grids (u, u_prev) | 2 grids (U, V) |
| Stability | `D·dt/dx² ≤ 0.25` (easy) | `c·dt/dx ≤ 1` (CFL) | depends on F, k |
| Snapshot bytes | grows monotonically smooth | oscillates indefinitely → harder to lock visually | bifurcates near phase boundaries |

Heat is by far the easiest to get byte-stable across platforms. Wave and RD need wave + reaction-diffusion infrastructure that compounds the determinism risk. Ship heat now; layer the others later.

---

## File structure

| Path | Action | Why |
|------|--------|-----|
| `packages/core/src/data/shapes/pde-solve.ts` | Create | Heat solver + grid materialization |
| `packages/core/src/data/shapes/pde-solve.test.ts` | Create | Unit tests: validation, value correctness, determinism |
| `packages/core/src/spec/schemas.ts` | Modify | `PdeSolveDataSchema` + add to `DataSourceSchema` |
| `packages/core/src/compiler/compile.ts` | Modify | `materializePdeSolveInput` + dispatch |
| `packages/core/__fixtures__/math/heat-diffusion.{json,test,svg}` | Create | A Gaussian pulse on a 32×32 grid, 200 steps |

---

## Tasks (TDD)

### Task 1 — Failing tests

5 unit tests in `pde-solve.test.ts`:

1. **Validation rejects invalid grid sizes** (rows < 4, > 256).
2. **Validation rejects CFL violation** (D·dt/dx² > 0.25).
3. **Heat equation conserves total temperature** (sum over grid is invariant under clamp boundary with smooth initial condition).
4. **Heat diffuses a Gaussian outward** (final field's peak amplitude < initial peak amplitude; final field is more spread out).
5. **Determinism** (two calls → byte-identical rows).

### Task 2 — Implement `solvePdeHeat`

Pure function: spec → `PdeRow[]`. Internal: ping-pong Float64Array buffers; no allocation per step.

### Task 3 — Schema + dispatch

Same shape as recurrence/geodesic registrations.

### Task 4 — Fixture

`heat-diffusion.{json,test,svg}` — Gaussian initial condition, 32×32 grid, 200 steps. Sanity: emits exactly 32·32 = 1024 rows.

### Task 5 — Lint, commit, PR, CI, merge

---

## Self-review

- [ ] **RFC coverage**: v1 scope cap (heat only) explicitly documented; wave + RD as follow-ups.
- [ ] **Determinism**: clampSamplerPrecision per cell per step. Existing `function`-shape evaluator handles the initial-condition expression with its own clamp.
- [ ] **Schema-clean**: new shape follows existing trajectory/recurrence/geodesic pattern.
- [ ] **Cross-platform**: explicit Euler is just arithmetic + the initial-condition expression. No new transcendental paths.
- [ ] **Performance**: 64×64 grid × 200 steps = 820 K cell-updates. ~50 ms in JS. Within budget for compile-time materialization.
