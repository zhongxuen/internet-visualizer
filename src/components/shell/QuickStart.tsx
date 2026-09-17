'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { ArrowRight } from 'lucide-react';

import { buttonClasses } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { focusRing } from '@/components/ui/styles';
import { cn } from '@/lib/cn';

import { checkQuickStart, QUICK_START_ROUTE } from './QuickStartUrl';

export interface QuickStartProps {
  className?: string;
}

/**
 * The home page's second way in: type a website, and the Internet Simulator opens on it
 * (uiux-spec.md §5.5, "Type a website and watch").
 *
 * **It works before, and without, JavaScript.** It is a real `GET` form to the simulator
 * with the field named `url`, so an unhydrated page or a failed chunk still lands on
 * `/internet-simulator?url=…`. Once hydrated, it checks the shape first
 * (`QuickStartUrl.ts`) and navigates client-side.
 *
 * An invalid submit moves focus to the field, which reads the error out through
 * `aria-describedby` -- `Field` explains why that, and not a live region, is the way.
 */
export function QuickStart({ className }: QuickStartProps) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const check = checkQuickStart(input.current?.value ?? '');
    if (!check.ok) {
      setError(check.error);
      input.current?.focus();
      return;
    }
    setError(null);
    router.push(check.href);
  }

  return (
    <form
      action={QUICK_START_ROUTE}
      method="get"
      noValidate
      onSubmit={onSubmit}
      className={cn('flex w-full max-w-md flex-col gap-2', className)}
    >
      <Field label="Or type a website and watch" error={error}>
        {(control) => (
          <div className="flex gap-2">
            <input
              {...control}
              ref={input}
              name="url"
              type="text"
              inputMode="url"
              autoComplete="url"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="example.com"
              onChange={() => {
                if (error) setError(null);
              }}
              className={cn(
                'border-border bg-surface text-fg placeholder:text-fg-dim min-h-target min-w-0 flex-1 rounded-lg border px-3 text-base',
                'hover:border-border-strong aria-invalid:border-state-error',
                focusRing,
              )}
            />
            <button
              type="submit"
              className={buttonClasses({ variant: 'secondary', className: 'shrink-0' })}
            >
              Watch
              <ArrowRight aria-hidden="true" className="size-4" />
            </button>
          </div>
        )}
      </Field>
    </form>
  );
}
