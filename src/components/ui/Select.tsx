import { ChevronDown } from 'lucide-react';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/cn';

import { focusRing } from './styles';

/**
 * A native `<select>`, styled. Native on purpose: on a phone it opens the platform's own
 * picker, which is larger, scrolls properly and is already understood; a custom listbox
 * would have to rebuild that, and its keyboard model, and would still be worse on touch.
 *
 * Only the closed control is styled -- `appearance-none` plus a chevron drawn over it.
 * The open list stays the browser's. Label it with `Field`, which also wires the hint
 * and the error; every prop is passed straight to the `<select>`, `ref` included.
 */

export type SelectSize = 'sm' | 'md';

const SIZES: Record<SelectSize, string> = {
  sm: 'min-h-target-floor h-8 pl-2.5 pr-8 text-xs',
  md: 'h-target pl-3 pr-10 text-sm',
};

export interface SelectProps extends Omit<ComponentProps<'select'>, 'size'> {
  /** The control's height. Not the HTML `size` attribute, which turns it into a list box. */
  size?: SelectSize;
  /** Classes for the wrapper, which is what sizes the control in a layout. */
  className?: string;
  /** Classes for the `<select>` itself. */
  selectClassName?: string;
}

export function Select({
  size = 'md',
  className,
  selectClassName,
  children,
  ...props
}: SelectProps) {
  return (
    <span className={cn('relative inline-flex min-w-0', className)}>
      <select
        {...props}
        className={cn(
          'border-border bg-surface text-fg w-full min-w-0 cursor-pointer appearance-none rounded-md border',
          'hover:border-border-strong transition-colors',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'aria-invalid:border-state-error',
          focusRing,
          SIZES[size],
          selectClassName,
        )}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className={cn(
          'text-fg-muted pointer-events-none absolute top-1/2 -translate-y-1/2',
          size === 'sm' ? 'right-2 h-3.5 w-3.5' : 'right-3 h-4 w-4',
        )}
      />
    </span>
  );
}
