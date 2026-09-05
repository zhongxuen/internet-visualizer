/**
 * The life of a connection: open, talk, keep alive, and close -- properly, or not at all.
 *
 * `upgrade.ts` gets the connection made and `frames.ts` describes what travels over it. This
 * file is the part in between: a small state machine that consumes frames in both directions
 * and says what the connection now is. It is where three lessons live that neither of the
 * other files can hold, because all three are about *sequence* rather than about a message.
 *
 * ## A close is a handshake, not a hangup
 *
 * Either endpoint may start it. It sends a Close frame and stops sending anything else; the
 * peer answers with a Close frame of its own and stops too; then the TCP connection comes
 * down, with the **server** closing first (RFC 6455 s 7.1.1) so that the socket sits in
 * `TIME_WAIT` on the side that has one connection rather than the side that has fifty
 * thousand. Until both Close frames have crossed, the closing endpoint must still *read* --
 * because there may be messages already in flight that were sent before the peer knew.
 *
 * That is the difference between a clean close and every other kind, and it is the whole
 * reason close code 1006 exists.
 *
 * ## 1006 is never on the wire
 *
 * It cannot be. It means "the connection dropped without a Close frame", and there is by
 * definition no frame to carry it. Neither is 1005 ("no code was present") nor 1015 ("TLS
 * failed"), and 1004 is reserved with no meaning at all. All four are values a local
 * WebSocket API *reports to your code*, invented at the moment the API gives up. Putting one
 * in a Close frame is a protocol error. See {@link CLOSE_CODES}, where the distinction is a
 * column.
 *
 * The practical consequence: if your error handler logs 1006, there is nothing to look up.
 * It is not a reason, it is the absence of one -- a proxy idle timeout, a NAT table eviction,
 * a laptop lid, a crash. Which is exactly why the next section exists.
 *
 * ## Ping and pong exist because a dead connection looks exactly like an idle one
 *
 * TCP will not tell you. Its keepalive defaults to two hours, is frequently disabled, and
 * says nothing about whether the application above it is still there. Meanwhile every NAT
 * and load balancer on the path evicts idle flows after thirty to a hundred and twenty
 * seconds, silently, and the first you learn of it is a write that never arrives. A
 * ping/pong every twenty or thirty seconds solves both halves: it proves the peer is alive
 * and it keeps the middleboxes from forgetting the flow.
 *
 * A detail people meet the hard way: **browser JavaScript cannot send a ping.** The
 * `WebSocket` API has no method for it. Browsers answer pings automatically and never
 * originate them, so in a browser deployment the keepalive is always the server's job, or it
 * is an application-level `{"type":"ping"}` message that costs far more than the two bytes a
 * real ping would have.
 *
 * Everything here is a pure function of its arguments over virtual milliseconds. Nothing
 * here opens a socket or reads a clock.
 */

import { fail, ok, type ParseResult } from '@/core/net/result';
import { createRng } from '@/core/sim/rng';
import type { LogLevel, RfcRef } from '@/core/types/events';

import { strictUtf8Text, utf8Bytes, utf8Text } from './digest';
import {
  frame,
  frameBytes,
  isControlOpcode,
  pongFrame,
  reassemble,
  type Opcode,
  type WebSocketFrame,
} from './frames';

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

const RFC_6455: RfcRef = { rfc: 6455, title: 'The WebSocket Protocol' };

/** Closing the connection. */
export const RFC_6455_CLOSING: RfcRef = { ...RFC_6455, section: '7.1.1' };
/** Fail the WebSocket connection -- the abrupt path. */
export const RFC_6455_FAIL: RfcRef = { ...RFC_6455, section: '7.1.7' };
/** The status code registry and its ranges. */
export const RFC_6455_CODES: RfcRef = { ...RFC_6455, section: '7.4.1' };
/** Reserved ranges. */
export const RFC_6455_RANGES: RfcRef = { ...RFC_6455, section: '7.4.2' };
/** Ping. */
export const RFC_6455_PING: RfcRef = { ...RFC_6455, section: '5.5.2' };
/** Pong. */
export const RFC_6455_PONG: RfcRef = { ...RFC_6455, section: '5.5.3' };
/** Close frames. */
export const RFC_6455_CLOSE_FRAME: RfcRef = { ...RFC_6455, section: '5.5.1' };
/** Recovering from abnormal closure -- where the backoff advice lives. */
export const RFC_6455_RECONNECT: RfcRef = { ...RFC_6455, section: '7.2.3' };

// ---------------------------------------------------------------------------
// Ready states
// ---------------------------------------------------------------------------

/**
 * The four states of a connection, named as the browser API names them.
 *
 * The numbers matter because they are what `socket.readyState` actually holds, and because
 * the commonest WebSocket bug in any codebase is sending on a socket in `connecting` --
 * which throws, because the handshake has not finished and there is nowhere to put the
 * frame yet.
 */
export type ReadyState = 'connecting' | 'open' | 'closing' | 'closed';

/** The numeric value each state has in the browser API. */
export const READY_STATE_VALUES: Readonly<Record<ReadyState, number>> = {
  connecting: 0,
  open: 1,
  closing: 2,
  closed: 3,
};

