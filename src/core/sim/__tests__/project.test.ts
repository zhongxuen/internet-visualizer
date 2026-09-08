import { describe, expect, it } from 'vitest';

import type { PDU } from '../../types/pdu';
import type { SimEvent } from '../../types/events';
import { inFlightAt, projectAt, projectionCursor, projectionKey } from '../project';
import { summarizePhases, type SimResult } from '../result';

/**
 * A hand-authored two-hop run: a DNS query and answer over `link-lan`, then a TCP SYN
 * over `link-wan`, split across two phases. Written by hand rather than produced by the
 * kernel so these tests exercise the projection alone.
 *
 * Timeline (virtual ms):
 *
 *   0   phase "resolve" | query created | client active | query in flight (20ms)
 *   20  query arrives   | resolver processing | note pinned to resolver
 *   30  answer in flight (20ms)
 *   50  answer arrives  | client active
 *   60  phase "connect" | resolver idle | SYN in flight (40ms)
 *   70  note pinned to server
 *   100 SYN arrives     | server active
 *   120 end
 */
function pdu(id: string, summary: string): PDU {
  return {
    id,
    layers: [
      {
        layer: 'application',
        protocol: 'DNS',
        fields: [
          { name: 'QNAME', value: 'example.com', note: 'the name being resolved' },
        ],
      },
    ],
    sizeBytes: 64,
    summary,
  };
}

const EVENTS: SimEvent[] = [
  {
    kind: 'phase',
    at: 0,
    id: 'resolve',
    title: 'DNS resolution',
    description: 'Turn the hostname into an IP address',
  },
  {
    kind: 'pdu-created',
    at: 0,
    pdu: pdu('query', 'DNS A? example.com'),
    atNode: 'client',
  },
  { kind: 'node-state', at: 0, nodeId: 'client', state: 'active' },
  {
    kind: 'transmit',
    at: 0,
    pduId: 'query',
    from: 'client',
    to: 'resolver',
    durationMs: 20,
    linkId: 'link-lan',
  },
  {
    kind: 'node-state',
    at: 20,
    nodeId: 'resolver',
    state: 'processing',
    note: 'cache miss',
  },
  {
    kind: 'annotate',
    at: 20,
    targetId: 'resolver',
    text: 'The recursive resolver checks its cache first',
    reference: { rfc: 1034, section: '4.3.2', title: 'Domain Names -- Concepts' },
  },
  { kind: 'log', at: 20, level: 'info', text: 'resolver: cache miss for example.com' },
  {
    kind: 'transmit',
    at: 30,
    pduId: 'answer',
    from: 'resolver',
    to: 'client',
    durationMs: 20,
    linkId: 'link-lan',
  },
  { kind: 'node-state', at: 50, nodeId: 'client', state: 'active' },
  {
    kind: 'phase',
    at: 60,
    id: 'connect',
    title: 'TCP handshake',
    description: 'Open a connection to the resolved address',
  },
  { kind: 'node-state', at: 60, nodeId: 'resolver', state: 'idle' },
  {
    kind: 'transmit',
    at: 60,
    pduId: 'syn',
    from: 'client',
    to: 'server',
    durationMs: 40,
    linkId: 'link-wan',
  },
  {
    kind: 'annotate',
    at: 70,
    targetId: 'server',
    text: 'SYN opens the three-way handshake',
  },
  { kind: 'node-state', at: 100, nodeId: 'server', state: 'active' },
];

const RESULT: SimResult = {
  events: EVENTS,
  phases: summarizePhases(EVENTS, 120),
  durationMs: 120,
  pdus: {
    query: pdu('query', 'DNS A? example.com'),
    answer: pdu('answer', 'DNS A 192.0.2.10'),
    syn: pdu('syn', 'TCP SYN 49152 -> 443'),
  },
};

