'use client';

import { useLayoutEffect, useRef } from 'react';

import type { PhaseSummary } from '@/core/sim/result';
import { cn } from '@/lib/cn';

import { useFrameClock } from './frameClock';
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
 *
 * ## Why the playhead is written by hand
 *
 * This is the one control that genuinely moves on every frame, and the obvious way to
 * write it is the expensive one. `width: 42%` on the fill invalidates layout; setting the
 * slider's `value` and its `aria-valuetext`, and rewriting the elapsed timecode, do the
 * same to the layout and the accessibility tree. Sixty times a second that is a
 * document-wide cost rather than a timeline-sized one, which is the shape phase 14's
 * measurements kept finding.
 *
 * So when a `FrameClock` is in context, React renders this once and the effect below
 * writes the moving parts itself: `transform: scaleX()` for the fill, which the compositor
 * handles without a reflow, and the slider left uncontrolled so React never touches its
 * value. The two accessible strings -- `aria-valuetext` and the printed timecode -- are
 * updated only when the *displayed* time actually changes, which is what they describe.
 *
 * Honest about what this bought: on its own it moved `/packet-journey` from 1.8 to 2.2
 * fps under a 4x CPU throttle, so it is not what is wrong with that page (see CLAUDE.md,
 * "Performance"). It is here because a per-frame write that does not touch layout is the
 * correct shape regardless, and because it removes one candidate from that hunt.
 *
 * Without a clock (a timeline rendered on its own, a test) nothing changes: it is the
 * controlled component it always was.
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

  const clock = useFrameClock();
  const fillRef = useRef<HTMLDivElement | null>(null);
  const sliderRef = useRef<HTMLInputElement | null>(null);
  const elapsedRef = useRef<HTMLSpanElement | null>(null);
  const total = formatTimecode(durationMs, durationMs);

  useLayoutEffect(() => {
    if (!clock) return;

    let printed: string | null = null;

    const apply = (time: number) => {
      const fraction = durationMs > 0 ? Math.min(1, Math.max(0, time / durationMs)) : 0;
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${fraction})`;
      if (sliderRef.current) sliderRef.current.value = String(time);

      // The playhead moves continuously; the timecode it is printed as does not. Writing
      // the text and the accessible value only when that string changes keeps both exact
      // while costing a DOM write a few times a second instead of sixty.
      const text = formatTimecode(time, durationMs);
      if (text === printed) return;
      printed = text;
      if (elapsedRef.current) elapsedRef.current.textContent = text;
      sliderRef.current?.setAttribute('aria-valuetext', `${text} of ${total}`);
    };

    apply(clock.now());
    return clock.subscribe(apply);
  }, [clock, durationMs, total]);

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
        {/*
          Full width, scaled down: `transform` is a compositor property, so the playhead
          advancing does not dirty the page's layout. See the note at the top of the file.
        */}
        <div
          ref={fillRef}
          aria-hidden="true"
          style={{
            transform: `scaleX(${Math.min(1, Math.max(0, elapsed / 100))})`,
            transformOrigin: 'left center',
          }}
          className="bg-accent absolute inset-x-0 h-1.5 rounded-full"
        />

        <input
          ref={sliderRef}
          type="range"
          min={0}
          max={empty ? 1 : durationMs}
          step={stepFor(durationMs)}
          // Uncontrolled while a clock is driving it, so React never writes `value` and
          // the effect above is the only thing that moves the thumb. Controlled without
          // one, exactly as before.
          {...(clock ? { defaultValue: virtualTime } : { value: virtualTime })}
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
        <span ref={elapsedRef}>{formatTimecode(virtualTime, durationMs)}</span>
        <span>{total}</span>
      </div>
    </div>
  );
}
