'use client';

import { useMemo } from 'react';

import type { PhaseSummary } from '@/core/sim/result';

/**
 * The one thing a simulation says out loud.
 *
 * `docs/implementation/14-quality-and-deployment.md`, section 2: *"each simulation
 * exposes an `aria-live` status announcing the current phase"*.
 *
 * ## What is announced, and what deliberately is not
 *
 * Only the phase. A run emits hundreds of events and moves the playhead sixty times a
 * second; a live region fed any of that would be a stream of interruptions that tells a
 * screen-reader user nothing and drowns out everything else on the page. The phase is the
 * right granularity because it is the *chapter*: it changes a handful of times per run, it
 * has a title and a sentence written for a human, and it is the same unit `PhaseStepper`
 * shows and the timeline marks.
 *
 * `role="status"` (which is `aria-live="polite"` plus `aria-atomic`) rather than `alert`:
 * a phase change is information, not an emergency, so it waits for a pause rather than
 * cutting off whatever is being read.
 *
 * ## Why the text is memoized
 *
 * The parent re-renders every animation frame. React would write the same string into
 * this node sixty times a second, and some screen readers announce a live region on any
 * mutation rather than on a change of value -- so the sentence is computed from the phase
 * index and nothing else, and the DOM text node is only touched when the chapter actually
 * turns over.
 *
 * The region is `sr-only`, not hidden: `display: none` or `aria-hidden` would stop it
 * being announced at all. Sighted users have the phase stepper, which says the same thing
 * with an icon and a word.
 */

export interface PhaseAnnouncerProps {
  phases: readonly PhaseSummary[];
  /** Index of the phase containing the playhead, or `-1` before the first begins. */
  currentIndex: number;
}

/** Prefixed with its position, so "3 of 7" is heard without counting. */
export function phaseAnnouncement(
  phases: readonly PhaseSummary[],
  currentIndex: number,
): string {
  if (phases.length === 0) return '';

  const phase = phases[currentIndex];
  if (!phase) return `Not started. ${phases.length} phases in this run.`;

  return `Phase ${currentIndex + 1} of ${phases.length}: ${phase.title}. ${phase.description}`;
}

export function PhaseAnnouncer({ phases, currentIndex }: PhaseAnnouncerProps) {
  const message = useMemo(
    () => phaseAnnouncement(phases, currentIndex),
    [phases, currentIndex],
  );

  return (
    <p role="status" className="sr-only">
      {message}
    </p>
  );
}