/** What each state means for the code holding the socket. */
export function describeReadyState(state: ReadyState): string {
  switch (state) {
    case 'connecting':
      return 'The HTTP upgrade is in flight. send() throws here -- there is no frame stream yet. This is the state most "why did my first message vanish" bugs live in.';
    case 'open':
      return 'Frames may travel in both directions, independently. There is no request/response pairing and no ordering between the two directions.';
    case 'closing':
      return 'A Close frame has been sent or received. No new messages may be sent, but frames already in flight must still be read until the peer’s Close arrives.';
    case 'closed':
      return 'The underlying TCP connection is down. Whether that was clean depends entirely on whether both Close frames were exchanged first.';
  }
}

// ---------------------------------------------------------------------------
// Close codes
// ---------------------------------------------------------------------------

/** Which block of the number space a close code falls in. */
export type CloseCodeRange = 'unused' | 'protocol' | 'registered' | 'private';

/** One close code, and whether it may ever appear in a frame. */
export interface CloseCodeInfo {
  readonly code: number;
  readonly name: string;
  /**
   * Whether an endpoint may put this code in a Close frame.
   *
   * The four that may not -- 1004, 1005, 1006, 1015 -- are the interesting ones. They are
   * values a local API reports to its own caller, never values that cross the wire.
   */
  readonly sendable: boolean;
  readonly meaning: string;
  /** Who normally sends it, when that is not obvious. */
  readonly sender?: 'client' | 'server';
  readonly reference: RfcRef;
}

/**
 * The close codes RFC 6455 defines, plus the three later IANA registrations.
 *
 * The `sendable` column is the reason this table is data rather than prose. Four codes in
 * the middle of the range look exactly like the others and can never be sent, and no amount
 * of explaining that in a paragraph works as well as a table with a column that says so.
 */
export const CLOSE_CODES: readonly CloseCodeInfo[] = [
  {
    code: 1000,
    name: 'Normal Closure',
    sendable: true,
    meaning:
      'The purpose the connection was opened for has been fulfilled. This is what a ' +
      'deliberate close() with no argument sends.',
    reference: RFC_6455_CODES,
  },
  {
    code: 1001,
    name: 'Going Away',
    sendable: true,
    meaning:
      'The endpoint is disappearing: a browser navigating away or closing a tab, or a ' +
      'server shutting down. Distinct from 1000 because it says nothing was wrong -- the ' +
      'client should feel free to reconnect elsewhere.',
    reference: RFC_6455_CODES,
  },
  {
    code: 1002,
    name: 'Protocol Error',
    sendable: true,
    meaning:
      'The peer sent something the protocol forbids: a reserved opcode, an RSV bit nobody ' +
      'negotiated, an unmasked client frame, a non-minimal length encoding.',
    reference: RFC_6455_CODES,
  },
  {
    code: 1003,
    name: 'Unsupported Data',
    sendable: true,
    meaning:
      'The data was well-formed but of a type this endpoint cannot accept -- a binary frame ' +
      'to an endpoint that only understands text. Note the difference from 1007: the frame ' +
      'was legal, the content was unwelcome.',
    reference: RFC_6455_CODES,
  },
  {
    code: 1004,
    name: 'Reserved',
    sendable: false,
    meaning:
      'Reserved with no meaning ever assigned. It was going to be "frame too large" before ' +
      '1009 took that job. Do not send it, and do not expect it.',
    reference: RFC_6455_CODES,
  },
  {
    code: 1005,
    name: 'No Status Received',
    sendable: false,
    meaning:
      'A Close frame arrived carrying no payload at all, which is legal. The local API ' +
      'invents 1005 so that its callback has a number to report. It is never in the frame ' +
      '-- the frame was empty, that is the entire point.',
    reference: RFC_6455_CODES,
  },
  {
    code: 1006,
    name: 'Abnormal Closure',
    sendable: false,
    meaning:
      'The connection went down without a Close frame in either direction. There is no ' +
      'frame to put this in and there never can be. Seeing 1006 in a log means the reason ' +
      'was not recorded anywhere: a proxy idle timeout, a NAT eviction, a crash, a lost ' +
      'network. It is the absence of an explanation, not an explanation.',
    reference: RFC_6455_CODES,
  },
  {
    code: 1007,
    name: 'Invalid Frame Payload Data',
    sendable: true,
    meaning:
      'A text frame whose payload is not well-formed UTF-8. Required, not optional -- there ' +
      'is no lenient mode and no replacement character.',
    reference: RFC_6455_CODES,
  },
  {
    code: 1008,
    name: 'Policy Violation',
    sendable: true,
    meaning:
      'The catch-all for application policy: unauthorised, rate limited, sent something ' +
      'forbidden. Used when no more specific code fits, or when the endpoint would rather ' +
      'not say which rule was broken.',
    reference: RFC_6455_CODES,
  },
  {
    code: 1009,
    name: 'Message Too Big',
    sendable: true,
    meaning:
      'The message exceeded what this endpoint will buffer. A real limit, and one worth ' +
      'setting: the 64-bit length field means a peer may legitimately announce a message ' +
      'larger than your memory.',
    reference: RFC_6455_CODES,
  },
  {
    code: 1010,
    name: 'Mandatory Extension',
    sendable: true,
    sender: 'client',
    meaning:
      'The client needed an extension the server declined to negotiate. Client-to-server ' +
      'only: a server that wanted an extension should simply have refused the handshake.',
    reference: RFC_6455_CODES,
  },
  {
    code: 1011,
    name: 'Internal Error',
    sendable: true,
    sender: 'server',
    meaning:
      'The server hit an unexpected condition. The WebSocket equivalent of a 500, and it ' +
      'deserves the same treatment: log it with detail on the server, say almost nothing in ' +
      'the reason field.',
    reference: RFC_6455_CODES,
  },
  {
    code: 1012,
    name: 'Service Restart',
    sendable: true,
    sender: 'server',
    meaning:
      'Registered with IANA after RFC 6455. The server is restarting; the client should ' +
      'reconnect, but with a randomised delay of 5 to 30 seconds so ten thousand clients do ' +
      'not return at once and take the restart down with them.',
    reference: RFC_6455_CODES,
  },
  {
    code: 1013,
    name: 'Try Again Later',
    sendable: true,
    sender: 'server',
    meaning:
      'Registered after RFC 6455. The server is overloaded and is shedding load. Backing ' +
      'off is the whole message.',
    reference: RFC_6455_CODES,
  },
  {
    code: 1014,
    name: 'Bad Gateway',
    sendable: true,
    sender: 'server',
    meaning:
      'Registered after RFC 6455. A gateway or proxy got an invalid response upstream -- ' +
      'the 502 of WebSockets.',
    reference: RFC_6455_CODES,
  },
  {
    code: 1015,
    name: 'TLS Handshake Failure',
    sendable: false,
    meaning:
      'The TLS handshake failed, so there was never a WebSocket connection to send a Close ' +
      'frame over. Reported locally only, like 1006.',
    reference: RFC_6455_CODES,
  },
];

