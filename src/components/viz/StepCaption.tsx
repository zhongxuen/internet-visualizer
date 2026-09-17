'use client';

import { memo } from 'react';

import { TermText } from '@/components/glossary';
import type { PhaseSummary } from '@/core/sim/result';
import { cn } from '@/lib/cn';

import { stepCaption, type Detail, type StageMoment } from './stage';

/**
 * The step, told in one sentence, large, next to the picture (uiux-spec.md §4, principle
 * 3) -- and the one thing a simulation says out loud.
 *
 * This is `PhaseAnnouncer` made visible. It keeps that component's contract, which
 * `e2e/a11y-manual.spec.ts` asserts: exactly one `role="status"` per view. A run emits
 * hundreds of events and moves the playhead sixty times a second; a live region fed any
 * of that would be a stream of interruptions, so only the step is announced, because it
 * is the chapter: it changes a handful of times in a run and has a sentence written for a
 * person. `status` (polite and atomic) rather than `alert`, because a new step is
 * information and can wait for the reader to finish.
 *
 * What it says is `stepCaption()` in `stage.ts`: the story's question before the first
 * play, "Step n of m" with the plain sentence (Simple) or the title and description
 * (Full detail) while it runs, and "Done: here is what happened" at the end. Glossary
 * words are linked through `TermText`, which is short enough work for one sentence.
 *
 * Memoized, and handed only discrete values: the view around it re-renders every frame
 * while playing, and some screen readers announce any mutation of a live region, not
 * just a change of text. So nothing here is touched until the step turns over.
 *
 * Where it sits is the view's decision, through `className`: overlaid on the canvas's
 * lower edge at `lg`, directly under the canvas below it.
 */

export interface StepCaptionProps {
  phases: readonly PhaseSummary[];
  /** Index of the step in force, or `-1` before the first begins. */
  currentIndex: number;
  moment: StageMoment;
  detail: Detail;
  /** The story's question, asked before the first play. */
  question?: string;
  className?: string;
}

export const StepCaption = memo(function StepCaption({
  phases,
  currentIndex,
  moment,
  detail,
  question,
  className,
}: StepCaptionProps) {
  const caption = stepCaption(phases, currentIndex, moment, detail, question);

  return (
    <div
      role="status"
      data-moment={moment}
      // Its height is fixed by the view, so a long step scrolls, and a scroll box of text
      // needs a tab stop of its own (CLAUDE.md, accessibility rule 2).
      tabIndex={0}
      className={cn(
        'text-fg text-story overflow-y-auto overscroll-contain leading-snug text-pretty',
        'focus-visible:outline-focus focus-visible:outline-2 focus-visible:outline-offset-2',
        className,
      )}
    >
      {caption.step ? (
        <span className="text-accent text-small mb-0.5 block font-semibold tracking-wide">
          {caption.step}
          {/* Heard as one sentence, not "Step 2 of 4Your laptop...". */}
          <span className="sr-only">: </span>
        </span>
      ) : null}
      {caption.title ? (
        <span className="block font-semibold">
          <TermText text={caption.title} />
          <span className="sr-only">. </span>
        </span>
      ) : null}
      <span
        className={cn('block', caption.title && 'text-fg-secondary text-body mt-0.5')}
      >
        <TermText text={caption.text} />
      </span>
    </div>
  );
});
