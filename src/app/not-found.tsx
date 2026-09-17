import Link from 'next/link';
import { Compass, GraduationCap, Play, SearchX } from 'lucide-react';
import type { Metadata } from 'next';

import { buttonClasses } from '@/components/ui';

export const metadata: Metadata = { title: 'Page not found' };

/**
 * The 404, and the only one.
 *
 * Every URL in this product is a module, a lesson, or the glossary -- there is no
 * database and no user-generated path, so an unknown URL is a typo, a stale bookmark, or
 * a page that moved. The reader is told that plainly and given the three ways in the
 * navigation offers: the beginner path, the modules by question, and the lessons.
 *
 * A wrong lesson URL lands here too, and a `not-found.tsx` under `app/learn/` would not
 * change that. Every lesson is pre-rendered and `/learn/[track]/[lesson]` sets
 * `dynamicParams = false`, so an unknown track or slug never matches the route at all --
 * the segment does not render, and no boundary inside it is consulted. That is why the
 * link to the lessons is on this page rather than on one of its own.
 *
 * The `h1` is pinned by `NOT_FOUND_ROUTES` in `e2e/routes.ts`; change both together.
 */
export default function NotFound() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6">
      <div className="max-w-2xl">
        <span className="text-fg-muted inline-flex" aria-hidden="true">
          <SearchX className="size-8" />
        </span>
        <h1 className="text-fg mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
          There is nothing at this address
        </h1>
        <p className="text-fg-secondary text-lead mt-4">
          The link may have a typo in it, or the page may have moved. Here are three good
          places to go instead.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link href="/start" className={buttonClasses()}>
            <Play aria-hidden="true" className="size-4" />
            Start here
          </Link>
          <Link href="/#explore" className={buttonClasses({ variant: 'secondary' })}>
            <Compass aria-hidden="true" className="size-4" />
            Explore
          </Link>
          <Link href="/learn" className={buttonClasses({ variant: 'secondary' })}>
            <GraduationCap aria-hidden="true" className="size-4" />
            Lessons
          </Link>
        </div>
      </div>
    </div>
  );
}
