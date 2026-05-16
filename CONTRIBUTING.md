# Contributing to Glyph

Thanks for considering a contribution. Glyph is pre-alpha; the surface is moving fast.

## Setup

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

Node 20+ and pnpm 9+ required.

## Workflow

1. Open an issue first if the change is non-trivial.
2. Branch from `main`. Prefix branch names: `feat/`, `fix/`, `chore/`, `docs/`.
3. Conventional Commits style (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`).
4. Every PR must pass lint + typecheck + test on the full CI matrix.
5. Snapshot tests must remain byte-identical across OS/Node combinations. If your change intentionally updates output, regenerate the snapshot corpus and explain why in the PR description.

## Scope

See [mvp.md](./mvp.md) for the active milestone. Out-of-scope contributions will be politely declined or deferred.

## License

By contributing you agree your contributions are licensed under Apache 2.0.
