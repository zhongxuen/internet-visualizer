import { describe, expect, it } from 'vitest';

import {
  createPlayback,
  currentPhaseStart,
  DEFAULT_SPEED,
  EMPTY_TIMELINE,
  jumpToEnd,
  jumpToStart,
  pause,
  play,
  playbackProgress,
  PLAYBACK_SPEEDS,
  replayPhase,
  seek,
  setSpeed,
  stepBack,
  stepEventBack,
  stepEventForward,
  stepForward,
  tick,
  timelineFrom,
  togglePlay,
  type PlaybackTimeline,
} from '../playback';
import { buildToyRun } from '../toyRun';

/** Phases at 0, 10, 60; events on a finer grid; the run ends at 120. */
const TIMELINE: PlaybackTimeline = timelineFrom(buildToyRun());

const PAUSED_AT = (time: number) =>
  ({ status: 'paused', virtualTime: time, speed: 1 }) as const;

describe('timelineFrom', () => {
  it('reduces a result to duration, phase starts, and distinct event times', () => {
    expect(TIMELINE.durationMs).toBe(120);
    expect(TIMELINE.phaseStarts).toEqual([0, 10, 60]);
    expect(TIMELINE.eventTimes).toEqual([0, 8, 10, 16, 24, 54, 60, 90, 96, 102]);
  });

  it('is ascending and deduplicated even though several events share an instant', () => {
    const ascending = TIMELINE.eventTimes.every(
      (time, index) => index === 0 || time > TIMELINE.eventTimes[index - 1],
    );
    expect(ascending).toBe(true);
  });
});

describe('createPlayback', () => {
  it('starts idle, at zero, at 1x', () => {
    expect(createPlayback()).toEqual({ status: 'idle', virtualTime: 0, speed: 1 });
  });

  it('rejects a speed that is not a positive finite number', () => {
    expect(createPlayback(0).speed).toBe(DEFAULT_SPEED);
    expect(createPlayback(-2).speed).toBe(DEFAULT_SPEED);
    expect(createPlayback(Number.NaN).speed).toBe(DEFAULT_SPEED);
  });
});

describe('play, pause, and toggle', () => {
  it('plays from idle without moving the playhead', () => {
    expect(play(createPlayback(), TIMELINE)).toEqual({
      status: 'playing',
      virtualTime: 0,
      speed: 1,
    });
  });

  it('resumes from where it was paused', () => {
    expect(play(PAUSED_AT(40), TIMELINE).virtualTime).toBe(40);
  });

  it('replays from the top when the run has ended', () => {
    const ended = { status: 'ended', virtualTime: 120, speed: 1 } as const;
    expect(play(ended, TIMELINE)).toEqual({
      status: 'playing',
      virtualTime: 0,
      speed: 1,
    });
  });

  it('cannot play a run with no duration', () => {
    expect(play(createPlayback(), EMPTY_TIMELINE).status).toBe('ended');
  });

  it('pause is a no-op unless it is playing', () => {
    const idle = createPlayback();
    expect(pause(idle)).toBe(idle);
  });

  it('toggles both ways', () => {
    const playing = togglePlay(createPlayback(), TIMELINE);
    expect(playing.status).toBe('playing');
    expect(togglePlay(playing, TIMELINE).status).toBe('paused');
  });
});

describe('tick', () => {
  it('advances virtual time by real time multiplied by speed', () => {
    const state = { status: 'playing', virtualTime: 0, speed: 2 } as const;
    expect(tick(state, TIMELINE, 16).virtualTime).toBe(32);
  });

  it('ignores ticks while paused, idle, or ended', () => {
    for (const status of ['idle', 'paused', 'ended'] as const) {
      const state = { status, virtualTime: 30, speed: 1 };
      expect(tick(state, TIMELINE, 16)).toBe(state);
    }
  });

  it('ignores a zero, negative, or non-finite delta', () => {
    const state = { status: 'playing', virtualTime: 30, speed: 1 } as const;
    expect(tick(state, TIMELINE, 0)).toBe(state);
    expect(tick(state, TIMELINE, -16)).toBe(state);
    expect(tick(state, TIMELINE, Number.NaN)).toBe(state);
  });

  it('stops exactly at the end rather than overshooting', () => {
    const state = { status: 'playing', virtualTime: 118, speed: 4 } as const;
    expect(tick(state, TIMELINE, 16)).toEqual({
      status: 'ended',
      virtualTime: 120,
      speed: 4,
    });
  });

  it('reaches the end from zero in duration/speed milliseconds of real time', () => {
    let state = play(createPlayback(2), TIMELINE);
    for (let frame = 0; frame < 100 && state.status === 'playing'; frame += 1) {
      state = tick(state, TIMELINE, 1);
    }
    // 120 virtual ms at 2x is 60 real ms, so 60 one-millisecond frames.
    expect(state).toEqual({ status: 'ended', virtualTime: 120, speed: 2 });
  });
});

