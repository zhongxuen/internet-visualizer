'use client';

import { AlertTriangle, Check } from 'lucide-react';
import { useId, type FormEvent } from 'react';

import { Button } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import { cn } from '@/lib/cn';
import { SUPPORTED_TYPES, type SupportedType } from '@/core/net/diagnostics';

import {
  checkLiveTarget,
  type CheckedTarget,
  type LiveOperation,
} from '../live/operations';

/**
 * One target. Not a list, not a range, not a block.
 *
 * The structural half of that is in the route handlers, which refuse a second
 * `?target=` and every plural parameter by name; this box is the half the user sees. It
 * is a single-line input with a single value, and it validates on every keystroke by
 * calling the *same* functions the server will call — `parseLookupTarget` for the two
 * lookups, `inspectUrl` for the one that opens a socket — so `10.0.0.1`,
 * `192.0.2.0/24`, `a.com,b.com` and `169.254.169.254` are refused here in the same
 * words the server would refuse them, before anything is sent.
 *
 * That check is advice, not the boundary. The server repeats all of it and adds the one
 * thing a browser cannot do: resolving the name and re-checking every address that comes
 * back. Nothing here is trusted downstream, which is why it is safe for it to be
 * convenient.
 */

export interface TargetInputProps {
  operation: LiveOperation;
  value: string;
  onValueChange: (value: string) => void;
  /** The DNS record type. Ignored, and the selector hidden, for the other operations. */
  recordType: SupportedType;
  onRecordTypeChange: (type: SupportedType) => void;
  /** Called with the checked target when the form is submitted with a valid one. */
  onSubmit: (target: CheckedTarget) => void;
  /** True while a run is in flight: the button says so and the form will not re-submit. */
  busy?: boolean;
  /**
   * Seconds until the rate limiter will accept another run. The button names the wait
   * rather than going quietly dead, because a disabled control with no reason on it is
   * indistinguishable from a broken one.
   */
  cooldownSeconds?: number;
  className?: string;
}

export function TargetInput({
  operation,
  value,
  onValueChange,
  recordType,
  onRecordTypeChange,
  onSubmit,
  busy = false,
  cooldownSeconds = 0,
  className,
}: TargetInputProps) {
  const inputId = useId();
  const typeId = useId();
  const messageId = useId();

  const trimmed = value.trim();
  // Validated on every render rather than on blur: the point of running the server's own
  // validator in the browser is that the refusal arrives while you are still typing.
  const checked = trimmed === '' ? undefined : checkLiveTarget(operation.id, trimmed);
  const valid = checked?.allowed === true;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy || cooldownSeconds > 0 || !checked?.allowed) return;
    onSubmit(checked.value);
  }

  return (
    <form onSubmit={handleSubmit} className={cn('flex flex-col gap-2', className)}>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <label htmlFor={inputId} className="text-fg-secondary text-xs font-medium">
            Target — one host, never a range
          </label>
          <input
            id={inputId}
            name="target"
            type="text"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value={value}
            placeholder={operation.placeholder}
            onChange={(event) => onValueChange(event.target.value)}
            aria-describedby={checked && !checked.allowed ? messageId : undefined}
            aria-invalid={checked ? !checked.allowed : undefined}
            className={cn(
              'border-border bg-surface text-fg placeholder:text-fg-muted h-10 w-full min-w-0 rounded-md border px-3 font-mono text-sm',
              focusRing,
              checked && !checked.allowed && 'border-state-error/70',
            )}
          />
        </div>

        {operation.id === 'dns' ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={typeId} className="text-fg-secondary text-xs font-medium">
              Record type
            </label>
            <select
              id={typeId}
              value={recordType}
              onChange={(event) =>
                onRecordTypeChange(event.target.value as SupportedType)
              }
              className={cn(
                'border-border bg-surface text-fg h-10 rounded-md border px-2 font-mono text-sm',
                focusRing,
              )}
            >
              {SUPPORTED_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <Button type="submit" disabled={busy || cooldownSeconds > 0 || !valid}>
          {busy
            ? 'Running…'
            : cooldownSeconds > 0
              ? `Wait ${cooldownSeconds}s`
              : 'Run once'}
        </Button>
      </div>

      <div className="flex min-h-5 flex-wrap items-center gap-x-3 gap-y-1">
        {/*
          The refusal is named by the input's `aria-describedby` rather than announced by
          a live region: this re-renders on every keystroke, and a `role="status"` here
          would read a half-typed hostname's refusal out loud several times a second.
        */}
        {checked && !checked.allowed ? (
          <p
            id={messageId}
            className="text-state-error flex items-start gap-1.5 text-xs leading-relaxed"
          >
            <AlertTriangle aria-hidden="true" className="mt-px size-3.5 shrink-0" />
            {/* The server's own wording. A second phrasing of the same refusal would be
                a second thing to keep true. */}
            <span>{checked.detail}</span>
          </p>
        ) : valid ? (
          <p className="text-fg-muted flex items-center gap-1.5 text-xs">
            <Check aria-hidden="true" className="text-state-ok size-3.5 shrink-0" />
            Accepted by the same validator the server runs. Nothing has been sent.
          </p>
        ) : (
          <p className="text-fg-muted text-xs">
            One hostname or address. Lists, CIDR blocks, ranges, and port lists are
            refused.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-fg-muted text-xs">Try:</span>
        {operation.examples.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => onValueChange(example)}
            className={cn(
              'border-border bg-surface-raised text-fg-secondary hover:border-border-strong hover:text-fg rounded-md border px-2 py-0.5 font-mono text-[0.6875rem] transition-colors',
              focusRing,
            )}
          >
            {example}
          </button>
        ))}
      </div>
    </form>
  );
}
