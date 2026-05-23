/**
 * RFC #6 — looping animation emitters.
 *
 * Each emitter returns a SMIL `<animateTransform>` XML string ready
 * to be embedded inside an SVG `<g>` element. SMIL is declarative
 * and byte-stable: same input → same output bytes, every render.
 *
 * The renderer composes these by wrapping a child group's contents
 * in `<g transform="translate(...)"><contents/><animateTransform/></g>`.
 * The `additive="sum"` attribute means the loop transform layers on
 * TOP of the parent translate — the group ends up at its placed
 * position while the contents rotate / swing / pulse about their
 * local origin.
 */

import type { LoopAnimation } from "../spec/compose-schema.js";

/**
 * Emit the right SMIL XML for any LoopAnimation, or empty string if
 * none. Delegates to one of the kind-specific helpers below.
 */
export function emitLoopAnimation(anim: LoopAnimation): string {
  if (!anim) return "";
  if (anim.kind === "swing") return emitSwing(anim.amplitudeDeg, anim.periodMs);
  if (anim.kind === "rotate-loop") return emitRotateLoop(anim.periodMs, anim.direction);
  if (anim.kind === "pulse") return emitPulse(anim.periodMs, anim.scale);
  return "";
}

/**
 * `swing` — back-and-forth rotation about the group's origin.
 * Values: -amp → +amp → -amp over one period. Used for pendulum
 * bobs, escapement levers, anything that oscillates.
 */
export function emitSwing(amplitudeDeg: number, periodMs: number): string {
  const a = amplitudeDeg.toFixed(3);
  const dur = (periodMs / 1000).toFixed(3);
  return `<animateTransform attributeName="transform" type="rotate" values="-${a};${a};-${a}" keyTimes="0;0.5;1" calcMode="spline" keySplines="0.42 0 0.58 1;0.42 0 0.58 1" dur="${dur}s" repeatCount="indefinite" additive="sum"/>`;
}

/**
 * `rotate-loop` — continuous rotation, one full revolution per period.
 * `cw` direction means clockwise in SVG visual frame (positive degrees);
 * `ccw` means negative degrees. Used for gears, wheels, flywheels.
 */
export function emitRotateLoop(periodMs: number, direction: "cw" | "ccw"): string {
  const dur = (periodMs / 1000).toFixed(3);
  const end = direction === "cw" ? "360" : "-360";
  return `<animateTransform attributeName="transform" type="rotate" values="0;${end}" dur="${dur}s" repeatCount="indefinite" additive="sum"/>`;
}

/**
 * `pulse` — scale oscillation about the group's origin. Values
 * 1 → scale → 1 over one period. Used for heartbeats, glowing
 * stars, anything that "breathes".
 */
export function emitPulse(periodMs: number, scale: number): string {
  const dur = (periodMs / 1000).toFixed(3);
  const s = scale.toFixed(3);
  return `<animateTransform attributeName="transform" type="scale" values="1;${s};1" keyTimes="0;0.5;1" calcMode="spline" keySplines="0.42 0 0.58 1;0.42 0 0.58 1" dur="${dur}s" repeatCount="indefinite" additive="sum"/>`;
}
