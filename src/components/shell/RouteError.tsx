'use client';

import Link from 'next/link';
import { RotateCcw, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button, buttonClasses } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

/**
 * The body of every `error.tsx` in the app.
 *
 * React's error boundaries are the one place this product can end up somewhere it did
 * not design for, so the three route-level boundaries all render the same shape and
 * differ only in their words. What that shape has to do:
 *
 * 1. **Offer the recovery that actually works.** `reset()` re-renders the segment that
 *    threw, which is the right first move here because nothing in this app is a
 *    partially-committed write -- a module is a pure function of a scenario, so trying
 *    again really is free and really can succeed (a chunk that failed to download is
 *    the common case). A full reload is the second move, and the link out is the third.
 * 2. **Say what broke, in the words the runtime used.** This is a product about
 *    protocols, read by people who debug things; hiding the message behind "something
 *    went wrong" costs them the one fact worth having. The `digest` is shown beside it
 *    because in production that is all a server-side throw leaves behind, and it is the
 *    string that matches a server log line.
 * 3. **Not lie about the safety posture.** An exception cannot start a network request,
 *    and the callers say so where a reader might reasonably wonder.
 *
 * The heading level is a prop because these boundaries render inside different frames:
 * under `(modules)` the layout has already drawn the module title as the page's `h1`,
 * so the error is an `h2` there and an `h1` everywhere else. One `h1` per page is a
 * phase-14 acceptance criterion, not a preference.
 */
export interface RouteErrorProps {
  /** The boundary's own `error` prop, passed straight through. */
  error: Error & { digest?: string };
  /** The boundary's own `reset` prop. Re-renders the segment that threw. */
  reset: () => void;
  title: string;
  /** One or two sentences on what this particular part of the app was doing. */
  children: ReactNode;
  /**
   * `1` when this boundary owns the page's heading, `2` when a layout above it already
   * drew one.
   */
  level?: 1 | 2;
  /** The way out, when "try again" does not work. Defaults to the module explorer. */
  escape?: { href: string; label: string };
  className?: string;
}

export function RouteError({
  error,
  reset,
  title,
  children,
  level = 1,
  escape = { href: '/', label: 'Back to all modules' },
  className,
}: RouteErrorProps) {
  const Heading = level === 1 ? 'h1' : 'h2';

  return (
    <div
      className={cn(
        'border-border bg-surface-raised mx-auto flex w-full max-w-2xl flex-col items-start gap-4 rounded-xl border px-6 py-10',
        className,
      )}
    >
      <span className="text-state-error inline-flex" aria-hidden="true">
        <TriangleAlert className="size-7" />
      </span>

      <Heading
        className={cn(
          'text-fg font-semibold tracking-tight',
          level === 1 ? 'text-2xl sm:text-3xl' : 'text-xl',
        )}
      >
        {title}
      </Heading>

      <div className="text-fg-secondary max-w-prose text-sm leading-relaxed">
        {children}
      </div>

      {/*
        The runtime's own words. `message` is empty for a production server throw, in
        which case the digest is the whole of what there is to quote -- so each half is
        rendered only when it exists, and the block disappears entirely when neither
        does.
      */}
      {error.message || error.digest ? (
        <dl className="border-border bg-surface w-full min-w-0 rounded-lg border px-4 py-3 text-xs">
          {error.message ? (
            <>
              <dt className="text-fg-muted font-medium">What the runtime said</dt>
              <dd className="text-fg-secondary mt-1 font-mono break-words">
                {error.message}
              </dd>
            </>
          ) : null}
          {error.digest ? (
            <>
              <dt className={cn('text-fg-muted font-medium', error.message && 'mt-3')}>
                Digest
              </dt>
              <dd className="text-fg-secondary mt-1 font-mono break-all">
                {error.digest}
              </dd>
            </>
          ) : null}
        </dl>
      ) : null}

      <div className="mt-1 flex flex-wrap items-center gap-3">
        <Button onClick={reset} icon={<RotateCcw className="size-4" />}>
          Try again
        </Button>
        <Link
          href={escape.href}
          className={buttonClasses({ variant: 'secondary', size: 'md' })}
        >
          {escape.label}
        </Link>
      </div>
    </div>
  );
}
