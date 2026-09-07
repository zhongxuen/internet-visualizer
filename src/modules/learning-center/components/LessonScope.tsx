'use client';

import { createContext, useContext } from 'react';

/**
 * Which lesson the surrounding content belongs to.
 *
 * A quiz written in MDX cannot be told its lesson by its author -- asking every
 * `<Quiz>` to repeat `slug="what-is-a-network"` would be a fact the file already knows
 * by being that file, and the first copy-pasted quiz would record its answers against
 * the wrong lesson. `LessonLayout` publishes the scope instead, and the components
 * inside read it.
 *
 * `null` outside a lesson is a supported state, not an error: a `<Quiz>` rendered on
 * its own -- in a test, or later on a summary page -- still works, it just has nowhere
 * to record the answer.
 */

export interface LessonScope {
  /** The lesson slug, which is the key progress is stored under. */
  slug: string;
  /** The track it was reached through. */
  trackId: string;
}

export const LessonScopeContext = createContext<LessonScope | null>(null);

export function useLessonScope(): LessonScope | null {
  return useContext(LessonScopeContext);
}