/** Look one up. */
export function describeCloseCode(code: number): CloseCodeInfo | undefined {
  return CLOSE_CODES.find((entry) => entry.code === code);
}

/**
 * Which block of the space a code belongs to.
 *
 * The ranges are the part worth internalising, because they are what lets an application
 * define its own codes without ever colliding with the protocol's. 4000-4999 is yours: no
 * registration, no coordination, no risk. Reaching for 1008 to mean "your subscription
 * lapsed" wastes that.
 */
export function closeCodeRange(code: number): CloseCodeRange {
  if (code < 1000) return 'unused';
  if (code < 3000) return 'protocol';
  if (code < 4000) return 'registered';
  if (code < 5000) return 'private';
  return 'unused';
}

/** What each range is for. */
export function describeCloseCodeRange(range: CloseCodeRange): string {
  switch (range) {
    case 'unused':
      return 'Not a valid close code. Below 1000 and above 4999 are not used by the protocol and must not be sent.';
    case 'protocol':
      return '1000-2999: the protocol’s own codes and future IANA registrations. Do not invent codes here.';
    case 'registered':
      return '3000-3999: for libraries and frameworks, registered with IANA on a first-come-first-served basis so two libraries never collide.';
    case 'private':
      return '4000-4999: private use. Yours, with no registration and no coordination. This is where an application’s own codes belong.';
  }
}

/**
 * Whether a code may appear in a Close frame.
 *
 * Anything in the private or registered ranges may; in the protocol range, only the codes
 * this module knows and only when their `sendable` flag says so.
 */
export function isSendableCloseCode(code: number): boolean {
  const range = closeCodeRange(code);
  if (range === 'unused') return false;
  if (range === 'private' || range === 'registered') return true;
  return describeCloseCode(code)?.sendable ?? false;
}

// ---------------------------------------------------------------------------
// Close frames
// ---------------------------------------------------------------------------

/** RFC 6455 s 5.5: a control frame carries 125 bytes, and the code takes two of them. */
export const MAX_CLOSE_REASON_BYTES = 123;

/** What a Close frame said. */
export interface CloseInfo {
  /** Absent when the frame carried no payload -- reported locally as 1005. */
  readonly code?: number;
  readonly reason: string;
  /** True when this endpoint invented the code rather than reading it off the wire. */
  readonly local: boolean;
}

/**
 * Build a Close frame.
 *
 * The payload is a big-endian 16-bit code followed by a UTF-8 reason, and both parts are
 * optional as a unit: an empty payload is legal and means "closing, no comment". A reason
 * without a code is *not* legal, because there is nowhere to put it -- the first two bytes
 * are always the code if there is anything at all.
 *
 * The 123-byte cap on the reason is a consequence, not a rule of its own: a control frame is
 * capped at 125 bytes and the code has already spent two. It is a cap in **bytes**, so a
 * reason full of emoji runs out four times faster than one in ASCII, which is a real bug
 * people ship.
 */
export function closeFrame(
  code?: number,
  reason = '',
  options: { maskingKey?: readonly [number, number, number, number] } = {},
): ParseResult<WebSocketFrame> {
  if (code === undefined) {
    if (reason !== '') {
      return fail(
        'a close reason needs a close code: the first two bytes of the payload are the ' +
          'code, so there is nowhere to put a reason without one',
      );
    }
    return ok(frame({ opcode: 'close', payload: new Uint8Array(0), ...options }));
  }

  if (!Number.isInteger(code) || code < 0 || code > 0xffff) {
    return fail(`close code ${code} does not fit in the 16-bit field`);
  }
  if (!isSendableCloseCode(code)) {
    const known = describeCloseCode(code);
    return fail(
      known === undefined
        ? `close code ${code} is outside every usable range (RFC 6455 s 7.4.2)`
        : `close code ${code} (${known.name}) must never be sent in a frame: ${known.meaning}`,
    );
  }

  const reasonBytes = utf8Bytes(reason);
  if (reasonBytes.length > MAX_CLOSE_REASON_BYTES) {
    return fail(
      `a close reason is at most ${MAX_CLOSE_REASON_BYTES} bytes (125 for the control ` +
        `frame, less 2 for the code); this one is ${reasonBytes.length}`,
    );
  }

  const payload = new Uint8Array(2 + reasonBytes.length);
  new DataView(payload.buffer).setUint16(0, code);
  payload.set(reasonBytes, 2);
  return ok(frame({ opcode: 'close', payload, ...options }));
}

