import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_PREFERENCES,
  LEGACY_MOTION_KEY,
  PREFERENCES_KEY,
  parsePreferences,
} from './preferences';
import { createLocalPreferencesStore, createMemoryPreferencesStore } from './store';

/** What another tab's write looks like from this one: storage changes, then an event. */
function writeFromAnotherTab(key: string | null, value: string | null): void {
  if (key === null) window.localStorage.clear();
  else if (value === null) window.localStorage.removeItem(key);
  else window.localStorage.setItem(key, value);

  window.dispatchEvent(
    new StorageEvent('storage', {
      key,
      newValue: value,
      storageArea: window.localStorage,
    }),
  );
}

const stored = () => window.localStorage.getItem(PREFERENCES_KEY);

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the localStorage store', () => {
  it('reads the defaults when nothing is stored, and writes nothing to say so', () => {
    const store = createLocalPreferencesStore();
    expect(store.getSnapshot()).toBe(DEFAULT_PREFERENCES);
    expect(stored()).toBeNull();
  });

  it('reads the defaults from bad JSON, and leaves the bad value alone until a write', () => {
    window.localStorage.setItem(PREFERENCES_KEY, '{"version":1,"detail":');
    const store = createLocalPreferencesStore();

    expect(store.getSnapshot()).toBe(DEFAULT_PREFERENCES);
    expect(stored()).toBe('{"version":1,"detail":');

    store.set({ detail: 'full' });
    expect(JSON.parse(stored()!)).toEqual({ ...DEFAULT_PREFERENCES, detail: 'full' });
  });

  it('serves the server snapshot as the defaults whatever storage holds', () => {
    window.localStorage.setItem(
      PREFERENCES_KEY,
      JSON.stringify({ version: 1, detail: 'full' }),
    );
    const store = createLocalPreferencesStore();
    expect(store.getServerSnapshot()).toBe(DEFAULT_PREFERENCES);
    expect(store.getSnapshot().detail).toBe('full');
  });

  it('writes one versioned JSON object under one key', () => {
    const store = createLocalPreferencesStore();
    store.set({ detail: 'full', textSize: 'large' });

    expect(Object.keys(window.localStorage)).toEqual([PREFERENCES_KEY]);
    expect(JSON.parse(stored()!)).toEqual({
      version: 1,
      detail: 'full',
      motion: 'system',
      textSize: 'large',
      pauseAtSteps: null,
      seenCoachMarks: false,
    });
  });

  it('hands out the same snapshot until something changes', () => {
    window.localStorage.setItem(
      PREFERENCES_KEY,
      JSON.stringify({ version: 1, detail: 'full' }),
    );
    const store = createLocalPreferencesStore();
    const first = store.getSnapshot();
    expect(store.getSnapshot()).toBe(first);

    store.set({ detail: 'simple' });
    expect(store.getSnapshot()).not.toBe(first);
  });

  it('notifies subscribers on a change, and not on a set that changes nothing', () => {
    const store = createLocalPreferencesStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.set({ detail: 'simple' });
    store.set({ detail: 'fancy' as never });
    expect(listener).not.toHaveBeenCalled();

    store.set({ detail: 'full' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps a setting for the tab when storage refuses the write', () => {
    const store = createLocalPreferencesStore();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });

    expect(() => store.set({ detail: 'full' })).not.toThrow();
    expect(store.getSnapshot().detail).toBe('full');
    expect(stored()).toBeNull();
  });

  it('reads the defaults, and never throws, when storage cannot be read at all', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    const store = createLocalPreferencesStore();
    expect(store.getSnapshot()).toBe(DEFAULT_PREFERENCES);
  });

  describe('a change in another tab', () => {
    it('applies here and notifies subscribers', () => {
      const store = createLocalPreferencesStore();
      const listener = vi.fn();
      store.subscribe(listener);
      expect(store.getSnapshot().detail).toBe('simple');

      writeFromAnotherTab(
        PREFERENCES_KEY,
        JSON.stringify({ version: 1, detail: 'full', textSize: 'large' }),
      );

      expect(listener).toHaveBeenCalledTimes(1);
      expect(store.getSnapshot()).toMatchObject({ detail: 'full', textSize: 'large' });
    });

    it('applies bad data from another tab as the defaults', () => {
      window.localStorage.setItem(
        PREFERENCES_KEY,
        JSON.stringify({ version: 1, detail: 'full' }),
      );
      const store = createLocalPreferencesStore();
      store.subscribe(() => {});
      expect(store.getSnapshot().detail).toBe('full');

      writeFromAnotherTab(PREFERENCES_KEY, 'not json');
      expect(store.getSnapshot()).toBe(DEFAULT_PREFERENCES);
    });

    it('applies `localStorage.clear()` elsewhere as a return to the defaults', () => {
      window.localStorage.setItem(
        PREFERENCES_KEY,
        JSON.stringify({ version: 1, detail: 'full' }),
      );
      const store = createLocalPreferencesStore();
      const listener = vi.fn();
      store.subscribe(listener);

      writeFromAnotherTab(null, null);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(store.getSnapshot()).toBe(DEFAULT_PREFERENCES);
    });

    it('ignores writes to other keys', () => {
      const store = createLocalPreferencesStore();
      const listener = vi.fn();
      store.subscribe(listener);

      writeFromAnotherTab('iv:learning-progress', '{}');
      expect(listener).not.toHaveBeenCalled();
    });

    it('stops listening once nothing is subscribed', () => {
      const store = createLocalPreferencesStore();
      const listener = vi.fn();
      const unsubscribe = store.subscribe(listener);
      unsubscribe();

      writeFromAnotherTab(
        PREFERENCES_KEY,
        JSON.stringify({ version: 1, detail: 'full' }),
      );
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('the old per-tab motion override', () => {
    it('is migrated into the store once, on first subscribe, and then removed', () => {
      window.sessionStorage.setItem(LEGACY_MOTION_KEY, 'reduced');
      const store = createLocalPreferencesStore();
      const listener = vi.fn();

      store.subscribe(listener);

      expect(store.getSnapshot().motion).toBe('reduced');
      expect(parsePreferences(stored()).motion).toBe('reduced');
      expect(window.sessionStorage.getItem(LEGACY_MOTION_KEY)).toBeNull();
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('never overrides preferences that were already stored', () => {
      window.localStorage.setItem(
        PREFERENCES_KEY,
        JSON.stringify({ version: 1, motion: 'full' }),
      );
      window.sessionStorage.setItem(LEGACY_MOTION_KEY, 'reduced');
      const store = createLocalPreferencesStore();
      store.subscribe(() => {});

      expect(store.getSnapshot().motion).toBe('full');
      // Still removed: it is read once and never again, whatever it said.
      expect(window.sessionStorage.getItem(LEGACY_MOTION_KEY)).toBeNull();
    });

    it('drops a value that was never a motion setting', () => {
      window.sessionStorage.setItem(LEGACY_MOTION_KEY, 'sometimes');
      const store = createLocalPreferencesStore();
      store.subscribe(() => {});

      expect(store.getSnapshot()).toBe(DEFAULT_PREFERENCES);
      expect(stored()).toBeNull();
      expect(window.sessionStorage.getItem(LEGACY_MOTION_KEY)).toBeNull();
    });

    it('is checked when the store gains its first subscriber, not on every one', () => {
      const store = createLocalPreferencesStore();
      store.subscribe(() => {});

      window.sessionStorage.setItem(LEGACY_MOTION_KEY, 'reduced');
      store.subscribe(() => {});
      expect(store.getSnapshot().motion).toBe('system');
    });

    it('is skipped entirely for a store built without a legacy key', () => {
      window.sessionStorage.setItem(LEGACY_MOTION_KEY, 'reduced');
      const store = createLocalPreferencesStore({ legacyMotionKey: null });
      store.subscribe(() => {});

      expect(store.getSnapshot().motion).toBe('system');
      expect(window.sessionStorage.getItem(LEGACY_MOTION_KEY)).toBe('reduced');
    });
  });
});

describe('the memory store', () => {
  it('starts from the given values over the defaults', () => {
    const store = createMemoryPreferencesStore({ detail: 'full' });
    expect(store.getSnapshot()).toEqual({ ...DEFAULT_PREFERENCES, detail: 'full' });
    expect(store.getServerSnapshot()).toBe(DEFAULT_PREFERENCES);
  });

  it('never touches storage', () => {
    const store = createMemoryPreferencesStore();
    store.set({ detail: 'full', motion: 'reduced' });
    expect(window.localStorage.length).toBe(0);
    expect(store.getSnapshot()).toMatchObject({ detail: 'full', motion: 'reduced' });
  });

  it('notifies only on a real change', () => {
    const store = createMemoryPreferencesStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.set({ detail: 'simple' });
    expect(listener).not.toHaveBeenCalled();
    store.set({ detail: 'full' });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.set({ detail: 'simple' });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
