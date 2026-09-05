import { describe, expect, it } from 'vitest';

import { utf8Bytes } from './digest';
import {
  binaryFrame,
  continuationFrame,
  pingFrame,
  pongFrame,
  textFrame,
  type WebSocketFrame,
} from './frames';
import {
  backoffSchedule,
  closeCodeRange,
  closeFrame,
  CLOSE_CODES,
  connectingConnection,
  describeCloseCode,
  describeCloseCodeRange,
  describeReadyState,
  explainBackoff,
  isSendableCloseCode,
  MAX_CLOSE_REASON_BYTES,
  messageText,
  openConnection,
  parseClosePayload,
  READY_STATE_VALUES,
  runLifecycle,
  simulateKeepalive,
  step,
  type ConnectionState,
} from './lifecycle';

function unwrap(result: ReturnType<typeof closeFrame>): WebSocketFrame {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe('ready states', () => {
  it('numbers them the way the browser API does', () => {
    expect(READY_STATE_VALUES).toEqual({
      connecting: 0,
      open: 1,
      closing: 2,
      closed: 3,
    });
  });

  it('explains each one', () => {
    expect(describeReadyState('connecting')).toContain('throws');
    expect(describeReadyState('closing')).toContain('must still be read');
  });
});

describe('close codes', () => {
  /**
   * The heart of the table. These four are values a local API invents to report to its own
   * caller; putting one in a frame is a protocol error, and 1006 in particular is the one
   * everybody sees in their logs and tries to look up.
   */
  it.each([1004, 1005, 1006, 1015])('never sends %i on the wire', (code) => {
    expect(isSendableCloseCode(code)).toBe(false);
    expect(describeCloseCode(code)?.sendable).toBe(false);
  });

  it('says 1006 is the absence of an explanation', () => {
    expect(describeCloseCode(1006)?.meaning).toContain('absence of an explanation');
  });

  it.each([1000, 1001, 1002, 1003, 1007, 1008, 1009, 1010, 1011])(
    'does send %i',
    (code) => {
      expect(isSendableCloseCode(code)).toBe(true);
    },
  );

  it('allows the private and library ranges without a table entry', () => {
    expect(isSendableCloseCode(4000)).toBe(true);
    expect(isSendableCloseCode(4999)).toBe(true);
    expect(isSendableCloseCode(3000)).toBe(true);
  });

  it('refuses anything outside every usable range', () => {
    expect(isSendableCloseCode(999)).toBe(false);
    expect(isSendableCloseCode(5000)).toBe(false);
    expect(isSendableCloseCode(0)).toBe(false);
  });

  it('classifies the four ranges of RFC 6455 s 7.4.2', () => {
    expect(closeCodeRange(999)).toBe('unused');
    expect(closeCodeRange(1000)).toBe('protocol');
    expect(closeCodeRange(2999)).toBe('protocol');
    expect(closeCodeRange(3000)).toBe('registered');
    expect(closeCodeRange(4000)).toBe('private');
    expect(describeCloseCodeRange('private')).toContain('4000-4999');
  });

  it('gives every code a meaning worth reading', () => {
    for (const entry of CLOSE_CODES) {
      expect(entry.meaning.length).toBeGreaterThan(40);
      expect(entry.reference.rfc).toBe(6455);
    }
  });
});

describe('closeFrame', () => {
  it('writes the code big-endian, then the reason as UTF-8', () => {
    const value = unwrap(closeFrame(1000, 'bye'));
    expect(value.opcode).toBe('close');
    expect([...value.payload]).toEqual([0x03, 0xe8, 0x62, 0x79, 0x65]);
  });

  it('round-trips through parseClosePayload', () => {
    const value = unwrap(closeFrame(1011, 'internal error'));
    const parsed = parseClosePayload(value.payload);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.code).toBe(1011);
      expect(parsed.value.reason).toBe('internal error');
    }
  });

  it('allows an empty payload, which means "closing, no comment"', () => {
    const value = unwrap(closeFrame());
    expect(value.payload).toHaveLength(0);
    const parsed = parseClosePayload(value.payload);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.code).toBeUndefined();
  });

  it('refuses a reason with no code -- there is nowhere to put it', () => {
    const result = closeFrame(undefined, 'why');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('needs a close code');
  });

  it('refuses a code that may not be sent', () => {
    const result = closeFrame(1006, 'gone');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('never be sent');
  });

  it('caps the reason at 123 bytes, and counts bytes not characters', () => {
    expect(closeFrame(1000, 'a'.repeat(MAX_CLOSE_REASON_BYTES)).ok).toBe(true);
    expect(closeFrame(1000, 'a'.repeat(MAX_CLOSE_REASON_BYTES + 1)).ok).toBe(false);
    // 31 emoji are 31 characters and 124 bytes, so this is over the cap.
    expect(closeFrame(1000, '🌍'.repeat(31)).ok).toBe(false);
  });

  it('refuses a one-byte payload: half a status code is a 1002', () => {
    const result = parseClosePayload(new Uint8Array([0x03]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('half a status code');
  });

  it('refuses a payload whose reason is not valid UTF-8', () => {
    const payload = new Uint8Array([0x03, 0xe8, 0xc3, 0x28]);
    expect(parseClosePayload(payload).ok).toBe(false);
  });
});

