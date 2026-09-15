import { describe, expect, it } from 'vitest';

import { placeFloating, VIEWPORT_PADDING } from './position';

const VIEWPORT = { width: 400, height: 800 };
const BOX = { width: 200, height: 100 };

/** An anchor 40x20, at (x, y). */
const at = (left: number, top: number) => ({ left, top, width: 40, height: 20 });

describe('placeFloating', () => {
  it('centres the box under the anchor when there is room', () => {
    expect(placeFloating(at(180, 300), BOX, VIEWPORT, { offset: 8 })).toEqual({
      top: 328,
      left: 100,
      side: 'bottom',
    });
  });

  it('flips to the opposite side when the preferred one has no room', () => {
    // 20px from the bottom: no room below, plenty above.
    const placement = placeFloating(at(180, 760), BOX, VIEWPORT, { offset: 8 });
    expect(placement.side).toBe('top');
    expect(placement.top).toBe(760 - 8 - BOX.height);

    // And back again from the top edge.
    expect(placeFloating(at(180, 10), BOX, VIEWPORT, { side: 'top' }).side).toBe(
      'bottom',
    );
  });

  it('keeps the preferred side when neither side fits but it is the roomier one', () => {
    const tall = { width: 200, height: 780 };
    expect(placeFloating(at(180, 500), tall, VIEWPORT, { side: 'top' }).side).toBe('top');
  });

  it('shifts sideways to stay inside the viewport, less the padding', () => {
    // Anchor at the right edge of a phone: centred, the box would overhang by 100px.
    expect(placeFloating(at(360, 300), BOX, VIEWPORT).left).toBe(
      VIEWPORT.width - BOX.width - VIEWPORT_PADDING,
    );
    // And at the left edge.
    expect(placeFloating(at(0, 300), BOX, VIEWPORT).left).toBe(VIEWPORT_PADDING);
  });

  it('pins a box wider than the viewport to the leading edge', () => {
    const wide = { width: 600, height: 100 };
    expect(placeFloating(at(180, 300), wide, VIEWPORT).left).toBe(VIEWPORT_PADDING);
  });

  it('clamps the main axis when the box fits on neither side', () => {
    const tall = { width: 200, height: 790 };
    const placement = placeFloating(at(180, 400), tall, VIEWPORT);
    expect(placement.top).toBe(VIEWPORT_PADDING);
  });

  it('honours start and end alignment', () => {
    expect(placeFloating(at(100, 300), BOX, VIEWPORT, { align: 'start' }).left).toBe(100);
    expect(placeFloating(at(100, 300), BOX, VIEWPORT, { align: 'end' }).left).toBe(
      VIEWPORT_PADDING,
    );
    expect(placeFloating(at(300, 300), BOX, VIEWPORT, { align: 'end' }).left).toBe(140);
  });

  it('places and flips on the horizontal axis too', () => {
    const right = placeFloating(at(20, 300), BOX, VIEWPORT, { side: 'right', offset: 4 });
    expect(right).toEqual({ side: 'right', left: 64, top: 260 });

    const flipped = placeFloating(at(20, 300), BOX, VIEWPORT, { side: 'left' });
    expect(flipped.side).toBe('right');
  });
});
