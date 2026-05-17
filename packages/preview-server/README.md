# @glyph/preview-server

Opt-in, **localhost-only** HTTP server that hosts an interactive Glyph chart preview. Used by `@glyph/mcp` to close the click → agent loop without depending on a host-vendor feature.

```ts
import { createPreviewServer } from "@glyph/preview-server";

const ps = createPreviewServer();
await ps.start();

ps.registerChart("abc123", "<svg ...>...</svg>");
const { url, token } = ps.urlFor("abc123");
// open `url` in a browser

// agent side:
const event = await ps.awaitInteraction("abc123", 30_000);
// → { kind: "click", binding: { row: 7, attrs: { x: "2024-03-12" } }, whereSql: 'WHERE "day" = …' }

await ps.stop();
```

Design + security floor: see `ROADMAP §B9e`.

Apache 2.0. Pre-alpha — see the [MVP plan](../../mvp.md).