describe('tick with pauseAtPhaseEnd', () => {
  const STEPS = { pauseAtPhaseEnd: true } as const;
  const PLAYING_AT = (time: number, speed = 1) =>
    ({ status: 'playing', virtualTime: time, speed }) as const;

  /** Play from `state`, one `frameMs` tick at a time, until playback stops moving. */
  function runUntilStopped(
    state: ReturnType<typeof PLAYING_AT> | ReturnType<typeof play>,
    frameMs: number,
    options: { pauseAtPhaseEnd?: boolean } = STEPS,
  ) {
    let current: ReturnType<typeof play> = state;
    for (let frame = 0; frame < 10_000 && current.status === 'playing'; frame += 1) {
      current = tick(current, TIMELINE, frameMs, options);
    }
    return current;
  }

  it('is off unless asked for, so a run plays straight through', () => {
    expect(runUntilStopped(play(createPlayback(), TIMELINE), 1, {})).toMatchObject({
      status: 'ended',
      virtualTime: 120,
    });
    const crossing = tick(PLAYING_AT(8), TIMELINE, 4);
    expect(crossing).toEqual({ status: 'playing', virtualTime: 12, speed: 1 });
  });

  it('pauses with the playhead exactly on the next phase start', () => {
    expect(tick(PLAYING_AT(8), TIMELINE, 4, STEPS)).toEqual({
      status: 'paused',
      virtualTime: 10,
      speed: 1,
    });
  });

  it('lets a tick that stops short of the boundary move as normal', () => {
    expect(tick(PLAYING_AT(2), TIMELINE, 4, STEPS)).toEqual(PLAYING_AT(6));
  });

  it('continues from the boundary when Play is pressed, without pausing there again', () => {
    const paused = tick(PLAYING_AT(8), TIMELINE, 4, STEPS);
    const resumed = play(paused, TIMELINE);
    expect(resumed).toEqual({ status: 'playing', virtualTime: 10, speed: 1 });

    expect(tick(resumed, TIMELINE, 16, STEPS)).toEqual(PLAYING_AT(26));
  });

  /** Where a viewer pressing Play at every pause sees the run stop, first to last. */
  function stopsOf(speed: number, frameMs: number): number[] {
    const stops: number[] = [];
    let state = play(createPlayback(speed), TIMELINE);
    while (stops.length < 10) {
      state = runUntilStopped(state, frameMs);
      stops.push(state.virtualTime);
      if (state.status === 'ended') break;
      expect(state.status).toBe('paused');
      state = play(state, TIMELINE);
    }
    return stops;
  }

  it('stops at every interior boundary in order, then ends', () => {
    expect(stopsOf(1, 1)).toEqual([10, 60, 120]);
  });

  it('never skips a boundary at 4x, however long the frame', () => {
    // 4x with the loop's largest believable frame (100 ms) is 400 virtual ms: enough to
    // cross both boundaries and the end of the run in one tick.
    expect(tick(PLAYING_AT(0, 4), TIMELINE, 100, STEPS)).toEqual({
      status: 'paused',
      virtualTime: 10,
      speed: 4,
    });
    expect(tick(PLAYING_AT(10, 4), TIMELINE, 100, STEPS)).toEqual({
      status: 'paused',
      virtualTime: 60,
      speed: 4,
    });
    expect(tick(PLAYING_AT(60, 4), TIMELINE, 100, STEPS)).toEqual({
      status: 'ended',
      virtualTime: 120,
      speed: 4,
    });
  });

  it('visits the same stops at every speed on the ladder', () => {
    for (const speed of PLAYBACK_SPEEDS) {
      expect(stopsOf(speed, 16.667), `at ${speed}x`).toEqual([10, 60, 120]);
    }
  });

  it('never pauses at zero', () => {
    // The toy run's first phase starts at 0: playing from the top must not stop there.
    expect(TIMELINE.phaseStarts[0]).toBe(0);
    expect(tick(play(createPlayback(), TIMELINE), TIMELINE, 1, STEPS)).toEqual(
      PLAYING_AT(1),
    );
  });

  it('never pauses at the end, even when a phase starts there', () => {
    const endsOnABoundary: PlaybackTimeline = {
      durationMs: 50,
      phaseStarts: [0, 20, 50],
      eventTimes: [0, 20, 50],
    };
    expect(tick(PLAYING_AT(40), endsOnABoundary, 20, STEPS)).toEqual({
      status: 'ended',
      virtualTime: 50,
      speed: 1,
    });
  });

  it('plays straight through a run with no interior phases', () => {
    const flat: PlaybackTimeline = { durationMs: 50, phaseStarts: [0], eventTimes: [] };
    expect(tick(PLAYING_AT(0), flat, 60, STEPS).status).toBe('ended');
  });

  it('catches a frame that lands a hair short of a boundary', () => {
    // Left alone, 59.9999999 would be within EPSILON of 60 on the next tick, and
    // `nextStop` would treat 60 as already passed.
    const drifted = tick(PLAYING_AT(50), TIMELINE, 9.9999999, STEPS);
    expect(drifted).toEqual({ status: 'paused', virtualTime: 60, speed: 1 });
  });

  it('resumes from a boundary reached by accumulated float drift', () => {
    const resumed = play(PAUSED_AT(60.00000000000001), TIMELINE);
    expect(tick(resumed, TIMELINE, 5, STEPS).status).toBe('playing');
  });

  it('still ignores ticks while paused, idle, or ended', () => {
    for (const status of ['idle', 'paused', 'ended'] as const) {
      const state = { status, virtualTime: 8, speed: 1 };
      expect(tick(state, TIMELINE, 16, STEPS)).toBe(state);
    }
  });

  it('pauses at the next boundary after a seek past earlier ones', () => {
    const scrubbed = seek(PLAYING_AT(0), TIMELINE, 30);
    expect(tick(scrubbed, TIMELINE, 100, STEPS)).toEqual({
      status: 'paused',
      virtualTime: 60,
      speed: 1,
    });
  });
});