/**
 * Read a Close frame's payload.
 *
 * An empty payload succeeds with no code, which the caller reports as 1005. A one-byte
 * payload does not: half a code is a protocol error, and an implementation that padded it or
 * ignored it would be inventing a close reason out of a truncated frame.
 */
export function parseClosePayload(payload: Uint8Array): ParseResult<CloseInfo> {
  if (payload.length === 0) return ok({ reason: '', local: false });
  if (payload.length === 1) {
    return fail('a close payload of one byte is half a status code; that is a 1002');
  }

  const code = new DataView(
    payload.buffer,
    payload.byteOffset,
    payload.byteLength,
  ).getUint16(0);

  if (!isSendableCloseCode(code)) {
    return fail(
      `close code ${code} may not be sent on the wire (${
        describeCloseCode(code)?.name ?? 'outside every usable range'
      })`,
    );
  }

  const reason = strictUtf8Text(payload.slice(2));
  if (!reason.ok) {
    return fail(
      `the close reason ${reason.error}; the reason field is UTF-8, like text frames`,
    );
  }
  return ok({ code, reason: reason.value, local: false });
}

// ---------------------------------------------------------------------------
// Connection state
// ---------------------------------------------------------------------------

/** A message being assembled from fragments. */
export interface PendingMessage {
  readonly opcode: 'text' | 'binary';
  readonly frames: readonly WebSocketFrame[];
}

/** A ping that has gone out and not yet been answered. */
export interface PendingPing {
  readonly sentAt: number;
  /** The application data the pong must echo back, byte for byte. */
  readonly payload: Uint8Array;
}

/** Counters the UI shows, and the transport comparison reuses. */
export interface ConnectionStats {
  readonly messagesSent: number;
  readonly messagesReceived: number;
  readonly framesSent: number;
  readonly framesReceived: number;
  readonly bytesSent: number;
  readonly bytesReceived: number;
  readonly pingsSent: number;
  readonly pongsReceived: number;
}

const ZERO_STATS: ConnectionStats = {
  messagesSent: 0,
  messagesReceived: 0,
  framesSent: 0,
  framesReceived: 0,
  bytesSent: 0,
  bytesReceived: 0,
  pingsSent: 0,
  pongsReceived: 0,
};

/** Everything one endpoint knows about its connection. */
export interface ConnectionState {
  readonly role: 'client' | 'server';
  readonly readyState: ReadyState;
  /** The message currently being assembled, if a fragmented one is in progress. */
  readonly pending?: PendingMessage;
  readonly sentClose?: CloseInfo;
  readonly receivedClose?: CloseInfo;
  readonly pendingPings: readonly PendingPing[];
  /** What the local API would report once `readyState` reaches `closed`. */
  readonly closeCode?: number;
  readonly closeReason: string;
  /**
   * True only when Close frames were exchanged in **both** directions before the transport
   * came down. This is the flag `event.wasClean` reports, and it is the only reliable way to
   * tell a deliberate shutdown from a vanished network.
   */
  readonly wasClean: boolean;
  readonly stats: ConnectionStats;
}

/** A connection that has just finished its handshake. */
export function openConnection(role: 'client' | 'server'): ConnectionState {
  return {
    role,
    readyState: 'open',
    pendingPings: [],
    closeReason: '',
    wasClean: false,
    stats: ZERO_STATS,
  };
}

/** A connection whose handshake has not finished. */
export function connectingConnection(role: 'client' | 'server'): ConnectionState {
  return { ...openConnection(role), readyState: 'connecting' };
}

// ---------------------------------------------------------------------------
// Stepping the machine
// ---------------------------------------------------------------------------

/** Something the connection did, for the log and the timeline. */
export interface LifecycleEvent {
  readonly at: number;
  readonly kind:
    | 'open'
    | 'message'
    | 'fragment'
    | 'ping'
    | 'pong'
    | 'close-sent'
    | 'close-received'
    | 'closed'
    | 'error';
  readonly level: LogLevel;
  readonly text: string;
  /** The complete message, when this event finished one. */
  readonly message?: { opcode: 'text' | 'binary'; bytes: number; text?: string };
  readonly reference?: RfcRef;
}

/** What one action did: the new state, what to log, and what must now be sent back. */
export interface StepResult {
  readonly state: ConnectionState;
  readonly events: readonly LifecycleEvent[];
  /**
   * Frames this endpoint is now obliged to send.
   *
   * The automatic replies, and only those: a pong for every ping, and the echoing Close that
   * completes a closing handshake. Both are protocol obligations rather than application
   * choices, which is why they belong to the state machine and not to the caller. Everything
   * else a scenario sends, it sends deliberately.
   */
  readonly emit: readonly WebSocketFrame[];
}

/** Something that happens to the connection. */
export type LifecycleAction =
  /** The `101` arrived and was accepted. */
  | { readonly kind: 'handshake-complete'; readonly at: number }
  /** This endpoint sends a frame it chose to send. */
  | { readonly kind: 'send'; readonly at: number; readonly frame: WebSocketFrame }
  /** A frame arrives from the peer. */
  | { readonly kind: 'receive'; readonly at: number; readonly frame: WebSocketFrame }
  /** The TCP connection went away underneath. The 1006 path. */
  | { readonly kind: 'transport-lost'; readonly at: number; readonly reason: string }
  /** Both Close frames have been exchanged and the socket is now down. */
  | { readonly kind: 'transport-closed'; readonly at: number };

