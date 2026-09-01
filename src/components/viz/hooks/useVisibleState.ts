'use client';

import { useMemo } from 'react';

import { projectAt, type InFlightPacket, type VisualState } from '@/core/sim/project';
import type { SimResult } from '@/core/sim/result';
import { useReducedMotionSafe } from '@/components/motion';

/**
 * What to draw right now.
 *
 * The whole hook is `projectAt(result, virtualTime)` plus the reduced-motion policy. It
 * computes nothing itself, which is the point: the projection is a pure function in
 * `src/core` with its own tests, and this is the twenty lines that let React call it.
 *
 * Recomputed every frame while playing -- deliberately. `projectAt` is a linear pass
 * over the event list with no allocation per node, and paying it each frame is what
 * makes reverse scrubbing exact: there is no accumulated state to unwind, because there
 * is no accumulated state.
 */

/**
 * Reduced motion: a packet is at one end of the wire or the other, never between.
 *
 * The phase-02 policy is "no tweening, nothing hidden". A packet still exists, still
 * belongs to a link, still appears and disappears at the right moments in the timeline
 * -- it simply stops sliding. Snapping at the halfway point means stepping through a run
 * shows each hop leaving and then arriving, which is the part of the animation that
 * carries the meaning.
 */
export function snapToEndpoints(inFlight: readonly InFlightPacket[]): InFlightPacket[] {
  return inFlight.map((packet) =>
    packet.progress === 0 || packet.progress === 1
      ? packet
      : { ...packet, progress: packet.progress < 0.5 ? 0 : 1 },
  );
}

/** The frame at `virtualTime`, with the viewer's motion preference applied. */
export function useVisibleState(result: SimResult, virtualTime: number): VisualState {
  const { reduced } = useReducedMotionSafe();

  return useMemo(() => {
    const state = projectAt(result, virtualTime);
    if (!reduced || state.inFlight.length === 0) return state;
    return { ...state, inFlight: snapToEndpoints(state.inFlight) };
  }, [result, virtualTime, reduced]);
}
