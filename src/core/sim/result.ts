/**
 * `SimResult` -- what a finished simulation hands to the renderer.
 *
 * A simulation runs a protocol script on a virtual clock and stops. What it produces is
 * this: an ordered event list, a derived phase index for the stepper, the total virtual
 * duration, and every PDU it created keyed by id. Nothing here knows how any of it is
 * drawn -- `projectAt` in `./project.ts` turns a `SimResult` plus a time into a frame.
 *
 * Specified in docs/implementation/03-simulation-core.md. The kernel that *produces* one
 * (`simulation.ts`, `builder.ts`) arrives with the rest of phase 03; this file is the
 * type contract both halves compile against, so the visualization layer can be built and
 * tested against hand-authored results in the meantime.
 */

import type { PDU } from '../types/pdu';
import type { SimEvent } from '../types/events';

/**
 * One chapter of the story, with its extent on the timeline.
 *
 * Derived from the `phase` events rather than authored separately: a scenario says
 * "a phase starts here" and the boundaries fall out of where the next one starts. The
 * stepper, the timeline markers, and `stepForward`/`stepBack` all navigate this list,
 * which is why it carries `startMs`/`endMs` that the raw event does not.
 */
export interface PhaseSummary {
  /** Position in `SimResult.phases`, so a stepper can move by index without a lookup. */
  index: number;
  /** The `phase` event's `id`, stable across runs -- safe to put in a URL or a test. */
  id: string;
  /** Short human title, e.g. `'TCP handshake'`. */
  title: string;
  /** One or two sentences explaining what happens in this phase. */
  description: string;
  /** Virtual millisecond the phase begins; equal to the `phase` event's `at`. */
  startMs: number;
  /**
   * Virtual millisecond the phase ends -- the next phase's `startMs`, or the
   * simulation's `durationMs` for the last phase. Treated as a half-open interval
   * `[startMs, endMs)` everywhere, so exactly one phase is current at any time.
   */
  endMs: number;
}

/**
 * The complete output of one simulation run.
 *
 * Deterministic by contract: the same scenario and seed produce a deep-equal
 * `SimResult`, which is what lets tests compare two runs with `toEqual`.
 */
export interface SimResult {
  /** Every event, sorted by `at` (non-decreasing). */
  events: SimEvent[];
  /** The phase index derived from the `phase` events; see `summarizePhases`. */
  phases: PhaseSummary[];
  /** Total virtual duration in milliseconds -- the far end of the timeline. */
  durationMs: number;
  /** Every PDU the run created, keyed by `PDU.id`, so events can refer to one by id. */
  pdus: Record<string, PDU>;
}

/**
 * Build the phase index from an event list.
 *
 * The one place phase boundaries are computed, so the kernel and any hand-authored
 * result agree on them. Phases are taken in the order they appear in `events`; each one
 * ends where the next begins, and the last ends at `durationMs` (or at its own start, if
 * the run is shorter than its final phase -- an empty phase is preferable to a negative
 * one).
 */
export function summarizePhases(
  events: readonly SimEvent[],
  durationMs: number,
): PhaseSummary[] {
  const starts = events.filter((event) => event.kind === 'phase');

  return starts.map((event, index) => {
    const next = starts[index + 1];
    const endMs = next ? next.at : Math.max(durationMs, event.at);

    return {
      index,
      id: event.id,
      title: event.title,
      description: event.description,
      startMs: event.at,
      endMs,
    };
  });
}
