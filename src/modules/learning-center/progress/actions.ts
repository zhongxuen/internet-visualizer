/**
 * The four things a reader can do to their own progress.
 *
 * Thin on purpose: each one is a pure reducer from `store.ts` applied to the singleton,
 * with `Date.now()` supplied here so the reducers themselves stay clock-free and
 * testable. Components call these; nothing in the module reaches for
 * `progressStore.update` directly.
 */

import {
  progressStore,
  recordQuizAnswer,
  rememberPosition,
  setLessonComplete,
} from './store';

/** Tick a lesson off, or untick it. */
export function markLessonComplete(slug: string, complete: boolean): void {
  progressStore.update((state) => setLessonComplete(state, slug, complete, Date.now()));
}

/** Note that a quiz was answered, and whether the answer was right. */
export function recordAnswer(slug: string, quizId: string, correct: boolean): void {
  progressStore.update((state) => recordQuizAnswer(state, slug, quizId, correct));
}

/** Remember where the reader is, so their track card can offer to resume. */
export function rememberLessonPosition(trackId: string, slug: string): void {
  progressStore.update((state) => rememberPosition(state, trackId, slug));
}

/**
 * Forget everything.
 *
 * Required by the spec, and by ordinary decency: data kept about someone without an
 * account is data they must be able to delete without one. `localStorage.removeItem`,
 * not a flag -- afterwards there is nothing stored.
 */
export function resetProgress(): void {
  progressStore.clear();
}
