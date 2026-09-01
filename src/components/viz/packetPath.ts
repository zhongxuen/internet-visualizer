/**
 * Where a packet is, given how far along the link it is.
 *
 * A `LinkEdge` is drawn with `getBezierPath`, so a packet travelling on that link has to
 * follow the same curve or it will visibly float off the wire. Finding a point on a
 * rendered `<path>` is normally a DOM job (`getPointAtLength`), which would make packet
 * placement untestable and dependent on layout having happened. Instead the curve is
 * parsed back into its four control points and evaluated arithmetically: same curve, pure
 * function, no DOM.
 *
 * The parsing is safe because the shape of the string is fixed by the library --
 * `M sx,sy C c1x,c1y c2x,c2y tx,ty`, one cubic segment, absolute coordinates. Anything
 * else returns `null` and the caller falls back to the straight line between the
 * endpoints, which it always knows.
 */

import type { XY } from './layout';

/** One cubic Bézier segment: the two endpoints and the two control points. */
export interface CubicPath {
  source: XY;
  sourceControl: XY;
  targetControl: XY;
  target: XY;
}

/** Matches every number in a path string; `M`/`C` and the separators are skipped. */
const NUMBER = /-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi;

/** How many numbers a single absolute cubic segment carries. */
const CUBIC_NUMBERS = 8;

/**
 * `0` for anything that is not a usable fraction.
 *
 * `NaN` is treated as the start rather than propagated: a packet at an unknown position
 * belongs at its origin, not at `translate(NaN, NaN)`, which removes it from the page.
 */
export function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.min(1, Math.max(0, progress));
}

/**
 * `M sx,sy C c1x,c1y c2x,c2y tx,ty` -> its four points, or `null` if it is anything else.
 */
export function parseCubicPath(d: string): CubicPath | null {
  if (!d.startsWith('M') || !d.includes('C')) return null;

  const numbers = d.match(NUMBER)?.map(Number);
  if (!numbers || numbers.length !== CUBIC_NUMBERS) return null;
  if (numbers.some((value) => !Number.isFinite(value))) return null;

  const [sx, sy, c1x, c1y, c2x, c2y, tx, ty] = numbers;

  return {
    source: { x: sx, y: sy },
    sourceControl: { x: c1x, y: c1y },
    targetControl: { x: c2x, y: c2y },
    target: { x: tx, y: ty },
  };
}

/** The point at `t` along the curve, `t` clamped to `0..1`. */
export function pointOnCubic(path: CubicPath, t: number): XY {
  const time = clampProgress(t);
  const inverse = 1 - time;

  // Bernstein form: (1-t)³P₀ + 3(1-t)²tP₁ + 3(1-t)t²P₂ + t³P₃.
  const a = inverse * inverse * inverse;
  const b = 3 * inverse * inverse * time;
  const c = 3 * inverse * time * time;
  const d = time * time * time;

  return {
    x:
      a * path.source.x +
      b * path.sourceControl.x +
      c * path.targetControl.x +
      d * path.target.x,
    y:
      a * path.source.y +
      b * path.sourceControl.y +
      c * path.targetControl.y +
      d * path.target.y,
  };
}

/**
 * Heading at `t`, in degrees clockwise from "pointing right" -- the angle to rotate a
 * direction arrow by so it points the way the packet is actually going.
 *
 * Falls back to the chord from source to target where the derivative vanishes (a curve
 * whose control point sits exactly on its endpoint), and to `0` for a path of zero length.
 */
export function tangentAngleOnCubic(path: CubicPath, t: number): number {
  const time = clampProgress(t);
  const inverse = 1 - time;

  // Derivative: 3(1-t)²(P₁-P₀) + 6(1-t)t(P₂-P₁) + 3t²(P₃-P₂).
  const a = 3 * inverse * inverse;
  const b = 6 * inverse * time;
  const c = 3 * time * time;

  let dx =
    a * (path.sourceControl.x - path.source.x) +
    b * (path.targetControl.x - path.sourceControl.x) +
    c * (path.target.x - path.targetControl.x);
  let dy =
    a * (path.sourceControl.y - path.source.y) +
    b * (path.targetControl.y - path.sourceControl.y) +
    c * (path.target.y - path.targetControl.y);

  if (dx === 0 && dy === 0) {
    dx = path.target.x - path.source.x;
    dy = path.target.y - path.source.y;
  }

  if (dx === 0 && dy === 0) return 0;

  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

/** Straight-line interpolation, for when there is no parseable curve to follow. */
export function pointOnSegment(from: XY, to: XY, t: number): XY {
  const time = clampProgress(t);
  return {
    x: from.x + (to.x - from.x) * time,
    y: from.y + (to.y - from.y) * time,
  };
}

/** Where a packet sits, and which way it is pointing, at `t` along a drawn edge path. */
export interface PathPlacement {
  point: XY;
  /** Degrees clockwise from east. */
  angle: number;
}

/**
 * Placement at `t` along `d`, using the straight line between `from` and `to` if `d`
 * cannot be parsed.
 */
export function placeAlongPath(
  d: string | undefined,
  from: XY,
  to: XY,
  t: number,
): PathPlacement {
  const curve = d ? parseCubicPath(d) : null;

  if (!curve) {
    const straight: CubicPath = {
      source: from,
      sourceControl: from,
      targetControl: to,
      target: to,
    };
    return {
      point: pointOnSegment(from, to, t),
      angle: tangentAngleOnCubic(straight, t),
    };
  }

  return { point: pointOnCubic(curve, t), angle: tangentAngleOnCubic(curve, t) };
}
