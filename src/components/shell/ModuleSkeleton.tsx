import { cn } from '@/lib/cn';

/**
 * The shape of a module route, drawn before the module arrives.
 *
 * Every module composes `SimulationView`, so every module route has the same silhouette:
 * the Stage (uiux-spec.md §5.3) -- a control strip, the canvas beside the Steps and
 * Details panels, the step caption, the transport bar -- and the event log underneath.
 * This traces that silhouette at the same sizes, for the same reason `LazyCanvas`'s
 * placeholder does: the module's chunk is the largest thing on the route, and a blank
 * page for the length of its download is both a worse wait and a layout shift when it
 * lands.
 *
 * The sizes are copied from `SimulationView` and are the one thing here that can go
 * stale. If one changes there, change it here:
 *
 * - the control strip: a row of 44px buttons, which every module still passes as
 *   `controlPanel` until its wave-3 pass puts a story picker in the stage header;
 * - the canvas: `h-[60svh] lg:h-[32rem]`, beside a `22rem` column of the same height;
 * - the step caption: `h-30` under the canvas below `lg` (at `lg` it is `h-36` and laid
 *   over the canvas and takes no room of its own);
 * - the transport: 118px below `lg` (Back / Play / Next step over the timeline row) and
 *   78px at `lg` (one row, as tall as the timeline).
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
    <div className={cn('flex min-h-0 flex-col gap-4', className)}>
      <p role="status" className="text-fg-muted text-sm">
        Loading the simulation…
      </p>

      <div aria-hidden="true" className="flex animate-pulse flex-col gap-4">
        <div className="flex flex-col gap-3">
          {/* The control strip every module still passes as `controlPanel`. */}
          <div className="flex flex-wrap gap-1.5">
            {['w-32', 'w-40', 'w-28', 'w-36'].map((width) => (
              <Box key={width} className={cn('h-11', width)} />
            ))}
          </div>

          <div className="grid min-h-0 gap-3 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="min-w-0">
              {/* The canvas. Same box `LazyCanvas` reserves, at the same height. */}
              <Box className="bg-surface h-[60svh] lg:h-[32rem]" />
              {/* The step caption, under the canvas below lg. */}
              <Box className="mt-3 h-30 lg:hidden" />
            </div>

            <div className="flex flex-col gap-3 lg:h-[32rem]">
              {/* Below lg: the Steps / Details tabs, then the Steps panel. */}
              <Box className="h-11 lg:hidden" />
              <Box className="h-40 shrink-0" />
              <Box className="min-h-0 flex-1 max-lg:hidden" />
            </div>
          </div>

          {/* The transport bar. */}
          <Box className="h-[118px] lg:h-[78px]" />
        </div>

        {/* The event log. */}
        <Box className="h-14" />
      </div>
    </div>
  );
}
