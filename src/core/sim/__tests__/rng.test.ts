import { describe, expect, it } from 'vitest';

import { createRng, hashSeed } from '../rng';

function draw(seed: number | string, count = 12): number[] {
  const rng = createRng(seed);
  return Array.from({ length: count }, () => rng.next());
}

describe('createRng', () => {
  it('replays the same sequence for the same seed', () => {
    expect(draw(1234)).toEqual(draw(1234));
    expect(draw('lossy-link')).toEqual(draw('lossy-link'));
  });

  it('produces a different sequence for a different seed', () => {
    expect(draw(1234)).not.toEqual(draw(1235));
    expect(draw('lossy-link')).not.toEqual(draw('lossy-link-2'));
  });

  it('stays inside [0, 1)', () => {
    const rng = createRng('range');
    for (let i = 0; i < 5000; i += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('spreads roughly evenly across the unit interval', () => {
    const rng = createRng(7);
    const buckets = new Array<number>(10).fill(0);
    const samples = 20_000;
    for (let i = 0; i < samples; i += 1) {
      buckets[Math.floor(rng.next() * 10)] += 1;
    }
    // A crude uniformity check: no decile may be off by more than 20%. This is a
    // regression guard against a broken mixing step, not a statistical test.
    for (const count of buckets) {
      expect(count).toBeGreaterThan(samples / 10 / 1.2);
      expect(count).toBeLessThan((samples / 10) * 1.2);
    }
  });
});

describe('int', () => {
  it('stays inside the bound and covers it', () => {
    const rng = createRng('int');
    const seen = new Set<number>();
    for (let i = 0; i < 500; i += 1) {
      const value = rng.int(6);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(6);
      seen.add(value);
    }
    expect(seen.size).toBe(6);
  });

  it('rejects a non-positive bound', () => {
    expect(() => createRng(1).int(0)).toThrow(RangeError);
    expect(() => createRng(1).int(2.5)).toThrow(RangeError);
  });
});

describe('between', () => {
  it('stays inside the half-open range', () => {
    const rng = createRng('between');
    for (let i = 0; i < 1000; i += 1) {
      const value = rng.between(10, 20);
      expect(value).toBeGreaterThanOrEqual(10);
      expect(value).toBeLessThan(20);
    }
  });
});

describe('chance', () => {
  it('never fires at 0 and always fires at 1, without consuming the stream', () => {
    const rng = createRng('chance');
    expect(rng.chance(0)).toBe(false);
    expect(rng.chance(1)).toBe(true);
    // The two saturated calls short-circuit, so the stream is where it started.
    expect(rng.next()).toBe(createRng('chance').next());
  });

  it('clamps a probability outside [0, 1] rather than throwing', () => {
    expect(createRng(1).chance(-3)).toBe(false);
    expect(createRng(1).chance(4)).toBe(true);
  });

  it('fires at roughly the requested rate', () => {
    const rng = createRng('rate');
    let hits = 0;
    for (let i = 0; i < 10_000; i += 1) {
      if (rng.chance(0.25)) hits += 1;
    }
    expect(hits).toBeGreaterThan(2200);
    expect(hits).toBeLessThan(2800);
  });
});

describe('fork', () => {
  it('gives each label its own stream', () => {
    const parent = createRng('run');
    expect(draw(parent.fork('loss').seed)).not.toEqual(draw(parent.fork('jitter').seed));
  });

  it('derives from the seed, not the current state', () => {
    const before = createRng('run');
    const after = createRng('run');
    for (let i = 0; i < 25; i += 1) after.next();

    // The whole point: drawing from the parent first must not shift the child's stream,
    // so adding a randomised detail elsewhere in a run cannot move which packet drops.
    expect(draw(before.fork('loss').seed)).toEqual(draw(after.fork('loss').seed));
  });
});

describe('hashSeed', () => {
  it('is stable and non-negative', () => {
    expect(hashSeed('home')).toBe(hashSeed('home'));
    expect(hashSeed(-42)).toBe(42);
    expect(hashSeed('x')).toBeGreaterThanOrEqual(0);
  });

  it('rejects a non-finite numeric seed', () => {
    expect(() => hashSeed(Number.NaN)).toThrow(RangeError);
    expect(() => hashSeed(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
