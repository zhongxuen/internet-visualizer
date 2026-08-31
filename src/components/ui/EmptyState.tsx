import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: ReactNode;
  description?: ReactNode;
  /** Decorative glyph above the title. */
  icon?: ReactNode;
  /** A button or link that gets the user somewhere useful. */
  action?: ReactNode;
}

/**
 * Placeholder for a surface with nothing in it yet — most often a module still marked
 * `planned` in the registry.
 */
export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
  children,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'border-border flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center',
        className,
      )}
      {...props}
    >
      {icon ? (
        <span aria-hidden="true" className="text-fg-muted inline-flex">
          {icon}
        </span>
      ) : null}
      <p className="text-fg text-base font-medium">{title}</p>
      {description ? (
        <p className="text-fg-muted max-w-prose text-sm">{description}</p>
      ) : null}
      {children}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
