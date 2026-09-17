'use client';

import { RouteError } from '@/components/shell';

/**
 * The catch-all error boundary: the home page, `/demo`, and anything else that is not
 * under `(modules)` or `/learn`.
 *
 * The nav, the skip link and the footer come from the root layout and survive, so this
 * owns the page's `h1`.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6">
      <RouteError error={error} reset={reset} title="This page didn’t load properly">
        <p>
          Press Try again &mdash; it usually works the second time. If it breaks the same
          way twice, go to the home page. An error like this can&rsquo;t send anything
          over the network.
        </p>
      </RouteError>
    </div>
  );
}
