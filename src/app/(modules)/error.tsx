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
      title="This simulation stopped before it could be drawn"
    >
      <p>
        The module above is registered and its scenarios are bundled with the page, so
        this is either a chunk that did not finish downloading or a bug in the run itself.
        Nothing was sent anywhere: a simulation is a pure function of a fixture in this
        repository, and an exception cannot start a network request.
      </p>
    </RouteError>
  );
}
