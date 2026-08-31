import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface KbdProps extends HTMLAttributes<HTMLElement> {
  /** Render a chord, e.g. `['Ctrl', 'K']`. Ignored when children are given. */
  keys?: string[];
  children?: ReactNode;
}

const KEY_CAP =
  'border-border bg-surface-overlay text-fg-secondary inline-flex h-5 min-w-5 items-center justify-center rounded border px-1.5 font-mono text-[0.7rem] leading-none';

/** Keyboard shortcut hint. `<Kbd>Esc</Kbd>` or `<Kbd keys={['Ctrl', 'K']} />`. */
export function Kbd({ keys, className, children, ...props }: KbdProps) {
  if (!children && keys?.length) {
    return (
      <kbd className={cn('inline-flex items-center gap-1', className)} {...props}>
        {keys.map((key, index) => (
          <span key={key} className="inline-flex items-center gap-1">
            {index > 0 ? (
              <span aria-hidden="true" className="text-fg-muted text-[0.7rem]">
                +
              </span>
            ) : null}
            <kbd className={KEY_CAP}>{key}</kbd>
          </span>
        ))}
      </kbd>
    );
  }

  return (
    <kbd className={cn(KEY_CAP, className)} {...props}>
      {children}
    </kbd>
  );
}
