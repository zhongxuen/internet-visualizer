import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/cn';

import { focusRing } from './styles';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-ink hover:bg-accent-strong',
  secondary:
    'border border-border bg-surface-raised text-fg hover:border-border-strong hover:bg-surface-overlay',
  ghost: 'text-fg-secondary hover:bg-surface-overlay hover:text-fg',
  danger: 'bg-state-error text-accent-ink hover:brightness-110',
};

/*
 * `md` is the primary control and is exactly `--target-min` (44px) tall; `sm` is 36px,
 * for secondary actions that sit in dense panels, and still well above the 24px floor.
 * Both are rem, so "Large text" grows them with their label.
 */
const SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 gap-1.5 px-3 text-caption',
  md: 'h-target gap-2 px-4 text-small',
};

export interface ButtonStyleOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}

/**
 * The button's classes without the button.
 *
 * Needed because a call to action that navigates must be an `<a>` — wrapping a
 * `<button>` in a `<Link>`, or firing `router.push` from one, loses middle-click,
 * "open in new tab", and the status bar. `<Link className={buttonClasses()}>` keeps
 * the element honest and the styling in one place.
 */
export function buttonClasses({
  variant = 'primary',
  size = 'md',
  className,
}: ButtonStyleOptions = {}): string {
  return cn(
    'inline-flex shrink-0 items-center justify-center rounded-md font-medium transition-colors',
    'disabled:pointer-events-none disabled:opacity-50',
    focusRing,
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Decorative leading glyph. Hidden from assistive tech — label the button in text. */
  icon?: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  className,
  type = 'button',
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses({ variant, size, className })}
      {...props}
    >
      {icon ? (
        <span aria-hidden="true" className="inline-flex shrink-0">
          {icon}
        </span>
      ) : null}
      {children}
    </button>
  );
}
