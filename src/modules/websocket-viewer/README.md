# `src/modules/websocket-viewer` — the connection that stops being HTTP

A WebSocket does not begin as a WebSocket. It begins as an ordinary HTTP/1.1 `GET`, on port
80 or 443, routed and logged by infrastructure that has never heard of frames — and only when
the server answers `101 Switching Protocols` does the same TCP connection stop carrying HTTP
and start carrying a two-way stream of frames. Every design decision in RFC 6455 follows from
that: it had to fit through what was already there.

This module is that boundary, drawn precisely, plus everything on the far side of it.

Simulated only. Nothing here opens a socket; see the rules at the bottom.

## What is here

Only `sim/` so far — the pure logic. The scenarios, the UI, and the route come next
(phase 10, prompt 10.4), and the registry entry stays `planned` until they do.

```
sim/                # pure logic -- no React, no DOM, no clock of its own
  digest.ts         # real SHA-1 and base64, checked against published vectors
  message.ts        # the phase-08 request/response model, restated (see below)
  upgrade.ts        # the handshake, with Sec-WebSocket-Accept derived step by step
  frames.ts         # the frame, to the bit: FIN/RSV/opcode/MASK, all three lengths
  lifecycle.ts      # open, messages, ping/pong, the closing handshake, reconnection
  comparison.ts     # polling vs long polling vs SSE vs WebSocket, on one timeline
```

## Why `message.ts` is a copy and not an import

`eslint.config.mjs` forbids `src/modules/<a>` importing from `src/modules/<b>`, and it is
right to: that rule is what keeps ten modules from congealing into one. The HTTP Explorer's
`sim/message.ts` is therefore off limits, and phases 09 and 10A answered the same question
the same way.

What is restated is the shape — ordered field lines, a version on the message, the CRLF wire
form — narrowed hard to what a handshake uses, and with one addition the HTTP Explorer does
not need: `fieldTokens`, because `Connection: keep-alive, Upgrade` is a token *list*, and a
server that compares the whole field value to `"Upgrade"` rejects every browser and then
blames the browser. Everything phase 08 exists to teach and a handshake never touches —
chunked framing, cookie jars, cache freshness, CORS — is deliberately absent.

## The four things worth the module

**The accept derivation is shown, not described.** `deriveAccept` keeps every intermediate:
the key as sent, the fixed GUID appended with nothing between them, the concatenated string,
the twenty-byte digest as hex, and the 28-character base64. Both worked examples in RFC 6455
(§1.2 and §1.3) are test vectors, so the values here match every other implementation on
earth. The digest is real SHA-1 for that reason alone — and `explainSha1Choice` says plainly
why SHA-1 is not a mistake here: nothing authenticates on it, so a collision buys nothing.

**The frame is bit-accurate.** `frameLayout` positions every field to the bit, including all
three payload-length encodings and the rule that the encoding must be *minimal* — a 100-byte
payload sent with the 16-bit escape is a protocol error, because two spellings of one frame
is how two parsers come to disagree about where the next one starts. The six examples in
RFC 6455 §5.7 are encoding tests.

**Masking is explained by its threat, not by hand-waving.** Client frames are always masked;
server frames never are. The reason is a cache-poisoning attack against a transparent proxy
that never understood the upgrade: without masking, page script could choose bytes that spell
out an HTTP request. The direction follows from who the attacker is. The payload stored in a
`WebSocketFrame` is always the *application* data; masking is applied on the way to the wire
and undone on the way back, because it is a transport transformation and not part of the
message.

**1006 is never on the wire.** Neither is 1005, 1015, or 1004. They are values a local API
invents at the moment it gives up, and `CLOSE_CODES` makes that a column rather than a
footnote — because 1006 is the code everyone finds in their logs and tries to look up, and
there is nothing to look up. It is the absence of an explanation.

## The comparison is meant to be fair

`comparison.ts` races four strategies over one schedule of updates, and every byte it counts
comes from a message it actually builds and renders: a realistic browser `GET` with its
cookies and `User-Agent`, the real handshake from `upgrade.ts`, real frame headers from
`frames.ts`. Polling costs about twenty times what a WebSocket costs on the same updates, and
that number is only worth quoting because it was counted rather than claimed.

Each transport carries a `verdict` saying what it is good at. Polling is stateless and needs
no connection affinity, so it scales horizontally with no coordination at all. SSE is plain
HTTP with automatic reconnection and `Last-Event-ID` resumption for about eight bytes an
event, and its one-directionality is the right shape for most live features. WebSockets pay
for their cheap messages with state: sticky routing, connection draining on deploy, a
keepalive to run, and reconnection with backoff to write.

The figures are HTTP/1.1. Under HTTP/2, HPACK compresses a repeated header set to a handful
of bytes, so the polling overhead is an upper bound — the request counts and round trips do
not change.

## Rules

- **No network, ever.** Every function here is a pure function of its arguments. There is no
  `WebSocket`, no `fetch`, and no socket of any kind in this module, and there will not be
  one — the handshake, the frames, and the transport comparison are all computed.
- **Randomness is seeded.** `generateKey` and `maskingKeyFrom` draw from `core/sim/rng`, so a
  scenario replays byte for byte. Both say in their doc comments that a real client must use
  a strong source of entropy and why: a predictable masking key removes the whole defence.
- **Nothing here imports from another module**, and nothing here draws. `exchange.ts` will be
  the one-way bridge to a drawable `SimResult`; the logic in `sim/` does not know that
  anything will ever be shown.
