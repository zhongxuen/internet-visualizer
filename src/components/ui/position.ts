'use client';

import { useLayoutEffect, useState, type RefObject } from 'react';

/**
 * Anchored positioning for the two floating primitives, `Popover` and `Tooltip`.
 *
 * Both render into the top layer where the browser has one (the `popover` attribute), so
 * both are `position: fixed` against the viewport and neither can be clipped by a
 * `Panel`'s `overflow-hidden`. What the top layer does not do is keep the box on screen:
 * a tooltip on a button at the right edge of a phone opens half off it. {@link placeFloating}
 * is that part, and it is deliberately small -- two moves, no middleware:
 *
 *  1. **Flip.** If the preferred side has no room and the opposite side has more, use the
 *     opposite side.
 *  2. **Shift.** Clamp the box inside the viewport, less {@link VIEWPORT_PADDING}, on both
 *     axes. A box that fits nowhere ends up overlapping its anchor rather than off screen,
 *     which is the right failure: covered is readable, clipped is not.
 *
 * The math is a pure function so it can be tested without a layout engine; jsdom reports
 * every box as the same size, which makes it useless for geometry.
 */

export type FloatingSide = 'top' | 'bottom' | 'left' | 'right';
export type FloatingAlign = 'start' | 'center' | 'end';

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface PlacementOptions {
  side?: FloatingSide;
  align?: FloatingAlign;
  /** Gap between anchor and box, in px. */
  offset?: number;
  /** Minimum distance from each viewport edge, in px. */
  padding?: number;
}

export interface Placement {
  top: number;
  left: number;
  /** The side actually used, after flipping. */
  side: FloatingSide;
}

/** 8px: enough that a box pinned to the edge still reads as a box and not as a border. */
export const VIEWPORT_PADDING = 8;
export const DEFAULT_OFFSET = 8;

const OPPOSITE: Record<FloatingSide, FloatingSide> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
};

function clamp(value: number, min: number, max: number): number {
  // A box larger than the viewport pins to the leading edge, so its start is readable.
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

/** Room available on one side of the anchor, less the offset and the edge padding. */
function room(side: FloatingSide, anchor: Rect, viewport: Size, gap: number): number {
  switch (side) {
    case 'top':
      return anchor.top - gap;
    case 'bottom':
      return viewport.height - (anchor.top + anchor.height) - gap;
    case 'left':
      return anchor.left - gap;
    case 'right':
      return viewport.width - (anchor.left + anchor.width) - gap;
  }
}

function needed(side: FloatingSide, floating: Size): number {
  return side === 'top' || side === 'bottom' ? floating.height : floating.width;
}

/** Where along the cross axis the box starts, before shifting. */
function aligned(
  start: number,
  anchorLength: number,
  floatingLength: number,
  align: FloatingAlign,
): number {
  if (align === 'start') return start;
  if (align === 'end') return start + anchorLength - floatingLength;
  return start + (anchorLength - floatingLength) / 2;
}

export function placeFloating(
  anchor: Rect,
  floating: Size,
  viewport: Size,
  {
    side: preferred = 'bottom',
    align = 'center',
    offset = DEFAULT_OFFSET,
    padding = VIEWPORT_PADDING,
  }: PlacementOptions = {},
): Placement {
  const gap = offset + padding;
  const opposite = OPPOSITE[preferred];

  const fits = room(preferred, anchor, viewport, gap) >= needed(preferred, floating);
  const side =
    !fits &&
    room(opposite, anchor, viewport, gap) > room(preferred, anchor, viewport, gap)
      ? opposite
      : preferred;

  let top: number;
  let left: number;

  if (side === 'top' || side === 'bottom') {
    top =
      side === 'top'
        ? anchor.top - offset - floating.height
        : anchor.top + anchor.height + offset;
    left = aligned(anchor.left, anchor.width, floating.width, align);
  } else {
    left =
      side === 'left'
        ? anchor.left - offset - floating.width
        : anchor.left + anchor.width + offset;
    top = aligned(anchor.top, anchor.height, floating.height, align);
  }

  return {
    top: clamp(top, padding, viewport.height - floating.height - padding),
    left: clamp(left, padding, viewport.width - floating.width - padding),
    side,
  };
}

/**
 * The layout viewport, which is what `position: fixed` is measured against. `clientWidth`
 * rather than `innerWidth` so a classic scrollbar is not counted as room; `innerWidth` is
 * the fallback for an environment that reports no layout at all.
 */
function viewportSize(): Size {
  const root = document.documentElement;
  return {
    width: root.clientWidth || window.innerWidth,
    height: root.clientHeight || window.innerHeight,
  };
}

/**
 * Keep `floating` beside `anchor` while `open`.
 *
 * Writes `top`/`left` straight onto the element instead of through React state: the box
 * moves on every scroll frame, and a position that goes through a render would put a
 * re-render in the scroll path -- the thing CLAUDE.md's performance section exists to
 * keep out. Only the resolved side, which changes rarely, is state.
 *
 * Runs in a layout effect so the first paint of an opened box is already in place.
 */
export function useAnchoredPosition(
  anchorRef: RefObject<HTMLElement | null>,
  floatingRef: RefObject<HTMLElement | null>,
  open: boolean,
  options: PlacementOptions = {},
): FloatingSide {
  const { side = 'bottom', align = 'center', offset, padding } = options;
  const [resolved, setResolved] = useState<FloatingSide>(side);

  useLayoutEffect(() => {
    if (!open) return;

    // At most one frame pending, however many scroll events arrive before it. Not a loop:
    // nothing re-schedules itself, and a frame that lands after cleanup does nothing
    // rather than being cancelled (tests/single-raf-loop.test.ts counts a cancel as a loop).
    let pending = false;
    let disposed = false;

    const update = () => {
      pending = false;
      if (disposed) return;
      const anchor = anchorRef.current;
      const floating = floatingRef.current;
      if (!anchor || !floating) return;

      const placement = placeFloating(
        anchor.getBoundingClientRect(),
        { width: floating.offsetWidth, height: floating.offsetHeight },
        viewportSize(),
        { side, align, offset, padding },
      );

      floating.style.top = `${placement.top}px`;
      floating.style.left = `${placement.left}px`;
      floating.dataset.side = placement.side;
      setResolved(placement.side);
    };

    const schedule = () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(update);
    };

    update();
    window.addEventListener('resize', schedule);
    // Capture, so a scroll inside any container moves the box, not only the page.
    window.addEventListener('scroll', schedule, { capture: true, passive: true });

    return () => {
      disposed = true;
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, { capture: true });
    };
  }, [open, anchorRef, floatingRef, side, align, offset, padding]);

  return resolved;
}
