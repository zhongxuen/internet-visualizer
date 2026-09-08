import Link from 'next/link';
import { Compass, SearchX } from 'lucide-react';
import type { Metadata } from 'next';

import { ModuleGrid } from '@/components/shell';
import { buttonClasses } from '@/components/ui';

export const metadata: Metadata = { title: 'Page not found' };

/**
 * The 404, and the only one.
 *
 * Every URL in this product is a module, a lesson, or the glossary -- there is no
 * database and no user-generated path, so an unknown URL is a typo, a stale bookmark, or
 * a module that was renamed. All three are answered the same way: say so, then show the
 * whole registry, because the list of everything that exists is short enough to be the
 * most useful thing on the page. `ModuleGrid` reads `MODULES` itself, so this cannot
 * fall behind it.
 *
 * A wrong lesson URL lands here too, and a `not-found.tsx` under `app/learn/` would not
 * change that. Every lesson is pre-rendered and `/learn/[track]/[lesson]` sets
 * `dynamicParams = false`, so an unknown track or slug never matches the route at all --
 * the segment does not render, and no boundary inside it is consulted. That is why the
 * link to the Learning Center is on this page rather than on one of its own.
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
        <p className="text-fg-secondary mt-4 text-base leading-relaxed">
          This product has no dynamic pages: every URL is one of the modules below, one of
          the lessons in the Learning Center, or the glossary. So this one is a typo or a
          link that has moved.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link href="/" className={buttonClasses()}>
            <Compass aria-hidden="true" className="mr-2 size-4" />
            Go to the module explorer
          </Link>
          <Link href="/learn" className={buttonClasses({ variant: 'secondary' })}>
            Browse the lessons
          </Link>
        </div>
      </div>

      <section aria-labelledby="everything-heading" className="mt-14">
        <h2
          id="everything-heading"
          className="text-fg-muted text-xs font-medium tracking-widest uppercase"
        >
          Everything that does exist
        </h2>
        <ModuleGrid className="mt-5" />
      </section>
    </div>
  );
}
