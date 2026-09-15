/**
 * The viewer's preferences: what they are, what they default to, and how a stored copy
 * is read back (docs/implementation/uiux.md §5.7, §7.5).
 *
 * Plain data and plain functions, no React, so the store, the provider, the pre-paint
 * script's test and the Settings menu all agree on one definition.
 *
 * **What is never in here.** Live mode: Network Diagnostics must come back in Learn mode
 * after a reload, so it lives in component state and nowhere else. And nothing personal:
 * `lastVisited` is a module route, validated as one, not a URL with a query string that
 * could carry what someone typed.
 */

/** The one `localStorage` key. Everything below is stored under it as one JSON object. */
export const PREFERENCES_KEY = 'iv:preferences';

/**
 * Where the motion override used to live, per tab, before it moved into the store.
 * Read once, migrated, and removed (see `store.ts`); nothing writes it any more.
 */
export const LEGACY_MOTION_KEY = 'iv:motion-preference';

/** Bumped only when a stored shape can no longer be read field by field. */
export const PREFERENCES_VERSION = 1;

export type DetailLevel = 'simple' | 'full';
/** `system` follows the OS `prefers-reduced-motion`; the other two override it. */
export type MotionSetting = 'system' | 'full' | 'reduced';
export type TextSize = 'normal' | 'large';

export interface Preferences {
  version: typeof PREFERENCES_VERSION;
  detail: DetailLevel;
  motion: MotionSetting;
  textSize: TextSize;
  /** `null` follows `detail`: on in Simple, off in Full detail. See `resolvePauseAtSteps`. */
  pauseAtSteps: boolean | null;
  seenCoachMarks: boolean;
  /** A module route, and nothing else. */
  lastVisited?: string;
}

/** Everything a caller may change. The version is the store's business. */
export type PreferenceValues = Omit<Preferences, 'version'>;
export type PreferenceKey = keyof PreferenceValues;

/**
 * What a new visitor gets, and what every server render uses.
 *
 * Frozen because it is handed out by identity -- as the server snapshot and as the
 * fallback for unreadable storage -- and one caller mutating it would change the page
 * for every other.
 */
export const DEFAULT_PREFERENCES: Readonly<Preferences> = Object.freeze({
  version: PREFERENCES_VERSION,
  detail: 'simple',
  motion: 'system',
  textSize: 'normal',
  pauseAtSteps: null,
  seenCoachMarks: false,
});

/** One path segment of lowercase words: `/packet-journey`. No query, no hash, no host. */
const MODULE_ROUTE = /^\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * One validator per field. A stored value either passes its own check or is replaced by
 * that field's default, so one bad field does not cost the viewer the other five.
 */
const VALID: { [K in PreferenceKey]-?: (value: unknown) => boolean } = {
  detail: (value) => value === 'simple' || value === 'full',
  motion: (value) => value === 'system' || value === 'full' || value === 'reduced',
  textSize: (value) => value === 'normal' || value === 'large',
  pauseAtSteps: (value) => value === null || typeof value === 'boolean',
  seenCoachMarks: (value) => typeof value === 'boolean',
  lastVisited: (value) => typeof value === 'string' && MODULE_ROUTE.test(value),
};

const KEYS = Object.keys(VALID) as PreferenceKey[];

export function isValidPreference<K extends PreferenceKey>(
  key: K,
  value: unknown,
): value is PreferenceValues[K] {
  return VALID[key](value);
}

/**
 * Read a stored copy back.
 *
 * Anything that is not a version-1 object -- missing, not JSON, an array, a number, a
 * future version this code cannot read -- is the defaults, by identity. A version-1
 * object keeps every field that is valid and loses every field that is not.
 */
export function parsePreferences(raw: string | null | undefined): Readonly<Preferences> {
  if (!raw) return DEFAULT_PREFERENCES;

  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return DEFAULT_PREFERENCES;
  }

  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
    return DEFAULT_PREFERENCES;
  }
  const record = stored as Record<string, unknown>;
  if (record.version !== PREFERENCES_VERSION) return DEFAULT_PREFERENCES;

  return withValues(DEFAULT_PREFERENCES, record);
}

/**
 * `base` with every valid field of `patch` applied, and every invalid one ignored.
 *
 * Returns `base` itself when nothing changes, which is what lets the store skip a write
 * and a re-render for a setting that was already set.
 */
export function withValues(
  base: Readonly<Preferences>,
  patch: Readonly<Record<string, unknown>>,
): Readonly<Preferences> {
  let next: Preferences | null = null;

  for (const key of KEYS) {
    if (!Object.hasOwn(patch, key)) continue;
    const value = patch[key];
    if (!VALID[key](value) || Object.is(base[key], value)) continue;
    next ??= { ...base };
    (next as unknown as Record<string, unknown>)[key] = value;
  }

  return next ?? base;
}

export function serializePreferences(preferences: Readonly<Preferences>): string {
  return JSON.stringify(preferences);
}

/**
 * Whether playback stops at each step boundary.
 *
 * An explicit choice wins. Otherwise it follows the detail level: Simple is for someone
 * watching this for the first time, who needs the run to wait while they read; Full
 * detail is for someone who already knows the shape and wants it uninterrupted.
 */
export function resolvePauseAtSteps(
  preferences: Pick<Preferences, 'detail' | 'pauseAtSteps'>,
): boolean {
  return preferences.pauseAtSteps ?? preferences.detail === 'simple';
}
