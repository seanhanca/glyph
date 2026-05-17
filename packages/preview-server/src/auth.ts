/**
 * Token-based auth for the preview server.
 *
 * Per-session HMAC-SHA-256 token. Browser receives the token in the URL
 * (so the user can paste links); the page reads it from `window.location`
 * and sends it as `X-Glyph-Token` for every `/api/*` request. The server
 * uses constant-time compare to defend against timing attacks.
 *
 * Why not unauthenticated localhost-only?
 *   Browsers ship origin policies that *allow* any local site to fetch
 *   127.0.0.1 by default. A token blocks drive-by exfiltration if the user
 *   happens to be on a malicious page in another tab.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export interface AuthState {
  readonly secret: Buffer;
  readonly token: string;
}

/** Generate a fresh secret + session token. */
export function newAuth(): AuthState {
  const secret = randomBytes(32);
  // Token = first 16 bytes of HMAC(secret, "glyph-preview-session"), hex.
  // Stable for the lifetime of this server instance.
  const token = createHmac("sha256", secret)
    .update("glyph-preview-session")
    .digest("hex")
    .slice(0, 32);
  return { secret, token };
}

/** Constant-time check the supplied token against the session token. */
export function verifyToken(state: AuthState, supplied: string | undefined): boolean {
  if (!supplied || typeof supplied !== "string") return false;
  const a = Buffer.from(state.token, "utf8");
  const b = Buffer.from(supplied, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
