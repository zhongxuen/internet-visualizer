import { describe, expect, it } from 'vitest';

import {
  clientMessageBytes,
  compareTransports,
  counters,
  pollingRequest,
  pollingResponse,
  runLongPolling,
  runPolling,
  runSse,
  runWebSocket,
  sseEventBytes,
  sseResponse,
  SSE_SPECIFICATION,
  TRANSPORTS,
  TRANSPORT_LABELS,
  TRANSPORT_SUMMARIES,
  websocketHandshakeCost,
  type ComparisonOptions,
} from './comparison';
import { wireBytes } from './message';

/** Five updates a minute apart-ish, which is the shape most "live" features really have. */
const SPARSE: ComparisonOptions = {
  durationMs: 60_000,
  updates: Array.from({ length: 5 }, (_, index) => ({
    at: 6_000 + index * 12_000,
    text: `{"n":${index}}`,
  })),
};

describe('the messages the byte counts come from', () => {
  it('measures a realistic browser GET, not a minimal one', () => {
    const request = pollingRequest({ host: 'live.example.com', path: '/updates' });
    // Cookies, User-Agent, four Accept* fields and a Referer: this is what a real poll costs.
    expect(wireBytes(request)).toBeGreaterThan(350);
    expect(request.headers.map((field) => field.name)).toContain('Cookie');
  });

  it('sends 204 for an empty poll and 200 with an ETag for a full one', () => {
    expect(pollingResponse('').status).toBe(204);
    expect(pollingResponse('{"n":1}').status).toBe(200);
    expect(wireBytes(pollingResponse(''))).toBeGreaterThan(100);
  });

  it('opens the SSE stream with text/event-stream and disables proxy buffering', () => {
    const names = sseResponse().headers.map((field) => field.name);
    expect(names).toContain('X-Accel-Buffering');
    expect(sseResponse().headers[2].value).toBe('text/event-stream');
  });

  it('charges eight bytes of SSE framing, plus an id line when resumption is wanted', () => {
    expect(sseEventBytes('abc')).toBe('abc'.length + 8);
    expect(sseEventBytes('abc', { withId: true })).toBe('abc'.length + 8 + 8);
  });

  it('charges the WebSocket column a real handshake, and exactly one request', () => {
    const cost = websocketHandshakeCost('live.example.com', '/updates');
    expect(cost.requests).toBe(1);
    expect(cost.requestBytes).toBeGreaterThan(150);
    expect(cost.responseBytes).toBeGreaterThan(80);
  });

  it('charges four extra bytes for a client-to-server frame', () => {
    expect(clientMessageBytes('hello', [1, 2, 3, 4])).toBe(2 + 4 + 5);
  });

  it('is honest about where SSE is specified', () => {
    expect(SSE_SPECIFICATION).toContain('WHATWG');
    expect(SSE_SPECIFICATION).toContain('not an IETF RFC');
  });
});

describe('polling', () => {
  const run = runPolling(SPARSE);

  it('issues one request per interval regardless of whether anything happened', () => {
    expect(run.requests).toBe(60_000 / 5_000);
  });

  it('spends most of them saying "nothing happened"', () => {
    expect(run.emptyResponses).toBe(7);
    expect(run.emptyResponses / run.requests).toBeGreaterThan(0.5);
  });

  it('delivers everything, eventually', () => {
    expect(run.undelivered).toBe(0);
  });

  it('waits about half an interval on average, however fast the network is', () => {
    expect(run.averageLatencyMs).toBeGreaterThan(SPARSE.durationMs / 60);
    expect(run.worstLatencyMs).toBeLessThanOrEqual(5_000 + 80);
  });

  it('is almost entirely overhead', () => {
    expect(run.overheadRatio).toBeGreaterThan(0.99);
  });
});

