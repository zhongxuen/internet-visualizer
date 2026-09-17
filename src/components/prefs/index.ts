/**
 * The viewer's preferences: one `localStorage` key, read through `useSyncExternalStore`,
 * and mirrored onto `<html>` before first paint (docs/implementation/uiux.md §5.7, §7.5).
 *
 * `renderWithPreferences` is deliberately not exported here; tests import it from
 * `@/components/prefs/testing`.
 */

export { applyPreferenceAttributes, PRE_PAINT_SCRIPT } from './prePaint';
export {
  DEFAULT_PREFERENCES,
  isValidPreference,
  LEGACY_MOTION_KEY,
  parsePreferences,
  PREFERENCES_KEY,
  PREFERENCES_VERSION,
  resolvePauseAtSteps,
  serializePreferences,
  withValues,
  type DetailLevel,
  type MotionSetting,
  type PreferenceKey,
  type Preferences,
  type PreferenceValues,
  type TextSize,
} from './preferences';
export {
  PreferencesProvider,
  useDetail,
  usePauseAtSteps,
  usePreference,
  usePreferencesStore,
  useStorePreference,
  type PreferencesProviderProps,
} from './PreferencesProvider';
export {
  createLocalPreferencesStore,
  createMemoryPreferencesStore,
  sharedPreferencesStore,
  type LocalPreferencesStoreOptions,
  type PreferencesStore,
} from './store';
