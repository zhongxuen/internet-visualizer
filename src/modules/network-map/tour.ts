/**
 * The guided tour, expressed as a simulation with no packets in it.
 *
 * A tour is an ordered walk through a topology: stop at a machine, say what it is for,
 * move on. That is the same shape as a run -- an ordered list of chapters, each with a
 * title and an explanation, that a viewer can play, pause, scrub, and step through -- so
 * it is built as a `SimResult` and handed to the same `SimulationView` every other module
 * uses. The phase stepper becomes the tour, the timeline becomes its progress bar, and
 * the keyboard map (`->` for the next phase, `Space` to play) works without a line of
 * code here.
 *
 * That reuse is deliberate, and it is the phase-05 test of the phase-04 abstraction
 * (docs/implementation/05-module-network-map.md): if the phase mechanism only worked for
 * things with packets in them, it would be an animation feature rather than a narrative
 * one. `pdus` is empty and no `transmit` event is ever emitted.
 *
 * The steps are not authored twice. `ScenarioTopology.notes` is already "the notes, in
 * the order a guided walk-through should visit them", so the tour *is* the notes -- a
 * scenario cannot gain a machine whose tour step was forgotten, and the wording a learner
 * reads in the stepper is the wording the scenario file carries.
 */

import { summarizePhases, type SimResult } from '@/core/sim/result';
import type { ScenarioTopology } from '@/core/topologies';
import type { SimEvent } from '@/core/types/events';

/**
 * How long one stop lasts, in virtual milliseconds.
 *
 * Long enough to read two or three sentences at 1x, and the only thing that sets the
 * pace of an auto-playing tour. Nothing else in the module depends on the number: steps
 * carry their own `startMs`, and everything reads that.
 */
export const TOUR_STEP_MS = 6000;

/** One stop on the walk-through. */
export interface TourStep {
  /** Position in `GuidedTour.steps`, matching the phase index in the run. */
  index: number;
  /** The phase id in the run, e.g. `'tour-router'`. Stable across builds. */
  id: string;
  /** What this stop is about: a machine, or the hop between two of them. */
  target: { type: 'node' | 'link'; id: string };
  /** Short heading -- the machine's label, or both ends of the hop. */
  title: string;
  /** The scenario's own note. Also the phase description the stepper prints. */
  text: string;
  /** Machines to bring into view: one for a node, both ends for a link. */
  focusNodeIds: string[];
  /** Virtual millisecond this stop begins. */
  startMs: number;
}

/** A scenario's walk-through: the steps, and the run that drives them. */
export interface GuidedTour {
  scenarioId: string;
  steps: TourStep[];
  /** Phases, node highlights, and nothing else. */
  result: SimResult;
}

/**
 * Build the tour for a scenario.
 *
 * Deterministic: same scenario in, deep-equal tour out. No clock and no randomness, so a
 * test can compare two builds and the memoized run in `NetworkMapModule` is safe to keep
 * for as long as the scenario is on screen.
 */
export function buildTour(scenario: ScenarioTopology): GuidedTour {
  const { nodes, links } = scenario.topology;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const linkById = new Map(links.map((link) => [link.id, link]));
  const labelOf = (id: string) => nodeById.get(id)?.label ?? id;

  const steps: TourStep[] = [];

  for (const note of scenario.notes) {
    const node = nodeById.get(note.targetId);
    const link = linkById.get(note.targetId);

    // A note pointing at nothing is a scenario bug, not a stop on the tour. Skipping it
    // keeps the walk-through coherent; `scenarios.test.ts` is where it gets caught.
    if (!node && !link) continue;

    steps.push({
      index: steps.length,
      id: `tour-${note.targetId}`,
      target: { type: node ? 'node' : 'link', id: note.targetId },
      title: node ? node.label : `${labelOf(link!.from)} \u2194 ${labelOf(link!.to)}`,
      text: note.text,
      focusNodeIds: node ? [node.id] : [link!.from, link!.to],
      startMs: steps.length * TOUR_STEP_MS,
    });
  }

  return {
    scenarioId: scenario.id,
    steps,
    result: buildResult(steps),
  };
}

/**
 * Steps to events.
 *
 * Two things happen at each stop: the chapter begins, and the machines it is about light
 * up while the previous stop's go dark. The `node-state` events are emitted *before* the
 * ones that follow at the same instant, because a machine that appears in two consecutive
 * stops must end up `active` rather than switched off by its own predecessor.
 */
function buildResult(steps: readonly TourStep[]): SimResult {
  const events: SimEvent[] = [];
  let lit: readonly string[] = [];

  for (const step of steps) {
    for (const id of lit) {
      if (!step.focusNodeIds.includes(id)) {
        events.push({ kind: 'node-state', at: step.startMs, nodeId: id, state: 'idle' });
      }
    }

    for (const id of step.focusNodeIds) {
      events.push({
        kind: 'node-state',
        at: step.startMs,
        nodeId: id,
        state: 'active',
        note: 'this stop on the tour',
      });
    }

    events.push({
      kind: 'phase',
      at: step.startMs,
      id: step.id,
      title: step.title,
      description: step.text,
    });

    lit = step.focusNodeIds;
  }

  const durationMs = steps.length * TOUR_STEP_MS;

  return {
    events,
    phases: summarizePhases(events, durationMs),
    durationMs,
    // No packets. A map is a place, not a journey -- phase 06 is what sends traffic
    // across these same topologies.
    pdus: {},
  };
}

/** The stop the playhead is inside, or `undefined` for an empty tour. */
export function tourStepAt(tour: GuidedTour, virtualTime: number): TourStep | undefined {
  let current: TourStep | undefined;
  for (const step of tour.steps) {
    if (step.startMs <= virtualTime) current = step;
    else break;
  }
  // Before the first stop begins there is still a stop being shown: the tour opens on it.
  return current ?? tour.steps[0];
}

/** The stop about a given machine or hop, if the tour visits it. */
export function tourStepFor(tour: GuidedTour, targetId: string): TourStep | undefined {
  return tour.steps.find((step) => step.target.id === targetId);
}