describe('sending', () => {
  it('refuses to send while CONNECTING', () => {
    const result = step(connectingConnection('client'), {
      kind: 'send',
      at: 0,
      frame: textFrame('too early'),
    });
    expect(result.state.readyState).toBe('connecting');
    expect(result.events[0].level).toBe('error');
    expect(result.events[0].text).toContain('CONNECTING');
  });

  it('opens on a completed handshake', () => {
    const result = step(connectingConnection('client'), {
      kind: 'handshake-complete',
      at: 120,
    });
    expect(result.state.readyState).toBe('open');
    expect(result.events[0].kind).toBe('open');
  });

  it('counts frames, messages and bytes', () => {
    const { state } = runLifecycle(openConnection('client'), [
      { kind: 'send', at: 0, frame: textFrame('one') },
      { kind: 'send', at: 10, frame: textFrame('two') },
    ]);
    expect(state.stats.messagesSent).toBe(2);
    expect(state.stats.framesSent).toBe(2);
    expect(state.stats.bytesSent).toBe(10); // two 2-byte headers, six bytes of payload
  });

  it('stops data frames once a Close has been sent, but still allows control frames', () => {
    const closing = step(openConnection('client'), {
      kind: 'send',
      at: 0,
      frame: unwrap(closeFrame(1000)),
    });
    expect(closing.state.readyState).toBe('closing');

    const rejected = step(closing.state, {
      kind: 'send',
      at: 5,
      frame: textFrame('one more thing'),
    });
    expect(rejected.events[0].level).toBe('warn');
    expect(rejected.state.stats.framesSent).toBe(closing.state.stats.framesSent);
  });
});

describe('ping and pong', () => {
  it('answers a received ping with a pong carrying the identical bytes', () => {
    const result = step(openConnection('server'), {
      kind: 'receive',
      at: 100,
      frame: pingFrame(utf8Bytes('are you there')),
    });
    expect(result.emit).toHaveLength(1);
    expect(result.emit[0].opcode).toBe('pong');
    expect(result.emit[0].payload).toEqual(utf8Bytes('are you there'));
  });

  it('matches a pong to its ping and measures the round trip on this connection', () => {
    const sent = step(openConnection('server'), {
      kind: 'send',
      at: 1_000,
      frame: pingFrame(utf8Bytes('beat-1')),
    });
    expect(sent.state.pendingPings).toHaveLength(1);

    const answered = step(sent.state, {
      kind: 'receive',
      at: 1_042,
      frame: pongFrame(utf8Bytes('beat-1')),
    });
    expect(answered.state.pendingPings).toHaveLength(0);
    expect(answered.state.stats.pongsReceived).toBe(1);
    expect(answered.events[0].text).toContain('42 ms');
  });

  it('accepts an unsolicited pong as a one-way heartbeat and does not answer it', () => {
    const result = step(openConnection('client'), {
      kind: 'receive',
      at: 10,
      frame: pongFrame(utf8Bytes('unsolicited')),
    });
    expect(result.emit).toHaveLength(0);
    expect(result.events[0].text).toContain('unsolicited');
  });
});

