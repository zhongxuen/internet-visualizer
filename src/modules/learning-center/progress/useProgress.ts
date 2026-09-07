'use client';

import { useSyncExternalStore } from 'react';

import {
  completedCount,
  isLessonComplete,
  progressStore,
  quizRecord,
  type ProgressState,
  type QuizRecord,
} from './store';

/**
 * Read progress in a component.
 *
 * **Returns `null` on the server and through hydration**, and a `ProgressState` from
 * the first client render after that. That is the whole hydration-safety story in one
 * return type: there is no value to draw a tick from until the browser has spoken, so
 * the server markup and the hydration markup are necessarily identical, and every
 * consumer is forced by the type checker to decide what it renders in the meantime.
 * Reading `localStorage` in a `useState` initialiser (mismatch) or in an effect
 * (cascading render) would both be shorter and both be wrong.
 *
 * The derived hooks below exist so the null check is written once per question rather
 * than once per component, and they keep the same convention: `null` is "ask again
 * after hydration", never "no".
 */
export function useProgress(): ProgressState | null {
  return useSyncExternalStore(
    progressStore.subscribe,
    progressStore.getSnapshot,
    progressStore.getServerSnapshot,
  );
}

/** Whether one lesson is done. `null` until progress is readable. */
export function useLessonComplete(slug: string): boolean | null {
  const progress = useProgress();
  return progress ? isLessonComplete(progress, slug) : null;
}

/** The reader's last answer to one quiz, if they have given one. */
export function useQuizRecord(slug: string, quizId: string): QuizRecord | null {
  const progress = useProgress();
  return progress ? (quizRecord(progress, slug, quizId) ?? null) : null;
}

export interface TrackProgress {
  completed: number;
  total: number;
  /** The lesson the reader last opened in this track, if any. */
  lastLesson?: string;
}

/** How far through a track the reader is. The caller passes the track's own order. */
export function useTrackProgress(
  trackId: string,
  slugs: readonly string[],
): TrackProgress | null {
  const progress = useProgress();
  if (!progress) return null;

  return {
    completed: completedCount(progress, slugs),
    total: slugs.length,
    lastLesson: progress.lastLesson[trackId],
  };
}
