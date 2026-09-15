'use client';

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import {
  DEFAULT_PREFERENCES,
  resolvePauseAtSteps,
  type DetailLevel,
  type PreferenceKey,
  type PreferenceValues,
} from './preferences';
import { sharedPreferencesStore, type PreferencesStore } from './store';

/**
 * Preferences, wired to React (docs/implementation/uiux.md §5.7, §7.5).
 *
 * ## Hydration never mismatches
 *
 * Every hook here reads through `useSyncExternalStore`, whose server snapshot is the
 * defaults. The server renders the defaults; the client hydrates with the defaults too,
 * then re-renders with what storage holds. Reading storage in a `useState` initialiser
 * would mismatch, and reading it in an effect would cost a cascading render -- the same
 * reasoning as `MotionProvider` and the Learning Center's progress store.
 *
 * What the viewer *sees* before hydration is handled one level down, by the pre-paint
 * script in `prePaint.ts`: CSS keyed on `data-detail` / `data-text-size` is already
 * right. Anything that must *unmount* in Simple (uiux.md §5.2's rendering rule) reads
 * `useDetail()` and so renders the Simple tree during hydration -- which is why panel
 * heights have to hold still between the two modes.
 *
 * ## Provider-safe
 *
 * With no provider above it, a hook reads the shared `localStorage` store directly, so a
 * component rendered on its own behaves exactly as it does in the app. The provider
 * exists to mirror the attributes onto `<html>` after hydration and to let a test hand
 * the tree a store of its own.
 */

const PreferencesContext = createContext<PreferencesStore | null>(null);

/** The store this subtree reads: the provider's, or the shared one. */
export function usePreferencesStore(): PreferencesStore {
  return useContext(PreferencesContext) ?? sharedPreferencesStore();
}

/**
 * One preference from a given store, and a setter for it.
 *
 * Selecting one field keeps a component subscribed to that field only: flipping "Large
 * text" does not re-render every simulation that reads the detail level.
 */
export function useStorePreference<K extends PreferenceKey>(
  store: PreferencesStore,
  key: K,
): [PreferenceValues[K], (value: PreferenceValues[K]) => void] {
  const value = useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot()[key],
    () => DEFAULT_PREFERENCES[key],
  );
  const set = useCallback(
    (next: PreferenceValues[K]) =>
      store.set({ [key]: next } as unknown as Partial<PreferenceValues>),
    [store, key],
  );
  return [value, set];
}

/** One preference and its setter, like `useState`. */
export function usePreference<K extends PreferenceKey>(
  key: K,
): [PreferenceValues[K], (value: PreferenceValues[K]) => void] {
  return useStorePreference(usePreferencesStore(), key);
}

/** Simple or Full detail. Simple during a server render and during hydration. */
export function useDetail(): DetailLevel {
  return usePreference('detail')[0];
}

/**
 * Whether playback should stop at each step: the explicit setting, or the detail level's
 * default when there is none (on in Simple, off in Full detail).
 */
export function usePauseAtSteps(): boolean {
  const [detail] = usePreference('detail');
  const [pauseAtSteps] = usePreference('pauseAtSteps');
  return resolvePauseAtSteps({ detail, pauseAtSteps });
}

export interface PreferencesProviderProps {
  children: ReactNode;
  /** Defaults to the shared `localStorage` store. Tests pass a memory store. */
  store?: PreferencesStore;
}

export function PreferencesProvider({ children, store }: PreferencesProviderProps) {
  const active = store ?? sharedPreferencesStore();
  const [detail] = useStorePreference(active, 'detail');
  const [textSize] = useStorePreference(active, 'textSize');

  /*
   * Keep `<html>` in step with the store after hydration: a change in Settings, or in
   * another tab, restyles the page at once. Written from the store's live snapshot
   * rather than from `detail`/`textSize` -- during hydration those are still the
   * server's defaults, and writing them would undo the pre-paint script for a frame.
   *
   * A layout effect, not a passive one, so the correction lands before paint. It also
   * puts the attributes back after React Strict Mode's development remount, which
   * resets `<html>` to the attributes JSX declares (the Next guide above describes it).
   * `data-motion` is not written here: `MotionProvider` owns it, resolved against the OS.
   */
  useLayoutEffect(() => {
    const root = document.documentElement;
    const live = active.getSnapshot();
    root.dataset.detail = live.detail;
    root.dataset.textSize = live.textSize;
    return () => {
      delete root.dataset.detail;
      delete root.dataset.textSize;
    };
  }, [active, detail, textSize]);

  return <PreferencesContext value={active}>{children}</PreferencesContext>;
}
