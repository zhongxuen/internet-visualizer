import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MotionProvider } from '@/components/motion';
import { buildToyRun } from '@/core/sim/toyRun';

import { createPlaybackStore, usePlayback } from './usePlayback';
import { timelineFrom } from '@/core/sim/playback';

const RUN = buildToyRun();
const TIMELINE = timelineFrom(RUN);

/** One animation frame, the way the fake clock delivers them. */
const FRAME_MS = 16;

function reducedMotion({ children }: { children: ReactNode }) {
  return <MotionProvider defaultPreference="reduced">{children}</MotionProvider>;
}

describe('the playback store', () => {
  it('starts idle at the beginning of the run', () => {
    const store = createPlaybackStore(TIMELINE);
    expect(store.getState()).toMatchObject({
      status: 'idle',
      virtualTime: 0,
      speed: 1,
    });
  });

  it('routes a keyboard command to the matching action', () => {
    const store = createPlaybackStore(TIMELINE);

    store.getState().run({ type: 'step-phase', direction: 1 });
    expect(store.getState().virtualTime).toBe(10);

    store.getState().run({ type: 'speed', speed: 4 });
    expect(store.getState().speed).toBe(4);

    store.getState().run({ type: 'jump', to: 'end' });
    expect(store.getState().status).toBe('ended');

    store.getState().run({ type: 'toggle' });
    expect(store.getState()).toMatchObject({ status: 'playing', virtualTime: 0 });

    store.getState().run({ type: 'replay-phase' });
    expect(store.getState().virtualTime).toBe(0);
  });

  it('does not notify subscribers when a transition changes nothing', () => {
    const store = createPlaybackStore(TIMELINE);
    const listener = vi.fn();
    store.subscribe(listener);

    store.getState().pause();
    store.getState().seek(0);
    expect(listener).not.toHaveBeenCalled();

    store.getState().seek(40);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('rewinds to the start when pointed at a different run', () => {
    const store = createPlaybackStore(TIMELINE);
    store.getState().seek(80);

    const other = { durationMs: 500, phaseStarts: [0], eventTimes: [0] };
    store.getState().setTimeline(other);

    expect(store.getState()).toMatchObject({ status: 'idle', virtualTime: 0 });
    expect(store.getState().timeline).toBe(other);
  });

  it('keeps the chosen speed across a change of run', () => {
    const store = createPlaybackStore(TIMELINE);
    store.getState().setSpeed(4);
    store.getState().setTimeline({ durationMs: 10, phaseStarts: [], eventTimes: [] });

    expect(store.getState().speed).toBe(4);
  });
});

describe('the animation loop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('advances virtual time only while playing', () => {
    const { result } = renderHook(() => usePlayback({ result: RUN }));
    const store = result.current;

    act(() => {
      vi.advanceTimersByTime(FRAME_MS * 4);
    });
    expect(store.getState().virtualTime).toBe(0);

    act(() => {
      store.getState().play();
    });
    act(() => {
      vi.advanceTimersByTime(FRAME_MS * 4);
    });

    const played = store.getState().virtualTime;
    expect(played).toBeGreaterThan(0);
    expect(played).toBeLessThan(RUN.durationMs);

    act(() => {
      store.getState().pause();
    });
    act(() => {
      vi.advanceTimersByTime(FRAME_MS * 10);
    });
    expect(store.getState().virtualTime).toBe(played);
  });

  it('covers the run faster at a higher speed, and stops at the end', () => {
    const { result } = renderHook(() => usePlayback({ result: RUN }));
    const store = result.current;

    act(() => {
      store.getState().setSpeed(4);
      store.getState().play();
    });
    act(() => {
      vi.advanceTimersByTime(RUN.durationMs);
    });

    expect(store.getState()).toMatchObject({
      status: 'ended',
      virtualTime: RUN.durationMs,
    });
  });

  it('stops scheduling frames once the run has ended', () => {
    const { result } = renderHook(() => usePlayback({ result: RUN }));
    const store = result.current;

    act(() => {
      store.getState().play();
    });
    act(() => {
      vi.advanceTimersByTime(RUN.durationMs * 2);
    });

    const frames = vi.fn();
    globalThis.requestAnimationFrame(frames);
    act(() => {
      vi.advanceTimersByTime(FRAME_MS * 4);
    });

    // Our own callback ran, so frames are still being delivered -- the loop simply is
    // not asking for any.
    expect(frames).toHaveBeenCalledTimes(1);
    expect(store.getState().virtualTime).toBe(RUN.durationMs);
  });

  it('cancels the loop when the view unmounts', () => {
    const cancel = vi.spyOn(globalThis, 'cancelAnimationFrame');
    const { result, unmount } = renderHook(() => usePlayback({ result: RUN }));

    act(() => {
      result.current.getState().play();
    });
    act(() => {
      vi.advanceTimersByTime(FRAME_MS * 2);
    });

    unmount();
    expect(cancel).toHaveBeenCalled();
    cancel.mockRestore();
  });

  it('autoplays when asked to', () => {
    const { result } = renderHook(() => usePlayback({ result: RUN, autoPlay: true }));
    expect(result.current.getState().status).toBe('playing');
  });

  it('never autoplays at a viewer who asked for less motion', () => {
    const { result } = renderHook(() => usePlayback({ result: RUN, autoPlay: true }), {
      wrapper: reducedMotion,
    });

    expect(result.current.getState().status).toBe('idle');

    // The run is still fully available -- reduced motion removes the movement, never
    // the content.
    act(() => {
      result.current.getState().stepPhase(1);
    });
    expect(result.current.getState().virtualTime).toBe(10);
  });
});
