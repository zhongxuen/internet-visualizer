'use client';

import { RotateCcw } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui';
import { cn } from '@/lib/cn';

import { resetProgress } from '../progress/actions';
import { hasAnyProgress, totalCompleted } from '../progress/store';
import { useProgress } from '../progress/useProgress';

/**
 * "Forget everything I have done."
 *
 * Required by the spec, and the right of anyone whose data is being kept without their
 * having agreed to an account. It says what is stored, where, and how much of it there
 * is, and then deletes it for real -- `localStorage.removeItem`, not a tombstone flag.
 *
 * ## Confirmation without a dialog
 *
 * Two presses, in place. Not `window.confirm`: a native modal blocks the page, cannot
 * be styled or made to match the rest of the product, and is a hostile way to ask a
 * question whose answer is nearly always "yes, that is why I pressed it". The second
 * press is the confirmation, Escape or Cancel backs out, and nothing is destroyed by
 * one stray click.
 *
 * The whole control renders only once progress is readable. Before that there is no
 * honest number to show and nothing to delete, so offering the button would be
 * offering to erase something the page has not yet looked at.
 */

export interface ProgressResetProps {
  className?: string;
}

export function ProgressReset({ className }: ProgressResetProps) {
  const progress = useProgress();
  const [confirming, setConfirming] = useState(false);

  if (!progress) return null;

  const completed = totalCompleted(progress);
  // Broader than the completed count on purpose: a quiz answered without the lesson
  // being ticked is still something stored about the reader, and still theirs to
  // delete.
  const anything = hasAnyProgress(progress);

  return (
    <div
      className={cn(
        'border-border bg-surface-raised flex flex-wrap items-center justify-between gap-4 rounded-xl border px-5 py-4',
        className,
      )}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && confirming) setConfirming(false);
      }}
    >
      <div className="min-w-0">
        <p className="text-fg text-sm font-medium">Your progress</p>
        <p className="text-fg-muted mt-1 text-xs leading-relaxed">
          {anything
            ? `${completed} lesson${completed === 1 ? '' : 's'} completed. Stored in this browser only -- no account, and nothing sent anywhere.`
            : 'Nothing recorded yet. Completed lessons and quiz answers are stored in this browser only.'}
        </p>
      </div>

      {confirming ? (
        <div className="flex shrink-0 items-center gap-2">
          {/*
            `role="status"` so the change of question is announced, not just seen, to
            anyone who activated the first button without watching the screen.
          */}
          <span role="status" className="text-fg-secondary text-xs">
            Delete it all?
          </span>
          <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            /*
              The button that was pressed has just been replaced, so without this focus
              falls to the body and a keyboard user is stranded outside the question
              they just asked for. Moving focus into a confirmation the reader opened
              deliberately is the case autofocus is for.
            */
            autoFocus
            onClick={() => {
              resetProgress();
              setConfirming(false);
            }}
          >
            Yes, reset
          </Button>
        </div>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          disabled={!anything}
          onClick={() => setConfirming(true)}
          icon={<RotateCcw className="size-3.5" />}
        >
          Reset progress
        </Button>
      )}
    </div>
  );
}
