import { TriangleAlert } from 'lucide-react';
import {
  cloneElement,
  isValidElement,
  useId,
  type ReactElement,
  type ReactNode,
} from 'react';

import { cn } from '@/lib/cn';

import { idList } from './ids';

/**
 * One labelled control: a label above, the control, a hint, and an error when there is
 * one. It replaces the three private `Control` shells in DNS Explorer, HTTP Explorer and
 * Packet Journey (wave 3 of docs/implementation/uiux.md).
 *
 * The wiring is the point, not the layout:
 *
 * - the `<label>` names the control through `htmlFor`/`id`;
 * - the hint and the error are both in the control's `aria-describedby`, error first,
 *   so a screen reader hears what is wrong before the general advice;
 * - `aria-invalid` is set while there is an error.
 *
 * The error is a sentence with an icon, never a red border alone. It is *not* a live
 * region: a view has exactly one of those, and it is the step caption (CLAUDE.md,
 * accessibility rule 3). A caller that has to announce a failed submit moves focus to
 * the invalid control, which reads the error through `aria-describedby`.
 *
 * ## Two ways to hand over the control
 *
 * - A single element, the usual case. It receives `id`, `aria-describedby` and
 *   `aria-invalid`; an `aria-describedby` it already had is kept, after these.
 * - A function, for a control that is not one element, or that has to put the ids
 *   somewhere other than its root: `{(control) => <Thing inputProps={control} />}`.
 */

export interface FieldControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  'aria-required'?: true;
}

type ControlElement = ReactElement<{
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
  'aria-required'?: boolean | 'true' | 'false';
}>;

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  /** A sentence saying what is wrong and how to fix it. Omit, or pass `null`, when valid. */
  error?: ReactNode;
  /** Marks the control required and says so in the label. */
  required?: boolean;
  /** The control's id. Generated when omitted. */
  id?: string;
  children: ControlElement | ((control: FieldControlProps) => ReactNode);
  className?: string;
}

export function Field({
  label,
  hint,
  error,
  required = false,
  id: idProp,
  children,
  className,
}: FieldProps) {
  const baseId = useId();
  const controlId = idProp ?? `${baseId}-control`;
  const hintId = `${baseId}-hint`;
  const errorId = `${baseId}-error`;

  const hasError = error !== undefined && error !== null && error !== false;
  const describedBy = idList(hasError && errorId, hint ? hintId : undefined);

  const control: FieldControlProps = {
    id: controlId,
    'aria-describedby': describedBy,
    ...(hasError ? { 'aria-invalid': true as const } : {}),
    ...(required ? { 'aria-required': true as const } : {}),
  };

  let rendered: ReactNode;
  if (typeof children === 'function') {
    rendered = children(control);
  } else if (isValidElement(children)) {
    rendered = cloneElement(children, {
      ...control,
      'aria-describedby': idList(describedBy, children.props['aria-describedby']),
    });
  } else {
    rendered = children;
  }

  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={controlId} className="text-fg-secondary text-sm font-medium">
        {label}
        {required ? (
          <>
            {' '}
            <span className="text-fg-muted font-normal">(required)</span>
          </>
        ) : null}
      </label>

      {rendered}

      {hasError ? (
        <p
          id={errorId}
          className="text-state-error flex items-start gap-1.5 text-sm leading-snug"
        >
          <TriangleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}

      {hint ? (
        <p id={hintId} className="text-fg-muted text-xs leading-snug">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
