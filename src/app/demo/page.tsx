import type { Metadata } from 'next';

import { Badge } from '@/components/ui';

import { DemoPlayground } from './DemoPlayground';

/**
 * **Temporary.** The phase-04 acceptance route
 * (docs/implementation/04-visualization-layer.md): the toy run from `src/core/sim`
 * driven end to end through `SimulationView`, so the visualization layer can be
 * exercised before any real module exists.
 *
 * Delete it once a real module renders a `SimulationView` -- Network Map, in phase 05.
 * It is excluded from search indexing and is not in the registry, so nothing links here.
 */
export const metadata: Metadata = {
  title: 'Visualization demo',
  robots: { index: false, follow: false },
};

export default function DemoPage() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <h1 className="text-fg text-2xl font-semibold">Visualization demo</h1>
          <Badge tone="warn">Temporary</Badge>
        </div>
        <p className="text-fg-secondary max-w-3xl text-sm">
          A laptop pings an echo server two hops away. Everything below is driven by one
          number -- the playhead -- so playing, scrubbing backwards, and stepping between
          phases all show exactly the same picture at the same virtual millisecond. Press{' '}
          <kbd className="border-border bg-surface-overlay text-fg-secondary rounded border px-1 font-mono text-xs">
            Space
          </kbd>{' '}
          to start; the full keyboard map is under <em>Shortcuts</em>.
        </p>
      </header>

      <DemoPlayground />
    </div>
  );
}
