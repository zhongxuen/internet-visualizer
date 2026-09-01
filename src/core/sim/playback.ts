/**
 * The playback state machine -- virtual time, without React.
 *
 * Everything about "where are we in the run and is it moving" lives here, as plain
 * functions over a plain value. There is no clock in this file: nothing calls
 * `Date.now()`, nothing schedules a frame, nothing subscribes to anything. Something on
 * the outside -- one `requestAnimationFrame` loop in the visualization layer -- decides
 * that real time has passed and calls `tick`. That inversion is what makes playback
 * testable without a browser, and it is why the rules for "what does the left arrow key
 * do" are asserted in a node environment instead of by clicking.
 *
 * Every function is pure: state in, state out, no mutation. They return the *same*
 * object when nothing changed, so a store wrapping them can skip notifying subscribers.
 *
 * Specified in docs/implementation/03-simulation-core.md; wrapped by a Zustand store in
 * `src/components/viz/hooks/usePlayback.ts` (phase 04).
 */

import type { SimResult } from './result';

/**
 * The five speeds the UI offers, mapped to the `1`--`5` keys in that order.
 *
 * A fixed ladder rather than a continuous slider: the point of the control is to compare
 * a TLS handshake at 0.25x with a DNS lookup at 4x, and named steps are what make that
 * comparison repeatable between one learner and another.
 */
export const PLAYBACK_SPEEDS = [0.25, 0.5, 1, 2, 4] as const;

export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

export const DEFAULT_SPEED: PlaybackSpeed = 1;

/**
 * Where playback is.
 *
 * `idle` is "at the start, never played" and exists so the first play can be told apart
 * from a resume -- an autoplay-on-mount module and a paused-at-zero one look different
 * to the user. `ended` is a resting state at `durationMs`, not a terminal one: play from
 * there restarts the run.
 */
export type PlaybackStatus = 'idle' | 'playing' | 'paused' | 'ended';

export interface PlaybackState {
  status: PlaybackStatus;
  /** Position in the run, in **virtual** milliseconds. Always within `[0, durationMs]`. */
  virtualTime: number;
  /** Multiplier applied to real elapsed time by `tick`. Always finite and positive. */
  speed: number;
}

/**
 * The parts of a `SimResult` that navigation needs: how long the run is, and the times
 * worth stopping at.
 *
 * Derived once by `timelineFrom` rather than passed as the whole result, so the state
 * machine cannot accidentally start reading events -- and so a test can hand-write a
 * timeline in one line.
 */
export interface PlaybackTimeline {
  /** Far end of the scrubber, in virtual milliseconds. */
  durationMs: number;
  /** Phase start times, ascending. The stops that `stepForward`/`stepBack` use. */
  phaseStarts: readonly number[];
  /** Distinct event times, ascending. The finer stops, for `Shift` + arrow. */
  eventTimes: readonly number[];
}

/** A timeline with nothing on it -- the state before a result has been produced. */
export const EMPTY_TIMELINE: PlaybackTimeline = {
  durationMs: 0,
  phaseStarts: [],
  eventTimes: [],
};

/**
 * Float slack for comparing a position against a stop.
 *
 * `virtualTime` is accumulated one animation frame at a time (`t += delta * speed`), so
 * it lands on `59.999999999999994` where a phase boundary says `60`. Without a tolerance,
 * "step to the next phase" from a position that *is* the boundary would step to the
 * boundary again and playback would appear stuck. A microsecond is far below anything a
 * simulation models and far above the error this accumulates.
 */
const EPSILON = 1e-6;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  return value > max ? max : value;
}

function normalizeSpeed(speed: number): number {
  return Number.isFinite(speed) && speed > 0 ? speed : DEFAULT_SPEED;
}

/** Reduce a finished run to the numbers navigation cares about. */
export function timelineFrom(result: SimResult): PlaybackTimeline {
  const durationMs = Math.max(0, result.durationMs);

  const times = new Set<number>();
  for (const event of result.events) times.add(clamp(event.at, 0, durationMs));

  return {
    durationMs,
    phaseStarts: result.phases.map((phase) => clamp(phase.startMs, 0, durationMs)),
    eventTimes: [...times].sort((a, b) => a - b),
  };
}

export function createPlayback(speed: number = DEFAULT_SPEED): PlaybackState {
  return { status: 'idle', virtualTime: 0, speed: normalizeSpeed(speed) };
}

/** First stop strictly after `time`, or `null` if `time` is at or past the last one. */
function nextStop(stops: readonly number[], time: number): number | null {
  for (const stop of stops) if (stop > time + EPSILON) return stop;
  return null;
}

/** Last stop strictly before `time`, or `null` if `time` is at or before the first. */
function previousStop(stops: readonly number[], time: number): number | null {
  let found: number | null = null;
  for (const stop of stops) {
    if (stop < time - EPSILON) found = stop;
    else break;
  }
  return found;
}

/** Start of the phase containing `time`, or `0` before the first phase begins. */
export function currentPhaseStart(timeline: PlaybackTimeline, time: number): number {
  let start = 0;
  for (const phaseStart of timeline.phaseStarts) {
    if (phaseStart <= time + EPSILON) start = phaseStart;
    else break;
  }
  return start;
}

/** `0`..`1` position along the scrubber. `0` for a run with no duration. */
export function playbackProgress(
  state: PlaybackState,
  timeline: PlaybackTimeline,
): number {
  if (timeline.durationMs <= 0) return 0;
  return clamp(state.virtualTime / timeline.durationMs, 0, 1);
}

