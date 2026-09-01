import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { SimResult } from '@/core/sim/result';
import type { Topology } from '@/core/types/topology';

import { useSimulation, type VisualizedRun } from './useSimulation';

/**
 * The hook's whole reason to exist is that a simulation runs *once*, not once per frame
 * of playback -- so what is asserted here is how often the thunk is called, not what it
 * returns. The second half of that contract is the caller's: a fresh thunk each render
 * re-runs the simulation, and the last test pins that down so the "must be stable"
 * warning in the doc comment is a demonstrated fact rather than advice.
 */

const TOPOLOGY: Topology = {
  nodes: [
    { id: 'laptop', kind: 'client', label: 'Laptop' },
    { id: 'router', kind: 'router', label: 'Home router' },
  ],
  links: [{ id: 'lan', from: 'laptop', to: 'router', latencyMs: 1 }],
};

const RESULT: SimResult = { durationMs: 0, events: [], pdus: {}, phases: [] };

const RUN: VisualizedRun = { topology: TOPOLOGY, result: RESULT };

describe('useSimulation', () => {
  it('hands back the run and the network it ran on', () => {
    const { result } = renderHook(() => useSimulation(RUN));

    expect(result.current.topology).toBe(TOPOLOGY);
    expect(result.current.result).toBe(RESULT);
  });

  it('resolves the labels every panel needs off the topology', () => {
    const { result } = renderHook(() => useSimulation(RUN));

    expect(result.current.labels).toMatchObject({
      laptop: 'Laptop',
      router: 'Home router',
    });
  });

  it('runs a thunk once, however many times the tree re-renders', () => {
    const run = vi.fn(() => RUN);
    const { rerender } = renderHook(() => useSimulation(run));

    rerender();
    rerender();

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('holds the same object across renders, so nothing downstream re-derives', () => {
    const { result, rerender } = renderHook(() => useSimulation(RUN));
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
  });

  it('re-runs when the scenario actually changes', () => {
    const other: VisualizedRun = { topology: { nodes: [], links: [] }, result: RESULT };
    const { result, rerender } = renderHook(({ source }) => useSimulation(source), {
      initialProps: { source: RUN },
    });

    rerender({ source: other });

    expect(result.current.topology).toBe(other.topology);
    expect(result.current.labels).toEqual({});
  });
});
