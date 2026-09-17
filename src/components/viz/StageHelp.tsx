'use client';

import { CircleHelp } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Dialog } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import { cn } from '@/lib/cn';

import { KeyboardLegend } from './KeyboardLegend';
import { isTypingTarget } from './keymap';

/**
 * "How to use this page" (uiux-spec.md §5.3, stage rule 5): a "?" button in the stage
 * header, and the `?` key anywhere on the page, open a dialog with three steps, the
 * module's own lines, and the keyboard map.
 *
 * The key is ignored while the viewer is typing -- in a field, a text area, a select or
 * anything editable -- because `?` is a character someone might mean to type, and a
 * dialog opening mid-word would take their text with it.
 *
 * The dialog is always mounted and its content only while it is open, so a closed help
 * costs the page one empty `<dialog>` and the keyboard map is not in the document until
 * it is asked for (document size is what costs frames; see CLAUDE.md, "Performance").
 */

export const HELP_STEPS = [
  'Pick a story to watch.',
  'Press Play. It pauses after each step, so you can read what happened.',
  'Click anything in the picture to see what it is.',
] as const;

export interface StageHelpProps {
  /** The module's own lines, after the three steps. */
  help?: readonly string[];
  /** Listen for the `?` key. Off for a view embedded in something else. */
  bindKey?: boolean;
  className?: string;
}

export function StageHelp({ help, bindKey = true, className }: StageHelpProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!bindKey) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '?' || event.defaultPrevented) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [bindKey]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="How to use this page"
        title="How to use this page (?)"
        aria-haspopup="dialog"
        className={cn(
          'text-fg-secondary hover:bg-surface-overlay hover:text-fg border-border size-target inline-flex shrink-0 items-center justify-center rounded-full border transition-colors',
          focusRing,
          className,
        )}
      >
        <CircleHelp aria-hidden="true" className="size-5" />
      </button>

      <Dialog open={open} onClose={() => setOpen(false)} title="How to use this page">
        {open ? (
          <div className="flex flex-col gap-5">
            <ol className="flex flex-col gap-3">
              {HELP_STEPS.map((step, index) => (
                <li key={step} className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="bg-accent text-accent-ink text-small inline-flex size-7 shrink-0 items-center justify-center rounded-full font-semibold"
                  >
                    {index + 1}
                  </span>
                  <span className="text-fg pt-0.5">{step}</span>
                </li>
              ))}
            </ol>

            {help?.length ? (
              <ul className="border-border flex list-disc flex-col gap-1.5 border-t pt-4 pl-5">
                {help.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : null}

            <div className="border-border border-t pt-4">
              <h3 className="text-fg text-small mb-3 font-semibold">
                Keyboard shortcuts
              </h3>
              <KeyboardLegend />
            </div>
          </div>
        ) : null}
      </Dialog>
    </>
  );
}
