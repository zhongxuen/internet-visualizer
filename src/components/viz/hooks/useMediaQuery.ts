'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Whether a media query matches, read through `useSyncExternalStore`.
 *
 * `serverValue` is what the server render and hydration assume. Pick the one whose
 * correction costs nothing on screen: the Stage assumes `lg`, because the only things it
 * decides with this are ARIA roles (an attribute change) and where "Go deeper" mounts
 * (below the fold at `lg`, in a tab that starts closed below it).
 *
 * Layout itself never goes through here. Anything that changes a box's size or position
 * is a Tailwind breakpoint, so the server HTML is already right at every width.
 */
export function useMediaQuery(query: string, serverValue: boolean): boolean {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (typeof window.matchMedia !== 'function') return () => {};
      const list = window.matchMedia(query);
      list.addEventListener('change', listener);
      return () => list.removeEventListener('change', listener);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () =>
      typeof window.matchMedia === 'function'
        ? window.matchMedia(query).matches
        : serverValue,
    () => serverValue,
  );
}

/** Tailwind's `lg`: 64rem. */
export const LG_QUERY = '(min-width: 64rem)';
