'use client';

import { useMemo } from 'react';

import type { SimResult } from '@/core/sim/result';
import type { Topology } from '@/core/types/topology';

import { labelsFor } from '../events';

/**
 * A finished run, plus the network it ran on.
 *
 * The two always travel together on the rendering side: a `SimResult` names nodes and
 * links by id and says nothing about what they are, so nothing can be drawn or even
 * labelled without the `Topology` beside it.
 */
export interface VisualizedRun {
  topology: Topology;
  result: SimResult;
}

/**
 * Where a view gets its run from.
 *
 * A function is the interesting case: it is where `Simulation.run(scenario)` will go
 * once phase 03's kernel exists, so a module will pass a thunk and the simulation will
 * execute once per scenario instead of once per render. A plain object is accepted too,
 * for a hand-authored run (`src/core/sim/toyRun.ts`) or a result that arrived as a prop.
 */
export type SimulationSource = VisualizedRun | (() => VisualizedRun);

/** The memoized run, plus the lookups every panel needs off it. */
export interface Simulation extends VisualizedRun {
  /** Node and link ids to display labels, for the log and the annotations. */
  labels: Record<string, string>;
}

/**
 * Run a scenario -- once.
 *
 * Simulations are deterministic and pure, so the result is a function of the source and
 * nothing else; the point of this hook is that it is computed once and then held, rather
 * than recomputed on every frame of playback. Sixty times a second is the rate this
 * component tree re-renders at, and a simulation is not cheap.
 *
 * **The source must be stable.** Declare the thunk (or the object) at module scope, or
 * wrap it in `useCallback`/`useMemo` -- a fresh arrow function on each render re-runs the
 * simulation on each render, which is exactly what this exists to prevent.
 */
export function useSimulation(source: SimulationSource): Simulation {
  return useMemo(() => {
    const run = typeof source === 'function' ? source() : source;
    return { ...run, labels: labelsFor(run.topology) };
  }, [source]);
}
