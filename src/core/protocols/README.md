# `src/core/protocols` — the protocols themselves

Pure protocol logic, shared. A file belongs here when it models what a protocol **is** —
its messages, its state machine, its arithmetic, its verdicts — rather than what any one
module does with it. Everything here is framework-free, deterministic, and unit-tested in
the node project.

## The layers

```
ipv4/
  ipv4.ts          # header, TTL, the real RFC 1071 checksum, fragmentation/reassembly,
                   # and the two ICMP messages forwarding generates
dns/
  records.ts       # RR types, wire-format sizing, and the simulated zones themselves
  resolver.ts      # the recursive walk: root -> TLD -> authoritative, with referrals
  cache.ts         # TTL expiry, and negative caching per RFC 2308
  dnssec.ts        # the chain-of-trust walk, and what each way of breaking it means
tcp/
  tcp.ts           # state machine and seq/ack arithmetic, send and deliver kept separate
udp/
  udp.ts           # eight bytes and no state, which is the lesson
tls/
  placeholder.ts   # the fake-crypto discipline, in one file
  cipher.ts        # suite catalogue and decomposition; why the 1.3 name has two parts
  certificates.ts  # chain, trust store, and the five validation steps
  keyschedule.ts   # (EC)DHE -> HKDF -> traffic keys, with client/server/observer columns
  records.ts       # the record layer, and what an observer reads off it
  handshake13.ts   # 1-RTT, 0-RTT/PSK, HelloRetryRequest, downgrade detection
  handshake12.ts   # full and abbreviated, plus the 1.2-vs-1.3 comparison table
http/
  message.ts       # the models, and exact HTTP/1.1 wire serialization
  semantics.ts     # safe / idempotent / cacheable, and the status-code table
  caching.ts       # freshness arithmetic, ETag revalidation, and the 304 path
  cookies.ts       # Set-Cookie parsing, the attributes, and the jar matching rules
  versions.ts      # h1/h2/h3 connections and streams, and the two head-of-line blockings
```

## Why they are here and not in a module

Each of these arrived inside the module that first needed it, and moved here when a second
module needed it: most in phase 11, when the Internet Simulator needed the same logic to
run one stage of an end-to-end page load, and `ipv4/` and `udp/` in phase 12, when Network
Diagnostics needed `forwardIpv4` and `icmpTimeExceededLayer` to build traceroute out of
the same TTL decrement Packet Journey animates, and the UDP header to carry the probes. A module may not import another module (`eslint.config.mjs`), and the right answer
to that rule is never to copy: it is to promote the shared half and leave the module the
part that is genuinely its own.

That line is worth stating exactly, because it is where the next file will have to fall
one way or the other:

| Here                                       | In the module                                  |
| ------------------------------------------ | ---------------------------------------------- |
| what a protocol says and computes          | which scenarios are worth showing              |
| message models, state machines, arithmetic | the topology a run is drawn on                 |
| verdicts, and the reasons for them         | phases, node states, annotations, `SimEvent`s  |

So `http/caching.ts` decides whether a stored response may be reused; the HTTP Explorer's
`sim/exchange.ts` decides that a browser asks its private cache *before* crossing the wire
and asks CORS *after*. `tls/handshake13.ts` decides what is in a ServerHello;
the HTTPS Explorer's `sim/connection.ts` decides that there is an observer node on the
path to watch it go by.

## What must NEVER be imported here

Everything the rest of `src/core` forbids: `react`, `react-dom`, `next`, `@xyflow/react`,
`motion`, `zustand`, `@/components/**`, `@/app/**`, and `@/modules/**`. Also no
`Math.random()` and no `Date.now()` — randomness is seeded through `@/core/sim/rng`, and
time is either virtual milliseconds the caller advances or an explicit epoch instant the
caller passes in. A protocol that reached for the wall clock would stop being replayable,
and replay is the whole product.

Tests live in each protocol's `__tests__/` and run in the node project
(`npx vitest run --project core`). If one ever needs a DOM, something has crossed a
boundary.
