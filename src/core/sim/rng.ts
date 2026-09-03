/**
 * The seeded PRNG -- the only source of randomness anywhere in a simulation.
 *
 * A simulation that calls `Math.random()` cannot be tested, diffed, screenshotted, or
 * linked to: run it twice and you get two different lessons. So nothing in this project
 * ever does. Where a scenario needs to look unpredictable -- a link that drops packets,
 * jitter on a round trip (phase 12) -- it draws from one of these, seeded from the
 * scenario, and the same seed replays the same run byte for byte.
 *
 * The generator is **mulberry32**: one 32-bit word of state, four operations per draw,
 * and a period of 2^32. It is not cryptographic and must never be used as if it were --
 * but for "which of these forty packets is the one that gets lost", a small, fast,
 * exactly reproducible generator is precisely the right tool, and one whose entire
 * implementation fits on a screen is one a reader can trust.
 *
 * ## Forking
 *
 * {@link Rng.fork} derives a child generator from the parent's **seed**, not from its
 * current state. That is deliberate: it means a child's stream does not shift when the
 * parent happens to draw one more number earlier in the run, so adding an unrelated
 * randomised detail to a scenario cannot silently change which packet was dropped.
 * Independent concerns get independent, stable streams.
 */

/** A stream of deterministic pseudo-random numbers. */
export interface Rng {
  /** The seed this stream was created from, as a 32-bit word. */
  readonly seed: number;
  /** The next value in `[0, 1)`. */
  next(): number;
  /** The next integer in `[0, boundExclusive)`. Throws for a non-positive bound. */
  int(boundExclusive: number): number;
  /** The next value in `[min, max)`. */
  between(min: number, max: number): number;
  /** True with probability `probability`, which is clamped to `[0, 1]`. */
  chance(probability: number): boolean;
  /**
   * An independent stream for one named concern, derived from this one's seed.
   *
   * `rng.fork('loss')` gives the loss decisions their own stream, so they are unaffected
   * by anything else in the run that draws a number.
   */
  fork(label: string): Rng;
}

/**
 * Reduce a seed to the 32-bit word the generator actually starts from.
 *
 * Strings are hashed with FNV-1a, which is short enough to read and spreads similar
 * labels (`'lossy-link'` and `'lossy-link-2'`) to unrelated words. Numbers are taken
 * modulo 2^32, so a scenario can use a plain readable constant as its seed.
 */
export function hashSeed(seed: number | string): number {
  if (typeof seed === 'number') {
    if (!Number.isFinite(seed)) {
      throw new RangeError(`RNG seed must be a finite number, got ${seed}`);
    }
    return Math.abs(Math.trunc(seed)) >>> 0;
  }

  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * A generator seeded from a number or a string.
 *
 * Two calls with the same seed produce the same sequence, on any platform: every step is
 * 32-bit integer arithmetic through `Math.imul`, with no floating point until the final
 * division.
 */
export function createRng(seed: number | string): Rng {
  const rootSeed = hashSeed(seed);
  let state = rootSeed;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
  };

  return {
    seed: rootSeed,
    next,
    int(boundExclusive: number): number {
      if (!Number.isInteger(boundExclusive) || boundExclusive <= 0) {
        throw new RangeError(
          `RNG bound must be a positive integer, got ${boundExclusive}`,
        );
      }
      return Math.floor(next() * boundExclusive);
    },
    between(min: number, max: number): number {
      return min + next() * (max - min);
    },
    chance(probability: number): boolean {
      // Clamped rather than validated: a loss rate arriving from a UI slider should
      // saturate, not throw. `0` never fires and `1` always does, because `next()` is
      // half-open on `[0, 1)`.
      const p = Math.min(1, Math.max(0, probability));
      if (p <= 0) return false;
      if (p >= 1) return true;
      return next() < p;
    },
    fork(label: string): Rng {
      // Mixed rather than added so that `fork('a')` on seed 2 and `fork('b')` on seed 1
      // cannot collide.
      return createRng((Math.imul(rootSeed ^ hashSeed(label), 0x2545f491) >>> 0) + 1);
    },
  };
}
