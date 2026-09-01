import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { MotionProvider } from '@/components/motion';
import { projectAt } from '@/core/sim/project';
import { buildToyRun } from '@/core/sim/toyRun';

import { snapToEndpoints, useVisibleState } from './useVisibleState';

const RUN = buildToyRun();

/** Mid-way through the first hop: the packet is on the LAN wire, half across. */
const MID_HOP = 13;

function reducedMotion({ children }: { children: ReactNode }) {
  return <MotionProvider defaultPreference="reduced">{children}</MotionProvider>;
}

describe('snapToEndpoints', () => {
  it('sends each packet to the end of the wire it is nearer', () => {
    expect(
      snapToEndpoints([
        { pduId: 'a', linkId: 'l', from: 'x', to: 'y', progress: 0.2 },
        { pduId: 'b', linkId: 'l', from: 'x', to: 'y', progress: 0.8 },
      ]).map((packet) => packet.progress),
    ).toEqual([0, 1]);
  });

  it('leaves a packet that is already at an end exactly where it is', () => {
    const packet = { pduId: 'a', linkId: 'l', from: 'x', to: 'y', progress: 1 };
    expect(snapToEndpoints([packet])[0]).toBe(packet);
  });

  it('keeps the packet -- reduced motion removes movement, not content', () => {
    const packets = [{ pduId: 'a', linkId: 'l', from: 'x', to: 'y', progress: 0.5 }];
    expect(snapToEndpoints(packets)).toHaveLength(1);
    expect(snapToEndpoints(packets)[0]).toMatchObject({ pduId: 'a', linkId: 'l' });
  });
});

describe('useVisibleState', () => {
  it('is the projection, unchanged, at full motion', () => {
    const { result } = renderHook(() => useVisibleState(RUN, MID_HOP));
    expect(result.current).toEqual(projectAt(RUN, MID_HOP));
    expect(result.current.inFlight[0].progress).toBeCloseTo(0.5, 10);
  });

  it('snaps packets to the endpoints under reduced motion', () => {
    const { result } = renderHook(() => useVisibleState(RUN, MID_HOP), {
      wrapper: reducedMotion,
    });

    expect(result.current.inFlight[0].progress).toBe(1);
    // Everything else about the frame is identical: same log, same phase, same states.
    expect(result.current.nodeStates).toEqual(projectAt(RUN, MID_HOP).nodeStates);
    expect(result.current.log).toEqual(projectAt(RUN, MID_HOP).log);
    expect(result.current.currentPhase).toEqual(projectAt(RUN, MID_HOP).currentPhase);
  });

  it('arrives at the same frame however the playhead got there', () => {
    const forwards = renderHook(({ t }) => useVisibleState(RUN, t), {
      initialProps: { t: 0 },
    });
    for (const t of [10, 20, 40, 61, 70]) forwards.rerender({ t });

    const straightThere = renderHook(() => useVisibleState(RUN, 70));

    expect(forwards.result.current).toEqual(straightThere.result.current);
  });

  it('re-renders to a new frame when the playhead moves', () => {
    const { result, rerender } = renderHook(({ t }) => useVisibleState(RUN, t), {
      initialProps: { t: 0 },
    });

    const first = result.current;
    rerender({ t: 70 });

    expect(result.current).not.toBe(first);
    expect(result.current.currentPhase?.id).toBe('reply');
  });
});
