'use client';

import { Play } from 'lucide-react';
import { memo } from 'react';

import { TermText } from '@/components/glossary';
import { buttonClasses } from '@/components/ui';
import { cn } from '@/lib/cn';

/**
 * "Watch it happen": the one obvious next action, before a run has started (uiux-spec.md
 * §4 principle 2, §5.3 stage rule 1).
 *
 * Shown until the first play or seek, and again when a new story resets the run. It
 * never plays anything by itself -- autoplay stays off -- it only makes the first press
 * impossible to miss.
 *
 * Absolutely positioned inside the canvas box, which already has its height before the
 * canvas chunk arrives, so appearing and disappearing costs zero layout shift. The scrim
 * lets pointer events through (`pointer-events-none`): a viewer who would rather click a
 * machine first can, and only the card itself catches clicks.
 */

export interface StartOverlayProps {
  /** The story's question, when it has one. */
  question?: string;
  /** How many steps the run has, for the line under the button when there is no question. */
  stepCount: number;
  onStart: () => void;
  className?: string;
}

export const StartOverlay = memo(function StartOverlay({
  question,
  stepCount,
  onStart,
  className,
}: StartOverlayProps) {
  return (
    <div
      className={cn(
        'bg-surface/55 pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-4',
        className,
      )}
    >
      <div className="bg-surface-raised/95 border-border pointer-events-auto flex max-w-md flex-col items-center gap-3 rounded-2xl border px-6 py-5 text-center shadow-xl">
        <button
          type="button"
          onClick={onStart}
          className={buttonClasses({
            className: 'text-lead h-14 gap-3 rounded-full px-7 shadow-lg',
          })}
        >
          <Play aria-hidden="true" className="size-6 fill-current" />
          Watch it happen
        </button>
        {question ? (
          <div className="text-fg text-body leading-relaxed">
            <TermText text={question} />
          </div>
        ) : stepCount > 0 ? (
          <p className="text-fg-secondary text-small">
            {stepCount} {stepCount === 1 ? 'step' : 'steps'}. Pause, step back or replay
            any of them.
          </p>
        ) : null}
      </div>
    </div>
  );
});
