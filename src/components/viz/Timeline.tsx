'use client';

import type { PhaseSummary } from '@/core/sim/result';
import { cn } from '@/lib/cn';

import { formatTimecode, percentOf } from './time';

/**
 * The scrubber.
 *
 * A native `<input type="range">` under the hood, on purpose. It is draggable, it is a
 * real ARIA slider, it announces its value, and its arrow keys, `Home`, and `End` already
 * do the right thing -- the keyboard map hands those back to it whenever it has focus
 * (`shouldIgnoreKey`) rather than moving the playhead twice.
 *
 * Phase markers sit on their own rail above the track, as focusable buttons. That is the
 * other half of "navigable without a pointer": tab to a phase, press it, and playback
 * jumps to the moment that chapter begins. They are deliberately *not* overlaid on the
 * slider, where they would swallow drags aimed at the thumb.
 *
 * Everything here is virtual time. The numbers do not change when the speed control does.
 */

export interface TimelineProps {
  /** Far end of the run, in virtual milliseconds. */
  durationMs: number;
  /** Where the playhead is now. */
  virtualTime: number;
  /** Phase boundaries to mark. */
  phases: readonly PhaseSummary[];
  /** Index of the phase containing the playhead, or `-1` before the first one. */
  currentPhaseIndex?: number;
  onSeek: (time: number) => void;
  className?: string;
}

/**
 * Slider granularity: one two-hundredth of the run.
 *
 * Fine enough that dragging feels continuous, coarse enough that an arrow key is a
 * visible move on a run of any length -- a fixed 1 ms step would take five thousand
 * presses to cross a five second timeline.
 */
function stepFor(durationMs: number): number {
  return durationMs > 0 ? durationMs / 200 : 1;
}

const THUMB =
  '[&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-surface [&::-webkit-slider-thumb]:bg-accent ' +
  '[&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-surface [&::-moz-range-thumb]:bg-accent';

export function Timeline({
  durationMs,
  virtualTime,
  phases,
  currentPhaseIndex = -1,
  onSeek,
  className,
}: TimelineProps) {
  const elapsed = percentOf(virtualTime, durationMs);
  const empty = durationMs <= 0;

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="relative h-5" aria-hidden={phases.length === 0}>
        {phases.map((phase) => (
          <button
            key={phase.id}
            type="button"
            onClick={() => onSeek(phase.startMs)}
            style={{ left: `${percentOf(phase.startMs, durationMs)}%` }}
            aria-current={phase.index === currentPhaseIndex ? 'step' : undefined}
            aria-label={`Phase ${phase.index + 1}, ${phase.title}, at ${formatTimecode(phase.startMs, durationMs)}`}
            title={`${phase.title} (${formatTimecode(phase.startMs, durationMs)})`}
            className={cn(
              'focus-visible:outline-focus absolute bottom-0 flex h-5 w-4 -translate-x-1/2 items-end justify-center rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2',
              'group',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'block h-2.5 w-0.5 rounded-full transition-colors',
                phase.index === currentPhaseIndex
                  ? 'bg-accent h-3.5'
                  : 'bg-border-strong group-hover:bg-fg-secondary',
              )}
            />
          </button>
        ))}
      </div>

      <div className="relative flex h-4 items-center">
        {/* Track and fill are decorative: the slider below carries the semantics. */}
        <div
          aria-hidden="true"
          className="bg-surface-overlay border-border absolute inset-x-0 h-1.5 rounded-full border"
        />
        <div
          aria-hidden="true"
          style={{ width: `${elapsed}%` }}
          className="bg-accent absolute left-0 h-1.5 rounded-full"
        />

        <input
          type="range"
          min={0}
          max={empty ? 1 : durationMs}
          step={stepFor(durationMs)}
          value={virtualTime}
          disabled={empty}
          onChange={(event) => onSeek(Number(event.target.value))}
          aria-label="Playback position"
          aria-valuetext={`${formatTimecode(virtualTime, durationMs)} of ${formatTimecode(durationMs, durationMs)}`}
          className={cn(
            'relative w-full cursor-pointer appearance-none bg-transparent',
            'focus-visible:outline-focus focus-visible:outline-2 focus-visible:outline-offset-4',
            'disabled:cursor-not-allowed',
            THUMB,
          )}
        />
      </div>

      <div className="text-fg-muted flex justify-between font-mono text-[0.6875rem]">
        <span>{formatTimecode(virtualTime, durationMs)}</span>
        <span>{formatTimecode(durationMs, durationMs)}</span>
      </div>
    </div>
  );
}
