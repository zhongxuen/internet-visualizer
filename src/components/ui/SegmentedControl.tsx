'use client';

import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

import { focusRing } from './styles';

/**
 * One choice out of a few, all visible: Simple / Full detail, System / Full / Reduced
 * motion, a speed. A radio group, because that is what it is -- `role="radiogroup"` of
 * `role="radio"` buttons -- rather than a row of toggle buttons each announcing
 * "pressed" or "not pressed" with no sense that they exclude one another.
 *
 * Keyboard follows the radio pattern: one tab stop for the whole group (roving
 * tabindex, on the checked option), arrow keys move *and* select, Home and End jump to
 * the ends, and disabled options are skipped. Selection follows focus because every use
 * of this is a cheap, reversible setting; something expensive to switch to wants a
 * `Tabs` or a confirm step instead.
 *
 * The checked option is marked by a filled surface *and* a heavier weight *and* a bar
 * under the label, so which one is checked survives greyscale, not only its hue.
 */

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

export type SegmentedSize = 'sm' | 'md';

const SIZES: Record<SegmentedSize, string> = {
  sm: 'min-h-target-floor h-8 px-2.5 text-xs',
  md: 'h-target px-4 text-sm',
};

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value?: T;
  defaultValue?: T;
  onValueChange?: (value: T) => void;
  /** The group's accessible name. Required unless `aria-labelledby` is given. */
  label?: string;
  'aria-labelledby'?: string;
  size?: SegmentedSize;
  className?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value: valueProp,
  defaultValue,
  onValueChange,
  label,
  'aria-labelledby': labelledBy,
  size = 'md',
  className,
}: SegmentedControlProps<T>) {
  const firstEnabled = options.find((option) => !option.disabled)?.value;
  const [internalValue, setInternalValue] = useState<T | undefined>(
    defaultValue ?? firstEnabled,
  );
  const value = valueProp ?? internalValue;
  const refs = useRef(new Map<T, HTMLButtonElement | null>());

  const select = (next: T) => {
    if (valueProp === undefined) setInternalValue(next);
    if (next !== value) onValueChange?.(next);
  };

  // With nothing checked (a controlled value no option matches), the first enabled
  // option holds the tab stop so the group is still reachable.
  const tabStop = options.some((option) => option.value === value && !option.disabled)
    ? value
    : firstEnabled;

  const move = (from: number, step: number) => {
    const count = options.length;
    for (let offset = 1; offset <= count; offset += 1) {
      const next = options[(((from + step * offset) % count) + count) % count];
      if (next && !next.disabled) {
        select(next.value);
        refs.current.get(next.value)?.focus();
        return;
      }
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        move(index, 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        move(index, -1);
        break;
      case 'Home':
        event.preventDefault();
        move(-1, 1);
        break;
      case 'End':
        event.preventDefault();
        move(options.length, -1);
        break;
      default:
        break;
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      className={cn(
        'border-border bg-surface inline-flex max-w-full flex-wrap items-stretch gap-1 rounded-lg border p-1',
        className,
      )}
    >
      {options.map((option, index) => {
        const checked = option.value === value;

        return (
          <button
            key={option.value}
            ref={(node) => {
              refs.current.set(option.value, node);
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={option.disabled}
            tabIndex={option.value === tabStop ? 0 : -1}
            onClick={() => select(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              'relative inline-flex flex-1 items-center justify-center rounded-md whitespace-nowrap transition-colors',
              'disabled:pointer-events-none disabled:opacity-50',
              focusRing,
              SIZES[size],
              checked
                ? 'bg-surface-overlay text-fg font-semibold'
                : 'text-fg-muted hover:text-fg hover:bg-surface-raised font-medium',
            )}
          >
            {option.label}
            {checked ? (
              <span
                aria-hidden="true"
                className="bg-accent absolute inset-x-3 bottom-1 h-0.5 rounded-full"
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