/**
 * Apply one action.
 *
 * A reducer, deliberately: the state is a value, the result is a value, and nothing is
 * mutated. That makes a whole connection a `reduce` over a list of actions, which is how
 * `exchange.ts` will drive it, and it makes any moment in a scenario reachable by replaying
 * the actions up to it -- which is what a scrubbing timeline needs.
 */
export function step(state: ConnectionState, action: LifecycleAction): StepResult {
  switch (action.kind) {
    case 'handshake-complete':
      return {
        state: { ...state, readyState: 'open' },
        events: [
          {
            at: action.at,
            kind: 'open',
            level: 'info',
            text: 'Connection open. Both directions are now independent frame streams -- there is no request/response pairing from here on.',
            reference: RFC_6455_CLOSING,
          },
        ],
        emit: [],
      };

    case 'send':
      return stepSend(state, action.at, action.frame);

    case 'receive':
      return stepReceive(state, action.at, action.frame);

    case 'transport-lost': {
      const events: LifecycleEvent[] = [
        {
          at: action.at,
          kind: 'error',
          level: 'error',
          text:
            `The transport dropped (${action.reason}). No Close frame was exchanged, so the ` +
            'local API reports 1006 -- a code that is never on the wire and carries no ' +
            'reason, because there was nothing to carry one.',
          reference: RFC_6455_FAIL,
        },
      ];
      return {
        state: {
          ...state,
          readyState: 'closed',
          closeCode: 1006,
          closeReason: '',
          wasClean: false,
        },
        events,
        emit: [],
      };
    }

    case 'transport-closed': {
      const clean = state.sentClose !== undefined && state.receivedClose !== undefined;
      const code =
        state.receivedClose?.code ?? state.sentClose?.code ?? (clean ? 1005 : 1006);
      return {
        state: {
          ...state,
          readyState: 'closed',
          closeCode: code,
          closeReason: state.receivedClose?.reason ?? state.sentClose?.reason ?? '',
          wasClean: clean,
        },
        events: [
          {
            at: action.at,
            kind: 'closed',
            level: clean ? 'info' : 'warn',
            text: clean
              ? `Closed cleanly with ${code}. Both Close frames crossed before the socket came down, which is what makes wasClean true. RFC 6455 s 7.1.1 then has the server -- not the client -- close the underlying TCP connection, so a client never has to invent a timeout for the last step of a shutdown.`
              : 'Closed without a completed closing handshake. wasClean is false.',
            reference: RFC_6455_CLOSING,
          },
        ],
        emit: [],
      };
    }
  }
}

function stepSend(state: ConnectionState, at: number, value: WebSocketFrame): StepResult {
  if (state.readyState === 'connecting') {
    return {
      state,
      events: [
        {
          at,
          kind: 'error',
          level: 'error',
          text: 'send() on a socket in CONNECTING throws. The handshake has not finished, so there is no frame stream to write to -- this is the bug behind most "my first message disappeared" reports.',
          reference: RFC_6455_CLOSING,
        },
      ],
      emit: [],
    };
  }

  if (state.readyState !== 'open' && !isControlOpcode(value.opcode)) {
    return {
      state,
      events: [
        {
          at,
          kind: 'error',
          level: 'warn',
          text: 'A Close frame has already been sent, so no further data frames may go out. Frames still arriving must be read, but nothing new may be written.',
          reference: RFC_6455_CLOSING,
        },
      ],
      emit: [],
    };
  }

  const bytes = frameBytes(value);
  const stats: ConnectionStats = {
    ...state.stats,
    framesSent: state.stats.framesSent + 1,
    bytesSent: state.stats.bytesSent + bytes,
  };

  if (value.opcode === 'close') {
    const parsed = parseClosePayload(value.payload);
    const info: CloseInfo = parsed.ok ? parsed.value : { reason: '', local: true };
    return {
      state: { ...state, readyState: 'closing', sentClose: info, stats },
      events: [
        {
          at,
          kind: 'close-sent',
          level: 'info',
          text:
            `Close sent${info.code === undefined ? ' with no code' : ` with ${info.code}`}` +
            `${info.reason === '' ? '' : ` (${info.reason})`}. The connection is now CLOSING: ` +
            'nothing more may be sent, but frames already in flight must still be read until ' +
            'the peer answers with its own Close.',
          reference: RFC_6455_CLOSE_FRAME,
        },
      ],
      emit: [],
    };
  }

  if (value.opcode === 'ping') {
    return {
      state: {
        ...state,
        pendingPings: [...state.pendingPings, { sentAt: at, payload: value.payload }],
        stats: { ...stats, pingsSent: stats.pingsSent + 1 },
      },
      events: [
        {
          at,
          kind: 'ping',
          level: 'info',
          text: `Ping sent (${value.payload.length} bytes of application data). The peer must answer with a pong carrying exactly these bytes back, as soon as it practically can.`,
          reference: RFC_6455_PING,
        },
      ],
      emit: [],
    };
  }

  const finishing = value.fin && value.opcode !== 'pong';
  return {
    state: {
      ...state,
      stats: finishing ? { ...stats, messagesSent: stats.messagesSent + 1 } : stats,
    },
    events: [
      {
        at,
        kind: value.opcode === 'pong' ? 'pong' : value.fin ? 'message' : 'fragment',
        level: 'info',
        text: describeOutgoing(value, bytes),
      },
    ],
    emit: [],
  };
}

