# 10 — Modules: API Visualizer & WebSocket Viewer

## Goal

Two related modules built together because they share the "application talking to
application" framing and contrast usefully: **request/response** vs **persistent
bidirectional**.

Both simulated only.

## Prerequisites

Phase 08.

---

## Part A — API Visualizer

### Deliverables

```
src/modules/api-visualizer/
  meta.ts
  sim/
    rest.ts           # resource model, CRUD verb mapping, status selection
    auth.ts           # API key, Bearer/JWT, OAuth 2.0 auth-code + PKCE flow
    ratelimit.ts      # token bucket, 429 + Retry-After + RateLimit headers
    pagination.ts     # offset, cursor, Link header
    graphql.ts        # single endpoint, query -> shaped response
    webhook.ts        # server -> client callback, signature verification, retries
    exchange.ts
  scenarios/
    rest-crud.ts
    auth-bearer.ts
    oauth-authcode-pkce.ts
    rate-limited.ts
    paginated-collection.ts
    rest-vs-graphql.ts        # same data, over/under-fetching contrast
    webhook-delivery.ts
  components/
    EndpointExplorer.tsx      # resource tree + verb chips
    ApiConsole.tsx            # build a request, see the shaped response
    AuthFlowDiagram.tsx
    RateLimitMeter.tsx        # live token bucket
    ResponseShape.tsx         # JSON tree with field explanations
  ApiVisualizerModule.tsx
src/app/(modules)/api-visualizer/page.tsx
```

### What to model

- **REST semantics done properly** — resources as nouns, correct verb→status mapping
  (`201` + `Location` on create, `204` on delete, `200` vs `202`), idempotency of
  `PUT`/`DELETE` vs `POST`, and `PATCH` semantics.
- **Auth flows** — API key in header vs query (and why query is worse: logs, referrers),
  Bearer tokens with a **decoded JWT** view (header / payload / signature, with `exp`,
  `iss`, `aud` explained, and an explicit note that the payload is _encoded, not
  encrypted_), and the OAuth 2.0 authorization-code + PKCE flow as a full ladder diagram
  across user, client, auth server, and resource server.
- **Rate limiting** — a live token bucket, the `429` response, `Retry-After`, and the
  `RateLimit-*` headers; show a client backing off exponentially.
- **Pagination** — offset vs cursor, with the offset-pagination skip/duplicate problem
  demonstrated by inserting a row mid-pagination. That is a genuinely non-obvious lesson.
- **REST vs GraphQL** — the same screen's data: REST needs three round trips or
  over-fetches; GraphQL gets it in one shaped response. Be even-handed — also show
  GraphQL's caching and N+1 downsides.
- **Webhooks** — direction reversal, HMAC signature verification, retry with backoff on
  non-2xx, and why idempotency keys matter.

### Interactions

`ApiConsole` builds requests against a bundled mock API. Validated with `zod`, badged
`simulated`, no real network access.

---

## Part B — WebSocket Viewer

### Deliverables

```
src/modules/websocket-viewer/
  meta.ts
  sim/
    upgrade.ts        # HTTP/1.1 Upgrade handshake, Sec-WebSocket-Key/Accept
    frames.ts         # frame format: FIN, opcode, mask, payload length
    lifecycle.ts      # open -> messages -> ping/pong -> close with codes
    comparison.ts     # polling vs long-polling vs SSE vs WebSocket
    exchange.ts
  scenarios/
    handshake-and-chat.ts
    ping-pong-keepalive.ts
    binary-frames.ts
    fragmented-message.ts
    close-handshake.ts        # close codes, who closes first
    reconnect-backoff.ts
    transport-comparison.ts
  components/
    UpgradePanel.tsx          # the HTTP request that becomes a WebSocket
    FrameInspector.tsx        # bit-level frame layout
    MessageStream.tsx         # bidirectional message log on a timeline
    TransportComparison.tsx   # 4 strategies racing on one timeline
  WebSocketViewerModule.tsx
src/app/(modules)/websocket-viewer/page.tsx
```

### What to model

- **The upgrade** — it starts as an ordinary HTTP/1.1 `GET` with
  `Upgrade: websocket`, `Connection: Upgrade`, `Sec-WebSocket-Key`; the server replies
  `101 Switching Protocols` with `Sec-WebSocket-Accept` (the key concatenated with the
  fixed GUID, SHA-1'd, base64'd — show the computation as a labeled step). Reuse the
  phase-08 HTTP message model here.