describe('summarizePhases', () => {
  it('derives contiguous half-open windows ending at the run duration', () => {
    expect(RESULT.phases).toEqual([
      {
        index: 0,
        id: 'resolve',
        title: 'DNS resolution',
        description: 'Turn the hostname into an IP address',
        startMs: 0,
        endMs: 60,
      },
      {
        index: 1,
        id: 'connect',
        title: 'TCP handshake',
        description: 'Open a connection to the resolved address',
        startMs: 60,
        endMs: 120,
      },
    ]);
  });

  it('returns nothing for a run with no phase events', () => {
    const events: SimEvent[] = [{ kind: 'log', at: 0, level: 'info', text: 'hi' }];
    expect(summarizePhases(events, 10)).toEqual([]);
  });

  it('never produces a phase that ends before it starts', () => {
    const late: SimEvent[] = [
      {
        kind: 'phase',
        at: 90,
        id: 'late',
        title: 'Late',
        description: 'Starts after the end',
      },
    ];
    expect(summarizePhases(late, 10)[0]).toMatchObject({ startMs: 90, endMs: 90 });
  });
});

describe('projectAt at t = 0', () => {
  const state = projectAt(RESULT, 0);

  it('opens in the first phase', () => {
    expect(state.currentPhase).toMatchObject({ id: 'resolve', index: 0 });
  });

  it('shows the first packet at the very start of its link', () => {
    expect(state.inFlight).toEqual([
      {
        pduId: 'query',
        linkId: 'link-lan',
        from: 'client',
        to: 'resolver',
        progress: 0,
        startMs: 0,
        durationMs: 20,
      },
    ]);
  });

  it('applies the state events at t = 0 and leaves every other node idle', () => {
    expect(state.nodeStates).toEqual({
      client: 'active',
      resolver: 'idle',
      server: 'idle',
    });
  });

  it('logs only the events at t = 0, in result order', () => {
    expect(state.log).toEqual(EVENTS.slice(0, 4));
  });

  it('has no annotations yet', () => {
    expect(state.activeAnnotations).toEqual([]);
  });

  it('clamps negative and non-finite times to the start', () => {
    expect(projectAt(RESULT, -500)).toEqual(state);
    expect(projectAt(RESULT, Number.NaN)).toEqual(state);
  });
});

describe('projectAt mid-transmit', () => {
  it('interpolates progress linearly across the flight', () => {
    expect(projectAt(RESULT, 5).inFlight[0]?.progress).toBe(0.25);
    expect(projectAt(RESULT, 10).inFlight[0]?.progress).toBe(0.5);
    expect(projectAt(RESULT, 19).inFlight[0]?.progress).toBeCloseTo(0.95, 10);
  });

  it('carries the link and direction so the sprite knows which way it is going', () => {
    expect(projectAt(RESULT, 40).inFlight).toEqual([
      {
        pduId: 'answer',
        linkId: 'link-lan',
        from: 'resolver',
        to: 'client',
        progress: 0.5,
        startMs: 30,
        durationMs: 20,
      },
    ]);
  });

  it('drops the packet at the arrival instant -- it is at the node, not on the wire', () => {
    expect(projectAt(RESULT, 19.999).inFlight).toHaveLength(1);
    expect(projectAt(RESULT, 20).inFlight).toEqual([]);
  });

  it('leaves the wire empty between hops', () => {
    expect(projectAt(RESULT, 25).inFlight).toEqual([]);
  });

  it('shows a zero-duration hop only at the instant it is sent, already arrived', () => {
    const events: SimEvent[] = [
      {
        kind: 'transmit',
        at: 10,
        pduId: 'p',
        from: 'a',
        to: 'b',
        durationMs: 0,
        linkId: 'l',
      },
    ];
    const instant: SimResult = { events, phases: [], durationMs: 10, pdus: {} };

    expect(projectAt(instant, 9).inFlight).toEqual([]);
    expect(projectAt(instant, 10).inFlight).toEqual([
      {
        pduId: 'p',
        linkId: 'l',
        from: 'a',
        to: 'b',
        progress: 1,
        startMs: 10,
        durationMs: 0,
      },
    ]);
    expect(projectAt(instant, 10.001).inFlight).toEqual([]);
  });
});

