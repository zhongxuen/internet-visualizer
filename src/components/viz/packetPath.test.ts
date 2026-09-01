import { getBezierPath, Position } from '@xyflow/react';
import { describe, expect, it } from 'vitest';

import {
  clampProgress,
  parseCubicPath,
  placeAlongPath,
  pointOnCubic,
  pointOnSegment,
  tangentAngleOnCubic,
} from './packetPath';

/** A curve whose midpoint is exactly (50, 50), so the arithmetic is checkable by hand. */
const DIAGONAL = 'M10,20 C30,20 70,80 90,80';

/** A flat left-to-right curve: control points on the line, midpoint at x = 50. */
const FLAT = 'M0,0 C0,0 100,0 100,0';

describe('parseCubicPath', () => {
  it('reads back the exact string React Flow draws an edge with', () => {
    const [d] = getBezierPath({
      sourceX: 0,
      sourceY: 0,
      targetX: 200,
      targetY: 100,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    });

    const path = parseCubicPath(d);

    expect(path).not.toBeNull();
    expect(path?.source).toEqual({ x: 0, y: 0 });
    expect(path?.target).toEqual({ x: 200, y: 100 });
  });

  it('reads the four points of a hand-written segment', () => {
    expect(parseCubicPath(DIAGONAL)).toEqual({
      source: { x: 10, y: 20 },
      sourceControl: { x: 30, y: 20 },
      targetControl: { x: 70, y: 80 },
      target: { x: 90, y: 80 },
    });
  });

  it('handles negative coordinates, which a canvas centred on zero produces', () => {
    expect(parseCubicPath('M-10,-20 C-5,-20 5,20 10,20')?.source).toEqual({
      x: -10,
      y: -20,
    });
  });

  it('refuses anything that is not one absolute cubic segment', () => {
    expect(parseCubicPath('')).toBeNull();
    expect(parseCubicPath('M0,0 L100,0')).toBeNull();
    expect(parseCubicPath('M0,0 C0,0 100,0')).toBeNull();
    expect(parseCubicPath('M0,0 C0,0 50,0 100,0 C150,0 200,0 250,0')).toBeNull();
  });
});

describe('pointOnCubic', () => {
  const path = parseCubicPath(DIAGONAL)!;

  it('sits on the endpoints at 0 and 1', () => {
    expect(pointOnCubic(path, 0)).toEqual({ x: 10, y: 20 });
    expect(pointOnCubic(path, 1)).toEqual({ x: 90, y: 80 });
  });

  it('is at the curve midpoint half way along', () => {
    expect(pointOnCubic(path, 0.5)).toEqual({ x: 50, y: 50 });
  });

  it('advances monotonically along a left-to-right curve', () => {
    const flat = parseCubicPath(FLAT)!;
    const xs = [0, 0.25, 0.5, 0.75, 1].map((t) => pointOnCubic(flat, t).x);

    expect(xs).toEqual([0, 15.625, 50, 84.375, 100]);
  });

  it('clamps rather than extrapolating off the end of the wire', () => {
    expect(pointOnCubic(path, -3)).toEqual(pointOnCubic(path, 0));
    expect(pointOnCubic(path, 4)).toEqual(pointOnCubic(path, 1));
    expect(pointOnCubic(path, Number.NaN)).toEqual(pointOnCubic(path, 0));
  });
});

describe('clampProgress', () => {
  it('keeps a fraction, clamps the ends, and treats nonsense as the start', () => {
    expect(clampProgress(0.42)).toBe(0.42);
    expect(clampProgress(-1)).toBe(0);
    expect(clampProgress(9)).toBe(1);
    expect(clampProgress(Number.NaN)).toBe(0);
    expect(clampProgress(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('tangentAngleOnCubic', () => {
  it('points east along a left-to-right curve', () => {
    expect(tangentAngleOnCubic(parseCubicPath(FLAT)!, 0.5)).toBe(0);
  });

  it('points south down a top-to-bottom curve', () => {
    expect(tangentAngleOnCubic(parseCubicPath('M0,0 C0,0 0,100 0,100')!, 0.5)).toBe(90);
  });

  it('falls back to the chord where the derivative vanishes at an endpoint', () => {
    // Both control points sit on the source, so the derivative at t = 0 is zero.
    expect(tangentAngleOnCubic(parseCubicPath('M0,0 C0,0 0,0 100,0')!, 0)).toBe(0);
  });

  it('is zero for a path of no length rather than NaN', () => {
    expect(tangentAngleOnCubic(parseCubicPath('M5,5 C5,5 5,5 5,5')!, 0.5)).toBe(0);
  });
});

describe('pointOnSegment', () => {
  it('interpolates a straight line', () => {
    expect(pointOnSegment({ x: 0, y: 0 }, { x: 100, y: 50 }, 0.5)).toEqual({
      x: 50,
      y: 25,
    });
  });
});

describe('placeAlongPath', () => {
  const from = { x: 0, y: 0 };
  const to = { x: 100, y: 100 };

  it('follows the curve when there is one', () => {
    expect(placeAlongPath(DIAGONAL, from, to, 0.5).point).toEqual({ x: 50, y: 50 });
  });

  it('falls back to the straight line between the endpoints', () => {
    expect(placeAlongPath(undefined, from, to, 0.5)).toEqual({
      point: { x: 50, y: 50 },
      angle: 45,
    });
    expect(placeAlongPath('not a path', from, to, 0.25).point).toEqual({
      x: 25,
      y: 25,
    });
  });
});