- **Frame format at bit level** — FIN, RSV, opcode, MASK, payload length (7 / 7+16 /
  7+64), masking key, payload. **Client→server frames are always masked; server→client
  never are** — and explain why (cache-poisoning defense). This is the detail that makes
  the module worth building.
- **Fragmentation** — a message split across continuation frames.
- **Control frames** — ping/pong keepalive, close with status codes (1000 normal, 1001
  going away, 1006 abnormal — note 1006 is never sent on the wire).
- **Transport comparison** — polling, long polling, SSE, and WebSocket racing on one
  timeline for the same updates, with a request-count and byte-overhead counter per
  strategy. Be fair to SSE: simpler, auto-reconnecting, but one-directional.

### Accuracy checks

RFC 6455 (WebSocket), RFC 9110 (upgrade semantics). For the API module: RFC 6749 + 7636
(OAuth/PKCE), RFC 7519 (JWT), RFC 9110 (status semantics).

---

## Acceptance criteria

- [ ] JWT view decodes header/payload/signature and states the payload is not encrypted
- [ ] OAuth authorization-code + PKCE ladder is complete and correctly ordered
- [ ] Token bucket depletes and refills visibly; 429 carries `Retry-After`
- [ ] Offset-pagination skip/duplicate problem is demonstrated, not just described
- [ ] `Sec-WebSocket-Accept` derivation is shown as an explicit step
- [ ] Frame inspector is bit-accurate, including the three payload-length encodings
- [ ] Client-side masking is shown and explained; server frames unmasked
- [ ] Transport comparison shows request counts and byte overhead per strategy
- [ ] Both registry entries `'ready'`, both `usesRealNetwork: false`
- [ ] Neither module imports from the other, nor from any other module folder

---

## Prompts to execute

### Prompt 10.1 — API logic

```
Read docs/implementation/10-modules-api-and-websocket.md, Part A.

Implement the pure logic under src/modules/api-visualizer/sim/: rest.ts, auth.ts (API
key, Bearer/JWT decode, OAuth 2.0 authorization-code with PKCE), ratelimit.ts (token
bucket + 429 + Retry-After + RateLimit-* headers), pagination.ts (offset and cursor,
including the offset skip/duplicate problem), graphql.ts, and webhook.ts (HMAC signature
verification and retry with backoff).

Reuse the phase-08 HTTP message model. No React. Unit-test the token bucket, JWT
decoding, PKCE challenge/verifier relationship, and the pagination edge case.
```

### Prompt 10.2 — API scenarios and UI

```
Implement the seven API Visualizer scenarios and the UI per Part A of the phase doc:
EndpointExplorer, ApiConsole (zod-validated, badged `simulated`, mock API only),
AuthFlowDiagram, RateLimitMeter, ResponseShape with per-field explanations.

The JWT view must state explicitly that the payload is encoded, not encrypted. The
rest-vs-graphql scenario must be even-handed and show GraphQL's caching and N+1
downsides too. Add the route and flip the registry entry to 'ready'.
```

### Prompt 10.3 — WebSocket logic

```
Read Part B of docs/implementation/10-modules-api-and-websocket.md.

Implement src/modules/websocket-viewer/sim/: upgrade.ts (the HTTP/1.1 Upgrade handshake
reusing the phase-08 message model, with the Sec-WebSocket-Accept derivation as an
explicit labeled step), frames.ts (bit-accurate frame layout including all three payload
length encodings and client-side masking), lifecycle.ts (open, messages, ping/pong,
close codes), and comparison.ts (polling, long polling, SSE, WebSocket).

Verify against RFC 6455. Unit-test frame encoding/decoding round-trips and the
Sec-WebSocket-Accept computation.
```

### Prompt 10.4 — WebSocket scenarios and UI

```
Implement the seven WebSocket Viewer scenarios and the UI per Part B: UpgradePanel,
FrameInspector (bit-level layout), MessageStream (bidirectional, on the timeline), and
TransportComparison racing all four strategies with request-count and byte-overhead
counters.

Explain why client frames are masked and server frames are not. Note that close code
1006 is never sent on the wire. Add the route and flip the registry entry to 'ready'.
Do not modify the API Visualizer module.
```
