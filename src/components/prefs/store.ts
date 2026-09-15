import {
  DEFAULT_PREFERENCES,
  isValidPreference,
  LEGACY_MOTION_KEY,
  parsePreferences,
  PREFERENCES_KEY,
  serializePreferences,
  withValues,
  type PreferenceValues,
  type Preferences,
} from './preferences';

/**
 * The preferences as an external store, in the shape `useSyncExternalStore` wants.
 *
 * Two implementations and one interface: the product uses the `localStorage` one, and a
 * test hands a provider the in-memory one (`renderWithPreferences`), so a test can pin
 * Full detail without writing to storage another test will read.
 */
export interface PreferencesStore {
  subscribe(listener: () => void): () => void;
  /** The same object until something changes -- `useSyncExternalStore` loops otherwise. */
  getSnapshot(): Readonly<Preferences>;
  /** Always the defaults. The server cannot see storage, so a server render never does. */
  getServerSnapshot(): Readonly<Preferences>;
  /** Apply the valid fields of `patch`; invalid ones are ignored, not thrown. */
  set(patch: Partial<PreferenceValues>): void;
}

function getServerSnapshot(): Readonly<Preferences> {
  return DEFAULT_PREFERENCES;
}

function readItem(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    // Private mode, blocked site data, a sandboxed frame. A preference is a nicety;
    // losing it must never break the page.
    return null;
  }
}

function writeItem(storage: () => Storage, key: string, value: string): boolean {
  try {
    storage().setItem(key, value);
    return true;
  } catch {
    // Quota or blocked storage. The tab keeps the value in memory; only durability goes.
    return false;
  }
}

function removeItem(storage: () => Storage, key: string): void {
  try {
    storage().removeItem(key);
  } catch {
    /* see readItem */
  }
}

export interface LocalPreferencesStoreOptions {
  key?: string;
  /** The old per-tab motion override to migrate once. `null` skips migration. */
  legacyMotionKey?: string | null;
}

/**
 * The store the product uses: one JSON object under `iv:preferences`.
 *
 * ## Why every snapshot re-reads storage
 *
 * `getSnapshot` reads the raw string each time and re-parses only when that string has
 * changed. A read is a synchronous in-memory lookup; in return, the store can never
 * serve a value that storage no longer holds -- whether another tab, a test, or the
 * legacy migration below changed it. Nothing that renders per frame reads preferences,
 * so this is a handful of reads per interaction, not per frame.
 *
 * ## Other tabs
 *
 * A `storage` event fires in every *other* tab when one tab writes. Listening for it is
 * all it takes for Settings changed in one tab to apply in the rest; the event carries
 * no value we need, because the next snapshot reads storage anyway. `key === null` is
 * `localStorage.clear()`.
 */
export function createLocalPreferencesStore({
  key = PREFERENCES_KEY,
  legacyMotionKey = LEGACY_MOTION_KEY,
}: LocalPreferencesStoreOptions = {}): PreferencesStore {
  const local = () => window.localStorage;
  const session = () => window.sessionStorage;
  const listeners = new Set<() => void>();

  /** The raw string `cached` was parsed from. `undefined` until the first read. */
  let cachedRaw: string | null | undefined;
  let cached: Readonly<Preferences> = DEFAULT_PREFERENCES;

  function emit(): void {
    for (const listener of listeners) listener();
  }

  function current(): Readonly<Preferences> {
    const raw = readItem(local, key);
    if (raw !== cachedRaw) {
      cachedRaw = raw;
      cached = parsePreferences(raw);
    }
    return cached;
  }

  function onStorage(event: StorageEvent): void {
    if (event.key !== null && event.key !== key) return;
    emit();
  }

  /**
   * The motion override used to be per tab, in `sessionStorage`. Carry it over once:
   * into the store if the store has never been written, and deleted either way. Nothing
   * writes that key any more, so once it is deleted there is nothing left to read.
   *
   * Run when the store gains its first subscriber rather than from a snapshot, because
   * a snapshot is read during render and a migration writes. `useSyncExternalStore`
   * subscribes after commit and re-checks the snapshot when it does, so the migrated
   * value still lands before the viewer can have acted on the old one. In the app that
   * is once per page load: the root layout's providers stay subscribed from then on.
   */
  function migrateLegacyMotion(): void {
    if (legacyMotionKey === null) return;

    const legacy = readItem(session, legacyMotionKey);
    if (legacy === null) return;
    removeItem(session, legacyMotionKey);

    if (readItem(local, key) !== null || !isValidPreference('motion', legacy)) return;
    const next = withValues(DEFAULT_PREFERENCES, { motion: legacy });
    if (writeItem(local, key, serializePreferences(next))) emit();
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) {
        window.addEventListener('storage', onStorage);
        migrateLegacyMotion();
      }

      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) window.removeEventListener('storage', onStorage);
      };
    },

    getSnapshot() {
      if (typeof window === 'undefined') return DEFAULT_PREFERENCES;
      return current();
    },

    getServerSnapshot,

    set(patch) {
      const base = current();
      const next = withValues(base, patch);
      if (next === base) return;

      const raw = serializePreferences(next);
      // Only adopt the new raw string as "what storage holds" if it really does; when
      // the write fails, storage still holds the old string and `cached` keeps the new
      // value in memory until that string changes.
      if (writeItem(local, key, raw)) cachedRaw = raw;
      cached = next;
      emit();
    },
  };
}

/**
 * A store that never touches storage. For tests, and for anything that must pin a
 * preference without changing the viewer's.
 */
export function createMemoryPreferencesStore(
  initial: Partial<PreferenceValues> = {},
): PreferencesStore {
  const listeners = new Set<() => void>();
  let value = withValues(DEFAULT_PREFERENCES, initial);

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => value,
    getServerSnapshot,
    set(patch) {
      const next = withValues(value, patch);
      if (next === value) return;
      value = next;
      for (const listener of listeners) listener();
    },
  };
}

let shared: PreferencesStore | null = null;

/**
 * The one `localStorage`-backed store the product uses, created on first use.
 *
 * A module singleton, like the Learning Center's progress store, because a preference is
 * a fact about the browser tab and not about a subtree: the Settings menu and every
 * simulation on the page must read the same answer.
 */
export function sharedPreferencesStore(): PreferencesStore {
  shared ??= createLocalPreferencesStore();
  return shared;
}
