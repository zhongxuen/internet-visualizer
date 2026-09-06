import { describe, expect, it } from 'vitest';

import { runWebSocketScenario } from '../sim/exchange';
import { decodeFrame, encodeFrame, reassemble } from '../sim/frames';
import { isSendableCloseCode, parseClosePayload } from '../sim/lifecycle';
import { deriveAccept } from '../sim/upgrade';

import { RFC_EXAMPLE_ACCEPT, RFC_EXAMPLE_KEY } from './common';
import {
  BINARY_FRAMES,
  CLOSE_HANDSHAKE,
  FRAGMENTED_MESSAGE,
  HANDSHAKE_AND_CHAT,
  PING_PONG_KEEPALIVE,
  RECONNECT_BACKOFF,
  TRANSPORT_COMPARISON,
  WEBSOCKET_SCENARIOS,
} from './index';

/**
 * The scenarios, checked against the protocol rather than against themselves.
 *
 * The assertions worth having here are the ones that would still be true if every scenario in
 * this folder were rewritten: every client frame is masked and no server frame is, the
 * derivation matches the vector printed in RFC 6455, a fragmented message reassembles to the
 * thing that was sent, and no close code that may never be sent ever appears in a frame.
 *
 * Determinism is asserted first because every other assertion depends on it. A scenario that
 * read a clock or an unseeded random source would make the rest of this file flaky rather than
 * wrong, which is much worse.
 */

