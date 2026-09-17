'use client';

import { memo, useId } from 'react';

import { Check, CircleDot } from 'lucide-react';

import { TermText } from '@/components/glossary';
import { useDetail } from '@/components/prefs';
import type { PhaseSummary } from '@/core/sim/result';
import { cn } from '@/lib/cn';

import { formatDuration } from './time';

/**
 * "Steps": the chapters of the run, in order, with the current one marked.
 *
 * Under reduced motion this is the primary way through a simulation
 * (docs/implementation/04-visualization-layer.md): with nothing sliding across the
 * canvas, the story is the list of steps and the state each one leaves the network in.
 * It has to be readable and operable on its own, which is why every step has a real
 * button that seeks, and why the current one is marked by an icon and the word "Now" as
 * well as by colour.
 *
 * Two voices (docs/implementation/uiux-spec.md §5.2): Simple shows each step's `plain`
 * sentence, falling back to its description; Full detail shows the title and the
 * description. Either way the words go through `TermText`, so a glossary word is a
 * button of its own -- and that is why the seek button is not the whole row. A button
 * inside a button is invalid, and the inner one is unreachable, so the row is the step
 * number and its status as the button, named by `aria-labelledby` after the text beside
 * it. A pointer can still click anywhere on the row.
 *
 * An ordered list, semantically -- these are steps in a sequence, and a screen reader
 * should be able to say "3 of 5".
 */

export interface PhaseStepperProps {
  phases: readonly PhaseSummary[];
  /** Index of the phase containing the playhead, or `-1` before the first begins. */
  currentIndex: number;
  /** Seek to a virtual time -- the phase's `startMs`. */
  onSeek: (time: number) => void;
  className?: string;
}

/** Done, now, or still ahead: a word for every row, never colour alone. */
function statusWord(index: number, currentIndex: number): string {
  if (index === currentIndex) return 'Now';
  if (index < currentIndex) return 'Finished';
  return 'Not reached yet';
}

interface StepRowProps {
  phase: PhaseSummary;
  currentIndex: number;
  full: boolean;
  onSeek: (time: number) => void;
}

function StepRow({ phase, currentIndex, full, onSeek }: StepRowProps) {
  const id = useId();
  const current = phase.index === currentIndex;
  const done = phase.index < currentIndex;
  const word = statusWord(phase.index, currentIndex);
  const seek = () => onSeek(phase.startMs);

  return (
    <li
      // A pointer convenience only: the button is the keyboard's way in, and a click on a
      // glossary word inside the text opens that word instead of moving the playhead.
      onClick={(event) => {
        if ((event.target as Element).closest('button, a')) return;
        seek();
      }}
      className={cn(
        'flex cursor-pointer items-start gap-2.5 rounded-lg border px-2 py-2 transition-colors',
        current
          ? 'border-accent/60 bg-accent/10'
          : 'hover:border-border hover:bg-surface-overlay/60 border-transparent',
      )}
    >
      <button
        type="button"
        onClick={seek}
        aria-current={current ? 'step' : undefined}
        aria-labelledby={`${id}-number ${id}-status ${id}-text`}
        className={cn(
          'focus-visible:outline-focus min-h-target-floor flex shrink-0 flex-col items-center gap-1 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2',
        )}
      >
        <span
          id={`${id}-number`}
          className={cn(
            'text-small flex size-7 items-center justify-center rounded-full border font-mono tabular-nums',
            current
              ? 'border-accent text-fg bg-accent/20'
              : done
                ? 'border-state-ok/60 text-fg-secondary'
                : 'border-border text-fg-secondary',
          )}
        >
          <span className="sr-only">Step</span> {phase.index + 1}
        </span>
        <span
          id={`${id}-status`}
          className={cn(
            'text-caption flex items-center gap-0.5 font-medium',
            !current && 'sr-only',
            current && 'text-accent',
          )}
        >
          {current ? (
            <CircleDot aria-hidden="true" className="size-3" strokeWidth={2.5} />
          ) : done ? (
            <Check aria-hidden="true" className="size-3" />
          ) : null}
          {word}
        </span>
      </button>

      <span id={`${id}-text`} className="min-w-0 flex-1">
        {full ? (
          <span className="flex items-baseline justify-between gap-2">
            <span
              className={cn(
                'text-small font-medium',
                current ? 'text-fg' : 'text-fg-secondary',
              )}
            >
              {phase.title}
            </span>
            <span className="text-fg-muted text-caption shrink-0 font-mono">
              {formatDuration(phase.endMs - phase.startMs)}
            </span>
          </span>
        ) : null}
        {/* The words are the teaching payload of the step; they are what a
            reduced-motion viewer reads instead of watching the hop. */}
        <span
          className={cn(
            'text-small block leading-snug',
            full ? 'text-fg-muted mt-0.5' : current ? 'text-fg' : 'text-fg-secondary',
          )}
        >
          <TermText
            text={full ? phase.description : (phase.plain ?? phase.description)}
          />
        </span>
      </span>
    </li>
  );
}

/*
 * Memoized because the view around it re-renders on every animation frame while the
 * playhead moves, and every prop reaching it is identity-stable between events -- see
 * `useVisibleState`, which is what makes that true. Without this, a frame that changes
 * nothing here still costs a full render of it.
 */
export const PhaseStepper = memo(function PhaseStepper({
  phases,
  currentIndex,
  onSeek,
  className,
}: PhaseStepperProps) {
  const full = useDetail() === 'full';

  if (phases.length === 0) {
    return (
      <p className={cn('text-fg-muted text-small', className)}>
        This run has no steps: it is one continuous sequence.
      </p>
    );
  }

  return (
    <ol className={cn('flex flex-col gap-1', className)}>
      {phases.map((phase) => (
        <StepRow
          key={phase.id}
          phase={phase}
          currentIndex={currentIndex}
          full={full}
          onSeek={onSeek}
        />
      ))}
    </ol>
  );
});