function describeOutgoing(value: WebSocketFrame, bytes: number): string {
  const mask = value.masked ? 'masked' : 'unmasked';
  if (value.opcode === 'pong') {
    return `Pong sent, echoing ${value.payload.length} bytes (${bytes} on the wire, ${mask}).`;
  }
  if (!value.fin) {
    return `Fragment sent: ${value.opcode === 'continuation' ? 'continuation' : value.opcode} frame, FIN 0, ${value.payload.length} bytes of payload in ${bytes} on the wire (${mask}).`;
  }
  return `Message sent: ${value.payload.length} bytes of payload in ${bytes} on the wire (${mask}). The same content over HTTP would have cost several hundred bytes of field lines.`;
}

function stepReceive(
  state: ConnectionState,
  at: number,
  value: WebSocketFrame,
): StepResult {
  const bytes = frameBytes(value);
  const stats: ConnectionStats = {
    ...state.stats,
    framesReceived: state.stats.framesReceived + 1,
    bytesReceived: state.stats.bytesReceived + bytes,
  };

  if (value.opcode === 'ping') {
    // The pong must carry the ping's application data back unchanged. Not a similar
    // payload, not an empty one -- the identical bytes, which is what lets a sender match a
    // pong to the ping it sent and measure a round trip from it.
    const reply = pongFrame(value.payload);
    return {
      state: { ...state, stats },
      events: [
        {
          at,
          kind: 'ping',
          level: 'info',
          text: `Ping received. Answering with a pong carrying the identical ${value.payload.length} bytes -- an obligation, not a courtesy, and one a browser fulfils automatically without telling the page it happened.`,
          reference: RFC_6455_PONG,
        },
      ],
      emit: [reply],
    };
  }

  if (value.opcode === 'pong') {
    const matchIndex = state.pendingPings.findIndex((ping) =>
      sameBytes(ping.payload, value.payload),
    );
    const matched = matchIndex === -1 ? undefined : state.pendingPings[matchIndex];
    return {
      state: {
        ...state,
        pendingPings: state.pendingPings.filter((_, index) => index !== matchIndex),
        stats: { ...stats, pongsReceived: stats.pongsReceived + 1 },
      },
      events: [
        {
          at,
          kind: 'pong',
          level: 'info',
          text:
            matched === undefined
              ? 'An unsolicited pong. Entirely legal: RFC 6455 s 5.5.3 allows a one-way heartbeat that expects no reply, and the receiver must not answer it.'
              : `Pong received, matching the ping sent at ${matched.sentAt} ms. Round trip: ${at - matched.sentAt} ms, measured on the connection itself rather than on a fresh one.`,
          reference: RFC_6455_PONG,
        },
      ],
      emit: [],
    };
  }

  if (value.opcode === 'close') {
    const parsed = parseClosePayload(value.payload);
    if (!parsed.ok) {
      return {
        state: { ...state, readyState: 'closing', stats },
        events: [
          {
            at,
            kind: 'error',
            level: 'error',
            text: `The Close frame is malformed: ${parsed.error}. Answer with 1002 and close.`,
            reference: RFC_6455_CLOSE_FRAME,
          },
        ],
        emit: unwrapClose(closeFrame(1002, 'malformed close frame')),
      };
    }

    const info = parsed.value;
    const alreadyClosing = state.sentClose !== undefined;
    // The endpoint that did not start the close echoes one back and then stops. The
    // endpoint that started it has nothing left to send -- its Close already went out.
    const emit = alreadyClosing ? [] : unwrapClose(closeFrame(info.code ?? 1000, ''));

    return {
      state: {
        ...state,
        readyState: 'closing',
        receivedClose: info,
        ...(alreadyClosing ? {} : { sentClose: { ...info, local: true } }),
        stats,
      },
      events: [
        {
          at,
          kind: 'close-received',
          level: 'info',
          text: alreadyClosing
            ? `Close received with ${info.code ?? 'no code'}, answering the one already sent. The closing handshake is complete in both directions; the server now closes the TCP connection.`
            : `Close received with ${info.code ?? 'no code'}${info.reason === '' ? '' : ` (${info.reason})`}. The peer started the closing handshake, so this endpoint echoes a Close back and sends nothing further.`,
          reference: RFC_6455_CLOSING,
        },
      ],
      emit,
    };
  }

  // A data frame. Fragmentation is tracked here rather than in frames.ts because whether a
  // continuation is legal depends on what came before it on *this connection*.
  if (value.opcode === 'continuation') {
    if (state.pending === undefined) {
      return protocolError(
        state,
        at,
        stats,
        'A continuation frame arrived with no message in progress. Nothing states what type it would continue, so there is no way to interpret it: fail the connection with 1002.',
      );
    }
    const frames = [...state.pending.frames, value];
    if (!value.fin) {
      return {
        state: { ...state, pending: { ...state.pending, frames }, stats },
        events: [
          {
            at,
            kind: 'fragment',
            level: 'info',
            text: `Continuation received (${value.payload.length} bytes). Still no FIN -- the message is ${frames.length} frames long so far and cannot be delivered to the application yet.`,
            reference: RFC_6455_CLOSE_FRAME,
          },
        ],
        emit: [],
      };
    }
    return completeMessage(state, at, stats, frames);
  }

  if (state.pending !== undefined) {
    return protocolError(
      state,
      at,
      stats,
      `A new ${value.opcode} frame arrived while a ${state.pending.opcode} message was still open. Messages may not interleave -- only control frames may appear between fragments.`,
    );
  }

  if (!value.fin) {
    return {
      state: {
        ...state,
        pending: { opcode: value.opcode as 'text' | 'binary', frames: [value] },
        stats,
      },
      events: [
        {
          at,
          kind: 'fragment',
          level: 'info',
          text: `First fragment of a ${value.opcode} message (${value.payload.length} bytes, FIN 0). The type is declared once, here; every frame after it carries the continuation opcode instead.`,
        },
      ],
      emit: [],
    };
  }

  return completeMessage(state, at, stats, [value]);
}

