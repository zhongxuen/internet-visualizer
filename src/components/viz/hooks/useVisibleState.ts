'use client';

import { useMemo, useState } from 'react';

import {
  inFlightAt,
  projectAt,
  projectionKey,
  type InFlightPacket,
  type VisualState,
} from '@/core/sim/project';
import type { SimResult } from '@/core/sim/result';
import { useReducedMotionSafe } from '@/components/motion';

import { usePlaybackContext, usePlaybackState } from './usePlayback';

/**
 * What to draw right now.
 *
 * The whole hook is `projectAt(result, virtualTime)` plus the reduced-motion policy. It
 * computes nothing itself, which is the point: the projection is a pure function in
 * `src/core` with its own tests, and this is the few dozen lines that let React call it.
 *
 * ## Why it caches
 *
 * `projectAt` is a linear pass that allocates a fresh `nodeStates` map, a fresh
 * annotation list and a fresh `log` array holding every event so far. Running it on
 * every animation frame is cheap enough in isolation, but the *identities* it returns
 * are not: a new `nodeStates` object sixty times a second means React Flow re-adopts
 * every node, the inspector re-renders, and the topology list rebuilds -- which is
 * where the frame time actually went before phase 14's performance pass.
 *
 * So the frame is split the way `projectionCursor` splits it. Everything except packet
 * positions is fixed by which events have happened and which phase is in force, and
 * that moves a few dozen times in a whole run rather than sixty times a second.
 * `projectionKey` collapses those two facts to one number, so an ordinary `useMemo`
 * holds the projection -- and with it the identity of `nodeStates`, `log`,
 * `activeAnnotations` and `currentPhase` -- still between events. There is no mutable
 * cache here to get wrong: the memo key is a pure function of `result` and `t`.
 *
 * Only `inFlight` is recomputed each frame, because `progress` is the one thing that
 * genuinely moves between events.
 *
 * The result is identical to calling `projectAt` every frame; the tests assert that
 * against the uncached function, here and in `core/sim/__tests__/project.test.ts`.
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

  // Packets are the one thing that moves between events, so they are recomputed every
  // frame -- returning a stale `progress` here would freeze them mid-wire, and would be
  // wrong for a scrub that lands between two events.
  const raw = inFlightAt(result, virtualTime);
  const inFlight = reduced && raw.length > 0 ? snapToEndpoints(raw) : raw;

  // One number standing for "which events have happened and which phase is in force".
  // It holds still between events, so the projection below -- and with it the identity
  // of `nodeStates`, `log`, `activeAnnotations` and `currentPhase` -- holds still too.
  const key = projectionKey(result, virtualTime);
  const projected = useMemo(() => projectAt(result, key), [result, key]);

  return { ...projected, inFlight };
}

/**
 * The playhead, as a value that only changes when something discrete does.
 *
 * For a module panel that follows the run -- a ledger row, a table of bindings, the
 * packet currently being built. Every one of those asks the same kind of question of the
 * playhead: *which events have happened by now?* None of them can tell the difference
 * between two times with the same answer, so none of them should re-render between them.
 *
 * Subscribing to `virtualTime` re-renders the panel sixty times a second to draw the same
 * thing. Subscribing to this re-renders it a few dozen times in a whole run, because the
 * selector runs every frame but the value it returns holds still -- and `usePlaybackState`
 * compares before it renders.
 *
 * The number is a virtual time, so it drops straight into whatever the panel already
 * calls -- but only where the derivation compares against an **event's** `at` and nothing
 * else. That condition is narrower than it looks, and getting it wrong is silent: the
 * panel simply lags a beat behind the run. Two real examples from Packet Journey, both
 * pinned in `ledger.test.ts`:
 *
 * - a packet stops being in flight at `at + durationMs`, and an arrival emits no event,
 *   so `focusAt` would stay on "in flight" until the next one fired;
 * - a NAT binding's `createdAt` is a moment inside the translation, not an entry in the
 *   event list, so a binding would appear late.
 *
 * Anything continuous is out of the question for the same reason -- a progress bar, a
 * packet's position, a clock readout would all visibly freeze between events. Those read
 * `virtualTime`, or the `FrameClock` if they must not cost a render.
 */
export function usePlayheadCursor(result: SimResult): number {
  const store = usePlaybackContext();
  return usePlaybackState(store, (state) => projectionKey(result, state.virtualTime));
}

/**
 * Which packets are on the wire, ignoring how far along they are.
 *
 * Membership changes when a packet is sent or arrives -- a few dozen times in a run.
 * `progress` changes on every frame.
 */
function membershipOf(inFlight: readonly InFlightPacket[]): string {
  if (!inFlight.length) return '';
  return inFlight.map((p) => `${p.pduId}@${p.linkId}:${p.startMs}`).join('|');
}

/**
 * `inFlight`, held still for as long as the same packets are travelling.
 *
 * The sprites position themselves from the `FrameClock`, so once the *set* of packets on
 * the wire is unchanged nothing downstream needs a fresh array -- and handing
 * `SimulationCanvas` a new one every frame is what stops it being memoized. Only use this
 * where a clock is in context; without one the caller is driving `progress` by hand and
 * every array has to be passed through as it arrives.
 *
 * Worth knowing before this is cited as a performance fix: it is not one. Memoizing the
 * canvas on top of it measured no change at all on the page that needed it
 * (`/packet-journey`, still ~2 fps). It is here because a value that changes sixty times
 * a second when the thing it describes changes twice a hop is the wrong value to pass,
 * and because it puts the stabilization in one place instead of inside the canvas. The
 * page that is slow is slow for a reason nobody has found yet -- see CLAUDE.md,
 * "Performance".
 */
export function useSteadyPackets(
  inFlight: readonly InFlightPacket[],
): readonly InFlightPacket[] {
  const key = membershipOf(inFlight);
  const [held, setHeld] = useState<{ key: string; packets: readonly InFlightPacket[] }>({
    key,
    packets: inFlight,
  });

  // React's "adjust state while rendering" pattern. An effect would be a frame late --
  // the canvas would paint once with the previous packet set before catching up.
  if (held.key !== key) setHeld({ key, packets: inFlight });

  return held.key === key ? held.packets : inFlight;
}
