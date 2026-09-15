'use client';

import { useId, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

import { idList } from './ids';
import { focusRing } from './styles';

/**
 * An on/off setting that takes effect at once: "Pause after each step", "Show
 * addresses", "Follow the action". The product had three of these in three styles; this
 * is the one.
 *
 * A `<button role="switch">` with `aria-checked`, so Space and Enter both flip it and it
 * is announced as a switch with its state. Three things say which state it is in, so no
 * one of them has to carry it alone: the thumb's position, the track's fill, and the
 * word "On" or "Off" beside it. The word is `aria-hidden` -- `aria-checked` already says
 * it to a screen reader, and "Pause after each step, On, switch, on" is one "on" too many
 * -- which keeps the visible label, and only the label, as the accessible name
 * (WCAG 2.5.3).
 *
 * The label is inside the button, so the whole row is the target rather than a 36px
 * track, and it is always visible. A switch whose meaning lives in a tooltip is one a
 * beginner cannot use. Because the description sits inside the button too, the name and
 * description are pointed at by id rather than computed from the content, which would
 * read the description as part of the name.
 */

export interface SwitchProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'onChange' | 'role' | 'aria-checked' | 'children' | 'value' | 'defaultValue'
> {
  /** What the switch controls, always visible. */
  label: ReactNode;
  /** A line under the label. Wired as the switch's description. */
  description?: ReactNode;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  onLabel?: string;
  offLabel?: string;
}

export function Switch({
  label,
  description,
  checked: checkedProp,
  defaultChecked = false,
  onCheckedChange,
  onLabel = 'On',
  offLabel = 'Off',
  className,
  onClick,
  'aria-describedby': describedBy,
  ...props
}: SwitchProps) {
  const baseId = useId();
  const labelId = `${baseId}-label`;
  const descriptionId = `${baseId}-description`;

  const [internalChecked, setInternalChecked] = useState(defaultChecked);
  const controlled = checkedProp !== undefined;
  const checked = controlled ? checkedProp : internalChecked;

  return (
    <button
      aria-labelledby={props['aria-label'] ? undefined : labelId}
      {...props}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-describedby={idList(describedBy, description ? descriptionId : undefined)}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        const next = !checked;
        if (!controlled) setInternalChecked(next);
        onCheckedChange?.(next);
      }}
      className={cn(
        // --target-min
        'group inline-flex min-h-11 items-center gap-3 rounded-md px-2 py-1.5 text-left',
        'hover:bg-surface-overlay transition-colors',
        'disabled:pointer-events-none disabled:opacity-50',
        focusRing,
        className,
      )}
    >
      <span className="min-w-0 flex-1">
        <span id={labelId} className="text-fg block text-sm font-medium">
          {label}
        </span>
        {description ? (
          <span
            id={descriptionId}
            className="text-fg-muted mt-0.5 block text-xs leading-snug"
          >
            {description}
          </span>
        ) : null}
      </span>

      <span aria-hidden="true" className="inline-flex shrink-0 items-center gap-2">
        <span
          className={cn(
            'relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border transition-colors',
            checked
              ? 'border-accent bg-accent'
              : 'border-border-strong bg-surface group-hover:border-fg-muted',
          )}
        >
          <span
            className={cn(
              'absolute top-1/2 left-0.5 h-4 w-4 -translate-y-1/2 rounded-full transition-transform',
              checked ? 'bg-accent-ink translate-x-4' : 'bg-fg-muted translate-x-0',
            )}
          />
        </span>
        {/* Fixed width so the row does not shift between "On" and "Off". */}
        <span
          className={cn(
            'inline-block min-w-7 text-xs font-medium',
            checked ? 'text-fg' : 'text-fg-muted',
          )}
        >
          {checked ? onLabel : offLabel}
        </span>
      </span>
    </button>
  );
}
