'use client';

import { useEffect } from 'react';

import { matchPlaybackKey, shouldIgnoreKey } from '../keymap';
import type { PlaybackStore } from './usePlayback';

/**
 * Bind the playback keyboard map.
 *
 * Bound to the window rather than to the view's root element, on purpose: the shortcuts
 * have to work when nothing in particular is focused, which is the state a page is in
 * the moment it loads. `shouldIgnoreKey` is what keeps that from being rude -- a key
 * press that belongs to the focused element (a text field, the scrubber's own arrows,
 * `Space` on a button) is handed straight back.
 *
 * `preventDefault` is called only for a press this actually handles, so `Space` still
 * scrolls the page when the viewer is reading below the diagram rather than watching it.
 *
 * Call it once, from `SimulationView`. Two views bound at the same time would both
 * respond to one key press.
 */
export function usePlaybackKeys(store: PlaybackStore, enabled = true): void {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    const onKeyDown = (event: KeyboardEvent) => {
      // Something closer to the key press already dealt with it -- a dialog closing on
      // `Escape`, a menu taking the arrow keys.
      if (event.defaultPrevented) return;

      const command = matchPlaybackKey(event);
      if (!command || shouldIgnoreKey(event.target, command)) return;

      event.preventDefault();
      store.getState().run(command);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [store, enabled]);
}
