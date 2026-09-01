'use client';

import { Check, CircleDot, Circle } from 'lucide-react';

import type { PhaseSummary } from '@/core/sim/result';
import { cn } from '@/lib/cn';

import { formatDuration } from './time';

/**
 * The chapters of the run, in order, with the current one marked.
 *
 * Under reduced motion this is the primary way through a simulation
 * (docs/implementation/04-visualization-layer.md): with nothing sliding across the
 * canvas, the story is the list of phases and the state each one leaves the network in.
 * It has to be readable and operable on its own, which is why every phase is a real
 * button that seeks, and why the current one is marked by an icon and a word as well as
 * by colour.
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

/** Done, current, or still ahead. Icon and word, never colour alone. */
function statusOf(index: number, currentIndex: number) {
  if (index === currentIndex) return { icon: CircleDot, word: 'Current phase' } as const;
  if (index < currentIndex) return { icon: Check, word: 'Finished' } as const;
  return { icon: Circle, word: 'Not reached yet' } as const;
}

export function PhaseStepper({
  phases,
  currentIndex,
  onSeek,
  className,
}: PhaseStepperProps) {
  if (phases.length === 0) {
    return (
      <p className={cn('text-fg-muted text-xs', className)}>
        This run has no phases: it is one continuous sequence.
      </p>
    );
  }

  return (
    <ol className={cn('flex flex-col gap-1', className)}>
      {phases.map((phase) => {
        const current = phase.index === currentIndex;
        const status = statusOf(phase.index, currentIndex);

        return (
          <li key={phase.id}>
            <button
              type="button"
              onClick={() => onSeek(phase.startMs)}
              aria-current={current ? 'step' : undefined}
              className={cn(
                'focus-visible:outline-focus flex w-full items-start gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2',
                current
                  ? 'border-accent/60 bg-accent/10'
                  : 'hover:border-border hover:bg-surface-overlay/60 border-transparent',
              )}
            >
              <status.icon
                aria-hidden="true"
                className={cn(
                  'mt-0.5 size-3.5 shrink-0',
                  current
                    ? 'text-accent'
                    : phase.index < currentIndex
                      ? 'text-state-ok'
                      : 'text-fg-muted',
                )}
              />

              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span
                    className={cn(
                      'text-sm font-medium',
                      current ? 'text-fg' : 'text-fg-secondary',
                    )}
                  >
                    {phase.title}
                  </span>
                  <span className="text-fg-muted shrink-0 font-mono text-[0.6875rem]">
                    {formatDuration(phase.endMs - phase.startMs)}
                  </span>
                </span>
                {/* The description is the teaching payload of the phase; it is what a
                    reduced-motion viewer reads instead of watching the hop. */}
                <span className="text-fg-muted mt-0.5 block text-xs leading-snug">
                  {phase.description}
                </span>
                <span className="sr-only">{status.word}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
