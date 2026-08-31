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

      <div className={cn('min-h-0 flex-1', !flush && 'p-4', scroll && 'overflow-y-auto')}>
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
