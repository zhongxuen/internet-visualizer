'use client';

import { useMemo } from 'react';

import { StartPath, type StartPathItem } from '@/components/shell/StartPath';
import { isLessonComplete } from '@/modules/learning-center/progress/store';
import { useProgress } from '@/modules/learning-center/progress/useProgress';

export interface StartPathProgressProps {
  steps: readonly StartPathItem[];
  className?: string;
}

/**
 * The home page's one reader of learning progress: it asks the Learning Center's store
 * which of the First steps are done and hands `StartPath` the answer.
 *
 * It lives in `app/` because it is the join between a module and the shell, which
 * neither side may make (CLAUDE.md, architecture rule 3). The import is the progress
 * hook's own files rather than the module's index on purpose: the index re-exports the
 * lesson layout, the embedded simulation and the MDX loader, and none of that belongs
 * in the home page's first load.
 *
 * `useProgress()` is `null` on the server and through hydration, so the first client
 * render matches the server's markup exactly and the ticks arrive a render later.
 */
export function StartPathProgress({ steps, className }: StartPathProgressProps) {
  const progress = useProgress();

  const completed = useMemo(() => {
    if (!progress) return null;
    return new Set(
      steps
        .filter((step) => isLessonComplete(progress, step.slug))
        .map((step) => step.slug),
    );
  }, [progress, steps]);

  return <StartPath steps={steps} completed={completed} className={className} />;
}
