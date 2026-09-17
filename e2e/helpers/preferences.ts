import type { Page } from '@playwright/test';

import {
  PREFERENCES_KEY,
  PREFERENCES_VERSION,
  type PreferenceValues,
} from '@/components/prefs/preferences';

/**
 * Start a page with the given preferences already stored (uiux-spec.md §8.3, rule 5).
 *
 * A fresh browser is in Simple detail, like a new visitor. A spec that means Full detail,
 * or playback that does not pause at each step, says so:
 *
 * ```ts
 * await setPreferences(page, { detail: 'full' });
 * await page.goto('/dns-explorer');
 * ```
 *
 * Written with `addInitScript`, so it is in storage before the document's first script
 * runs -- the pre-paint script reads it before first paint, exactly as it would for a
 * returning viewer -- and again on every navigation in the page. Call it before `goto`.
 * The store reads a partial version-1 object field by field, so only the fields given
 * are set; the rest stay at their defaults.
 */
export async function setPreferences(
  page: Page,
  prefs: Partial<PreferenceValues>,
): Promise<void> {
  await page.addInitScript(
    ({ key, value }) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // No storage, no preferences: the store falls back to its defaults.
      }
    },
    {
      key: PREFERENCES_KEY,
      value: JSON.stringify({ version: PREFERENCES_VERSION, ...prefs }),
    },
  );
}
