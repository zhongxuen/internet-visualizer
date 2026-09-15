'use client';

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
  type RefObject,
} from 'react';

import { cn } from '@/lib/cn';

import { buttonClasses, type ButtonVariant } from './Button';
import { useAnchoredPosition, type FloatingAlign, type FloatingSide } from './position';
import { focusRing } from './styles';
import { restoreFocus, useSupportsPopover } from './topLayer';

/**
 * A non-modal box anchored to a button: a definition with a link in it, the settings
 * menu, anything a `Tooltip` is too small for (see the note at the top of Tooltip.tsx).
 *
 * ## What the platform does, and what this adds
 *
 * The panel carries the HTML `popover` attribute, which gives it the top layer (no
 * `overflow-hidden` ancestor can clip it, no `z-index` contest), light dismiss, and
 * Escape -- and closes any other open `auto` popover, so two menus are never open at
 * once. On top of that this component adds:
 *
 * - **React owns `open`.** The trigger is a plain `<button>`, not a `popovertarget`
 *   invoker, and the panel is shown and hidden from an effect. The platform's own
 *   dismissals (light dismiss, Escape, another popover opening) arrive as a `toggle`
 *   event and are mirrored back into state, so `aria-expanded` and `onOpenChange` never
 *   disagree with the screen.
 * - **Positioning.** The top layer places a popover in the middle of the viewport.
 *   {@link useAnchoredPosition} puts it beside the trigger, flipping and shifting to keep
 *   it on screen.
 * - **Focus.** Opening moves focus into the panel (so a keyboard user lands on the
 *   content, and Tab reaches a link inside it); closing returns focus to the trigger
 *   unless the user has already put it somewhere else.
 *
 * ## The light-dismiss race
 *
 * Pressing the trigger of an open popover is a pointerdown *outside the panel*, so the
 * platform light-dismisses it -- and then the click arrives and would open it again. The
 * trigger therefore records, at pointerdown, whether the panel was open, and the click
 * acts on that rather than on the state the dismissal has already changed. A keyboard
 * press has no pointerdown and toggles normally.
 *
 * ## Without the `popover` attribute
 *
 * jsdom and pre-2024 browsers get the same markup with `hidden` instead of the top
 * layer, plus document listeners for Escape and outside pointerdown. The panel is still
 * `position: fixed` and positioned, but a transformed ancestor can capture it and an
 * `overflow-hidden` one can clip it. That is the whole of what the fallback gives up.
 *
 * ## Only while open
 *
 * The panel element always exists (so `aria-controls` always points at something), but
 * its children mount only while it is open. A page of glossary terms is a page of
 * closed popovers, and CLAUDE.md's Packet Journey measurements say document size is
 * what costs frames.
 */

export interface PopoverRenderApi {
  close: () => void;
}

export interface PopoverProps {
  /** What the trigger button says. Its text is also the panel's accessible name. */
  trigger: ReactNode;
  children: ReactNode | ((api: PopoverRenderApi) => ReactNode);
  /** Controlled open state. Pass with `onOpenChange`. */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: FloatingSide;
  align?: FloatingAlign;
  /**
   * An accessible name for the panel, when the trigger's text is not one -- an icon-only
   * trigger with an `aria-label`, for instance. Defaults to the trigger's text.
   */
  label?: string;
  /** Receives focus when the panel opens. Defaults to the panel itself. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /**
   * `unstyled` drops the button look entirely, for a trigger that has to sit inside a
   * sentence (a glossary term) and styles itself through `triggerClassName`.
   */
  triggerVariant?: ButtonVariant | 'unstyled';
  triggerClassName?: string;
  /** Extra attributes for the trigger button: `aria-label`, `data-*`, and so on. */
  triggerProps?: Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    | 'type'
    | 'onClick'
    | 'onPointerDown'
    | 'aria-expanded'
    | 'aria-controls'
    | 'aria-haspopup'
    | 'children'
  >;
  /** Classes for the panel. */
  className?: string;
}

