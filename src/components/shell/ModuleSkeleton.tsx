import { cn } from '@/lib/cn';

/**
 * The shape of a module route, drawn before the module arrives.
 *
 * Every module composes `SimulationView`, so every module route has the same silhouette:
 * a control strip, then a diagram beside a column of panels, then the timeline and the
 * event log underneath. This traces that silhouette at the same sizes, for the same
 * reason `LazyCanvas`'s placeholder does -- the module's chunk is the largest thing on
 * the route, and a blank page for the length of its download is both a worse wait and a
 * layout shift when it lands.
 *
 * The heights are copied from `SimulationView` deliberately and are the one thing here
 * that can go stale: `h-[26rem] lg:h-[32rem]` is its full-size canvas slot, and `22rem`
 * is its right-hand column. If those change there, change them here.
 *
 * Nothing below is announced. The boxes are decoration -- there is no content in them to
 * describe -- so the whole tree is `aria-hidden` and the one thing a screen reader gets
 * is the status line, which is the only true sentence available at this point.
 */
function Box({ className }: { className?: string }) {
  return (
    <div className={cn('bg-surface-raised border-border rounded-xl border', className)} />
  );
}

export function ModuleSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('flex min-h-0 flex-col gap-3', className)}>
      <p role="status" className="text-fg-muted text-sm">
        Loading the simulation…
      </p>

      <div aria-hidden="true" className="flex animate-pulse flex-col gap-3">
        {/* The control strip: a row of scenario buttons and the line describing them. */}
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5">
            {['w-32', 'w-40', 'w-28', 'w-36'].map((width) => (
              <Box key={width} className={cn('h-8', width)} />
            ))}
          </div>
          <Box className="h-4 w-full max-w-xl border-transparent" />
        </div>

        <div className="grid min-h-0 gap-3 lg:grid-cols-[minmax(0,1fr)_22rem]">
          {/* The diagram. Same box `LazyCanvas` reserves, at the same height. */}
          <Box className="bg-surface h-[26rem] lg:h-[32rem]" />

          <div className="flex flex-col gap-3 lg:h-[32rem]">
            <Box className="h-40 shrink-0" />
            <Box className="min-h-0 flex-1" />
          </div>
        </div>

        {/* Timeline, then the event log. */}
        <Box className="h-14" />
        <Box className="h-32" />
      </div>
    </div>
  );
}
