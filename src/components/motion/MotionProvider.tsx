'use client';

import {
  createContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import type { MotionSetting } from '@/components/prefs/preferences';
import {
  usePreferencesStore,
  useStorePreference,
} from '@/components/prefs/PreferencesProvider';
import { createMemoryPreferencesStore } from '@/components/prefs/store';

/**
 * Reduced-motion policy for the whole product
 * (docs/implementation/02-design-system-and-shell.md, step 3).
 *
 * `reduced === true` removes **tweening only**. Simulations still run, still advance
 * through every step, and stay fully explorable — what changes is that a transition
 * lands on its end state immediately and the module leans on its step label instead of
 * the movement between states. Nothing here may be used to skip or hide content.
 *
 * The source of truth is the OS `prefers-reduced-motion` setting, overridable from the
 * UI: some users want the animation without editing their system preferences, and some
 * want it gone without having set the OS flag. The override is the `motion` field of the
 * viewer's preferences (`@/components/prefs`, uiux.md §5.7), so it lasts across visits
 * and follows the viewer between tabs. It used to be per tab, in `sessionStorage`; the
 * preferences store migrates that value once and never reads it again.
 */

/** `system` follows the OS; the other two are the explicit override. */
export type MotionPreference = MotionSetting;

export interface MotionContextValue {
  /** Tweening is off. Read this before animating anything. */
  reduced: boolean;
  /**
   * Scale an intended duration (ms) for the current preference: the value unchanged
   * when motion is full, `0` when it is reduced. Every duration handed to `motion`,
   * a CSS transition, or a timeline must pass through here.
   */
  scale: (ms: number) => number;
  /** The stored setting, including whether it is currently deferring to the OS. */
  preference: MotionPreference;
  setPreference: (preference: MotionPreference) => void;
  /** What the OS asks for, regardless of the override. Lets the UI say "follows OS". */
  systemReduced: boolean;
}

export const MotionContext = createContext<MotionContextValue | null>(null);

const MEDIA_QUERY = '(prefers-reduced-motion: reduce)';

function subscribeToSystem(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const list = window.matchMedia(MEDIA_QUERY);
  list.addEventListener('change', onStoreChange);
  return () => list.removeEventListener('change', onStoreChange);
}

function getSystemSnapshot(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(MEDIA_QUERY).matches;
}

// The server cannot know the user's setting. Render as full motion and let the client
// correct it on hydration — the reverse would flash content that never animates in.
function getServerSnapshot(): boolean {
  return false;
}

/** Live `prefers-reduced-motion`, ignoring any session override. */
export function useSystemReducedMotion(): boolean {
  return useSyncExternalStore(subscribeToSystem, getSystemSnapshot, getServerSnapshot);
}

export function resolveReduced(
  preference: MotionPreference,
  systemReduced: boolean,
): boolean {
  return preference === 'system' ? systemReduced : preference === 'reduced';
}

/**
 * The one place a duration is allowed to collapse. `0` rather than a small non-zero
 * value so animation libraries jump straight to the end state instead of scheduling a
 * frame that a reduced-motion user can still perceive as movement.
 */
export function scaleDuration(reduced: boolean, ms: number): number {
  return reduced ? 0 : ms;
}

export interface MotionProviderProps {
  children: ReactNode;
  /**
   * Pin the starting preference instead of reading the viewer's.
   *
   * For tests and isolated demos: the provider then keeps its own in-memory setting,
   * starting here, and never reads or writes the stored preferences. Leave it out --
   * as the root layout does -- to follow the viewer's stored setting.
   */
  defaultPreference?: MotionPreference;
}

export function MotionProvider({ children, defaultPreference }: MotionProviderProps) {
  const systemReduced = useSystemReducedMotion();
  const viewer = usePreferencesStore();
  const [pinned] = useState(() =>
    defaultPreference === undefined
      ? null
      : createMemoryPreferencesStore({ motion: defaultPreference }),
  );
  const store = pinned ?? viewer;
  const [preference, setPreference] = useStorePreference(store, 'motion');

  const reduced = resolveReduced(preference, systemReduced);

  /*
   * Mirror onto <html> so `globals.css` can collapse transitions that no component
   * owns — hover states, focus rings, anything styled purely in CSS. Without this the
   * manual override would only reach JS-driven animation.
   *
   * Resolved from the live snapshot, not from `reduced`: during hydration `reduced` is
   * still the server's answer (full motion), and writing it would briefly undo what the
   * pre-paint script set from the stored preference.
   */
  useEffect(() => {
    const live = resolveReduced(store.getSnapshot().motion, getSystemSnapshot());
    document.documentElement.dataset.motion = live ? 'reduced' : 'full';
  }, [reduced, store]);

  const value = useMemo<MotionContextValue>(
    () => ({
      reduced,
      systemReduced,
      preference,
      setPreference,
      scale: (ms: number) => scaleDuration(reduced, ms),
    }),
    [reduced, systemReduced, preference, setPreference],
  );

  return <MotionContext value={value}>{children}</MotionContext>;
}