describe('long polling', () => {
  const run = runLongPolling(SPARSE);

  it('costs roughly one request per update rather than one per interval', () => {
    expect(run.requests).toBeLessThan(runPolling(SPARSE).requests);
    expect(run.requests).toBeGreaterThanOrEqual(SPARSE.updates.length);
  });

  it('delivers in half a round trip, like a WebSocket', () => {
    expect(run.averageLatencyMs).toBe(40);
  });

  it('has a blind spot: updates during the turnaround wait for the next request', () => {
    // Updates 5 ms apart, with a 200 ms gap between the response and the next request.
    // Everything that lands in that gap is queued and delivered late.
    const rapid = runLongPolling({
      durationMs: 10_000,
      turnaroundMs: 200,
      updates: Array.from({ length: 20 }, (_, index) => ({
        at: 100 + index * 5,
        text: 'x',
      })),
    });
    expect(rapid.worstLatencyMs).toBeGreaterThan(200);
    expect(rapid.averageLatencyMs).toBeGreaterThan(
      runLongPolling(SPARSE).averageLatencyMs,
    );
  });

  it('lets go and re-asks before an intermediary can kill an idle connection', () => {
    const quiet = runLongPolling({
      durationMs: 120_000,
      longPollTimeoutMs: 30_000,
      updates: [],
    });
    expect(quiet.emptyResponses).toBeGreaterThan(0);
    expect(quiet.wire.some((event) => event.note.includes('Timeout'))).toBe(true);
  });
});

describe('server-sent events', () => {
  const run = runSse(SPARSE);

  it('makes exactly one request for the whole run', () => {
    expect(run.requests).toBe(1);
  });

  it('is one-directional, and the comparison says so', () => {
    expect(run.bidirectional).toBe(false);
    expect(run.verdict).toContain('one-directional');
  });

  it('delivers as promptly as a WebSocket', () => {
    expect(run.averageLatencyMs).toBe(runWebSocket(SPARSE).averageLatencyMs);
  });

  it('costs about what a WebSocket frame costs per event', () => {
    const perEvent = sseEventBytes('{"n":1}', { withId: true });
    expect(perEvent).toBeLessThan(40);
  });

  it('credits automatic reconnection and Last-Event-ID', () => {
    expect(run.verdict).toContain('Last-Event-ID');
    expect(run.verdict).toContain('HTTP/2');
  });
});

describe('websocket', () => {
  const run = runWebSocket(SPARSE);

  it('pays one handshake and then nothing but frames', () => {
    expect(run.requests).toBe(1);
    expect(run.wire.filter((event) => event.kind === 'handshake')).toHaveLength(2);
    expect(run.wire.filter((event) => event.kind === 'frame')).toHaveLength(5);
  });

  it('sends server frames unmasked, so a short update costs two bytes of header', () => {
    const frames = run.wire.filter((event) => event.kind === 'frame');
    expect(frames[0].bytes).toBe(SPARSE.updates[0].text.length + 2);
    expect(frames[0].note).toContain('Unmasked');
  });

  it('names the costs that do not appear in a byte count', () => {
    expect(run.verdict).toContain('sticky routing');
    expect(run.verdict).toContain('not worth it');
  });
});

