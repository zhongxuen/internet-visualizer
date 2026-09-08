/**
 * `projectAt` -- the heart of the visualization layer.
 *
 * Everything on screen at virtual time `t` is a **pure function of `t`**. There is no
 * accumulated animation state anywhere: no component advances a packet a little each
 * frame, no store remembers which nodes lit up. The playback loop moves a single number
 * and calls this; components render what comes back.
 *
 * That is what makes scrubbing backwards work for free -- seeking to `t` and arriving at
 * `t` by playing forward produce the same object, because neither path is a path, only
 * an evaluation. It is also why this lives in `src/core`: no React, no DOM, no timers,
 * unit-testable in a node environment.
 *
 * Specified in docs/implementation/04-visualization-layer.md.
 */

import type { NodeState, RfcRef, SimEvent } from '../types/events';
import type { PhaseSummary, SimResult } from './result';

/**
 * A PDU currently on a link, with how far along it is.
 *
 * `progress` is positional interpolation input, not a CSS animation: the renderer places
 * the sprite at `progress` of the way down the edge path and nothing more. Snapping it to
 * 0 or 1 is all that reduced-motion mode has to do.
 */
export interface InFlightPacket {
  /** `PDU.id` of the thing travelling; look the PDU itself up in `SimResult.pdus`. */
  pduId: string;
  /** `SimLink.id` being traversed -- the edge to draw it on. */
  linkId: string;
  /** `SimNode.id` the packet left, i.e. the end of the link `progress` measures from. */
  from: string;
  /** `SimNode.id` it is heading to. */
  to: string;
  /** How far across, `0` at the moment of departure to `1` at arrival. */
  progress: number;
  /**
   * Virtual millisecond the packet left `from` -- the `transmit` event's `at`.
   *
   * Carried alongside `progress` rather than instead of it so that a renderer can
   * recompute the position itself at any time without another projection. That is what
   * lets the packet sprites follow the playhead without a React render per frame
   * (`PacketSprite`); a still frame still just reads `progress`.
   */
  startMs: number;
  /** How long the hop takes, in virtual milliseconds. `0` for an instantaneous hop. */
  durationMs: number;
}

/**
 * A teaching note currently pinned to something on screen.
 *
 * Derived from `annotate` events. An annotation belongs to the phase it was emitted in
 * and stays up for the rest of it -- notes explain the chapter they appear in, and
 * expiring them at the phase boundary keeps the canvas from silting up with every note
 * the run has ever produced.
 */
export interface Annotation {
  /**
   * Stable identity for list reconciliation, derived from the event's position in
   * `SimResult.events` (`'annotation-7'`). Deterministic for a deterministic result,
   * which is what a React `key` needs it to be.
   */
  id: string;
  /** Id of whatever this explains: a `SimNode`, a `SimLink`, or a `PDU`. */
  targetId: string;
  /** The note itself. */
  text: string;
  /** Optional citation into the standards documents. */
  reference?: RfcRef;
  /** Virtual millisecond the note appeared, for ordering and for the event log. */
  at: number;
}

/** Everything that is on screen at one virtual instant. */
export interface VisualState {
  /**
   * Highlight state per node, keyed by `SimNode.id`.
   *
   * The key set is every node any `node-state` event in the run ever names -- it does not
   * grow or shrink as `t` moves, so a renderer can rely on the shape being stable.
   * A node is `'idle'` until its first state event, and holds the last state set at or
   * before `t` after that. Nodes the simulation never comments on are simply absent;
   * treat absent as `'idle'`.
   */
  nodeStates: Record<string, NodeState>;
  /** Every PDU on a wire right now, in the order its `transmit` events were emitted. */
  inFlight: InFlightPacket[];
  /** The phase containing `t`, or `undefined` before the first phase begins. */
  currentPhase?: PhaseSummary;
  /** Notes belonging to the current phase that have already appeared. */
  activeAnnotations: Annotation[];
  /** Every event with `at <= t`, in result order -- the log, and the seek targets. */
  log: SimEvent[];
}

