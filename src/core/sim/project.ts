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
  const now = Number.isFinite(t) ? Math.max(0, t) : 0;

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
        const elapsed = now - event.at;
        // Half-open `[at, at + durationMs)`: at the arrival instant the packet is at the
        // far node, not on the wire, so it does not overlap the next hop's departure.
        if (event.durationMs > 0) {
          if (elapsed >= event.durationMs) break;
          inFlight.push({
            pduId: event.pduId,
            linkId: event.linkId,
            from: event.from,
            to: event.to,
            progress: elapsed / event.durationMs,
          });
        } else if (elapsed === 0) {
          // A zero-duration hop crosses the link instantaneously; it is only ever on the
          // wire at the one instant it is sent, and it is already all the way across.
          inFlight.push({
            pduId: event.pduId,
            linkId: event.linkId,
            from: event.from,
            to: event.to,
            progress: 1,
          });
        }
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
