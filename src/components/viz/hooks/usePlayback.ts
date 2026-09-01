'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

import {
  createPlayback,
  DEFAULT_SPEED,
  jumpToEnd,
  jumpToStart,
  pause as pauseState,
  play as playState,
  replayPhase as replayPhaseState,
  seek as seekState,
  setSpeed as setSpeedState,
  stepBack,
  stepEventBack,
  stepEventForward,
  stepForward,
  tick as tickState,
  timelineFrom,
  togglePlay,
  type PlaybackState,
  type PlaybackTimeline,
} from '@/core/sim/playback';
import type { SimResult } from '@/core/sim/result';
import { useReducedMotionSafe } from '@/components/motion';

import type { PlaybackCommand } from '../keymap';

/**
 * Playback, wired to React.
 *
 * This file is a *wrapper*, deliberately thin. Every rule about what play, seek, and
 * step actually do lives in `src/core/sim/playback.ts`, where it is framework-free and
 * unit-tested in a node environment. What is added here is the two things core cannot
 * have: somewhere to keep the state (a Zustand store) and something to move it (one
 * `requestAnimationFrame` loop).
 *
 * ## One loop, in one place
 *
 * `useRafLoop` below is the only `requestAnimationFrame` in the product, and it is the
 * reason the acceptance criterion "exactly one rAF loop exists in the codebase" is
 * checkable rather than aspirational (`tests/single-raf-loop.test.ts` asserts it). No
 * component owns a timer, no packet animates itself: the loop advances one number and
 * everything on screen is recomputed from it by `projectAt`.
 *
 * The loop runs only while `status === 'playing'` and is cancelled the moment it is not,
 * so a paused module costs nothing. Frame deltas are clamped: coming back to a
 * backgrounded tab hands you one enormous delta, and without the clamp the run would
 * teleport to the end instead of resuming.
 *
 * ## Store per view, not per app
 *
 * A module page owns its store and passes it down (or shares it through
 * `PlaybackContext` for slot content). A global singleton would leak one module's
 * playhead into the next and make two simulations on one page impossible.
 */

export interface PlaybackActions {
  play(): void;
  pause(): void;
  toggle(): void;
  seek(time: number): void;
  /** Advance by `deltaMs` of real time. Called by the rAF loop; nothing else should. */
  tick(deltaMs: number): void;
  /** One phase boundary in `direction`. */
  stepPhase(direction: 1 | -1): void;
  /** One event in `direction`. */
  stepEvent(direction: 1 | -1): void;
  jumpTo(edge: 'start' | 'end'): void;
  setSpeed(speed: number): void;
  replayPhase(): void;
  /** Point playback at a different run. Resets to the start. */
  setTimeline(timeline: PlaybackTimeline): void;
  /** Run a command from the keyboard map. The one path shortcuts and buttons share. */
  run(command: PlaybackCommand): void;
}

export interface PlaybackStoreState extends PlaybackState, PlaybackActions {
  timeline: PlaybackTimeline;
}

export type PlaybackStore = StoreApi<PlaybackStoreState>;

/** A transition from the core state machine. */
type Transition = (state: PlaybackState, timeline: PlaybackTimeline) => PlaybackState;

export function createPlaybackStore(
  timeline: PlaybackTimeline,
  speed: number = DEFAULT_SPEED,
): PlaybackStore {
  return createStore<PlaybackStoreState>((set, get) => {
    /**
     * Run a core transition against the current state.
     *
     * The identity check is not an optimization detail -- the core functions return the
     * *same object* when a transition is a no-op, so this is how "pressing pause twice
     * does not re-render the tree" is expressed.
     */
    const apply = (transition: Transition) => {
      const state = get();
      const next = transition(state, state.timeline);
      if (next === state) return;
      set({ status: next.status, virtualTime: next.virtualTime, speed: next.speed });
    };

    return {
      ...createPlayback(speed),
      timeline,

      play: () => apply(playState),
      pause: () => apply(pauseState),
      toggle: () => apply(togglePlay),
      seek: (time) => apply((state, line) => seekState(state, line, time)),
      tick: (deltaMs) => apply((state, line) => tickState(state, line, deltaMs)),
      stepPhase: (direction) => apply(direction === 1 ? stepForward : stepBack),
      stepEvent: (direction) => apply(direction === 1 ? stepEventForward : stepEventBack),
      jumpTo: (edge) => apply(edge === 'start' ? jumpToStart : jumpToEnd),
      setSpeed: (speed) => apply((state) => setSpeedState(state, speed)),
      replayPhase: () => apply(replayPhaseState),

      setTimeline: (next) => {
        if (next === get().timeline) return;
        // A different run is a different story: keeping the playhead would drop the
        // viewer into the middle of a simulation they have not seen the start of.
        set({ timeline: next, ...createPlayback(get().speed) });
      },

      run: (command) => {
        const actions = get();
        switch (command.type) {
          case 'toggle':
            return actions.toggle();
          case 'step-phase':
            return actions.stepPhase(command.direction);
          case 'step-event':
            return actions.stepEvent(command.direction);
          case 'jump':
            return actions.jumpTo(command.to);
          case 'speed':
            return actions.setSpeed(command.speed);
          case 'replay-phase':
            return actions.replayPhase();
        }
      },
    };
  });
}