function statusAfterSeek(
  status: PlaybackStatus,
  time: number,
  durationMs: number,
): PlaybackStatus {
  // Landing on the far end *is* the end, however you got there -- the loop would stop
  // there on the next frame anyway, and reporting `playing` at `durationMs` would keep
  // the pause button showing for a run that cannot advance.
  if (time >= durationMs) return 'ended';
  if (status === 'playing') return 'playing';
  // A seek out of `idle` is the user taking hold of the timeline: only a seek that
  // leaves the playhead at the very start keeps "never played".
  return status === 'idle' && time <= 0 ? 'idle' : 'paused';
}

/** Move the playhead. Clamped into the run; keeps playing if it already was. */
export function seek(
  state: PlaybackState,
  timeline: PlaybackTimeline,
  time: number,
): PlaybackState {
  const virtualTime = clamp(time, 0, timeline.durationMs);
  const status = statusAfterSeek(state.status, virtualTime, timeline.durationMs);
  if (virtualTime === state.virtualTime && status === state.status) return state;
  return { ...state, virtualTime, status };
}

/**
 * Start (or resume) playing.
 *
 * From `ended`, this replays from the top: the alternative is a play button that does
 * nothing, and "watch it again" is the single most common thing a learner asks of a
 * finished animation.
 */
export function play(state: PlaybackState, timeline: PlaybackTimeline): PlaybackState {
  if (timeline.durationMs <= 0) {
    return state.status === 'ended' ? state : { ...state, status: 'ended' };
  }

  const virtualTime = state.virtualTime >= timeline.durationMs ? 0 : state.virtualTime;
  return { ...state, status: 'playing', virtualTime };
}

export function pause(state: PlaybackState): PlaybackState {
  return state.status === 'playing' ? { ...state, status: 'paused' } : state;
}

export function togglePlay(
  state: PlaybackState,
  timeline: PlaybackTimeline,
): PlaybackState {
  return state.status === 'playing' ? pause(state) : play(state, timeline);
}

/**
 * Advance by `deltaMs` of **real** time, scaled by `speed`.
 *
 * The only function that moves time on its own, and it still does not know what time it
 * is -- the caller measures the frame. Anything but `playing` ignores the tick, so a
 * loop that is a frame late shutting down cannot nudge a paused run.
 */
export function tick(
  state: PlaybackState,
  timeline: PlaybackTimeline,
  deltaMs: number,
): PlaybackState {
  if (state.status !== 'playing') return state;
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return state;

  const virtualTime = state.virtualTime + deltaMs * state.speed;
  if (virtualTime >= timeline.durationMs) {
    return { ...state, virtualTime: timeline.durationMs, status: 'ended' };
  }
  return { ...state, virtualTime };
}

/**
 * Step to a stop and stay there.
 *
 * Stepping is inspection, so it always leaves playback paused: the whole point of
 * pressing the arrow key is to look at the frame it lands on.
 */
function stepTo(
  state: PlaybackState,
  timeline: PlaybackTimeline,
  time: number,
): PlaybackState {
  return pause(seek(state, timeline, time));
}

/**
 * Forward to the next phase boundary, or to the end of the run if this is the last one.
 *
 * Phases, not events: a phase is a chapter a learner can hold in their head, and it is
 * what makes a module fully explorable by keyboard and under reduced motion. Raw events
 * are on `Shift` + arrow for when someone wants the detail.
 */
export function stepForward(
  state: PlaybackState,
  timeline: PlaybackTimeline,
): PlaybackState {
  const target = nextStop(timeline.phaseStarts, state.virtualTime);
  return stepTo(state, timeline, target ?? timeline.durationMs);
}

/** Back to the previous phase boundary -- which, from mid-phase, is this phase's start. */
export function stepBack(
  state: PlaybackState,
  timeline: PlaybackTimeline,
): PlaybackState {
  const target = previousStop(timeline.phaseStarts, state.virtualTime);
  return stepTo(state, timeline, target ?? 0);
}

/** Forward one event -- the fine-grained step, for `Shift` + right arrow. */
export function stepEventForward(
  state: PlaybackState,
  timeline: PlaybackTimeline,
): PlaybackState {
  const target = nextStop(timeline.eventTimes, state.virtualTime);
  return stepTo(state, timeline, target ?? timeline.durationMs);
}

/** Back one event. */
export function stepEventBack(
  state: PlaybackState,
  timeline: PlaybackTimeline,
): PlaybackState {
  const target = previousStop(timeline.eventTimes, state.virtualTime);
  return stepTo(state, timeline, target ?? 0);
}

export function jumpToStart(
  state: PlaybackState,
  timeline: PlaybackTimeline,
): PlaybackState {
  return stepTo(state, timeline, 0);
}

export function jumpToEnd(
  state: PlaybackState,
  timeline: PlaybackTimeline,
): PlaybackState {
  return seek(state, timeline, timeline.durationMs);
}

export function setSpeed(state: PlaybackState, speed: number): PlaybackState {
  const next = normalizeSpeed(speed);
  return next === state.speed ? state : { ...state, speed: next };
}

/**
 * Rewind to the start of the phase the playhead is in and play it again.
 *
 * The `.` key. Watching one chapter three times is how the interesting ones get
 * understood, and doing it by hand means finding the boundary on the scrubber first.
 */
export function replayPhase(
  state: PlaybackState,
  timeline: PlaybackTimeline,
): PlaybackState {
  const start = currentPhaseStart(timeline, state.virtualTime);
  return play({ ...state, virtualTime: start }, timeline);
}
