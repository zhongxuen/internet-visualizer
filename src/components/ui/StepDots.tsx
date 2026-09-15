import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

/**
 * "Step 3 of 6", as words and as a row of dots.
 *
 * The words are always rendered and always visible. The dots are a picture of the same
 * fact and are `aria-hidden`: a screen reader gets the sentence once rather than six
 * unlabelled shapes. Past, current and future steps differ in fill and size, not only in
 * colour -- a filled dot, a larger ringed dot, a hollow dot -- so the row still reads in
 * greyscale.
 *
 * Past {@link MAX_DOTS} steps the dots stop being countable at a glance and start being
 * texture, so they are dropped and the words carry it alone.
 *
 * Not a live region. Where the step changes during playback, the step caption announces
 * it; this only shows where the reader is.
 */

/** Beyond this many steps the row is omitted. */
export const MAX_DOTS = 12;

export interface StepDotsProps extends HTMLAttributes<HTMLDivElement> {
  /** The current step, counting from 1. */
  current: number;
  total: number;
  /** What is being counted. "Step" unless the surface counts something else ("Stop"). */
  noun?: string;
}

export function StepDots({
  current,
  total,
  noun = 'Step',
  className,
  ...props
}: StepDotsProps) {
  const count = Math.floor(total);
  // A run with no steps has no position to show, and "Step 1 of 0" would be a false one.
  if (!(count >= 1)) return null;
  const at = Math.min(Math.max(1, Math.floor(current)), count);

  return (
    <div className={cn('inline-flex items-center gap-2.5', className)} {...props}>
      {count > 1 && count <= MAX_DOTS ? (
        <span aria-hidden="true" className="inline-flex items-center gap-1.5">
          {Array.from({ length: count }, (_, index) => {
            const step = index + 1;
            const state = step < at ? 'done' : step === at ? 'current' : 'todo';

            return (
              <span
                key={step}
                data-state={state}
                className={cn(
                  'inline-block rounded-full',
                  state === 'done' && 'bg-fg-muted h-2 w-2',
                  state === 'current' &&
                    'bg-accent ring-accent/40 ring-offset-surface h-2.5 w-2.5 ring-2 ring-offset-1',
                  state === 'todo' && 'border-border-strong h-2 w-2 border',
                )}
              />
            );
          })}
        </span>
      ) : null}

      <span className="text-fg-secondary text-sm tabular-nums">
        {noun} {at} of {count}
      </span>
    </div>
  );
}