describe('the closing handshake', () => {
  it('echoes a Close when the peer starts it', () => {
    const result = step(openConnection('server'), {
      kind: 'receive',
      at: 50,
      frame: unwrap(closeFrame(1001, 'navigating away')),
    });
    expect(result.state.readyState).toBe('closing');
    expect(result.emit).toHaveLength(1);
    expect(result.emit[0].opcode).toBe('close');
    expect(result.events[0].text).toContain('echoes a Close back');
  });

  it('does not echo again when it started the close itself', () => {
    const sent = step(openConnection('client'), {
      kind: 'send',
      at: 0,
      frame: unwrap(closeFrame(1000, 'done')),
    });
    const answered = step(sent.state, {
      kind: 'receive',
      at: 40,
      frame: unwrap(closeFrame(1000, '')),
    });
    expect(answered.emit).toHaveLength(0);
    expect(answered.events[0].text).toContain('complete in both directions');
  });

  it('is clean only when both Close frames were exchanged', () => {
    const { state } = runLifecycle(openConnection('client'), [
      { kind: 'send', at: 0, frame: unwrap(closeFrame(1000, 'done')) },
      { kind: 'receive', at: 40, frame: unwrap(closeFrame(1000, '')) },
      { kind: 'transport-closed', at: 45 },
    ]);
    expect(state.readyState).toBe('closed');
    expect(state.wasClean).toBe(true);
    expect(state.closeCode).toBe(1000);
  });

  it('reports 1006 when the transport vanishes with no Close at all', () => {
    const { state, events } = runLifecycle(openConnection('client'), [
      { kind: 'send', at: 0, frame: textFrame('hello?') },
      { kind: 'transport-lost', at: 900, reason: 'proxy idle timeout' },
    ]);
    expect(state.readyState).toBe('closed');
    expect(state.closeCode).toBe(1006);
    expect(state.wasClean).toBe(false);
    expect(state.closeReason).toBe('');
    expect(events.at(-1)?.text).toContain('never on the wire');
  });

  it('reports 1005 when a clean close carried no code', () => {
    const { state } = runLifecycle(openConnection('server'), [
      { kind: 'receive', at: 10, frame: unwrap(closeFrame()) },
      { kind: 'transport-closed', at: 20 },
    ]);
    expect(state.wasClean).toBe(true);
    expect(state.closeCode).toBe(1005);
  });

  it('answers a malformed Close with 1002', () => {
    const result = step(openConnection('server'), {
      kind: 'receive',
      at: 10,
      frame: { ...pingFrame(), opcode: 'close', payload: new Uint8Array([0x03]) },
    });
    const parsed = parseClosePayload(result.emit[0].payload);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.code).toBe(1002);
  });
});

