'use client';

import { RouteError } from '@/components/shell';

/**
 * The error boundary for the Learning Center -- the index, the glossary, and every
 * lesson.
 *
 * A lesson is MDX compiled at build time plus one or more `<EmbeddedSim>`s, and an
 * embed that cannot load its module handles that itself, inline, without throwing (see
 * `EmbeddedSim`). So what reaches this boundary is the lesson frame failing rather than
 * a simulation inside it, and the way out offered is the curriculum index rather than
 * the module explorer -- the reader was part-way through a track and that is where the
 * rest of it is.
 */
export default function LearnError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6">
      <RouteError
        error={error}
        reset={reset}
        title="This lesson stopped loading"
        escape={{ href: '/learn', label: 'Back to the Learning Center' }}
      >
        <p>
          The lesson text is compiled into the page itself, so this is most likely one of
          the simulations it embeds failing to download rather than anything wrong with
          the writing. Your progress is stored in this browser and is untouched by this.
        </p>
      </RouteError>
    </div>
  );
}