function completeMessage(
  state: ConnectionState,
  at: number,
  stats: ConnectionStats,
  frames: readonly WebSocketFrame[],
): StepResult {
  const assembled = reassemble(frames);
  if (!assembled.ok) {
    return protocolError(state, at, stats, assembled.error);
  }

  const { opcode, payload, frameCount, text } = assembled.value;
  // `pending` is rebuilt rather than spread-and-deleted: the message is finished, so the
  // slot must be absent, not present and undefined.
  const next: ConnectionState = {
    role: state.role,
    readyState: state.readyState,
    ...(state.sentClose === undefined ? {} : { sentClose: state.sentClose }),
    ...(state.receivedClose === undefined ? {} : { receivedClose: state.receivedClose }),
    pendingPings: state.pendingPings,
    ...(state.closeCode === undefined ? {} : { closeCode: state.closeCode }),
    closeReason: state.closeReason,
    wasClean: state.wasClean,
    stats: { ...stats, messagesReceived: stats.messagesReceived + 1 },
  };

  return {
    state: next,
    events: [
      {
        at,
        kind: 'message',
        level: 'info',
        text:
          frameCount === 1
            ? `Message received: ${payload.length} bytes of ${opcode}.`
            : `Message complete: ${payload.length} bytes of ${opcode}, reassembled from ${frameCount} frames. UTF-8 is validated now and not per fragment, because a multi-byte character may straddle a fragment boundary.`,
        message: {
          opcode,
          bytes: payload.length,
          ...(text === undefined ? {} : { text }),
        },
      },
    ],
    emit: [],
  };
}

function protocolError(
  state: ConnectionState,
  at: number,
  stats: ConnectionStats,
  text: string,
): StepResult {
  const code = text.includes('UTF-8') ? 1007 : 1002;
  return {
    state: { ...state, readyState: 'closing', stats },
    events: [
      {
        at,
        kind: 'error',
        level: 'error',
        text: `${text} Closing with ${code}.`,
        reference: RFC_6455_FAIL,
      },
    ],
    emit: unwrapClose(closeFrame(code, '')),
  };
}