describe('seek', () => {
  it('clamps into the run', () => {
    expect(seek(PAUSED_AT(40), TIMELINE, -10).virtualTime).toBe(0);
    expect(seek(PAUSED_AT(40), TIMELINE, 9999).virtualTime).toBe(120);
  });

  it('keeps playing while scrubbing a playing run', () => {
    const playing = { status: 'playing', virtualTime: 10, speed: 1 } as const;
    expect(seek(playing, TIMELINE, 40).status).toBe('playing');
  });

  it('ends the run when the playhead lands on the far end', () => {
    expect(seek(PAUSED_AT(40), TIMELINE, 120).status).toBe('ended');
  });

  it('stays idle only while the playhead has not left zero', () => {
    const idle = createPlayback();
    expect(seek(idle, TIMELINE, 0)).toBe(idle);
    expect(seek(idle, TIMELINE, 40).status).toBe('paused');
  });

  it('returns the same object when nothing changes', () => {
    const state = PAUSED_AT(40);
    expect(seek(state, TIMELINE, 40)).toBe(state);
  });
});

describe('phase stepping', () => {
  it('steps forward to the next phase boundary', () => {
    expect(stepForward(PAUSED_AT(0), TIMELINE).virtualTime).toBe(10);
    expect(stepForward(PAUSED_AT(10), TIMELINE).virtualTime).toBe(60);
  });

  it('steps forward from mid-phase to the boundary ahead, not a whole phase on', () => {
    expect(stepForward(PAUSED_AT(30), TIMELINE).virtualTime).toBe(60);
  });

  it('steps forward from the last phase to the end of the run', () => {
    expect(stepForward(PAUSED_AT(70), TIMELINE)).toEqual({
      status: 'ended',
      virtualTime: 120,
      speed: 1,
    });
  });

  it('steps back from mid-phase to the start of that phase', () => {
    expect(stepBack(PAUSED_AT(30), TIMELINE).virtualTime).toBe(10);
  });

  it('steps back from a boundary to the previous one', () => {
    expect(stepBack(PAUSED_AT(60), TIMELINE).virtualTime).toBe(10);
    expect(stepBack(PAUSED_AT(10), TIMELINE).virtualTime).toBe(0);
  });

  it('steps back from the first phase to zero', () => {
    expect(stepBack(PAUSED_AT(5), TIMELINE).virtualTime).toBe(0);
  });

  it('pauses a playing run, because a step is something you look at', () => {
    const playing = { status: 'playing', virtualTime: 30, speed: 1 } as const;
    expect(stepForward(playing, TIMELINE).status).toBe('paused');
    expect(stepBack(playing, TIMELINE).status).toBe('paused');
  });

  it('is not confused by float drift from accumulated frames', () => {
    // What 60 looks like after being reached one 16.667 ms frame at a time.
    const drifted = PAUSED_AT(60.00000000000001);
    expect(stepForward(drifted, TIMELINE).virtualTime).toBe(120);
    expect(stepBack(drifted, TIMELINE).virtualTime).toBe(10);
  });

  it('goes straight to the end when a run has no phases at all', () => {
    const flat: PlaybackTimeline = { durationMs: 50, phaseStarts: [], eventTimes: [] };
    expect(stepForward(PAUSED_AT(10), flat).virtualTime).toBe(50);
    expect(stepBack(PAUSED_AT(10), flat).virtualTime).toBe(0);
  });
});

