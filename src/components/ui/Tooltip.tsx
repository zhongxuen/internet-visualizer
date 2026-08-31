'use client';

import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

import { cn } from '@/lib/cn';

export interface TooltipProps {
  content: ReactNode;
  side?: 'top' | 'bottom';
  /**
   * The trigger. Must be focusable (a button, link, or something with `tabIndex`) —
   * a hover-only tooltip is not acceptable in this product.
   */
  children: ReactElement<{ 'aria-describedby'?: string }>;
  className?: string;
}

/**
 * Keyboard-accessible tooltip: opens on hover *and* on focus, closes on blur, pointer
 * leave, or `Escape`.
 */
export function Tooltip({ content, side = 'top', children, className }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };

    // On document, not the trigger: the tooltip can be open while focus sits
    // elsewhere (hover), and Escape must still dismiss it.
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  return (
    <span
      className={cn('relative inline-flex', className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={close}
      // React's onFocus/onBlur delegate focusin/focusout, so they fire for the
      // trigger inside this wrapper.
      onFocus={() => setOpen(true)}
      onBlur={close}
    >
      {cloneElement(children, {
        'aria-describedby': open ? tooltipId : undefined,
      })}

      {open ? (
        <span
          role="tooltip"
          id={tooltipId}
          className={cn(
            'border-border bg-surface-overlay text-fg-secondary pointer-events-none absolute left-1/2 z-50 w-max max-w-64 -translate-x-1/2 rounded-md border px-2.5 py-1.5 text-xs leading-snug whitespace-normal shadow-lg',
            side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
          )}
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}
