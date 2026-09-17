'use client';

import { ArrowRight, RotateCcw, X } from 'lucide-react';
import { memo, useEffect, useId } from 'react';

import { Button } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import type { PhaseSummary } from '@/core/sim/result';
import { cn } from '@/lib/cn';

import { recapLines, type Detail } from './stage';

/**
 * "What just happened": the end of a run, and a way into the next one (uiux-spec.md §4
 * principle 7, §5.3 stage rule 4).
 *
 * One line per step -- the plain sentence in Simple, the title in Full detail -- then
 * Play again and, when the module has stories, Next story.
 *
 * An overlay inside the canvas box, like `StartOverlay`, so it appears with no layout
 * shift; and not modal, so it takes no focus and traps none. It closes on its own button
 * and on `Escape`, and the view hands focus back to Play when it does, since the button
 * that had it is gone. It is anchored to the lower part of the canvas and scrolls on its
 * own, so the upper part of the diagram stays clickable while it is open.
 */

export interface RunRecapProps {
  phases: readonly PhaseSummary[];
  detail: Detail;
  onPlayAgain: () => void;
  /** Present only when there is another story to go to. */
  onNextStory?: () => void;
  onDismiss: () => void;
  className?: string;
}

export const RunRecap = memo(function RunRecap({
  phases,
  detail,
  onPlayAgain,
  onNextStory,
  onDismiss,
  className,
}: RunRecapProps) {
  const headingId = useId();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // An open dialog or popover owns this Escape; closing the recap too would be two.
      if (event.target instanceof Element && event.target.closest('dialog, [popover]')) {
        return;
      }
      event.preventDefault();
      onDismiss();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onDismiss]);

  const lines = recapLines(phases, detail);

  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        'bg-surface-raised/97 border-border absolute inset-x-3 bottom-3 z-20 mx-auto flex max-h-[calc(100%-1.5rem)] max-w-xl flex-col rounded-2xl border shadow-2xl',
        className,
      )}
    >
      <header className="flex items-center gap-2 py-1.5 pr-1.5 pl-4">
        <h2 id={headingId} className="text-fg text-lead min-w-0 flex-1 font-semibold">
          What just happened
        </h2>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Close what just happened"
          className={cn(
            'text-fg-secondary hover:bg-surface-overlay hover:text-fg size-target inline-flex shrink-0 items-center justify-center rounded-md transition-colors',
            focusRing,
          )}
        >
          <X aria-hidden="true" className="size-5" />
        </button>
      </header>

      {lines.length ? (
        <ol
          // A scroll box of plain text needs its own tab stop (CLAUDE.md, rule 2).
          tabIndex={0}
          aria-label="Steps in this run"
          className="text-fg-secondary text-small focus-visible:outline-focus min-h-0 flex-1 list-decimal overflow-y-auto overscroll-contain py-1 pr-4 pl-9 leading-relaxed focus-visible:outline-2 focus-visible:-outline-offset-2"
        >
          {lines.map((line, index) => (
            <li key={phases[index]!.id} className="py-0.5">
              {line}
            </li>
          ))}
        </ol>
      ) : null}

      <footer className="border-border flex flex-wrap items-center gap-2 border-t px-4 py-3">
        <Button onClick={onPlayAgain} icon={<RotateCcw className="size-4" />}>
          Play again
        </Button>
        {onNextStory ? (
          <Button variant="secondary" onClick={onNextStory}>
            Next story
            <ArrowRight aria-hidden="true" className="size-4" />
          </Button>
        ) : null}
      </footer>
    </section>
  );
});
