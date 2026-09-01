import { describe, expect, it } from 'vitest';

import { formatDuration, formatTimecode, percentOf } from './time';

describe('formatTimecode', () => {
  it('prints milliseconds for a short run', () => {
    expect(formatTimecode(0, 120)).toBe('0 ms');
    expect(formatTimecode(37.4, 120)).toBe('37 ms');
    expect(formatTimecode(120, 120)).toBe('120 ms');
  });

  it('prints seconds for a long one, including the elapsed reading', () => {
    // The unit is decided by the run, not by the position -- otherwise the left-hand
    // number would switch units under the cursor while scrubbing.
    expect(formatTimecode(0, 4200)).toBe('0.00 s');
    expect(formatTimecode(1234, 4200)).toBe('1.23 s');
  });

  it('never prints a negative or non-finite position', () => {
    expect(formatTimecode(-40, 120)).toBe('0 ms');
    expect(formatTimecode(Number.NaN, 120)).toBe('0 ms');
  });
});

describe('formatDuration', () => {
  it('picks its own unit, since a duration stands alone', () => {
    expect(formatDuration(60)).toBe('60 ms');
    expect(formatDuration(2500)).toBe('2.50 s');
  });
});

describe('percentOf', () => {
  it('maps a position onto the scrubber', () => {
    expect(percentOf(30, 120)).toBe(25);
    expect(percentOf(120, 120)).toBe(100);
  });

  it('clamps, and survives a run with no duration', () => {
    expect(percentOf(500, 120)).toBe(100);
    expect(percentOf(-10, 120)).toBe(0);
    expect(percentOf(10, 0)).toBe(0);
  });
});