/**
 * Longest frame delta the loop will believe, in real milliseconds.
 *
 * `requestAnimationFrame` stops firing in a backgrounded tab and then hands you the
 * whole gap at once. Ten frames' worth is enough to absorb a slow frame or a long GC
 * pause; anything beyond it is time the viewer was not watching, and replaying it would
 * skip the part of the story they came back for.
 */
const MAX_FRAME_MS = 100;

/**
 * The product's one animation loop. See the note at the top of this file before adding
 * another `requestAnimationFrame` anywhere.
 */
function useRafLoop(store: PlaybackStore): void {
  const playing = useStore(store, (state) => state.status === 'playing');

  useEffect(() => {
    if (!playing || typeof requestAnimationFrame !== 'function') return;

    let frame = 0;
    /** `null` until the first frame: one timestamp is not yet a delta. */
    let previous: number | null = null;

    const step = (now: number) => {
      // Queued before ticking, so that a tick which ends the run leaves a frame for the
      // effect cleanup to cancel rather than one that has already fired.
      frame = requestAnimationFrame(step);
      if (previous !== null) {
        store.getState().tick(Math.min(now - previous, MAX_FRAME_MS));
      }
      previous = now;
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [playing, store]);
}

export interface UsePlaybackOptions {
  /** The run to play. Changing it resets the playhead to the start. */
  result: SimResult;
  /** Starting speed. The `1`--`5` keys and the speed control change it afterwards. */
  speed?: number;
  /**
   * Start playing on mount.
   *
   * Ignored under reduced motion: a viewer who has asked for less movement should not
   * have a diagram start moving at them. They get the same run, at rest, with the phase
   * stepper as the way in -- which is the phase-02 policy applied to playback.
   */
  autoPlay?: boolean;
}

/**
 * Create the playback store for a run and drive it.
 *
 * Call this **once** per simulation view. The store it returns is what the controls, the
 * timeline, and the canvas read from.
 */
export function usePlayback({
  result,
  speed = DEFAULT_SPEED,
  autoPlay = false,
}: UsePlaybackOptions): PlaybackStore {
  const timeline = useMemo(() => timelineFrom(result), [result]);
  const [store] = useState(() => createPlaybackStore(timeline, speed));
  const { reduced } = useReducedMotionSafe();

  useEffect(() => {
    store.getState().setTimeline(timeline);
  }, [store, timeline]);

  const shouldAutoPlay = autoPlay && !reduced;
  useEffect(() => {
    if (shouldAutoPlay) store.getState().play();
  }, [store, timeline, shouldAutoPlay]);

  useRafLoop(store);

  return store;
}

/** Read a slice of playback state. Re-renders only when the slice changes. */
export function usePlaybackState<T>(
  store: PlaybackStore,
  selector: (state: PlaybackStoreState) => T,
): T {
  return useStore(store, selector);
}

/**
 * The store for the surrounding `SimulationView`.
 *
 * For module-supplied slot content, which is rendered inside the view but written
 * outside it and so cannot be handed the store as a prop.
 */
export const PlaybackContext = createContext<PlaybackStore | null>(null);

export function usePlaybackContext(): PlaybackStore {
  const store = useContext(PlaybackContext);
  if (!store) {
    throw new Error('usePlaybackContext must be used inside a <SimulationView>.');
  }
  return store;
}