describe('projectAt at phase boundaries', () => {
  it('treats a phase window as half-open, so the boundary belongs to the new phase', () => {
    expect(projectAt(RESULT, 59.999).currentPhase).toMatchObject({ id: 'resolve' });
    expect(projectAt(RESULT, 60).currentPhase).toMatchObject({ id: 'connect', index: 1 });
  });

  it('omits currentPhase entirely before the first phase begins', () => {
    const events: SimEvent[] = [
      { kind: 'log', at: 0, level: 'info', text: 'booting' },
      {
        kind: 'phase',
        at: 10,
        id: 'later',
        title: 'Later',
        description: 'Starts at 10ms',
      },
    ];
    const delayed: SimResult = {
      events,
      phases: summarizePhases(events, 20),
      durationMs: 20,
      pdus: {},
    };

    expect(projectAt(delayed, 5).currentPhase).toBeUndefined();
    expect(projectAt(delayed, 5)).not.toHaveProperty('currentPhase');
    expect(projectAt(delayed, 10).currentPhase).toMatchObject({ id: 'later' });
  });

  it('applies every event exactly at the boundary time', () => {
    const state = projectAt(RESULT, 60);
    expect(state.nodeStates.resolver).toBe('idle');
    expect(state.inFlight).toEqual([
      {
        pduId: 'syn',
        linkId: 'link-wan',
        from: 'client',
        to: 'server',
        progress: 0,
        startMs: 60,
        durationMs: 40,
      },
    ]);
  });

  it('retires annotations from the phase they belong to when that phase ends', () => {
    expect(projectAt(RESULT, 30).activeAnnotations).toEqual([
      {
        id: 'annotation-5',
        targetId: 'resolver',
        text: 'The recursive resolver checks its cache first',
        reference: { rfc: 1034, section: '4.3.2', title: 'Domain Names -- Concepts' },
        at: 20,
      },
    ]);
    expect(projectAt(RESULT, 60).activeAnnotations).toEqual([]);
    expect(projectAt(RESULT, 70).activeAnnotations).toEqual([
      {
        id: 'annotation-12',
        targetId: 'server',
        text: 'SYN opens the three-way handshake',
        at: 70,
      },
    ]);
  });
});

describe('projectAt past the end of the run', () => {
  const ended = projectAt(RESULT, 1_000);

  it('has nothing left on the wire', () => {
    expect(ended.inFlight).toEqual([]);
  });

  it('holds every node at its final state', () => {
    expect(ended.nodeStates).toEqual({
      client: 'active',
      resolver: 'idle',
      server: 'active',
    });
  });

  it('has logged the whole run', () => {
    expect(ended.log).toEqual(EVENTS);
  });

  it('keeps the last phase current rather than falling off the timeline', () => {
    expect(ended.currentPhase).toMatchObject({ id: 'connect' });
  });

  it('is stable however far past the end you go', () => {
    expect(projectAt(RESULT, 120)).toEqual(ended);
    expect(projectAt(RESULT, 1_000_000)).toEqual(ended);
  });
});

describe('projectAt is a pure function of t', () => {
  const times = [0, 5, 19.999, 20, 25, 30, 50, 59.999, 60, 70, 99, 100, 120, 500];

  it('reaches the same state scrubbing backwards as scrubbing forwards', () => {
    const forwards = times.map((t) => projectAt(RESULT, t));
    const backwards = [...times].reverse().map((t) => projectAt(RESULT, t));

    expect(backwards.reverse()).toEqual(forwards);
  });

  it('reaches the same state by seeking as by playing through every frame', () => {
    // Walk the whole run at 1ms granularity, keeping the frames at the checkpoints...
    const played = new Map<number, unknown>();
    for (let t = 0; t <= 130; t += 1) {
      if (times.includes(t)) played.set(t, projectAt(RESULT, t));
    }

    // ...then jump straight to each checkpoint and expect the identical frame.
    for (const [t, state] of played) {
      expect(projectAt(RESULT, t)).toEqual(state);
    }
  });

  it('keeps the nodeStates key set stable at every t, so renderers can rely on it', () => {
    for (const t of times) {
      expect(Object.keys(projectAt(RESULT, t).nodeStates)).toEqual([
        'client',
        'resolver',
        'server',
      ]);
    }
  });

  it('never mutates the result it projects', () => {
    const before = structuredClone(RESULT);
    for (const t of times) projectAt(RESULT, t);
    expect(RESULT).toEqual(before);
  });
});

