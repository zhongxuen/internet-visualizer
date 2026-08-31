'use client';

import { useContext, useMemo } from 'react';

import {
  MotionContext,
  scaleDuration,
  useSystemReducedMotion,
  type MotionContextValue,
} from './MotionProvider';

const noop = () => {};

/**
 * The reduced-motion hook every animated component uses.
 *
 * "Safe" in two senses:
 *
 *  - **SSR-safe** — it never touches `window` during render, so a component that
 *    animates can still be server-rendered.
 *  - **Provider-safe** — with no `MotionProvider` above it (an isolated unit test, a
 *    primitive rendered on its own) it falls back to reading the OS setting directly
 *    instead of throwing or, worse, silently animating for someone who asked it not to.
 *    Only the session override is unavailable in that case.
 *
 * Never read `prefers-reduced-motion` any other way: durations must go through
 * `scale()` so the override is honoured everywhere.
 */
export function useReducedMotionSafe(): MotionContextValue {
  const provided = useContext(MotionContext);
  // Called unconditionally — hooks rules — but only used when there is no provider.
  const systemReduced = useSystemReducedMotion();

  const fallback = useMemo<MotionContextValue>(
    () => ({
      reduced: systemReduced,
      systemReduced,
      preference: 'system',
      // No provider means no session state to write to; the OS setting still applies.
      setPreference: noop,
      scale: (ms: number) => scaleDuration(systemReduced, ms),
    }),
    [systemReduced],
  );

  return provided ?? fallback;
}
