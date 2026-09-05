/**
 * Scenario 4 -- a message is not a frame.
 *
 * The distinction sounds pedantic until the first time it matters, and then it matters
 * completely: `onmessage` fires once here, and four frames crossed the wire. An application
 * never sees the fragments, and an application that tried to would be reaching past the
 * abstraction into a decision the sender made about buffering.
 *
 * Fragmentation exists so a sender can start transmitting before it knows how long the
 * message will be. A log stream, a live encoder, a file being read in chunks -- none of them
 * can fill in a length field up front without buffering the entire thing first, and buffering
 * a gigabyte to send a gigabyte is not a design, it is a memory limit.
 *
 * The rules are three, and they are all visible below.
 *
 * 1. The first frame carries the real opcode with `FIN` 0. **The type is stated once.**
 * 2. Every frame after it carries the *continuation* opcode, which says nothing about what it
 *    is continuing -- which is why a continuation frame is meaningless on its own and why a
 *    continuation with no message in progress is a protocol error worth 1002.
 * 3. The last one sets `FIN`.
 *
 * And the fourth thing, which is the one worth staying for: **a control frame may be slipped
 * between fragments.** The server pings in the middle of the upload and the client answers
 * immediately, without waiting for the message to finish. That is precisely why RFC 6455
 * s 5.5 forbids fragmenting a control frame: a ping that could itself be split could end up
 * queued behind the very message it was sent to check on.
 *
 * The UTF-8 validation is the last subtlety. It happens on the reassembled message, never per
 * fragment, because a multi-byte character may straddle a boundary -- and this message is
 * chunked at a size that puts one there deliberately.
 */

import type { WebSocketScenario } from '../sim/exchange';

import { PAGE_ORIGIN, WS_HOST } from './common';

/**
 * A message with multi-byte characters in it, chunked so that one is split.
 *
 * The em dash is three bytes in UTF-8 and sits at byte 61. Chunked at 62, the first fragment
 * ends one byte into it -- so that fragment is not valid UTF-8 on its own, and an
 * implementation that validated each one would fail the connection on legal traffic.
 */
const LONG_MESSAGE =
  'Fragmentation lets a sender start before it knows the length — a log stream, a live encoder, a résumé of a file being read in chunks. The receiver reassembles; the application never sees the seams.';

/** One message, four frames, and a ping that arrives in the middle of it. */
export const FRAGMENTED_MESSAGE: WebSocketScenario = {
  id: 'fragmented-message',
  title: 'One message, several frames',
  summary:
    'A long text message split across continuation frames: the opcode declared once with FIN 0, continuations that say nothing about what they continue, and FIN on the last. A ping slips in between fragments and is answered immediately.',
  teaches: [
    'A message is not a frame: onmessage fires once, however many frames crossed',
    'The first frame carries the type with FIN 0; every frame after it carries the continuation opcode',
    'A continuation frame is meaningless alone -- one with no message in progress is a 1002',
    'Fragmentation lets a sender begin before it knows the length, without buffering the whole message',
    'Control frames may be interleaved between fragments, which is exactly why they may not be fragmented themselves',
    'UTF-8 is validated on the reassembled message, never per fragment: a character may straddle a boundary',
  ],
  conditions: { rttMs: 70 },
  plan: {
    kind: 'session',
    handshake: {
      resource: '/stream',
      host: WS_HOST,
      keySeed: 'fragmented',
      origin: PAGE_ORIGIN,
      policy: { allowedOrigins: [PAGE_ORIGIN] },
    },
    steps: [
      {
        kind: 'message',
        id: 'short-first',
        title: 'An unfragmented message, for contrast',
        from: 'client',
        intent:
          'One frame, FIN set, opcode text. The overwhelmingly common case, and worth seeing immediately before the fragmented one so the difference is a difference and not a novelty.',
        text: 'starting upload',
        afterMs: 100,
      },
      {
        kind: 'message',
        id: 'fragmented',
        title: 'The same idea, split across frames',
        from: 'client',
        intent:
          'One message, chunked at 62 bytes. Watch the opcode column: text, then continuation, continuation, continuation -- and FIN only on the last. The receiver holds the pieces and delivers nothing to the application until it sees that bit.',
        text: LONG_MESSAGE,
        fragmentBytes: 62,
        // Two fragments in, the server checks whether anybody is still there.
        interleavePingAfter: 1,
        afterMs: 240,
        notes: [
          'Each fragment has its own masking key. A key reused across the frames of one message would let an attacker who guessed one guess the rest, which is the entire defence gone.',
        ],
      },
      {
        kind: 'message',
        id: 'server-ack',
        title: 'Server acknowledges the whole message',
        from: 'server',
        intent:
          'The server saw one message, not four fragments. Everything about the chunking was a decision the sender made about its own buffers, and nothing above the framing layer has any reason to know about it.',
        text: 'upload received: 201 bytes, one message',
        afterMs: 200,
      },
    ],
  },
  notes: [
    {
      phase: 'fragmented',
      text: 'Look at the first frame: opcode text, FIN 0. The type is declared once, here, and never repeated -- which is what makes a continuation frame meaningless in isolation and why one arriving with no message in progress must fail the connection with 1002. It also means an endpoint cannot decide what to do with a message until it knows the type, which it learned in a frame it may have received a long time ago.',
      reference: { rfc: 6455, section: '5.4', title: 'The WebSocket Protocol' },
    },
    {
      phase: 'fragmented',
      target: 'server',
      text: 'The ping arrives between fragment two and fragment three, and the pong goes back before the message is finished. This is the reason control frames may not be fragmented: if a ping could be split, it could be queued behind the 40 MB upload it was sent to check on, and a liveness check that waits for the thing it is checking is not a liveness check. Control frames are capped at 125 bytes for the same reason -- so one always fits in whatever gap exists.',
      reference: { rfc: 6455, section: '5.5', title: 'The WebSocket Protocol' },
    },
    {
      phase: 'server-ack',
      text: 'The receiver validated the UTF-8 now, on the whole message, and not on any fragment. That is not an optimisation -- it is a correctness requirement. The em dash in that message sits at byte 61, so chunking at 62 ends the first fragment one byte into it. A fragment is therefore not required to be valid UTF-8 on its own, and an implementation that checked each one would fail the connection with 1007 on perfectly legal traffic.',
      reference: { rfc: 6455, section: '5.6', title: 'The WebSocket Protocol' },
    },
  ],
};
