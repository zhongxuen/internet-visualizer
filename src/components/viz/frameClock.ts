'use client';

import { createContext, useContext } from 'react';

/**
 * The playhead, readable without a render.
 *
 * Everything on the canvas is a pure function of virtual time, and almost all of it
 * changes only when the playhead crosses an event -- a few dozen times in a whole run.
 * Packet positions are the exception: they move on every one of the sixty frames a
 * second the loop produces. Routing that through React state means a render, a
 * reconciliation of the whole diagram and a forced layout per frame, which is what the
 * phase-14 profile found the frame time going on.
 *
 * So packets do not get their position as a prop. They get this, subscribe to it, and
 * write their own `transform` between renders. Nothing else about the architecture
 * changes: position is still `progress` of the way along the wire, still derived from
 * the one number the playback store holds, still exact when scrubbed backwards. The
 * derivation simply stops going through React on its way to the DOM.
 *
 * `SimulationView` provides one, backed by its playback store. It is optional
 * everywhere: a `SimulationCanvas` rendered on its own -- a still frame, a test -- finds
 * no clock and draws each packet at the `progress` it was handed, exactly as before.
 */
export interface FrameClock {
  /** Virtual milliseconds right now. Safe to call during a layout effect. */
  now(): number;
  /**
   * Run `listener` whenever virtual time changes, until the returned function is called.
   *
   * A listener must not set React state: this fires on every animation frame, and the
   * whole point of the interface is that a frame costs no render.
   */
  subscribe(listener: (virtualTime: number) => void): () => void;
}

export const FrameClockContext = createContext<FrameClock | null>(null);

/** The surrounding view's playhead, or `null` when there is no playback driving one. */
export function useFrameClock(): FrameClock | null {
  return useContext(FrameClockContext);
}
