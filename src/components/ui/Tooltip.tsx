'use client';

/**
 * A Tooltip is for a label: a few words naming or qualifying the thing it is attached to.
 * Anything with a link in it, or longer than one sentence, is a `Popover`.
 *
 * The reason is what each one can hold. A tooltip opens on hover and focus and closes the
 * moment either ends, and it is `pointer-events: none` -- there is no way to move into
 * one, so a link inside it can never be followed, and a paragraph inside it disappears
 * before it is read. A popover opens on a press, stays until dismissed, and takes focus.
 */

import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

import { cn } from '@/lib/cn';

import { useAnchoredPosition } from './position';
import { useSupportsPopover } from './topLayer';

export interface TooltipProps {
  content: ReactNode;
  /** The preferred side. The tooltip flips to the other one when this side has no room. */
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
 *
 * On touch, where there is no hover, a tap toggles it: the first tap on the trigger
 * opens it, a second closes it, and a tap anywhere else closes it too. Hover is read
 * from pointer events rather than mouse events for that reason -- a touch screen fires
 * emulated `mouseenter`s, and a tooltip that opened on every one of them could never be
 * closed by a tap.
 *
 * Positioned against the viewport, flipping to the other side and shifting sideways to
 * stay on screen (`useAnchoredPosition`). Where the browser has the `popover` attribute
 * the tooltip is a `manual` popover, so it sits in the top layer and no
 * `overflow-hidden` panel can clip it; `manual` because a tooltip must not light-dismiss
 * or close a popover that is open alongside it.
 */
export function Tooltip({ content, side = 'top', children, className }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();
  const native = useSupportsPopover();

  const anchorRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };

    // A tap elsewhere. On touch there is no pointer leave to close it, and a tapped
    // button is not always focused (iOS), so there may be no blur either.
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && !anchorRef.current?.contains(target)) close();
    };

    // On document, not the trigger: the tooltip can be open while focus sits
    // elsewhere (hover), and Escape must still dismiss it.
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, close]);

  // Into the top layer on mount. Before the positioning hook: the box has to be
  // displayed before it can be measured. Leaving the DOM takes it out again.
  useLayoutEffect(() => {
    const tooltip = tooltipRef.current;
    if (open && native && tooltip && !tooltip.matches(':popover-open')) {
      tooltip.showPopover();
    }
  }, [open, native]);

  useAnchoredPosition(anchorRef, tooltipRef, open, { side });

  return (
    <span
      ref={anchorRef}
      className={cn('relative inline-flex', className)}
      onPointerEnter={(event) => {
        if (event.pointerType !== 'touch') setOpen(true);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== 'touch') close();
      }}
      onPointerDown={(event) => {
        if (event.pointerType === 'touch') setOpen((current) => !current);
      }}
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
          ref={tooltipRef}
          role="tooltip"
          id={tooltipId}
          popover={native ? 'manual' : undefined}
          className={cn(
            // `inset-auto m-0` undoes the UA's centring of a popover; the hook sets
            // top/left.
            'pointer-events-none fixed inset-auto z-50 m-0 w-max max-w-64',
            'border-border bg-surface-overlay text-fg-secondary rounded-md border px-2.5 py-1.5 text-xs leading-snug whitespace-normal shadow-lg',
          )}
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}
