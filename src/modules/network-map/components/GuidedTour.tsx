'use client';

import { Route } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { useReducedMotionSafe } from '@/components/motion';
import { usePlaybackContext, usePlaybackState } from '@/components/viz';
import { Tooltip } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import { cn } from '@/lib/cn';

import { tourStepAt, type GuidedTour as Tour, type TourStep } from '../tour';

/**
 * The switch that makes the phase stepper drive the map.
 *
 * The tour itself is not here -- it is the run (`../tour.ts`), and the phase stepper, the
 * timeline, the play button, and the `->` key are already walking it. What this adds is
 * the one thing a *map* tour needs that a packet animation does not: the camera. With the
 * switch on, every stop selects the machine it is about and brings it into view, so the
 * explanation in the stepper always has the thing it is explaining on screen next to it.
 *
 * With the switch off nothing is taken away. The stops are still phases, the stepper
 * still seeks, and the map is free to be explored by hand -- the camera simply stays
 * where the user put it.
 *
 * ## Reduced motion
 *
 * Starting the tour does not start playback for anyone who has asked for less movement:
 * a diagram that begins panning by itself is exactly what that preference is about. They
 * get the same tour, at rest, advanced by the stepper or the arrow keys, and each stop
 * still selects and frames its machine -- `SimulationCanvas` jumps the viewport rather
 * than gliding it.
 *
 * Rendered inside `SimulationView`'s `controlPanel` slot, which sits inside
 * `PlaybackContext` -- that is how it reads the playhead and seeks without the view
 * needing a prop for it.
 */

export interface GuidedTourProps {
  tour: Tour;
  /** `true` while the map follows the playhead. */
  following: boolean;
  onFollowingChange: (next: boolean) => void;
  /** Fired when the stop changes while following: select it and frame it. */
  onStep: (step: TourStep) => void;
  className?: string;
}

export function GuidedTour({
  tour,
  following,
  onFollowingChange,
  onStep,
  className,
}: GuidedTourProps) {
  const store = usePlaybackContext();
  const virtualTime = usePlaybackState(store, (state) => state.virtualTime);
  const { reduced } = useReducedMotionSafe();

  const step = tourStepAt(tour, virtualTime);
  const total = tour.steps.length;

  // Held in a ref so the effect below can depend on *which stop* rather than on the
  // identity of a callback: the parent re-renders on every frame of playback, and a fresh
  // handler each time would re-aim the camera sixty times a second.
  const onStepRef = useRef(onStep);
  useEffect(() => {
    onStepRef.current = onStep;
  }, [onStep]);

  const stepId = following ? step?.id : undefined;
  useEffect(() => {
    if (!stepId) return;
    const current = tour.steps.find((entry) => entry.id === stepId);
    if (current) onStepRef.current(current);
  }, [stepId, tour]);

  const start = () => {
    const { seek, play } = store.getState();
    seek(0);
    // Auto-advance is movement, and movement is what reduced motion asks for less of.
    if (!reduced) play();
    onFollowingChange(true);
  };

  const stop = () => {
    store.getState().pause();
    onFollowingChange(false);
  };

  if (total === 0) return null;

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <Tooltip
        content={
          following
            ? 'The map is following the tour: each stop selects its machine and brings it into view. Turn it off to explore by hand.'
            : reduced
              ? 'Walk the network one machine at a time. Use the phase list or the arrow keys to move between stops.'
              : 'Walk the network one machine at a time, explained as it goes. Space pauses; the phase list jumps to any stop.'
        }
      >
        <button
          type="button"
          role="switch"
          aria-checked={following}
          onClick={following ? stop : start}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors',
            focusRing,
            following
              ? 'border-accent/60 bg-accent/12 text-fg'
              : 'border-border text-fg-muted hover:text-fg hover:border-border-strong',
          )}
        >
          <Route
            aria-hidden="true"
            className={cn('size-3.5', following && 'text-accent')}
          />
          Guided tour
        </button>
      </Tooltip>

      {step ? (
        <p className="text-fg-muted min-w-0 text-xs">
          <span className="font-mono">
            Stop {step.index + 1}/{total}
          </span>
          <span aria-hidden="true"> &middot; </span>
          <span className="text-fg-secondary">{step.title}</span>
        </p>
      ) : null}
    </div>
  );
}
