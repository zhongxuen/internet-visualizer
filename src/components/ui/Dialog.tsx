'use client';

import { X } from 'lucide-react';
import {
  useId,
  useLayoutEffect,
  useRef,
  type MouseEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';

import { cn } from '@/lib/cn';

import { focusRing } from './styles';
import { restoreFocus, supportsModalDialog } from './topLayer';

/**
 * A modal dialog on the native `<dialog>` element, opened with `showModal()`.
 *
 * The platform does the hard parts: the top layer, the `::backdrop`, making everything
 * behind the dialog inert (which is the focus trap -- there is nowhere else for Tab to
 * go), and Escape. This component adds the product's shape around it -- a title, an
 * optional description, a close button, the body -- and three behaviours:
 *
 * - **`open` is controlled.** The parent says whether the dialog is open; every way of
 *   closing it (Escape, the close button, a click on the backdrop) calls `onClose` and the
 *   parent decides. Escape is the one the platform performs itself, so the native `close`
 *   event is what reports it.
 * - **Focus goes back to the opener.** Whatever had focus when `open` became true gets it
 *   back when it becomes false, unless focus has since moved somewhere deliberate.
 * - **Focus lands on the body,** not the close button. A dialog that opens with focus on
 *   "Close" invites closing it; one that opens on its content is read from the top. The
 *   body is a tab stop anyway, because it scrolls (CLAUDE.md, accessibility rule 2).
 *
 * Without `showModal()` (jsdom, and nothing this product otherwise supports) the dialog
 * opens non-modally with the `open` attribute and handles Escape itself; it gives up the
 * inert background and the backdrop.
 *
 * The body stays mounted while the dialog is closed, which is what lets the drawer's
 * close transition play and keeps a drawer's links in the server HTML. Something heavy
 * belongs behind `open` in the caller.
 */

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Actions pinned under the body: a confirm button, "Done". */
  footer?: ReactNode;
  /** The close button's accessible name. */
  closeLabel?: string;
  /** Receives focus on open. Defaults to the body. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  className?: string;
  bodyClassName?: string;
}

/** Shared by `Dialog` and `Drawer`; not exported from the barrel. */
export interface DialogSurfaceProps extends DialogProps {
  surfaceClassName: string;
}

export function DialogSurface({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  closeLabel = 'Close',
  initialFocusRef,
  className,
  bodyClassName,
  surfaceClassName,
}: DialogSurfaceProps) {
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descriptionId = `${baseId}-description`;

  const dialogRef = useRef<HTMLDialogElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const openRef = useRef(open);
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    openRef.current = open;
    onCloseRef.current = onClose;
  });

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      const active = document.activeElement;
      openerRef.current = active instanceof HTMLElement ? active : null;

      if (supportsModalDialog()) dialog.showModal();
      else dialog.setAttribute('open', '');

      (initialFocusRef?.current ?? bodyRef.current)?.focus({ preventScroll: true });
    } else if (!open && dialog.open) {
      if (supportsModalDialog()) dialog.close();
      else dialog.removeAttribute('open');

      restoreFocus(openerRef.current, dialog);
      openerRef.current = null;
    }
  }, [open, initialFocusRef]);

  // Escape, as performed by the platform: the dialog is already closed when this fires,
  // and the parent is told so it can catch up.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const onNativeClose = () => {
      if (!openRef.current) return;
      onCloseRef.current();
      restoreFocus(openerRef.current, dialog);
    };

    dialog.addEventListener('close', onNativeClose);
    return () => dialog.removeEventListener('close', onNativeClose);
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    // The platform handles Escape for a modal dialog; the fallback has to do it here.
    if (event.key === 'Escape' && !supportsModalDialog()) {
      event.preventDefault();
      onClose();
    }
  };

  // The surface fills the dialog box edge to edge, so a click whose target is the
  // `<dialog>` itself can only have landed on the backdrop.
  const onClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  return (
    // Both handlers have a keyboard route already: the backdrop click is the close
    // button's job for a keyboard user, and Escape is the platform's (or, in the
    // fallback, this component's).
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onKeyDown={onKeyDown}
      onClick={onClick}
      className={cn(
        'text-fg bg-surface-raised border-border overflow-hidden border p-0 shadow-2xl',
        'backdrop:bg-surface/80',
        surfaceClassName,
        className,
      )}
    >
      <div className="flex h-full max-h-[inherit] min-h-0 flex-col">
        <header className="border-border flex items-start gap-3 border-b py-2 pr-2 pl-5">
          <div className="min-w-0 flex-1 py-2.5">
            <h2 id={titleId} className="text-fg text-lg leading-snug font-semibold">
              {title}
            </h2>
            {description ? (
              <p
                id={descriptionId}
                className="text-fg-muted mt-1 text-sm leading-relaxed"
              >
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            aria-label={closeLabel}
            onClick={onClose}
            className={cn(
              'text-fg-secondary hover:bg-surface-overlay hover:text-fg size-target inline-flex shrink-0 items-center justify-center rounded-md transition-colors',
              focusRing,
            )}
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </header>

        <div
          ref={bodyRef}
          // The body scrolls, and a scroll box holding only text needs a tab stop of its
          // own (CLAUDE.md, accessibility rule 2). It is also where focus lands on open.
          tabIndex={0}
          className={cn(
            'text-fg-secondary min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 text-base leading-relaxed',
            'focus-visible:outline-focus focus-visible:outline-2 focus-visible:-outline-offset-2',
            bodyClassName,
          )}
        >
          {children}
        </div>

        {footer ? (
          <footer className="border-border flex flex-wrap items-center justify-end gap-2 border-t px-5 py-3">
            {footer}
          </footer>
        ) : null}
      </div>
    </dialog>
  );
}

/**
 * A centred modal: "How to use this page", a confirmation, anything that needs the
 * reader's whole attention for a moment and then gives it back.
 */
export function Dialog(props: DialogProps) {
  return (
    <DialogSurface
      {...props}
      surfaceClassName={cn(
        'm-auto max-h-[calc(100dvh_-_2rem)] w-[min(32rem,calc(100vw_-_2rem))] max-w-none rounded-xl',
        // Fade in and out. `allow-discrete` lets `display` and `overlay` wait for the
        // fade; reduced motion collapses it through globals.css like every transition.
        'opacity-0 open:opacity-100 starting:open:opacity-0',
        'transition-[opacity,display,overlay] transition-discrete duration-(--dur-base) ease-out',
      )}
    />
  );
}
