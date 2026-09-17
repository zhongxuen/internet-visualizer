import { describe, expect, it } from 'vitest';

import {
  describeDuration,
  describeSize,
  FIBRE_KM_PER_MS,
  fibreDistanceKm,
} from '../humanScale';

describe('describeDuration', () => {
  it.each([
    [0, 'much quicker than a blink'],
    [12, 'much quicker than a blink'],
    [99.9, 'much quicker than a blink'],
    [100, 'about a blink'],
    [400, 'about a blink'],
    [400.1, 'under a second'],
    [999.9, 'under a second'],
    [1000, '1 second'],
    // Rounded to a tenth, so this is still one second, not "1 seconds".
    [1049, '1 second'],
    [1050, '1.1 seconds'],
    [2000, '2 seconds'],
    [90_500, '90.5 seconds'],
    [1_234_500, '1,234.5 seconds'],
  ])('%d ms is "%s"', (ms, expected) => {
    expect(describeDuration(ms)).toBe(expected);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('refuses %d', (ms) => {
    expect(() => describeDuration(ms)).toThrow(RangeError);
  });
});

describe('describeSize', () => {
  it.each([
    [0, 'nothing at all (0 bytes)'],
    [1, 'about a sentence of text (1 byte)'],
    [99, 'about a sentence of text (99 bytes)'],
    [100, 'about a paragraph of text (100 bytes)'],
    [999, 'about a paragraph of text (999 bytes)'],
    [1_000, 'about a page of text (1,000 bytes)'],
    [1_500, 'about a page of text (1,500 bytes)'],
    [9_999, 'about a page of text (9,999 bytes)'],
    [10_000, 'about a small picture (10,000 bytes)'],
    [999_999, 'about a small picture (999,999 bytes)'],
    [1_000_000, 'about a photo from a phone (1,000,000 bytes)'],
    [9_999_999, 'about a photo from a phone (9,999,999 bytes)'],
    [10_000_000, 'about a short video (10,000,000 bytes)'],
    [999_999_999, 'about a short video (999,999,999 bytes)'],
    [1_000_000_000, 'about a full-length film (1,000,000,000 bytes)'],
  ])('%d bytes is "%s"', (bytes, expected) => {
    expect(describeSize(bytes)).toBe(expected);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('refuses %d', (bytes) => {
    expect(() => describeSize(bytes)).toThrow(RangeError);
  });
});

describe('fibreDistanceKm', () => {
  it('uses about 200 km of glass per millisecond', () => {
    expect(FIBRE_KM_PER_MS).toBe(200);
  });

  it.each([
    [0, 'less than 1 km of cable'],
    [0.004, 'less than 1 km of cable'],
    [0.005, 'roughly 1 km of cable'],
    [0.3, 'roughly 60 km of cable'],
    [0.499, 'roughly 100 km of cable'],
    [0.5, 'roughly 100 km of cable'],
    [1.234, 'roughly 250 km of cable'],
    [4.999, 'roughly 1,000 km of cable'],
    [5, 'roughly 1,000 km of cable'],
    // The worked example in docs/implementation/uiux.md §5.4.
    [12, 'roughly 2,400 km of cable'],
    [80.37, 'roughly 16,100 km of cable'],
  ])('%d ms one way is "%s"', (ms, expected) => {
    expect(fibreDistanceKm(ms)).toBe(expected);
  });

  it.each([-0.1, Number.NaN, Number.POSITIVE_INFINITY])('refuses %d', (ms) => {
    expect(() => fibreDistanceKm(ms)).toThrow(RangeError);
  });
});
