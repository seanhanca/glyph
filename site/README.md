# site/ — Glyph landing page

Single-file static landing page. No build step. Deploys to any static host (Vercel, Netlify, Cloudflare Pages, GitHub Pages).

## Deploy to Vercel

```bash
cd site/
vercel --prod
```

Or connect the GitHub repo at <https://vercel.com/new> and set the root directory to `site/`.

## Edit

`index.html` is the entire site — one file, ~600 lines, ~22 KB. All inline CSS, all inline SVG. No JavaScript dependencies.

## Next session: full Astro docs site

This v0 landing page is the foundation. A full docs site (Session B in `NEXT-SESSIONS.md`) adds:

- Astro scaffold + Tailwind
- TypeDoc-generated API docs
- ≥25-example gallery
- DuckDB-WASM playground
- Per-PR Vercel previews on the PR

Tracked as a follow-up session in `NEXT-SESSIONS.md`.
