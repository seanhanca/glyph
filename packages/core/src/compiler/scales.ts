/**
 * Scales — pure functions that map data values to pixel coordinates.
 *
 * Phase 0:
 *   - linear: continuous quantitative
 *   - band: categorical (used for x of bar charts)
 *
 * Deterministic to 8 decimal places — important for snapshot byte-identity.
 */

/** Round to 8 decimal places. Stabilizes outputs across platforms. */
export function roundPx(n: number): number {
  // 1e8 is the highest precision that's still safe for IEEE-754 doubles.
  return Math.round(n * 1e8) / 1e8;
}

export interface LinearScale {
  readonly type: "linear";
  readonly domain: readonly [number, number];
  readonly range: readonly [number, number];
  readonly apply: (v: number) => number;
}

export function linearScale(
  domain: readonly [number, number],
  range: readonly [number, number],
): LinearScale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  const apply = (v: number): number => {
    if (span === 0) return roundPx(r0);
    const t = (v - d0) / span;
    return roundPx(r0 + t * (r1 - r0));
  };
  return { type: "linear", domain, range, apply };
}

export interface BandScale {
  readonly type: "band";
  readonly domain: ReadonlyArray<string>;
  readonly range: readonly [number, number];
  readonly bandwidth: number;
  readonly apply: (v: string) => number;
}

export function bandScale(
  domain: ReadonlyArray<string>,
  range: readonly [number, number],
  padding = 0.1,
): BandScale {
  const [r0, r1] = range;
  const step = (r1 - r0) / Math.max(1, domain.length);
  const bandwidth = roundPx(step * (1 - padding));
  const offset = (step - bandwidth) / 2;
  const index = new Map(domain.map((d, i) => [d, i] as const));
  const apply = (v: string): number => {
    const i = index.get(v);
    if (i === undefined) return Number.NaN;
    return roundPx(r0 + i * step + offset);
  };
  return { type: "band", domain, range, bandwidth, apply };
}

/**
 * "Nice" round numbers for a linear domain. Used for axis tick generation.
 * Adapted from d3-array's tickStep (BSD license), simplified for Phase 0.
 */
export function niceTicks(
  d0: number,
  d1: number,
  count = 5,
): { domain: [number, number]; ticks: number[] } {
  if (d0 === d1) {
    return { domain: [d0 - 1, d0 + 1], ticks: [d0] };
  }
  const span = d1 - d0;
  const step0 = span / Math.max(1, count);
  const exp = Math.floor(Math.log10(step0));
  const pow = 10 ** exp;
  const norm = step0 / pow;
  // Round to a "nice" multiple: 1, 2, 5, 10.
  let nice: number;
  if (norm < 1.5) nice = 1;
  else if (norm < 3) nice = 2;
  else if (norm < 7) nice = 5;
  else nice = 10;
  const step = nice * pow;
  const niceMin = Math.floor(d0 / step) * step;
  const niceMax = Math.ceil(d1 / step) * step;
  const ticks: number[] = [];
  for (let v = niceMin; v <= niceMax + step / 2; v += step) {
    ticks.push(roundPx(v));
  }
  return { domain: [roundPx(niceMin), roundPx(niceMax)], ticks };
}