describe('receiving messages', () => {
  it('delivers an unfragmented text message', () => {
    const result = step(openConnection('client'), {
      kind: 'receive',
      at: 5,
      frame: textFrame('hello'),
    });
    expect(result.events[0].kind).toBe('message');
    expect(result.events[0].message?.text).toBe('hello');
    expect(result.state.stats.messagesReceived).toBe(1);
  });

  it('holds fragments until FIN and then delivers one message', () => {
    const { state, events } = runLifecycle(openConnection('client'), [
      { kind: 'receive', at: 0, frame: textFrame('Hel', { fin: false }) },
      { kind: 'receive', at: 5, frame: continuationFrame(utf8Bytes('lo')) },
    ]);
    expect(events[0].kind).toBe('fragment');
    expect(events[1].kind).toBe('message');
    expect(events[1].message?.text).toBe('Hello');
    expect(state.stats.messagesReceived).toBe(1);
    expect(state.stats.framesReceived).toBe(2);
    expect(state.pending).toBeUndefined();
  });

  it('lets a ping through in the middle of a fragmented message', () => {
    const opened = step(openConnection('server'), {
      kind: 'receive',
      at: 0,
      frame: textFrame('Hel', { fin: false }),
    });
    const pinged = step(opened.state, {
      kind: 'receive',
      at: 1,
      frame: pingFrame(utf8Bytes('x')),
    });
    expect(pinged.emit[0].opcode).toBe('pong');
    expect(pinged.state.pending).toBeDefined();

    const finished = step(pinged.state, {
      kind: 'receive',
      at: 2,
      frame: continuationFrame(utf8Bytes('lo')),
    });
    expect(finished.events[0].message?.text).toBe('Hello');
  });

  it('fails the connection on a continuation with nothing to continue', () => {
    const result = step(openConnection('client'), {
      kind: 'receive',
      at: 0,
      frame: continuationFrame(utf8Bytes('lo')),
    });
    expect(result.state.readyState).toBe('closing');
    expect(result.events[0].level).toBe('error');
    const parsed = parseClosePayload(result.emit[0].payload);
    if (parsed.ok) expect(parsed.value.code).toBe(1002);
  });

  it('fails with 1007 when a reassembled text message is not valid UTF-8', () => {
    const result = runLifecycle(openConnection('client'), [
      {
        kind: 'receive',
        at: 0,
        frame: { ...textFrame(''), fin: false, payload: new Uint8Array([0xc3]) },
      },
      {
        kind: 'receive',
        at: 1,
        frame: { ...continuationFrame(new Uint8Array([0x28])), fin: true },
      },
    ]);
    expect(result.events.at(-1)?.text).toContain('1007');
  });

  it('delivers a binary message without pretending it is text', () => {
    const result = step(openConnection('client'), {
      kind: 'receive',
      at: 0,
      frame: binaryFrame(new Uint8Array([0x00, 0xff, 0x10])),
    });
    expect(result.events[0].message?.opcode).toBe('binary');
    expect(result.events[0].message?.text).toBeUndefined();
  });

  it('exposes the text of a frame sequence for callers that have no state', () => {
    expect(
      messageText([textFrame('Hel', { fin: false }), continuationFrame(utf8Bytes('lo'))]),
    ).toBe('Hello');
  });
});

describe('simulateKeepalive', () => {
  it('beats on the interval and matches every pong', () => {
    const run = simulateKeepalive({ durationMs: 100_000, intervalMs: 25_000 });
    expect(run.beats.map((beat) => beat.sentAt)).toEqual([
      25_000, 50_000, 75_000, 100_000,
    ]);
    expect(run.beats.every((beat) => beat.pongAt !== undefined)).toBe(true);
    expect(run.deadAt).toBeUndefined();
  });

  it('costs eight bytes a beat: a two-byte ping and a six-byte masked pong', () => {
    const run = simulateKeepalive({ durationMs: 50_000, intervalMs: 25_000 });
    expect(run.overheadBytes).toBe(16);
  });

  it('declares the connection dead when a pong stops coming', () => {
    const run = simulateKeepalive({
      durationMs: 200_000,
      intervalMs: 25_000,
      timeoutMs: 10_000,
      failAfterPing: 2,
    });
    expect(run.beats.at(-1)?.timedOut).toBe(true);
    expect(run.deadAt).toBe(75_000 + 10_000);
  });

  it('says why a browser cannot do this itself', () => {
    expect(simulateKeepalive({ durationMs: 1_000 }).explain).toContain(
      'Browsers cannot send pings',
    );
  });
});

