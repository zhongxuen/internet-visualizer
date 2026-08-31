'use client';

import {
  createContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

/**
 * Reduced-motion policy for the whole product
 * (docs/implementation/02-design-system-and-shell.md, step 3).
 *
 * `reduced === true` removes **tweening only**. Simulations still run, still advance
 * through every step, and stay fully explorable — what changes is that a transition
 * lands on its end state immediately and the module leans on its step label instead of
 * the movement between states. Nothing here may be used to skip or hide content.
 *
 * The source of truth is the OS `prefers-reduced-motion` setting, overridable per
 * session from the UI: some users want the animation for one sitting without editing
 * their system preferences, and some want it gone without having set the OS flag.
 */

/** `system` follows the OS; the other two are the explicit session override. */
export type MotionPreference = 'system' | 'full' | 'reduced';

export interface MotionContextValue {
  /** Tweening is off. Read this before animating anything. */
  reduced: boolean;
  /**
   * Scale an intended duration (ms) for the current preference: the value unchanged
   * when motion is full, `0` when it is reduced. Every duration handed to `motion`,
   * a CSS transition, or a timeline must pass through here.
   */
  scale: (ms: number) => number;
  /** The session setting, including whether it is currently deferring to the OS. */
  preference: MotionPreference;
  setPreference: (preference: MotionPreference) => void;
  /** What the OS asks for, regardless of the override. Lets the UI say "follows OS". */
  systemReduced: boolean;
}

export const MotionContext = createContext<MotionContextValue | null>(null);

const MEDIA_QUERY = '(prefers-reduced-motion: reduce)';

/** Session-scoped on purpose: an override lasts for the sitting, not forever. */
const STORAGE_KEY = 'iv:motion-preference';

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

function isMotionPreference(value: unknown): value is MotionPreference {
  return value === 'system' || value === 'full' || value === 'reduced';
}

function readStoredPreference(): MotionPreference | null {
  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    return isMotionPreference(stored) ? stored : null;
  } catch {
    // Storage can throw (private mode, blocked cookies). The override is a nicety;
    // losing it must never break the app.
    return null;
  }
}

function writeStoredPreference(preference: MotionPreference): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, preference);
  } catch {
    /* see readStoredPreference */
  }
}

/**
 * The session override is an external store rather than plain state, for one reason:
 * the server cannot see `sessionStorage`, so the stored value must not reach the
 * hydration render. `useSyncExternalStore` renders `getServerSnapshot()` while
 * hydrating and then re-renders with the real value — which reading storage in a
 * `useState` initialiser (hydration mismatch) or in an effect (cascading render)
 * would not.
 *
 * One store per provider, resolved lazily so storage is only ever touched on the
 * client.
 */
function createPreferenceStore(initial: MotionPreference) {
  const listeners = new Set<() => void>();
  let value: MotionPreference | null = null;

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot(): MotionPreference {
      value ??= readStoredPreference() ?? initial;
      return value;
    },
    getServerSnapshot(): MotionPreference {
      return initial;
    },
    set(next: MotionPreference) {
      value = next;
      writeStoredPreference(next);
      for (const listener of listeners) listener();
    },
  };
}

export interface MotionProviderProps {
  children: ReactNode;
  /** Starting point before any stored session override is read. */
  defaultPreference?: MotionPreference;
}

export function MotionProvider({
  children,
  defaultPreference = 'system',
}: MotionProviderProps) {
  const systemReduced = useSystemReducedMotion();
  const [store] = useState(() => createPreferenceStore(defaultPreference));
  const preference = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );

  const reduced = resolveReduced(preference, systemReduced);

  // Mirror onto <html> so `globals.css` can collapse transitions that no component
  // owns — hover states, focus rings, anything styled purely in CSS. Without this the
  // manual override would only reach JS-driven animation.
  useEffect(() => {
    document.documentElement.dataset.motion = reduced ? 'reduced' : 'full';
  }, [reduced]);

  const value = useMemo<MotionContextValue>(
    () => ({
      reduced,
      systemReduced,
      preference,
      setPreference: store.set,
      scale: (ms: number) => scaleDuration(reduced, ms),
    }),
    [reduced, systemReduced, preference, store],
  );

  return <MotionContext value={value}>{children}</MotionContext>;
}