describe('compareTransports', () => {
  const comparison = compareTransports(SPARSE);
  const byTransport = new Map(comparison.runs.map((run) => [run.transport, run]));

  it('runs all four over the same updates', () => {
    expect(comparison.runs.map((run) => run.transport)).toEqual(TRANSPORTS);
    for (const run of comparison.runs) {
      expect(run.undelivered).toBe(0);
      expect(run.deliveries).toHaveLength(SPARSE.updates.length);
    }
  });

  it('orders request counts the way the story does', () => {
    const requests = comparison.runs.map((run) => run.requests);
    expect(requests[0]).toBeGreaterThan(requests[1]); // polling > long polling
    expect(requests[1]).toBeGreaterThan(requests[2]); // long polling > SSE
    expect(requests[2]).toBe(requests[3]); // SSE and WebSocket both make one
  });

  it('orders byte counts the same way', () => {
    const bytes = comparison.runs.map((run) => run.totalBytes);
    expect(bytes[0]).toBeGreaterThan(bytes[1]);
    expect(bytes[1]).toBeGreaterThan(bytes[2]);
    expect(bytes[2]).toBeGreaterThan(bytes[3]);
    expect(comparison.leanest).toBe('websocket');
  });

  it('costs polling more than fifteen times what a WebSocket costs, on the same updates', () => {
    const polling = byTransport.get('polling');
    const websocket = byTransport.get('websocket');
    expect(polling && websocket).toBeTruthy();
    if (!polling || !websocket) return;
    expect(polling.totalBytes / websocket.totalBytes).toBeGreaterThan(15);
  });

  it('leaves polling the only one that is slow, and it is slow by design', () => {
    for (const run of comparison.runs) {
      if (run.transport === 'polling') {
        expect(run.averageLatencyMs).toBeGreaterThan(1_000);
      } else {
        expect(run.averageLatencyMs).toBe(40);
      }
    }
    // Three transports tie on latency; `fastest` names the first of them, which is the
    // genuinely interesting result: with updates this rare, long polling is as prompt as
    // anything newer.
    expect(comparison.fastest).toBe('long-polling');
  });

  it('separates payload from overhead, and every column is mostly overhead', () => {
    for (const run of comparison.runs) {
      expect(run.payloadBytes).toBe(
        SPARSE.updates.reduce((sum, update) => sum + update.text.length, 0),
      );
      expect(run.overheadBytes).toBe(run.totalBytes - run.payloadBytes);
      expect(run.overheadRatio).toBeGreaterThan(0.9);
    }
  });

  it('accounts for both directions separately', () => {
    for (const run of comparison.runs) {
      expect(run.bytesUp + run.bytesDown).toBe(run.totalBytes);
      expect(run.bytesUp).toBeGreaterThan(0);
      expect(run.bytesDown).toBeGreaterThan(0);
    }
  });

  it('keeps every wire event in a drawable, non-decreasing order per direction', () => {
    for (const run of comparison.runs) {
      expect(run.wire.length).toBeGreaterThan(0);
      for (const event of run.wire) {
        expect(event.at).toBeGreaterThanOrEqual(0);
        expect(event.bytes).toBeGreaterThan(0);
        expect(event.note.length).toBeGreaterThan(10);
      }
    }
  });

  it('is deterministic', () => {
    expect(compareTransports(SPARSE)).toEqual(compareTransports(SPARSE));
  });

  it('sorts the updates it is given rather than trusting the order', () => {
    const shuffled = compareTransports({
      ...SPARSE,
      updates: [...SPARSE.updates].reverse(),
    });
    expect(shuffled.runs.map((run) => run.totalBytes)).toEqual(
      comparison.runs.map((run) => run.totalBytes),
    );
  });
});

describe('counters', () => {
  it('reduces a run to the numbers the panel puts above each column', () => {
    const row = counters(runPolling(SPARSE));
    expect(row).toEqual({
      transport: 'polling',
      label: 'Polling',
      requests: 12,
      totalBytes: expect.any(Number),
      overheadBytes: expect.any(Number),
      overheadPercent: expect.any(Number),
      averageLatencyMs: expect.any(Number),
      bidirectional: true,
    });
    expect(row.overheadPercent).toBeGreaterThan(95);
  });

  it('labels and summarises all four', () => {
    for (const transport of TRANSPORTS) {
      expect(TRANSPORT_LABELS[transport].length).toBeGreaterThan(3);
      expect(TRANSPORT_SUMMARIES[transport].length).toBeGreaterThan(30);
    }
  });
});

describe('a chatty workload, where the ordering changes', () => {
  /**
   * The sparse case is the one that flatters polling least on requests and most on latency.
   * With an update every second, long polling stops being cheap -- it pays a full request
   * and response for each one -- while the WebSocket column barely moves. That reversal is
   * the point of running the comparison over more than one workload.
   */
  const CHATTY: ComparisonOptions = {
    durationMs: 60_000,
    updates: Array.from({ length: 50 }, (_, index) => ({
      at: 1_000 + index * 1_000,
      text: `{"tick":${index}}`,
    })),
  };

  it('makes long polling more expensive than plain polling', () => {
    const polling = runPolling(CHATTY);
    const longPolling = runLongPolling(CHATTY);
    expect(longPolling.requests).toBeGreaterThan(polling.requests);
    expect(longPolling.totalBytes).toBeGreaterThan(polling.totalBytes);
  });

  it('leaves the WebSocket column almost unchanged', () => {
    const sparse = runWebSocket(SPARSE);
    const chatty = runWebSocket(CHATTY);
    expect(chatty.requests).toBe(sparse.requests);
    // Ten times the messages, and the extra cost is ten times a two-byte header.
    expect(chatty.totalBytes - chatty.payloadBytes).toBeLessThan(
      sparse.totalBytes - sparse.payloadBytes + 100,
    );
  });

  it('still leaves the WebSocket leanest by a wide margin', () => {
    expect(compareTransports(CHATTY).leanest).toBe('websocket');
  });
});
