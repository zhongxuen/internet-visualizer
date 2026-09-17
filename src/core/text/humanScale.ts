/**
 * Numbers a beginner can picture.
 *
 * "12 ms" means nothing to someone who has never measured anything in milliseconds;
 * "much quicker than a blink" does. These turn the durations, sizes and distances a
 * simulation already knows into a comparison, and leave the exact figure beside it
 * where the reader can still see it (docs/implementation/uiux.md §5.4).
 *
 * Every comparison here is a simplification, and each one gets a row in
 * `docs/ACCURACY.md` when a screen first shows it.
 *
 * All three are pure and throw a `RangeError` on a negative or non-finite input: a
 * simulation never produces one, so receiving one is a bug to surface, not a value to
 * describe.
 */

/** Thousands separators, fixed to one style so a server and a browser print the same. */
function groupDigits(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function assertMeasure(value: number, what: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`cannot describe ${value} as a ${what}`);
  }
}

/**
 * A blink lasts roughly a tenth to four tenths of a second. Below the lower bound a
 * delay is "much quicker than a blink"; inside the band it is "about a blink".
 */
const BLINK_MS = { from: 100, to: 400 } as const;

/**
 * How long `ms` feels: `'much quicker than a blink'`, `'about a blink'`,
 * `'under a second'`, or `'N seconds'` from one second up. The caller shows the exact
 * figure beside it ("12 ms -- much quicker than a blink").
 */
export function describeDuration(ms: number): string {
  assertMeasure(ms, 'duration');

  if (ms < BLINK_MS.from) return 'much quicker than a blink';
  if (ms <= BLINK_MS.to) return 'about a blink';
  if (ms < 1000) return 'under a second';

  const seconds = Math.round(ms / 100) / 10;
  return seconds === 1 ? '1 second' : `${groupDigits(seconds)} seconds`;
}

/**
 * Sizes compared with text, then pictures and video. One byte holds one character of
 * plain English text, which is what makes the smaller bands honest.
 */
const SIZE_BANDS: readonly (readonly [below: number, comparison: string])[] = [
  [100, 'about a sentence of text'],
  [1_000, 'about a paragraph of text'],
  [10_000, 'about a page of text'],
  [1_000_000, 'about a small picture'],
  [10_000_000, 'about a photo from a phone'],
  [1_000_000_000, 'about a short video'],
];

/**
 * A plain comparison plus the exact number: `describeSize(1500)` is
 * `'about a page of text (1,500 bytes)'`. The number is always in bytes, never
 * rounded into kB, because it is the exact half of the pair.
 */
export function describeSize(bytes: number): string {
  assertMeasure(bytes, 'size');
  if (!Number.isInteger(bytes)) {
    throw new RangeError(`cannot describe ${bytes} as a size: bytes are whole`);
  }

  const exact = bytes === 1 ? '1 byte' : `${groupDigits(bytes)} bytes`;
  if (bytes === 0) return `nothing at all (${exact})`;

  const band = SIZE_BANDS.find(([below]) => bytes < below);
  return `${band ? band[1] : 'about a full-length film'} (${exact})`;
}

/**
 * Light in glass fibre covers about 200 km in a millisecond: two thirds of its speed in
 * a vacuum.
 */
export const FIBRE_KM_PER_MS = 200;

/**
 * How much cable a one-way fibre delay of `ms` stands for, always labelled as the
 * estimate it is: `fibreDistanceKm(12)` is `'roughly 2,400 km of cable'`. Rounded to the
 * nearest kilometre under 100 km, to 10 km under 1,000 km, and to 100 km beyond, so the
 * figure never claims more precision than "roughly" allows.
 */
export function fibreDistanceKm(ms: number): string {
  assertMeasure(ms, 'delay');

  const km = ms * FIBRE_KM_PER_MS;
  if (km < 1) return 'less than 1 km of cable';

  const step = km < 100 ? 1 : km < 1000 ? 10 : 100;
  return `roughly ${groupDigits(Math.round(km / step) * step)} km of cable`;
}