/**
 * The packet a `transmit` event puts on the wire at `now`, or `null` if it is not on it.
 *
 * The single definition of the half-open `[at, at + durationMs)` rule, so `projectAt`
 * and `inFlightAt` below cannot drift apart: at the arrival instant the packet is at the
 * far node, not on the wire, and so does not overlap the next hop's departure.
 */
function packetOnWire(
  event: Extract<SimEvent, { kind: 'transmit' }>,
  now: number,
): InFlightPacket | null {
  const elapsed = now - event.at;
  if (elapsed < 0) return null;

  const base = {
    pduId: event.pduId,
    linkId: event.linkId,
    from: event.from,
    to: event.to,
    startMs: event.at,
    durationMs: event.durationMs,
  };

  if (event.durationMs > 0) {
    if (elapsed >= event.durationMs) return null;
    return { ...base, progress: elapsed / event.durationMs };
  }

  // A zero-duration hop crosses the link instantaneously; it is only ever on the wire at
  // the one instant it is sent, and it is already all the way across.
  return elapsed === 0 ? { ...base, progress: 1 } : null;
}

/** `t` as `projectAt` reads it: clamped at 0 below, and never `NaN`. */
function normalizeTime(t: number): number {
  return Number.isFinite(t) ? Math.max(0, t) : 0;
}

/**
 * Just the packets on a wire at `t`.
 *
 * The one part of a `VisualState` that changes on **every** frame rather than only when
 * the playhead crosses an event: `nodeStates`, the log, the annotations and the current
 * phase are all fixed by `projectionCursor` below, but a packet's `progress` is a
 * continuous function of `t`. Playback recomputes this each frame and the rest only when
 * the cursor moves -- see `useVisibleState`.
 *
 * Equivalent to `projectAt(result, t).inFlight`, and asserted to be in the tests.
 */
export function inFlightAt(result: SimResult, t: number): InFlightPacket[] {
  const now = normalizeTime(t);
  const inFlight: InFlightPacket[] = [];

  for (const event of result.events) {
    // Sorted by `at`, so the first event past `now` ends the search.
    if (event.at > now) break;
    if (event.kind !== 'transmit') continue;
    const packet = packetOnWire(event, now);
    if (packet) inFlight.push(packet);
  }

  return inFlight;
}

/**
 * Index of the phase containing `time`, or `-1` before the first phase starts.
 *
 * Phases are half-open `[startMs, endMs)`, so a `time` landing exactly on a boundary
 * belongs to the phase beginning there. Past the end of the run the last phase stays
 * current: the timeline stops, it does not empty out.
 */
function phaseIndexAt(phases: readonly PhaseSummary[], time: number): number {
  let index = -1;
  for (const phase of phases) {
    if (phase.startMs <= time) index = phase.index;
    else break;
  }
  return index;
}

/**
 * What is on screen at virtual time `t`.
 *
 * Pure: same `result` and same `t` in, deep-equal `VisualState` out, with no dependence
 * on call order. `t` is clamped at 0 below; above `result.durationMs` it is left alone,
 * and the projection naturally settles -- every event has fired, nothing is in flight,
 * and the last phase remains current.
 */
export function projectAt(result: SimResult, t: number): VisualState {
  const now = normalizeTime(t);

  // Seed the key set from the whole run, not from the events so far, so that the shape of
  // `nodeStates` does not depend on `t`.
  const nodeStates: Record<string, NodeState> = {};
  for (const event of result.events) {
    if (event.kind === 'node-state' && nodeStates[event.nodeId] === undefined) {
      nodeStates[event.nodeId] = 'idle';
    }
  }

  const currentPhaseIndex = phaseIndexAt(result.phases, now);
  const currentPhase = result.phases[currentPhaseIndex];

  const inFlight: InFlightPacket[] = [];
  const activeAnnotations: Annotation[] = [];
  const log: SimEvent[] = [];

  result.events.forEach((event, index) => {
    if (event.at > now) return;
    log.push(event);

    switch (event.kind) {
      case 'node-state':
        // Last write at or before `t` wins; events are sorted, so plain assignment folds.
        nodeStates[event.nodeId] = event.state;
        break;

      case 'transmit': {
        const packet = packetOnWire(event, now);
        if (packet) inFlight.push(packet);
        break;
      }

      case 'annotate': {
        if (phaseIndexAt(result.phases, event.at) !== currentPhaseIndex) break;
        const annotation: Annotation = {
          id: `annotation-${index}`,
          targetId: event.targetId,
          text: event.text,
          at: event.at,
        };
        if (event.reference) annotation.reference = event.reference;
        activeAnnotations.push(annotation);
        break;
      }

      default:
        break;
    }
  });

  const state: VisualState = { nodeStates, inFlight, activeAnnotations, log };
  // Assigned conditionally rather than as `undefined`, so that a state before the first
  // phase deep-equals one built without the key at all.
  if (currentPhase) state.currentPhase = currentPhase;
  return state;
}