/**
 * The two guarantees the playback loop's per-frame cache is built on.
 *
 * `useVisibleState` calls `projectAt` only when the cursor moves and `inFlightAt` on
 * every frame. That is only sound if these hold, so they are asserted here rather than
 * left as a comment in the hook.
 */
describe('the per-frame split', () => {
  /** Every tenth of a millisecond across the run, plus the boundaries themselves. */
  const sweep = [
    -5,
    ...Array.from({ length: 1301 }, (_, i) => i / 10),
    RESULT.durationMs,
    RESULT.durationMs + 500,
    Number.NaN,
  ];

  it('inFlightAt is exactly the inFlight projectAt would have produced', () => {
    for (const t of sweep) {
      expect(inFlightAt(RESULT, t)).toEqual(projectAt(RESULT, t).inFlight);
    }
  });

  it('an unchanged cursor means unchanged node states, log, notes and phase', () => {
    const seen = new Map<string, ReturnType<typeof projectAt>>();

    for (const t of sweep) {
      const cursor = projectionCursor(RESULT, t);
      const key = `${cursor.eventCount}/${cursor.phaseIndex}`;
      const state = projectAt(RESULT, t);
      const first = seen.get(key);

      if (!first) {
        seen.set(key, state);
        continue;
      }

      // Everything the cache reuses. `inFlight` is deliberately not compared -- it is
      // the one member that moves between events, which is why it is recomputed.
      expect(state.nodeStates).toEqual(first.nodeStates);
      expect(state.log).toEqual(first.log);
      expect(state.activeAnnotations).toEqual(first.activeAnnotations);
      expect(state.currentPhase).toEqual(first.currentPhase);
    }

    // A guard against the assertion above passing vacuously.
    expect(seen.size).toBeGreaterThan(5);
  });

  it('counts the events that have happened, and names the phase in force', () => {
    // Clamped at 0 below, exactly as `projectAt` clamps it.
    expect(projectionCursor(RESULT, -1)).toEqual(projectionCursor(RESULT, 0));
    expect(projectionCursor(RESULT, Number.NaN)).toEqual(projectionCursor(RESULT, 0));
    expect(projectionCursor(RESULT, 0).phaseIndex).toBe(0);
    expect(projectionCursor(RESULT, 60).phaseIndex).toBe(1);
    // Past the end the last phase stays current and every event has been counted.
    expect(projectionCursor(RESULT, 10_000)).toEqual({
      eventCount: RESULT.events.length,
      phaseIndex: RESULT.phases.length - 1,
    });
  });

  it('projects the same discrete state at the key as at the time itself', () => {
    for (const t of sweep) {
      const atKey = projectAt(RESULT, projectionKey(RESULT, t));
      const atTime = projectAt(RESULT, t);

      expect(atKey.nodeStates).toEqual(atTime.nodeStates);
      expect(atKey.log).toEqual(atTime.log);
      expect(atKey.activeAnnotations).toEqual(atTime.activeAnnotations);
      expect(atKey.currentPhase).toEqual(atTime.currentPhase);
    }
  });

  it('gives one key per cursor, and one cursor per key', () => {
    const keysByCursor = new Map<string, Set<number>>();

    for (const t of sweep) {
      const cursor = projectionCursor(RESULT, t);
      const id = `${cursor.eventCount}/${cursor.phaseIndex}`;
      const keys = keysByCursor.get(id) ?? new Set<number>();
      keys.add(projectionKey(RESULT, t));
      keysByCursor.set(id, keys);
    }

    // One key per cursor is what makes the key usable as a memo dependency; distinct
    // keys across cursors is what stops two different frames sharing a cache entry.
    for (const keys of keysByCursor.values()) expect(keys.size).toBe(1);
    const all = [...keysByCursor.values()].map((keys) => [...keys][0]);
    expect(new Set(all).size).toBe(all.length);
  });

  it('agrees with the projection on how many events have been reached', () => {
    for (const t of sweep) {
      expect(projectionCursor(RESULT, t).eventCount).toBe(
        projectAt(RESULT, t).log.length,
      );
    }
  });
});
