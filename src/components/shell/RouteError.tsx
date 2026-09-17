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
 * differ only in their words. Read top to bottom, that shape is:
 *
 * 1. **A plain headline, then the next step.** The reader is most likely a beginner who
 *    did nothing wrong, so the first things on screen say what happened in plain words
 *    and what to press. `reset()` comes first because it is the recovery that actually
 *    works here: nothing in this app is a partially-committed write -- a module is a
 *    pure function of a scenario -- so trying again really is free and really can succeed
 *    (a chunk that failed to download is the common case). The link out is the second.
 * 2. **Then what the browser reported, in its own words, visible.** Below the next step,
 *    never folded away: this is a product about protocols, read by people who debug
 *    things, and hiding the message behind "something went wrong" costs them the one
 *    fact worth having. The `digest` is shown beside it because in production that is
 *    all a server-side throw leaves behind, and it is the string that matches a server
 *    log line.
 * 3. **Not lie about the safety posture.** An exception cannot start a network request,
 *    and the callers say so where a reader might reasonably wonder.
 *
 * The heading level is a prop because these boundaries render inside different frames:
 * under `(modules)` the layout has already drawn the module title as the page's `h1`,
 * so the error is an `h2` there and an `h1` everywhere else. One `h1` per page is a
 * phase-14 acceptance criterion, not a preference. "What the browser reported" is one
 * level below it, so no level is skipped either way.
 */
export interface RouteErrorProps {
  /** The boundary's own `error` prop, passed straight through. */
  error: Error & { digest?: string };
  /** The boundary's own `reset` prop. Re-renders the segment that threw. */
  reset: () => void;
  /** A plain headline: what happened, in words a beginner uses. */
  title: string;
  /** The next step, in one or two plain sentences. Shown straight under the title. */
  children: ReactNode;
  /**
   * `1` when this boundary owns the page's heading, `2` when a layout above it already
   * drew one.
   */
  level?: 1 | 2;
  /** The way out, when "try again" does not work. Defaults to the home page. */
  escape?: { href: string; label: string };
  className?: string;
}

export function RouteError({
  error,
  reset,
  title,
  children,
  level = 1,
  escape = { href: '/', label: 'Go to the home page' },
  className,
}: RouteErrorProps) {
  const Heading = level === 1 ? 'h1' : 'h2';
  const DetailHeading = level === 1 ? 'h2' : 'h3';

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

      <div className="text-fg-secondary text-body max-w-prose leading-relaxed">
        {children}
      </div>

      <div className="flex flex-wrap items-center gap-3">
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

      {/*
        The runtime's own words. `message` is empty for a production server throw, in
        which case the digest is the whole of what there is to quote -- so each half is
        rendered only when it exists, and the block disappears entirely when neither
        does.
      */}
      {error.message || error.digest ? (
        <section className="border-border bg-surface mt-2 w-full min-w-0 rounded-lg border px-4 py-3">
          <DetailHeading className="text-fg-muted text-small font-medium">
            What the browser reported
          </DetailHeading>
          <dl className="text-caption mt-2">
            {error.message ? (
              <>
                <dt className="text-fg-muted">Message</dt>
                <dd className="text-fg-secondary mt-1 font-mono break-words">
                  {error.message}
                </dd>
              </>
            ) : null}
            {error.digest ? (
              <>
                <dt className={cn('text-fg-muted', error.message && 'mt-3')}>Digest</dt>
                <dd className="text-fg-secondary mt-1 font-mono break-all">
                  {error.digest}
                </dd>
              </>
            ) : null}
          </dl>
        </section>
      ) : null}
    </div>
  );
}
