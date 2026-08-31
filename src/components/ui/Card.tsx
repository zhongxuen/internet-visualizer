import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Rendered as an `h3`. Omit for a bare raised surface. */
  title?: ReactNode;
  description?: ReactNode;
  /** Right-aligned header slot: status badges, a small button. */
  actions?: ReactNode;
  footer?: ReactNode;
  /** Adds hover/active affordances for cards that are themselves links or buttons. */
  interactive?: boolean;
}

/**
 * The standard raised surface: a bordered container with an optional header.
 * `Panel` is the same family for labelled regions with their own scroll area.
 */
export function Card({
  title,
  description,
  actions,
  footer,
  interactive = false,
  className,
  children,
  ...props
}: CardProps) {
  const hasHeader = Boolean(title || description || actions);

  return (
    <div
      className={cn(
        'border-border bg-surface-raised rounded-xl border',
        interactive &&
          'hover:border-border-strong hover:bg-surface-overlay transition-colors',
        className,
      )}
      {...props}
    >
      {hasHeader ? (
        <div className="flex items-start justify-between gap-3 px-5 pt-5">
          <div className="min-w-0">
            {title ? (
              <h3 className="text-fg truncate text-base font-medium">{title}</h3>
            ) : null}
            {description ? (
              <p className="text-fg-muted mt-1 text-sm">{description}</p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
          ) : null}
        </div>
      ) : null}

      <div className={cn('px-5 py-5', hasHeader && 'pt-4')}>{children}</div>

      {footer ? (
        <div className="border-border text-fg-muted border-t px-5 py-3 text-sm">
          {footer}
        </div>
      ) : null}
    </div>
  );
}
