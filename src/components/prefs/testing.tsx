import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

import { MotionProvider } from '@/components/motion';

import type { PreferenceValues } from './preferences';
import { PreferencesProvider } from './PreferencesProvider';
import { createMemoryPreferencesStore, type PreferencesStore } from './store';

/**
 * Render with the given preferences in force, for tests (uiux.md §8.6 rule 5).
 *
 * A fresh browser and jsdom both start in Simple, so a test that means Full detail says
 * so: `renderWithPreferences(<Thing />, { detail: 'full' })`. The preferences live in a
 * memory store, never in `localStorage`, so one test's choice cannot leak into the next;
 * the store is returned as `preferences` for a test that changes one mid-run.
 *
 * `MotionProvider` sits inside, reading the same store, so `{ motion: 'reduced' }` means
 * what it says.
 *
 * Its own module, and not re-exported from the folder's index, so that nothing in the
 * product can import Testing Library by accident.
 */
export function renderWithPreferences(
  ui: ReactElement,
  prefs: Partial<PreferenceValues> = {},
  options: Omit<RenderOptions, 'wrapper'> = {},
): RenderResult & { preferences: PreferencesStore } {
  const preferences = createMemoryPreferencesStore(prefs);

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <PreferencesProvider store={preferences}>
        <MotionProvider>{children}</MotionProvider>
      </PreferencesProvider>
    );
  }

  return { ...render(ui, { ...options, wrapper: Wrapper }), preferences };
}