describe('backoffSchedule', () => {
  it('doubles the cap and then stops at the ceiling', () => {
    const schedule = backoffSchedule(8, {
      baseMs: 1_000,
      maxMs: 30_000,
      jitter: 'none',
    });
    expect(schedule.map((attempt) => attempt.capMs)).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000,
    ]);
  });

  it('accumulates elapsed time across attempts', () => {
    const schedule = backoffSchedule(3, { baseMs: 1_000, jitter: 'none' });
    expect(schedule.map((attempt) => attempt.elapsedMs)).toEqual([1_000, 3_000, 7_000]);
  });

  it('keeps full jitter inside [0, cap]', () => {
    const schedule = backoffSchedule(10, { jitter: 'full', seed: 'reconnect' });
    for (const attempt of schedule) {
      expect(attempt.delayMs).toBeGreaterThanOrEqual(0);
      expect(attempt.delayMs).toBeLessThanOrEqual(attempt.capMs);
    }
  });

  it('keeps equal jitter inside [cap/2, cap], so progress is guaranteed', () => {
    const schedule = backoffSchedule(10, { jitter: 'equal', seed: 'reconnect' });
    for (const attempt of schedule) {
      expect(attempt.delayMs).toBeGreaterThanOrEqual(Math.floor(attempt.capMs / 2));
      expect(attempt.delayMs).toBeLessThanOrEqual(attempt.capMs);
    }
  });

  it('is deterministic for a seed, and different across seeds', () => {
    expect(backoffSchedule(5, { seed: 'a' })).toEqual(backoffSchedule(5, { seed: 'a' }));
    expect(backoffSchedule(5, { seed: 'a' })).not.toEqual(
      backoffSchedule(5, { seed: 'b' }),
    );
  });

  it('spreads a herd that unjittered backoff would keep synchronised', () => {
    // Ten clients dropped by one restart, each with its own seed. Without jitter every
    // delayMs is identical; with it, they scatter.
    const delays = Array.from(
      { length: 10 },
      (_, index) => backoffSchedule(1, { seed: `client-${index}` })[0].delayMs,
    );
    expect(new Set(delays).size).toBeGreaterThan(5);
  });

  it('explains that the exponent saves the client and the jitter saves the server', () => {
    expect(explainBackoff().headline).toContain('jitter saves the server');
    expect(explainBackoff().reference.section).toBe('7.2.3');
  });
});

describe('the state machine as a whole', () => {
  it('replays a full connection from a list of actions', () => {
    const initial: ConnectionState = connectingConnection('client');
    const { state, events } = runLifecycle(initial, [
      { kind: 'handshake-complete', at: 0 },
      { kind: 'send', at: 10, frame: textFrame('hello', { maskingKey: [1, 2, 3, 4] }) },
      { kind: 'receive', at: 50, frame: textFrame('hi back') },
      { kind: 'receive', at: 60, frame: pingFrame() },
      { kind: 'send', at: 61, frame: pongFrame() },
      { kind: 'send', at: 100, frame: unwrap(closeFrame(1000, 'done')) },
      { kind: 'receive', at: 140, frame: unwrap(closeFrame(1000, '')) },
      { kind: 'transport-closed', at: 145 },
    ]);

    expect(state.readyState).toBe('closed');
    expect(state.wasClean).toBe(true);
    expect(state.stats.messagesSent).toBe(1);
    expect(state.stats.messagesReceived).toBe(1);
    expect(events.map((event) => event.kind)).toEqual([
      'open',
      'message',
      'message',
      'ping',
      'pong',
      'close-sent',
      'close-received',
      'closed',
    ]);
  });

  it('never mutates the state it is given', () => {
    const before = openConnection('client');
    const snapshot = JSON.stringify(before.stats);
    step(before, { kind: 'send', at: 0, frame: textFrame('x') });
    expect(JSON.stringify(before.stats)).toBe(snapshot);
  });
});