export function Popover({
  trigger,
  children,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  side = 'bottom',
  align = 'center',
  label,
  initialFocusRef,
  triggerVariant = 'secondary',
  triggerClassName,
  triggerProps,
  className,
}: PopoverProps) {
  const baseId = useId();
  const triggerId = `${baseId}-trigger`;
  const panelId = `${baseId}-panel`;

  const native = useSupportsPopover();
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : internalOpen;

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // The latest `open`, for event handlers that must not re-subscribe on every change.
  const openRef = useRef(open);
  const onOpenChangeRef = useRef(onOpenChange);
  useLayoutEffect(() => {
    openRef.current = open;
    onOpenChangeRef.current = onOpenChange;
  });

  const setOpen = useCallback(
    (next: boolean) => {
      if (next === openRef.current) return;
      openRef.current = next;
      if (!controlled) setInternalOpen(next);
      onOpenChangeRef.current?.(next);
    },
    [controlled],
  );

  const close = useCallback(() => setOpen(false), [setOpen]);

  // The render prop's `close`, handed out during render, so it reads no refs: it is only
  // reachable from inside an open panel, which is all the guard in `setOpen` is for.
  const closeFromInside = useCallback(() => {
    if (!controlled) setInternalOpen(false);
    onOpenChange?.(false);
  }, [controlled, onOpenChange]);

  // Show and hide the top-layer box. Declared before the positioning hook: layout effects
  // run in order, and the box has to be displayed before it can be measured.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!native || !panel) return;

    const showing = panel.matches(':popover-open');
    if (open && !showing) panel.showPopover();
    if (!open && showing) panel.hidePopover();
  }, [open, native]);

  // The platform's own dismissals, mirrored into state.
  useEffect(() => {
    const panel = panelRef.current;
    if (!native || !panel) return;

    const onToggle = () => {
      if (!panel.matches(':popover-open')) setOpen(false);
    };

    panel.addEventListener('toggle', onToggle);
    return () => panel.removeEventListener('toggle', onToggle);
  }, [native, setOpen]);

  // The fallback's dismissals: what light dismiss and Escape would have done.
  useEffect(() => {
    if (native || !open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        target &&
        !panelRef.current?.contains(target) &&
        !triggerRef.current?.contains(target)
      ) {
        close();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [native, open, close]);

  // Focus in on open, back to the trigger on close.
  const wasOpenRef = useRef(open);
  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = open;

    if (open && !wasOpen) {
      (initialFocusRef?.current ?? panelRef.current)?.focus({ preventScroll: true });
    } else if (!open && wasOpen) {
      restoreFocus(triggerRef.current, panelRef.current);
    }
  }, [open, initialFocusRef]);

  const resolvedSide = useAnchoredPosition(triggerRef, panelRef, open, { side, align });

  // See "The light-dismiss race" above.
  const openAtPointerDown = useRef<boolean | null>(null);

  return (
    <>
      <button
        {...triggerProps}
        ref={triggerRef}
        id={triggerId}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        onPointerDown={() => {
          openAtPointerDown.current = openRef.current;
        }}
        onClick={() => {
          const wasOpen = openAtPointerDown.current ?? openRef.current;
          openAtPointerDown.current = null;
          setOpen(!wasOpen);
        }}
        className={
          triggerVariant === 'unstyled'
            ? cn(focusRing, triggerClassName)
            : buttonClasses({ variant: triggerVariant, className: triggerClassName })
        }
      >
        {trigger}
      </button>

      <div
        ref={panelRef}
        id={panelId}
        role="dialog"
        aria-modal="false"
        aria-label={label}
        aria-labelledby={label ? undefined : triggerId}
        popover={native ? 'auto' : undefined}
        hidden={native ? undefined : !open}
        tabIndex={-1}
        data-side={resolvedSide}
        className={cn(
          // `inset-auto m-0` undoes the UA's centring of a popover; the hook sets top/left.
          'fixed inset-auto z-50 m-0',
          'max-h-[calc(100dvh_-_1rem)] w-max max-w-[min(20rem,calc(100vw_-_1rem))] overflow-y-auto',
          'border-border bg-surface-overlay text-fg-secondary rounded-lg border p-3 text-sm leading-relaxed shadow-lg',
          'focus-visible:outline-focus focus-visible:outline-2 focus-visible:outline-offset-2',
          className,
        )}
      >
        {open
          ? typeof children === 'function'
            ? children({ close: closeFromInside })
            : children
          : null}
      </div>
    </>
  );
}
