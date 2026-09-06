'use client';

import { AlertTriangle, MinusCircle } from 'lucide-react';

import { focusRing } from '@/components/ui/styles';
import { formatDuration } from '@/components/viz';
import { cn } from '@/lib/cn';

import type { StageRun } from '../sim/pipeline';
import type { BrowserFailure, StageId } from '../sim/stage';

/**
 * The eight stages of a page load, as one bar the width of the run.
 *
 * The rail is the module's thesis in a single control: a page load is not one thing that
 * takes a while, it is eight things, and the ones people think about are usually not the
 * expensive ones. Every stage's width is its share of the run -- taken straight from
 * `StageRun.share`, which the pipeline computed by dividing a real virtual duration by the
 * real total, so the proportions cannot drift from the timeline no matter what the copy
 * says.
 *
 * ## Why a minimum width, and why it does not lie
 *
 * URL parsing takes a fifth of a millisecond and would be a sub-pixel sliver on a 900 ms
 * run: unclickable, unreadable, and effectively missing from a control whose job is to show
 * that it happened. Each stage therefore gets a small floor. The floor is visibly *smaller*
 * than any real stage, the exact duration is printed inside every segment, and stages that
 * did not run are drawn as hatched placeholders rather than as time -- so the eye reads
 * proportion, the label reads truth, and neither is doing the other's job.
 *
 * ## Click to zoom
 *
 * Selecting a stage seeks the timeline to its start and opens `StageZoom` beneath. That
 * pairing is deliberate: the rail answers "where did the time go", the zoom answers "what
 * happened there", and the handoff inside the zoom answers "show me this properly".
 */

export interface StageRailProps {
  stages: readonly StageRun[];
  /** The run's total virtual duration, for the summary line. */
  durationMs: number;
  /** Which stage is expanded below, if any. */
  selected: StageId | null;
  /** Fired on click and on keyboard activation. Passing the same id again closes it. */
  onSelect: (id: StageId) => void;
  /** Set when the run ended in a browser error, so the rail can mark the stage it died in. */
  failure?: BrowserFailure;
  className?: string;
}

/** Growth weight for one segment: its real share, floored so it stays clickable. */
const MIN_SHARE = 0.045;

function toneFor(stage: StageRun, failed: boolean, selected: boolean): string {
  if (failed) {
    return selected
      ? 'border-state-error bg-state-error/25 text-fg'
      : 'border-state-error/60 bg-state-error/15 text-fg-secondary hover:bg-state-error/20';
  }
  if (stage.status === 'ran') {
    return selected
      ? 'border-accent bg-accent/25 text-fg'
      : 'border-border bg-accent/10 text-fg-secondary hover:border-border-strong hover:bg-accent/16 hover:text-fg';
  }
  // Skipped and never-reached stages are hatched rather than coloured: they occupy a slot
  // in the sequence without occupying time, and the difference has to be visible at a
  // glance or the rail reads as though the run was eight equal steps.
  return cn(
    'border-dashed text-fg-muted hover:text-fg-secondary',
    selected ? 'border-border-strong bg-surface-overlay' : 'border-border bg-surface',
  );
}

export function StageRail({
  stages,
  durationMs,
  selected,
  onSelect,
  failure,
  className,
}: StageRailProps) {
  const ran = stages.filter((stage) => stage.status === 'ran');
  const skipped = stages.filter((stage) => stage.status === 'skipped');
  const heaviest = ran.reduce<StageRun | undefined>(
    (worst, stage) => (!worst || stage.durationMs > worst.durationMs ? stage : worst),
    undefined,
  );

  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-fg-muted text-xs font-medium tracking-widest uppercase">
          Stage rail
        </h2>
        <p className="text-fg-muted text-xs">
          {formatDuration(durationMs)} total
          {heaviest ? (
            <>
              {' '}
              &middot;{' '}
              <span className="text-fg-secondary">
                {heaviest.title} is {Math.round(heaviest.share * 100)}% of it
              </span>
            </>
          ) : null}
          {skipped.length > 0 ? ` · ${skipped.length} skipped` : null}
        </p>
      </div>

      <ol className="flex min-w-0 items-stretch gap-1" aria-label="Page load stages">
        {stages.map((stage) => {
          const failed = failure?.stage === stage.id;
          const isSelected = selected === stage.id;

          return (
            <li
              key={stage.id}
              className="flex min-w-0"
              style={{ flexGrow: Math.max(MIN_SHARE, stage.share), flexBasis: 0 }}
            >
              <button
                type="button"
                aria-pressed={isSelected}
                onClick={() => onSelect(stage.id)}
                title={stage.skipReason ?? stage.summary}
                className={cn(
                  'flex min-w-0 flex-1 flex-col justify-between gap-1 rounded-lg border px-2 py-2 text-left transition-colors',
                  focusRing,
                  toneFor(stage, failed, isSelected),
                )}
              >
                <span className="flex min-w-0 items-center gap-1">
                  {failed ? (
                    <AlertTriangle
                      aria-hidden="true"
                      className="text-state-error size-3 shrink-0"
                    />
                  ) : null}
                  {stage.status !== 'ran' && !failed ? (
                    <MinusCircle
                      aria-hidden="true"
                      className="size-3 shrink-0 opacity-70"
                    />
                  ) : null}
                  <span className="truncate text-xs font-medium">{stage.title}</span>
                </span>

                <span className="block font-mono text-[0.625rem] tabular-nums opacity-90">
                  {stage.status === 'ran' ? formatDuration(stage.durationMs) : '--'}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <p className="text-fg-muted text-[0.6875rem] leading-relaxed">
        Widths are each stage&rsquo;s real share of the run, with a floor so a
        fifth-of-a-millisecond stage stays clickable. Hatched segments took no time: they
        were skipped, or the run ended before them. Pick one to open it.
      </p>
    </div>
  );
}
