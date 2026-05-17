/**
 * @glyph/preview-server — public surface.
 *
 * The MCP server creates one of these on `glyph_preview`; long-poll
 * interactions come back via `awaitInteraction`. See server.ts for the
 * full contract; see ROADMAP §B9e for design rationale.
 */
export { createPreviewServer } from "./server.js";
export type { PreviewServer, PreviewServerOptions, PreviewUrl } from "./server.js";
export type { InteractionEvent } from "./queue.js";
