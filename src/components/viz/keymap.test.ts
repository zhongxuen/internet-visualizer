import { describe, expect, it } from 'vitest';

import { PLAYBACK_SPEEDS } from '@/core/sim/playback';

import {
  matchPlaybackKey,
  PLAYBACK_SHORTCUTS,
  shouldIgnoreKey,
  type PlaybackCommand,
} from './keymap';

function element(html: string): Element {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host.firstElementChild as Element;
}

const TOGGLE: PlaybackCommand = { type: 'toggle' };
const STEP: PlaybackCommand = { type: 'step-phase', direction: 1 };

describe('matchPlaybackKey', () => {
  it('maps the documented keys', () => {
    expect(matchPlaybackKey({ key: ' ' })).toEqual({ type: 'toggle' });
    expect(matchPlaybackKey({ key: 'ArrowRight' })).toEqual({
      type: 'step-phase',
      direction: 1,
    });
    expect(matchPlaybackKey({ key: 'ArrowLeft' })).toEqual({
      type: 'step-phase',
      direction: -1,
    });
    expect(matchPlaybackKey({ key: 'Home' })).toEqual({ type: 'jump', to: 'start' });
    expect(matchPlaybackKey({ key: 'End' })).toEqual({ type: 'jump', to: 'end' });
    expect(matchPlaybackKey({ key: '.' })).toEqual({ type: 'replay-phase' });
  });

  it('turns the arrows into event steps when Shift is held', () => {
    expect(matchPlaybackKey({ key: 'ArrowRight', shiftKey: true })).toEqual({
      type: 'step-event',
      direction: 1,
    });
    expect(matchPlaybackKey({ key: 'ArrowLeft', shiftKey: true })).toEqual({
      type: 'step-event',
      direction: -1,
    });
  });

  it('maps 1 to 5 onto the speed ladder in order', () => {
    for (const [index, speed] of PLAYBACK_SPEEDS.entries()) {
      expect(matchPlaybackKey({ key: String(index + 1) })).toEqual({
        type: 'speed',
        speed,
      });
    }
  });

  it('leaves keys it does not own alone', () => {
    for (const key of ['a', 'Escape', 'Enter', '0', '6', 'ArrowUp', 'Tab']) {
      expect(matchPlaybackKey({ key })).toBeNull();
    }
  });

  it('never shadows a browser or OS chord', () => {
    expect(matchPlaybackKey({ key: 'ArrowLeft', metaKey: true })).toBeNull();
    expect(matchPlaybackKey({ key: 'ArrowRight', ctrlKey: true })).toBeNull();
    expect(matchPlaybackKey({ key: ' ', altKey: true })).toBeNull();
  });
});

describe('shouldIgnoreKey', () => {
  it('hands every key back to a text field', () => {
    expect(shouldIgnoreKey(element('<input type="text" />'), TOGGLE)).toBe(true);
    expect(shouldIgnoreKey(element('<textarea></textarea>'), STEP)).toBe(true);
    expect(shouldIgnoreKey(element('<div contenteditable="true"></div>'), TOGGLE)).toBe(
      true,
    );
  });

  it('leaves the scrubber its own navigation keys but not play/pause', () => {
    const scrubber = element('<input type="range" />');

    expect(shouldIgnoreKey(scrubber, STEP)).toBe(true);
    expect(shouldIgnoreKey(scrubber, { type: 'jump', to: 'end' })).toBe(true);
    expect(shouldIgnoreKey(scrubber, TOGGLE)).toBe(false);
    expect(shouldIgnoreKey(scrubber, { type: 'speed', speed: 2 })).toBe(false);
  });

  it('lets Space activate the focused button rather than toggling playback', () => {
    const button = element('<button type="button"></button>');

    expect(shouldIgnoreKey(button, TOGGLE)).toBe(true);
    // The arrows are not a button's to claim.
    expect(shouldIgnoreKey(button, STEP)).toBe(false);
    expect(shouldIgnoreKey(element('<div role="button"></div>'), TOGGLE)).toBe(true);
  });

  it('claims everything when the press landed on nothing in particular', () => {
    expect(shouldIgnoreKey(null, TOGGLE)).toBe(false);
    expect(shouldIgnoreKey(document.body, TOGGLE)).toBe(false);
  });
});

describe('the printed legend', () => {
  it('documents a working shortcut for every key it prints', () => {
    /** How the legend spells a key, to what a `KeyboardEvent` would report. */
    const AS_EVENT_KEY: Record<string, string> = {
      Space: ' ',
      '→': 'ArrowRight',
      '←': 'ArrowLeft',
    };

    for (const shortcut of PLAYBACK_SHORTCUTS) {
      for (const chord of shortcut.chords) {
        const shiftKey = chord.includes('Shift');
        const printed = chord.filter((key) => key !== 'Shift').at(-1) ?? '';
        const key = AS_EVENT_KEY[printed] ?? printed;

        expect(matchPlaybackKey({ key, shiftKey })).not.toBeNull();
      }
    }
  });

  it('covers every command the map can produce', () => {
    const produced = new Set(
      [' ', 'ArrowRight', 'ArrowLeft', 'Home', 'End', '.', '1']
        .map((key) => matchPlaybackKey({ key })?.type)
        .filter(Boolean),
    );

    expect(produced).toEqual(
      new Set(['toggle', 'step-phase', 'jump', 'replay-phase', 'speed']),
    );
    expect(matchPlaybackKey({ key: 'ArrowRight', shiftKey: true })?.type).toBe(
      'step-event',
    );
    expect(PLAYBACK_SHORTCUTS).toHaveLength(6);
  });
});