describe('event stepping', () => {
  it('moves one event at a time, finer than a phase', () => {
    expect(stepEventForward(PAUSED_AT(0), TIMELINE).virtualTime).toBe(8);
    expect(stepEventForward(PAUSED_AT(8), TIMELINE).virtualTime).toBe(10);
    expect(stepEventBack(PAUSED_AT(10), TIMELINE).virtualTime).toBe(8);
  });

  it('falls off each end onto the bounds of the run', () => {
    expect(stepEventBack(PAUSED_AT(0), TIMELINE).virtualTime).toBe(0);
    expect(stepEventForward(PAUSED_AT(102), TIMELINE).virtualTime).toBe(120);
  });

  it('walks the whole run forwards and back to the same positions', () => {
    const forwards: number[] = [];
    let state = createPlayback();
    while (state.virtualTime < TIMELINE.durationMs) {
      state = stepEventForward(state, TIMELINE);
      forwards.push(state.virtualTime);
    }

    const backwards: number[] = [];
    while (state.virtualTime > 0) {
      backwards.push(state.virtualTime);
      state = stepEventBack(state, TIMELINE);
    }

    expect(forwards).toEqual([...TIMELINE.eventTimes.slice(1), 120]);
    expect(backwards.reverse()).toEqual(forwards);
  });
});

describe('jumps', () => {
  it('Home returns to a paused start', () => {
    expect(jumpToStart(PAUSED_AT(70), TIMELINE)).toEqual({
      status: 'paused',
      virtualTime: 0,
      speed: 1,
    });
  });

  it('End parks on the finished run', () => {
    expect(jumpToEnd(createPlayback(), TIMELINE)).toEqual({
      status: 'ended',
      virtualTime: 120,
      speed: 1,
    });
  });
});

describe('setSpeed', () => {
  it('accepts every speed on the ladder', () => {
    for (const speed of PLAYBACK_SPEEDS) {
      expect(setSpeed(createPlayback(), speed).speed).toBe(speed);
    }
  });

  it('does not move the playhead or change the status', () => {
    const playing = { status: 'playing', virtualTime: 40, speed: 1 } as const;
    expect(setSpeed(playing, 4)).toEqual({
      status: 'playing',
      virtualTime: 40,
      speed: 4,
    });
  });

  it('falls back to 1x for a nonsense speed', () => {
    expect(setSpeed(createPlayback(4), 0).speed).toBe(DEFAULT_SPEED);
  });
});

describe('replayPhase', () => {
  it('rewinds to the start of the current phase and plays', () => {
    expect(replayPhase(PAUSED_AT(80), TIMELINE)).toEqual({
      status: 'playing',
      virtualTime: 60,
      speed: 1,
    });
  });

  it('replays the last phase from its start rather than restarting the run', () => {
    const ended = { status: 'ended', virtualTime: 120, speed: 1 } as const;
    expect(replayPhase(ended, TIMELINE).virtualTime).toBe(60);
  });
});

describe('derived readings', () => {
  it('reports the phase containing the playhead', () => {
    expect(currentPhaseStart(TIMELINE, 0)).toBe(0);
    expect(currentPhaseStart(TIMELINE, 9)).toBe(0);
    expect(currentPhaseStart(TIMELINE, 10)).toBe(10);
    expect(currentPhaseStart(TIMELINE, 119)).toBe(60);
  });

  it('reports progress along the scrubber', () => {
    expect(playbackProgress(PAUSED_AT(30), TIMELINE)).toBe(0.25);
    expect(playbackProgress(PAUSED_AT(0), EMPTY_TIMELINE)).toBe(0);
  });
});
