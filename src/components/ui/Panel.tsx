import { useId, type HTMLAttributes, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** Panel heading. Also becomes the region's accessible name. */
  title: ReactNode;
  /** Right-aligned header slot: a layer badge, playback controls, a close button. */
  aside?: ReactNode;
  footer?: ReactNode;
  /** Constrain the body and let it scroll — the usual choice for explanation panels. */
  scroll?: boolean;
  /** Drop body padding when the panel holds a canvas or a full-bleed list. */
  flush?: boolean;
}

/**
 * A labelled region on a raised surface. Used for the module explanation panel and
 * anywhere a section needs its own header bar and scroll area.
 */
export function Panel({
  title,
  aside,
  footer,
  scroll = false,
  flush = false,
  className,
  children,
  ...props
}: PanelProps) {
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        'border-border bg-surface-raised flex min-h-0 flex-col overflow-hidden rounded-xl border',
        className,
      )}
      {...props}
    >
      <header className="border-border flex items-center justify-between gap-3 border-b px-4 py-3">
        <h2
          id={headingId}
          className="text-fg-secondary text-xs font-medium tracking-widest uppercase"
        >
          {title}
        </h2>
        {aside ? <div className="flex shrink-0 items-center gap-2">{aside}</div> : null}
      </header>

      <div
        /*
         * A scroll container that holds only text is a region a mouse can reach and a
         * keyboard cannot: there is nothing inside to tab to, so the overflow is simply
         * unreadable without a pointer. `tabIndex={0}` makes the box itself a stop, which
         * is what `Space`/`PageDown`/arrow scrolling needs, and axe's
         * `scrollable-region-focusable` is exactly this rule. It is applied whenever the
         * panel scrolls rather than only when the content happens to be inert -- a panel
         * whose children stop being focusable must not silently lose its tab stop.
         *
         * `group` is on the header's sibling rather than here so the outline is drawn on
         * the box that actually scrolls.
         */
        tabIndex={scroll ? 0 : undefined}
        className={cn(
          'min-h-0 flex-1',
          !flush && 'p-4',
          scroll &&
            'focus-visible:outline-focus overflow-y-auto focus-visible:outline-2 focus-visible:-outline-offset-2',
        )}
      >
        {children}
      </div>

      {footer ? (
        <footer className="border-border text-fg-muted border-t px-4 py-3 text-sm">
          {footer}
        </footer>
      ) : null}
    </section>
  );
}
