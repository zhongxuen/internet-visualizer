/**
 * Scenario 5 -- saying goodbye, and the code you will never find in a table.
 *
 * Closing a WebSocket is a handshake, not an event. One endpoint sends a Close frame and
 * stops writing; the other echoes a Close back and stops writing; only then does the TCP
 * connection come down. Both halves are required, and `wasClean` is true only when both
 * happened -- which makes it the one reliable way to tell a deliberate shutdown from a
 * network that vanished.
 *
 * The server starts it here, on purpose. A deploy is the most common reason a WebSocket
 * closes in production, and it is the case where the code matters most: 1001 *Going Away*
 * says nothing was wrong, so a client should reconnect, immediately and elsewhere. 1000
 * *Normal Closure* would have said the purpose was fulfilled, which is the wrong message to
 * send a client that is meant to come straight back.
 *
 * The server also brings the TCP connection down, and that is a rule rather than a habit:
 * RFC 6455 s 7.1.1 says the server MUST close the underlying connection once the handshake is
 * complete, and the client SHOULD wait for it to do so. The client is therefore never left
 * guessing whether more frames are coming, and never has to invent a timeout for the last
 * step of a shutdown -- it either sees the connection close or it does not, and if it does
 * not, it has learned something too.
 *
 * ## 1006 is never on the wire
 *
 * The close-code table beside this run has a `sendable` column, and four codes fail it:
 * 1004, 1005, 1006, and 1015. They look like the others and can never appear in a frame. They
 * are values a *local API* invents at the moment it gives up:
 *
 * - **1005** -- a Close frame arrived with no payload at all. Legal, and means "closing, no
 *   comment"; the API needs a number to report, so it reports this one.
 * - **1006** -- no Close frame arrived. The transport died. There is nothing to look up
 *   because there is nothing to explain, and this is the code everyone finds in their logs
 *   and searches for in vain.
 * - **1015** -- the TLS handshake failed, so there was never a WebSocket to send a frame over.
 * - **1004** -- reserved and never defined.
 *
 * A server that tries to *send* 1006 to be helpful is writing a frame the peer must reject
 * with 1002, which is why `closeFrame` refuses the value rather than trusting the caller.
 */

import type { WebSocketScenario } from '../sim/exchange';

import { PAGE_ORIGIN, WS_HOST } from './common';

/** A short session, then a server-initiated close with 1001. */
export const CLOSE_HANDSHAKE: WebSocketScenario = {
  id: 'close-handshake',
  title: 'The closing handshake, and the code never sent',
  summary:
    'The server goes away for a deploy and says so with 1001. The client echoes a Close back, the server closes the TCP connection, and wasClean is true because both directions said goodbye. Beside it: the four close codes that can never appear in a frame at all.',
  teaches: [
    'Closing is a handshake: one Close out, one Close echoed back, and only then does TCP come down',
    'wasClean is true only when both Close frames crossed -- the one reliable way to tell shutdown from disconnection',
    '1000 says the purpose was fulfilled; 1001 says the endpoint is disappearing and the client should come back',
    '1004, 1005, 1006 and 1015 are never sent on the wire -- they are what a local API reports when there is no frame to read a code from',
    'A close reason is capped at 123 bytes, not characters: the control frame holds 125 and the code has spent 2',
    '4000-4999 is private use -- yours, with no registration and no risk of colliding with the protocol',
  ],
  conditions: { rttMs: 90 },
  plan: {
    kind: 'session',
    handshake: {
      resource: '/chat?room=lobby',
      host: WS_HOST,
      keySeed: 'close',
      origin: PAGE_ORIGIN,
      policy: { allowedOrigins: [PAGE_ORIGIN] },
    },
    steps: [
      {
        kind: 'message',
        id: 'in-progress',
        title: 'Ordinary traffic',
        from: 'client',
        intent:
          'A message on a connection nobody has any reason to think is about to end.',
        text: 'draft saved',
        afterMs: 110,
      },
      {
        kind: 'message',
        id: 'server-warning',
        title: 'The server gives notice',
        from: 'server',
        intent:
          'An application-level warning, sent as an ordinary text frame. Nothing in the protocol provides this -- the Close frame’s 123-byte reason is for a human reading a log, not for an application to act on -- so a service that wants to drain gracefully has to say so in its own messages first.',
        text: '{"type":"draining","reconnect_after_ms":250}',
        afterMs: 220,
      },
      {
        kind: 'close',
        id: 'server-close',
        title: 'Server closes with 1001',
        from: 'server',
        intent:
          'Going Away. Distinct from 1000 because it says nothing was wrong: the endpoint is disappearing, and the client should feel free to reconnect -- probably to a different instance behind the same name.',
        code: 1001,
        reason: 'server restarting for deploy',
        afterMs: 260,
        notes: [
          'The reason is capped at 123 bytes and not 123 characters: a control frame holds 125, and the code has already taken two. A reason full of emoji runs out four times faster than one in ASCII, and that is a bug people genuinely ship.',
        ],
      },
    ],
  },
  notes: [
    {
      phase: 'server-close',
      target: 'server',
      text: 'The client answers this Close with a Close of its own and then writes nothing further. That echo is the whole handshake: it tells the server that everything it sent was read, which is why a clean close is the only way to know a final message was not lost in a socket buffer. Watch the state column -- the client goes CLOSING, not CLOSED, and stays there until the transport actually comes down.',
      reference: { rfc: 6455, section: '7.1.1', title: 'The WebSocket Protocol' },
    },
    {
      phase: 'server-close',
      text: 'Now look at the close-code table. 1004, 1005, 1006 and 1015 have "never sent" against them, and 1006 is the one everybody meets: it appears in a log, it looks exactly like a code a peer chose, and searching for its meaning finds nothing useful -- because it means no Close frame arrived. It is the name for the absence of an explanation. An endpoint that tried to send it would be writing a frame its peer must reject with 1002, which is why the frame builder in this module refuses the value outright.',
      reference: { rfc: 6455, section: '7.4.1', title: 'The WebSocket Protocol' },
    },
  ],
};