/**
 * The two indices that decide everything in a `VisualState` except packet positions.
 *
 * Playback moves `t` sixty times a second, but almost nothing on screen changes that
 * often: the node highlights, the log, the pinned annotations and the current phase only
 * change when the playhead crosses an event or a phase boundary, which happens a few
 * dozen times in a whole run. This is the cheap test for that.
 *
 * **The contract:** two times with an equal cursor produce deep-equal `nodeStates`,
 * `log`, `activeAnnotations` and `currentPhase`. They do *not* produce equal `inFlight`
 * -- a packet's `progress` moves continuously between events, which is why `inFlightAt`
 * is separate. `useVisibleState` relies on exactly this split to reuse the previous
 * frame's objects, and `__tests__/project.test.ts` asserts it.
 *
 * Both searches are binary rather than linear because this runs every frame while the
 * projection it guards no longer does.
 */
export interface ProjectionCursor {
  /** How many of `result.events` have `at <= t`; the length of `VisualState.log`. */
  eventCount: number;
  /** Index of the phase containing `t`, or `-1` before the first phase begins. */
  phaseIndex: number;
}

/**
 * Number of leading items of `sorted` whose time is `<= now`.
 *
 * `sorted` must be non-decreasing in `timeOf`, which both `SimResult.events` (by
 * contract) and `SimResult.phases` (derived from them) are.
 */
function countAtOrBefore<T>(
  sorted: readonly T[],
  now: number,
  timeOf: (item: T) => number,
): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (timeOf(sorted[mid]!) <= now) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** See `ProjectionCursor`. Pure, and cheap enough to call on every animation frame. */
export function projectionCursor(result: SimResult, t: number): ProjectionCursor {
  const now = normalizeTime(t);
  return {
    eventCount: countAtOrBefore(result.events, now, (event) => event.at),
    phaseIndex: countAtOrBefore(result.phases, now, (phase) => phase.startMs) - 1,
  };
}

/**
 * A time that projects to the same discrete state as `t`, and the same for every `t`
 * that shares its cursor.
 *
 * The cursor is two numbers, which makes it awkward as a cache key. This is the same
 * fact as one number: the later of the last event reached and the start of the phase in
 * force -- the instant the current cursor came into being. Every `t` from there until
 * the next event or phase boundary maps to it, so
 *
 * ```ts
 * useMemo(() => projectAt(result, projectionKey(result, t)), [result, projectionKey(result, t)])
 * ```
 *
 * recomputes the projection only when something discrete actually changed, with no
 * mutable cache to get wrong. `projectAt(result, projectionKey(result, t))` agrees with
 * `projectAt(result, t)` on everything except `inFlight`; that is the same guarantee
 * `ProjectionCursor` documents, and the tests assert it directly.
 */
export function projectionKey(result: SimResult, t: number): number {
  const { eventCount, phaseIndex } = projectionCursor(result, t);
  const lastEvent = eventCount > 0 ? result.events[eventCount - 1]!.at : 0;
  const phaseStart = phaseIndex >= 0 ? result.phases[phaseIndex]!.startMs : 0;
  return Math.max(lastEvent, phaseStart);
}
