'use client';

import { buildToyRun, TOY_TOPOLOGY } from '@/core/sim/toyRun';
import { SimulationView, type VisualizedRun } from '@/components/viz';

/**
 * Built once, at module scope.
 *
 * `useSimulation` memoizes on the identity of what it is given, so a run created inside
 * the component would be a new object on every frame of playback -- and playback
 * re-renders this tree sixty times a second. Module scope is the simplest way to make
 * "the simulation runs once" true by construction.
 */
const TOY_RUN: VisualizedRun = {
  topology: TOY_TOPOLOGY,
  result: buildToyRun(),
};

export function DemoPlayground() {
  return <SimulationView simulation={TOY_RUN} label="Toy echo request topology" />;
}
