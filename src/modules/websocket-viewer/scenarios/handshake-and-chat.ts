/**
 * Scenario 1 -- the moment a request stops being a request.
 *
 * Everything else in this module happens on the far side of a `101`, so the `101` has to be
 * understood first. What makes it worth a whole scenario is that nothing about the opening
 * message is special: it is a `GET`, on port 443, with a `Host` field, and every proxy,
 * firewall, load balancer, and access log on the path handles it exactly as it handles any
 * other `GET`. That is not an accident of the design -- it *is* the design. WebSockets
 * deploy because the first packet is indistinguishable from traffic the world already
 * permits.
 *
 * Three things are worth watching for.
 *
 * **The accept value is a proof of comprehension, not a secret.** The key is a public nonce,
 * the GUID is printed in the RFC, and the digest is SHA-1 -- broken for signatures and
 * perfectly adequate here, because nothing authenticates on it. What it proves is that the
 * responder read the request and understood which protocol was being asked for. A cached
 * `101` from some earlier connection, or a naive endpoint echoing headers back, cannot
 * produce it.
 *
 * **The server picks the subprotocol from its own preference order.** The client offers
 * `chat.v2` first and gets `chat.v1`, because the server listed `chat.v1` first and the
 * server is the party that knows which of its implementations is best maintained. Every
 * negotiation in HTTP works this way round.
 *
 * **After the blank line, the arithmetic changes completely.** The handshake costs several
 * hundred bytes and is paid once. The four messages after it cost eleven, nine, thirteen and
 * seven -- and four HTTP requests carrying the same words would have cost more than the
 * handshake did.
 */

import type { WebSocketScenario } from '../sim/exchange';

import {
  CLIENT_SUBPROTOCOLS,
  PAGE_ORIGIN,
  RFC_EXAMPLE_KEY,
  SERVER_SUBPROTOCOLS,
  WS_HOST,
} from './common';

/** The upgrade, and then a short conversation on the far side of it. */
export const HANDSHAKE_AND_CHAT: WebSocketScenario = {
  id: 'handshake-and-chat',
  title: 'The upgrade, and the chat after it',
  summary:
    'An ordinary HTTP/1.1 GET asks to stop being HTTP. The server derives Sec-WebSocket-Accept step by step, answers 101, and from the blank line onward the same TCP connection carries frames in both directions at eleven bytes a message.',
  teaches: [
    'A WebSocket begins as a GET on port 443, which is exactly why it deploys through infrastructure that has never heard of it',
    'Sec-WebSocket-Accept is SHA-1(key + a fixed public GUID), base64 -- a proof of comprehension, not a secret',
    'Connection is a token list, so Connection: keep-alive, Upgrade is correct and a server comparing the whole value is broken',
    'The server picks the subprotocol from its own preference order, applied to the client’s set',
    'The blank line ending the 101 is the exact byte where HTTP stops and frames begin',
    'Once open there is no request/response pairing at all: two independent streams sharing one connection',
  ],
  plan: {
    kind: 'session',
    handshake: {
      resource: '/chat?room=lobby',
      host: WS_HOST,
      // The key printed in RFC 6455 s 1.2, so the derivation panel shows the digest the
      // specification prints. A real client draws sixteen fresh random bytes per connection.
      key: RFC_EXAMPLE_KEY,
      origin: PAGE_ORIGIN,
      subprotocols: [...CLIENT_SUBPROTOCOLS],
      policy: {
        subprotocols: [...SERVER_SUBPROTOCOLS],
        allowedOrigins: [PAGE_ORIGIN],
      },
    },
    steps: [
      {
        kind: 'message',
        id: 'client-hello',
        title: 'Client sends a message',
        from: 'client',
        intent:
          'Six bytes of text in an eleven-byte frame: two bytes of header, four of masking key, five of payload. The same five characters as an HTTP POST would have cost several hundred bytes of field lines, and would have needed a reply.',
        text: 'hello',
        afterMs: 90,
        notes: [
          'The MASK bit is 1 and there is a masking key, because this frame is going client to server. Every one of them is, without exception.',
        ],
      },
      {
        kind: 'message',
        id: 'server-broadcast',
        title: 'Server sends, unprompted',
        from: 'server',
        intent:
          'Nothing asked for this. The server had something to say and said it -- which is the entire difference from HTTP, where a server may only ever answer. Note the frame is two bytes shorter than the client’s: no masking key.',
        text: 'ada joined the room',
        afterMs: 140,
      },
      {
        kind: 'message',
        id: 'client-typing',
        title: 'Client sends again',
        from: 'client',
        intent:
          'A second message on the same connection. No handshake, no headers, no cookies re-sent, no TCP slow start -- the connection was already warm and stays warm.',
        text: 'is anyone here?',
        afterMs: 260,
      },
      {
        kind: 'message',
        id: 'server-reply',
        title: 'Server answers',
        from: 'server',
        intent:
          'It looks like a reply and the protocol does not think it is one. There is no request id, no correlation, and no ordering guarantee between the two directions. An application that needs request/response over a WebSocket has to build it, and most do.',
        text: 'ada: yes, hello',
        afterMs: 180,
      },
    ],
  },
  notes: [
    {
      phase: 'handshake',
      text: 'Read the request as an ordinary GET, because that is what every machine between here and the server reads it as. Only three field lines make it a WebSocket handshake: Upgrade names the protocol, Connection lists Upgrade as a connection option, and Sec-WebSocket-Key carries sixteen random bytes. Connection is a comma-separated token *list* -- browsers really do send "keep-alive, Upgrade" -- and a server that compares the whole field value against the string "Upgrade" rejects them and blames the browser.',
      reference: { rfc: 6455, section: '4.1', title: 'The WebSocket Protocol' },
    },
    {
      phase: 'client-hello',
      text: 'The connection is open, and the arithmetic has changed. This frame is 11 bytes: 2 of header, 4 of masking key, 5 of payload. The handshake above it cost several hundred and is never paid again. That ratio -- a few hundred once, then two to fourteen bytes a message -- is the whole argument, and the transport comparison scenario counts it out in full.',
      reference: { rfc: 6455, section: '5.2', title: 'The WebSocket Protocol' },
    },
    {
      phase: 'server-broadcast',
      target: 'server',
      text: 'The server sent this without being asked. Over HTTP that sentence is not expressible: a server may answer a request and nothing else, which is why every pre-WebSocket approach to live data is a way of keeping a request open long enough to answer it late. Note also that this frame has no masking key. Masking defends against page script choosing wire bytes, and there is no page script on this side.',
      reference: { rfc: 6455, section: '5.1', title: 'The WebSocket Protocol' },
    },
  ],
};
