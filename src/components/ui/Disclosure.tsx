'use client';

import { ChevronRight } from 'lucide-react';
import {
  useState,
  type HTMLAttributes,
  type MouseEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react';

import { cn } from '@/lib/cn';

import { focusRing } from './styles';

/**
 * A styled `<details>`/`<summary>`: "What you'll learn", "Experiment", "Technical
 * details", "Everything that happened" (docs/implementation/uiux.md §5.3).
 *
 * Native elements, so the summary is a button to every assistive technology, Enter and
 * Space work, and the open state is announced, all without ARIA.
 *
 * ## React owns `open`
 *
 * A summary click is intercepted (`preventDefault`) and turned into a state change, and
 * the `open` attribute is rendered from that state. Letting the browser toggle the
 * element and then reconciling afterwards is what makes a controlled `<details>` flicker,
 * or fight its parent when the parent says no. The one toggle that does not come through
 * the summary -- the browser opening a closed `<details>` to reveal a find-in-page match
 * -- arrives as a `toggle` event and is reported the same way.
 *
 * ## `lazy`
 *
 * With `lazy`, the content is unmounted while the disclosure is closed, not hidden.
 * That is the point of it: the Packet Journey measurements in CLAUDE.md found that the
 * number of elements in the document is what costs frames during playback, and the
 * event log is most of them. A closed log with `lazy` costs one summary row. The price
 * is that find-in-page cannot see into a closed lazy disclosure, and that its content's
 * state is lost on close; use it for derived content like the log, not for a form.
 */

export interface DisclosureProps extends Omit<
  HTMLAttributes<HTMLDetailsElement>,
  'onToggle' | 'title'
> {
  /** The always-visible row. Plain text or a short phrase; it is the button's name. */
  summary: ReactNode;
  /** A trailing note on the summary row: a count, a badge. Part of the button's name. */
  meta?: ReactNode;
  children: ReactNode;
  /** Controlled open state. Pass with `onToggle`. */
  open?: boolean;
  defaultOpen?: boolean;
  onToggle?: (open: boolean) => void;
  /** Unmount the content while closed. See the note above. */
  lazy?: boolean;
  summaryClassName?: string;
  contentClassName?: string;
}

export function Disclosure({
  summary,
  meta,
  children,
  open: openProp,
  defaultOpen = false,
  onToggle,
  lazy = false,
  className,
  summaryClassName,
  contentClassName,
  ...props
}: DisclosureProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : internalOpen;

  const request = (next: boolean) => {
    if (next === open) return;
    if (!controlled) setInternalOpen(next);
    onToggle?.(next);
  };

  const onSummaryClick = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    request(!open);
  };

  // Only a toggle this component did not cause gets here with a different state: the
  // browser revealing a find-in-page match.
  const onNativeToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    const next = event.currentTarget.open;
    if (next !== open) request(next);
  };

  return (
    <details
      {...props}
      open={open}
      onToggle={onNativeToggle}
      className={cn('border-border rounded-lg border', className)}
    >
      <summary
        onClick={onSummaryClick}
        className={cn(
          // --target-min
          'flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-2',
          'text-fg text-base font-medium select-none [&::-webkit-details-marker]:hidden',
          'hover:bg-surface-overlay transition-colors',
          focusRing,
          summaryClassName,
        )}
      >
        <ChevronRight
          aria-hidden="true"
          // Keyed to this summary's own `<details>`, not a `group`: a closed disclosure
          // nested in an open one must not turn its chevron with its parent's.
          className="text-fg-muted h-4 w-4 shrink-0 transition-transform [details[open]>summary>&]:rotate-90"
        />
        <span className="min-w-0 flex-1">{summary}</span>
        {meta ? <span className="text-fg-muted shrink-0 text-sm">{meta}</span> : null}
      </summary>

      {!lazy || open ? (
        <div className={cn('px-3 pt-1 pb-3', contentClassName)}>{children}</div>
      ) : null}
    </details>
  );
}
