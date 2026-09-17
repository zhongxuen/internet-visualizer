'use client';

import { RouteError } from '@/components/shell';

/**
 * The error boundary for every module route.
 *
 * It renders *inside* `(modules)/layout.tsx`, so the back link, the module title and
 * the safety badge are all still on screen and still correct -- which is why the
 * heading here is an `h2`: `ModuleChrome` already drew the page's `h1`.
 *
 * "Try again" is a real offer rather than a polite one. A module is a pure function of
 * a bundled scenario: there is no request in flight to redo and no half-written state
 * to reconcile, so re-rendering the segment either works or fails the same way twice.
 * The two things that realistically land here are a chunk that failed to download and a
 * genuine bug in a simulation, and the first of those is fixed by pressing the button.
 */
export default function ModuleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      level={2}
      error={error}
      reset={reset}
      title="This simulation stopped before it could start"
    >
      <p>
        Press Try again &mdash; a part of the page that didn&rsquo;t finish downloading is
        the usual cause, and a second try fixes it. Nothing was sent anywhere: a
        simulation runs from data already in this page, and an error can&rsquo;t start a
        network request.
      </p>
    </RouteError>
  );
}
