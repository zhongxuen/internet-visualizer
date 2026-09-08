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
      <RouteError error={error} reset={reset} title="This page did not finish rendering">
        <p>
          Whatever this was, it was local: every module in this product is a deterministic
          simulation that runs in your browser, and none of it can reach a network by
          failing. Try again, and if it fails the same way twice the message below is the
          thing worth quoting.
        </p>
      </RouteError>
    </div>
  );
}