describe('WebSocket scenarios', () => {
  it('offers exactly the seven runs the phase specifies, in teaching order', () => {
    expect(WEBSOCKET_SCENARIOS.map((scenario) => scenario.id)).toEqual([
      'handshake-and-chat',
      'ping-pong-keepalive',
      'binary-frames',
      'fragmented-message',
      'close-handshake',
      'reconnect-backoff',
      'transport-comparison',
    ]);
  });

  it.each(WEBSOCKET_SCENARIOS.map((scenario) => [scenario.id, scenario] as const))(
    'replays %s byte for byte',
    (_id, scenario) => {
      // Deep equality across two independent runs is the whole determinism contract: no
      // clock is read, and every masking key and nonce comes from the seeded generator.
      expect(runWebSocketScenario(scenario)).toEqual(runWebSocketScenario(scenario));
    },
  );

  it.each(WEBSOCKET_SCENARIOS.map((scenario) => [scenario.id, scenario] as const))(
    'emits events in non-decreasing time order for %s',
    (_id, scenario) => {
      const { events, durationMs } = runWebSocketScenario(scenario).result;
      for (let index = 1; index < events.length; index += 1) {
        expect(events[index].at).toBeGreaterThanOrEqual(events[index - 1].at);
      }
      expect(durationMs).toBeGreaterThanOrEqual(events[events.length - 1]?.at ?? 0);
    },
  );

  /**
   * The rule the module exists for.
   *
   * Not "most client frames" and not "the ones the scenario remembered to mask": every frame
   * travelling client to server, including the pongs and the echoing Closes that the state
   * machine produced rather than the scenario. Those are the ones a hand-written scenario
   * would get wrong, which is why they are generated.
   */
  it.each(WEBSOCKET_SCENARIOS.map((scenario) => [scenario.id, scenario] as const))(
    'masks every client frame and no server frame in %s',
    (_id, scenario) => {
      for (const record of runWebSocketScenario(scenario).frames) {
        expect(record.frame.masked).toBe(record.from === 'client');
        expect(record.frame.maskingKey !== undefined).toBe(record.from === 'client');
      }
    },
  );

  it('gives every masked frame its own key, never a reused one', () => {
    const keys = runWebSocketScenario(FRAGMENTED_MESSAGE)
      .frames.filter((record) => record.frame.maskingKey !== undefined)
      .map((record) => (record.frame.maskingKey ?? []).join('.'));

    expect(keys.length).toBeGreaterThan(1);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each(WEBSOCKET_SCENARIOS.map((scenario) => [scenario.id, scenario] as const))(
    'encodes every frame in %s to legal wire bytes that decode back',
    (_id, scenario) => {
      for (const record of runWebSocketScenario(scenario).frames) {
        const encoded = encodeFrame(record.frame, { direction: record.direction });
        expect(encoded.ok).toBe(true);
        if (!encoded.ok) return;

        expect(encoded.value.length).toBe(record.wireBytes);

        const decoded = decodeFrame(encoded.value);
        expect(decoded.ok).toBe(true);
        if (!decoded.ok) return;

        // The payload survives the mask, which is the property masking must have: it
        // changes the bytes on the wire and not the message.
        expect(decoded.value.frame.payload).toEqual(record.frame.payload);
        expect(decoded.value.frame.opcode).toBe(record.frame.opcode);
      }
    },
  );
});

describe('handshake-and-chat', () => {
  const run = runWebSocketScenario(HANDSHAKE_AND_CHAT);
  const handshake = run.handshakes[0];

  it('derives the Sec-WebSocket-Accept printed in RFC 6455 § 1.2', () => {
    expect(handshake.request.method).toBe('GET');
    expect(handshake.derivation.key).toBe(RFC_EXAMPLE_KEY);
    expect(handshake.derivation.accept).toBe(RFC_EXAMPLE_ACCEPT);
    expect(deriveAccept(RFC_EXAMPLE_KEY).accept).toBe(RFC_EXAMPLE_ACCEPT);
  });

  it('keeps every intermediate value of the derivation, not just the answer', () => {
    const ids = handshake.derivation.steps.map((step) => step.id);
    expect(ids).toEqual(['key', 'guid', 'concatenated', 'sha1', 'accept']);
    // Nothing between the key and the GUID -- no space, no colon, no newline.
    expect(handshake.derivation.concatenated).toBe(
      `${RFC_EXAMPLE_KEY}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`,
    );
  });

  it('answers 101 and passes every MUST', () => {
    expect(handshake.accepted).toBe(true);
    expect(handshake.response.status).toBe(101);
    for (const check of handshake.checks) {
      if (check.requirement === 'MUST') expect(check.passed).toBe(true);
    }
  });

  it('picks the subprotocol from the server’s preference order, not the client’s', () => {
    // The client offers chat.v2 first; the server prefers chat.v1 and the server chooses.
    expect(handshake.subprotocol).toBe('chat.v1');
  });

  it('costs more for the handshake than for every frame after it put together', () => {
    const frameBytes = run.frames.reduce((sum, record) => sum + record.wireBytes, 0);
    expect(handshake.cost.totalBytes).toBeGreaterThan(frameBytes);
    expect(handshake.cost.requests).toBe(1);
  });
});

describe('binary-frames', () => {
  const run = runWebSocketScenario(BINARY_FRAMES);

  it('exercises all three payload-length encodings', () => {
    const encodings = run.frames.map((record) => record.layout.lengthEncoding);
    expect(new Set(encodings)).toEqual(new Set(['7-bit', '7+16', '7+64']));
  });

  it('uses the minimal encoding for every frame', () => {
    for (const record of run.frames) {
      const length = record.frame.payload.length;
      const expected = length <= 125 ? '7-bit' : length <= 0xffff ? '7+16' : '7+64';
      expect(record.layout.lengthEncoding).toBe(expected);
    }
  });

  it('prices the same data as base64 text against the binary frame', () => {
    const binary = run.frames.find((record) => record.stepId === 'medium-binary');
    const asText = run.frames.find((record) => record.stepId === 'as-text');
    if (!binary || !asText) throw new Error('the scenario lost a step');

    expect(binary.frame.payload.length).toBe(300);
    // base64 is 4 characters per 3 bytes, and the JSON wrapper adds 16 more.
    expect(asText.frame.payload.length).toBe(416);
    expect(asText.wireBytes).toBeGreaterThan(binary.wireBytes);
  });
});

describe('fragmented-message', () => {
  const run = runWebSocketScenario(FRAGMENTED_MESSAGE);
  const fragments = run.frames.filter(
    (record) =>
      record.stepId === 'fragmented' &&
      record.frame.opcode !== 'ping' &&
      record.frame.opcode !== 'pong',
  );

  it('declares the type once, continues, and sets FIN only on the last', () => {
    expect(fragments.length).toBeGreaterThan(1);
    expect(fragments[0].frame.opcode).toBe('text');
    expect(fragments[0].frame.fin).toBe(false);
    for (const record of fragments.slice(1)) {
      expect(record.frame.opcode).toBe('continuation');
    }
    expect(fragments[fragments.length - 1].frame.fin).toBe(true);
  });

  it('reassembles to the message that was sent', () => {
    const assembled = reassemble(fragments.map((record) => record.frame));
    expect(assembled.ok).toBe(true);
    if (!assembled.ok) return;

    expect(assembled.value.frameCount).toBe(fragments.length);
    expect(assembled.value.text).toContain('Fragmentation lets a sender start');
    expect(assembled.value.text).toContain('never sees the seams');
  });

  it('has a fragment that is not valid UTF-8 on its own, which is the point', () => {
    // The em dash straddles the first boundary, so validating per fragment would reject
    // legal traffic. Only the reassembled message is required to decode.
    const partial = reassemble([fragments[0].frame]);
    expect(partial.ok).toBe(false);
  });

  it('answers a ping that arrives between fragments, before the message finishes', () => {
    const ping = run.frames.find((record) => record.frame.opcode === 'ping');
    const pong = run.frames.find((record) => record.frame.opcode === 'pong');
    const last = fragments[fragments.length - 1];
    if (!ping || !pong) throw new Error('the interleaved ping is missing');

    expect(ping.from).toBe('server');
    expect(pong.from).toBe('client');
    expect(pong.automatic).toBe(true);
    expect(pong.frame.payload).toEqual(ping.frame.payload);
    expect(pong.sentAt).toBeLessThan(last.sentAt);
  });
});

describe('close-handshake', () => {
  const run = runWebSocketScenario(CLOSE_HANDSHAKE);
  const closes = run.frames.filter((record) => record.frame.opcode === 'close');

  it('closes in both directions, so the close is clean', () => {
    expect(closes).toHaveLength(2);
    expect(closes[0].from).toBe('server');
    expect(closes[1].from).toBe('client');
    expect(closes[1].automatic).toBe(true);
    expect(closes[0].close?.code).toBe(1001);

    if (run.detail.kind !== 'session') throw new Error('wrong detail kind');
    expect(run.detail.client.wasClean).toBe(true);
    expect(run.detail.client.closeCode).toBe(1001);
  });

  it('caps the close reason inside the 123 bytes a control frame leaves for it', () => {
    // 125 for the control frame, less the two the code has already spent.
    expect(closes[0].frame.payload.length).toBeLessThanOrEqual(125);
  });
});

describe('the codes that are never on the wire', () => {
  it('refuses 1004, 1005, 1006 and 1015 as sendable codes', () => {
    for (const code of [1004, 1005, 1006, 1015]) {
      expect(isSendableCloseCode(code)).toBe(false);
    }
  });

  it('never puts one of them in a Close frame in any scenario', () => {
    for (const scenario of WEBSOCKET_SCENARIOS) {
      for (const record of runWebSocketScenario(scenario).frames) {
        if (record.frame.opcode !== 'close') continue;
        const parsed = parseClosePayload(record.frame.payload);
        expect(parsed.ok).toBe(true);
        if (parsed.ok && parsed.value.code !== undefined) {
          expect(isSendableCloseCode(parsed.value.code)).toBe(true);
        }
      }
    }
  });

  it('still reports 1006 locally when the transport vanished with no frame', () => {
    const keepalive = runWebSocketScenario(PING_PONG_KEEPALIVE);
    if (keepalive.detail.kind !== 'keepalive') throw new Error('wrong detail kind');
    expect(keepalive.detail.server.closeCode).toBe(1006);
    expect(keepalive.detail.server.wasClean).toBe(false);

    const reconnect = runWebSocketScenario(RECONNECT_BACKOFF);
    const lost = reconnect.result.events.find(
      (event) => event.kind === 'log' && event.text.includes('1006'),
    );
    expect(lost).toBeDefined();
  });
});

describe('ping-pong-keepalive', () => {
  const run = runWebSocketScenario(PING_PONG_KEEPALIVE);

  it('answers every ping that arrived, and the last one never arrives', () => {
    const pings = run.frames.filter((record) => record.frame.opcode === 'ping');
    const pongs = run.frames.filter((record) => record.frame.opcode === 'pong');

    expect(pings.length).toBeGreaterThan(1);
    expect(pongs).toHaveLength(pings.length - 1);
    expect(pings[pings.length - 1].delivered).toBe(false);
    for (const pong of pongs) expect(pong.automatic).toBe(true);
  });

  it('pings from the server, because a browser has no way to', () => {
    for (const record of run.frames.filter((each) => each.frame.opcode === 'ping')) {
      expect(record.from).toBe('server');
    }
  });
});

describe('reconnect-backoff', () => {
  const run = runWebSocketScenario(RECONNECT_BACKOFF);

  it('reconnects with a fresh key, because a reused nonce could be replayed', () => {
    expect(run.handshakes).toHaveLength(2);
    expect(run.handshakes[1].derivation.key).not.toBe(run.handshakes[0].derivation.key);
    expect(run.handshakes[1].accepted).toBe(true);
  });

  it('draws each delay from inside a doubling window rather than equal to it', () => {
    if (run.detail.kind !== 'reconnect') throw new Error('wrong detail kind');
    const { schedule, withoutJitter } = run.detail;

    for (const attempt of schedule) {
      expect(attempt.delayMs).toBeGreaterThanOrEqual(0);
      expect(attempt.delayMs).toBeLessThanOrEqual(attempt.capMs);
    }
    // Without jitter every client waits exactly the window -- the synchronised herd.
    for (const attempt of withoutJitter) {
      expect(attempt.delayMs).toBe(attempt.capMs);
    }
    expect(withoutJitter[1].capMs).toBe(withoutJitter[0].capMs * 2);
  });
});

describe('transport-comparison', () => {
  const run = runWebSocketScenario(TRANSPORT_COMPARISON);

  it('races all four strategies over the same updates', () => {
    if (run.detail.kind !== 'comparison') throw new Error('wrong detail kind');
    expect(run.detail.comparison.runs.map((each) => each.transport)).toEqual([
      'polling',
      'long-polling',
      'sse',
      'websocket',
    ]);
  });

  it('counts a request total and a byte overhead for every strategy', () => {
    if (run.detail.kind !== 'comparison') throw new Error('wrong detail kind');
    for (const transport of run.detail.comparison.runs) {
      expect(transport.requests).toBeGreaterThan(0);
      expect(transport.totalBytes).toBeGreaterThan(0);
      expect(transport.overheadBytes).toBeGreaterThan(0);
      expect(transport.overheadRatio).toBeGreaterThan(0);
      expect(transport.overheadRatio).toBeLessThanOrEqual(1);
      expect(transport.verdict.length).toBeGreaterThan(40);
    }
  });

  it('makes polling the most expensive and the WebSocket the leanest', () => {
    if (run.detail.kind !== 'comparison') throw new Error('wrong detail kind');
    const { comparison } = run.detail;
    const polling = comparison.runs.find((each) => each.transport === 'polling');
    const websocket = comparison.runs.find((each) => each.transport === 'websocket');
    if (!polling || !websocket) throw new Error('a transport is missing');

    expect(comparison.leanest).toBe('websocket');
    expect(polling.requests).toBeGreaterThan(websocket.requests);
    expect(polling.emptyResponses).toBeGreaterThan(0);
    expect(polling.totalBytes).toBeGreaterThan(websocket.totalBytes * 5);
  });

  it('is fair to SSE: cheap and resumable, and one-directional', () => {
    if (run.detail.kind !== 'comparison') throw new Error('wrong detail kind');
    const sse = run.detail.comparison.runs.find((each) => each.transport === 'sse');
    if (!sse) throw new Error('SSE is missing');

    expect(sse.bidirectional).toBe(false);
    expect(sse.requests).toBe(1);
    expect(sse.verdict.toLowerCase()).toContain('reconnect');
  });
});