function unwrapClose(result: ParseResult<WebSocketFrame>): WebSocketFrame[] {
  // The codes passed here are literals from this file, so a failure would mean a bug in
  // this file rather than bad input. Falling back to an empty Close keeps the machine
  // running rather than throwing inside a reducer.
  return [result.ok ? result.value : frame({ opcode: 'close' })];
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

/** Run a whole list of actions through {@link step}. */
export function runLifecycle(
  initial: ConnectionState,
  actions: readonly LifecycleAction[],
): { state: ConnectionState; events: readonly LifecycleEvent[] } {
  let state = initial;
  const events: LifecycleEvent[] = [];
  for (const action of actions) {
    const result = step(state, action);
    state = result.state;
    events.push(...result.events);
  }
  return { state, events };
}

/** The text a text message carried, for a caller that has the frames but not the state. */
export function messageText(frames: readonly WebSocketFrame[]): string | undefined {
  const assembled = reassemble(frames);
  return assembled.ok ? assembled.value.text : undefined;
}

// ---------------------------------------------------------------------------
// Keepalive
// ---------------------------------------------------------------------------

/** How an endpoint paces its pings. */
export interface KeepaliveOptions {
  /** How often to ping. 20-30 s is the usual choice, and the reason is below. */
  readonly intervalMs?: number;
  /** How long to wait for the pong before declaring the connection dead. */
  readonly timeoutMs?: number;
  /** How long the run lasts. */
  readonly durationMs: number;
  /** The ping index at which pongs stop coming back, if the scenario wants a death. */
  readonly failAfterPing?: number;
}

/** One ping and what became of it. */
export interface KeepaliveBeat {
  readonly index: number;
  readonly sentAt: number;
  /** Absent when no pong came back. */
  readonly pongAt?: number;
  readonly roundTripMs?: number;
  /** True when this is the ping whose silence ends the connection. */
  readonly timedOut: boolean;
}

/** A keepalive run. */
export interface KeepaliveRun {
  readonly beats: readonly KeepaliveBeat[];
  /** When the connection was declared dead, if it was. */
  readonly deadAt?: number;
  /** Total wire bytes the keepalive cost over the run. */
  readonly overheadBytes: number;
  readonly explain: string;
}

/**
 * Simulate a keepalive.
 *
 * The interval is the interesting parameter and 25 seconds is not arbitrary. It has to be
 * comfortably shorter than the shortest idle timeout on the path, and the shortest one is
 * usually a load balancer or NAT at 30 to 60 seconds. Too long and the connection is
 * silently evicted between beats; too short and a mobile client wakes its radio every few
 * seconds, which is a battery decision rather than a networking one.
 *
 * The round trip a pong measures is worth more than a fresh ping to the same host: it is
 * measured *on this connection*, through the same proxies and the same queues that the
 * application's own messages travel through.
 */
export function simulateKeepalive(options: KeepaliveOptions): KeepaliveRun {
  const interval = options.intervalMs ?? 25_000;
  const timeout = options.timeoutMs ?? 10_000;
  const beats: KeepaliveBeat[] = [];
  // A ping frame with no payload is 2 bytes from the server; the client's pong carries a
  // masking key, so it is 6. Ten bytes a minute is what liveness costs at a 25 s interval.
  const pingBytes = 2;
  const pongBytes = 6;
  let overheadBytes = 0;
  let deadAt: number | undefined;

  for (let index = 1; index * interval <= options.durationMs; index += 1) {
    const sentAt = index * interval;
    overheadBytes += pingBytes;
    const failed = options.failAfterPing !== undefined && index > options.failAfterPing;
    if (failed) {
      beats.push({ index, sentAt, timedOut: true });
      deadAt = sentAt + timeout;
      break;
    }
    // A round trip that grows very slightly with each beat, so the panel does not show a
    // suspiciously flat line. Deterministic, like everything else here.
    const roundTripMs = 40 + (index % 5) * 3;
    overheadBytes += pongBytes;
    beats.push({
      index,
      sentAt,
      pongAt: sentAt + roundTripMs,
      roundTripMs,
      timedOut: false,
    });
  }

  return {
    beats,
    ...(deadAt === undefined ? {} : { deadAt }),
    overheadBytes,
    explain:
      `A ping every ${Math.round(interval / 1000)} s costs ${pingBytes + pongBytes} bytes a ` +
      'beat and buys two things: proof the peer is alive, and enough traffic that the NAT ' +
      'tables and load balancers on the path do not evict a flow they think is idle. ' +
      'Browsers cannot send pings -- the WebSocket API has no method for it -- so in a ' +
      'browser deployment this is always the server’s job.',
  };
}

// ---------------------------------------------------------------------------
// Reconnecting
// ---------------------------------------------------------------------------

/** How the client backs off between reconnection attempts. */
export interface BackoffOptions {
  /** The first delay, before any jitter. Default 1000 ms. */
  readonly baseMs?: number;
  /** Multiplier per attempt. Default 2. */
  readonly factor?: number;
  /** Ceiling on the delay, however many attempts have failed. Default 30 s. */
  readonly maxMs?: number;
  /**
   * How much randomness to add.
   *
   * `none` is the version everybody writes first and it is the one that causes the outage;
   * see {@link explainBackoff}. `full` picks uniformly from `[0, cap]`; `equal` picks from
   * `[cap/2, cap]`, which spreads the herd while still guaranteeing progress.
   */
  readonly jitter?: 'none' | 'full' | 'equal';
  /** Seed for the deterministic jitter. */
  readonly seed?: number | string;
}

/** One reconnection attempt. */
export interface BackoffAttempt {
  readonly attempt: number;
  /** `base * factor^(attempt-1)`, capped -- what the delay would be with no jitter. */
  readonly capMs: number;
  readonly delayMs: number;
  /** Milliseconds from the disconnection to this attempt. */
  readonly elapsedMs: number;
}

/**
 * The delays between reconnection attempts.
 *
 * RFC 6455 s 7.2.3 asks for exponential backoff with randomisation, and is unusually
 * insistent about it for a framing specification. The reason is that WebSocket clients fail
 * in herds: a server restarts, and every one of its connections drops within the same
 * second. Without jitter they all wait exactly one second, all reconnect at the same
 * instant, all fail together, all wait exactly two seconds, and so on -- a synchronised wave
 * that can keep a recovering server down indefinitely. The randomisation is not politeness,
 * it is what breaks the synchronisation.
 */
export function backoffSchedule(
  attempts: number,
  options: BackoffOptions = {},
): readonly BackoffAttempt[] {
  const base = options.baseMs ?? 1_000;
  const factor = options.factor ?? 2;
  const max = options.maxMs ?? 30_000;
  const jitter = options.jitter ?? 'full';
  const rng = createRng(`backoff:${options.seed ?? 'default'}`);

  const schedule: BackoffAttempt[] = [];
  let elapsed = 0;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const capMs = Math.min(max, base * factor ** (attempt - 1));
    let delayMs = capMs;
    if (jitter === 'full') delayMs = Math.round(rng.next() * capMs);
    if (jitter === 'equal') delayMs = Math.round(capMs / 2 + rng.next() * (capMs / 2));
    elapsed += delayMs;
    schedule.push({ attempt, capMs, delayMs, elapsedMs: elapsed });
  }
  return schedule;
}

/** Why the jitter is the important half. */
export function explainBackoff(): {
  headline: string;
  detail: string;
  reference: RfcRef;
} {
  return {
    headline: 'The exponent saves the client. The jitter saves the server.',
    detail:
      'WebSocket clients disconnect in herds -- one server restart drops every connection ' +
      'it had within the same second. Backoff without randomisation keeps them ' +
      'synchronised: they all wait one second, all reconnect together, all fail together, ' +
      'all wait two. The recovering server meets the entire herd at every step and may ' +
      'never come back. Full jitter -- a delay chosen uniformly between zero and the cap -- ' +
      'spreads the same attempts across the whole window and turns a wave into a trickle.',
    reference: RFC_6455_RECONNECT,
  };
}

/** The opcode of a frame as a display name, for the log. */
export function opcodeLabel(opcode: Opcode): string {
  return opcode === 'continuation' ? 'continuation' : opcode;
}

/** Bytes back to text for a preview pane. Lenient by design; see `digest.ts`. */
export function previewPayload(payload: Uint8Array): string {
  return utf8Text(payload);
}
