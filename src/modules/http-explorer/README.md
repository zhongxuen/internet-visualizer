# `src/modules/http-explorer` — a request and a response, byte by byte

An HTTP/1.1 message is text you can read: a start-line, some field lines, **a blank
line**, and then the body. That blank line is the entire framing mechanism, and seeing it
once explains more than any description of "the headers section". This module exists to
put that on screen, and then to take apart the four things layered on top of it —
method and status semantics, caching, cookies, and the h1/h2/h3 differences.

Simulated only. Nothing here can send a request to a real server; see the rules below.

## What exists today

All of phase 08: the pure logic, the version model, the seven scenarios, and the module
surface on `/http-explorer`. The registry entry is `ready`, `usesRealNetwork: false`.

```
sim/                    # pure HTTP logic -- no React, no DOM, no clock of its own
  message.ts            # the models, and exact HTTP/1.1 wire serialization
  semantics.ts          # safe / idempotent / cacheable, and the status-code table
  caching.ts            # freshness arithmetic, ETag revalidation, and the 304 path
  cookies.ts            # Set-Cookie parsing, the attributes, and the jar matching rules
  versions.ts           # h1/h2/h3 connections and streams, and the two head-of-line blockings
  exchange.ts           # the scenario runner: SimEvents out, no idea anything is drawn
scenarios/              # seven runs declared as data -- a screenful each, no logic
  common.ts             # the fixed clock origin, and the documentation addresses
builder.ts              # the safety boundary: what a learner typed, validated (zod) and scoped
wire.ts                 # what actually crossed the wire, which is not what the client got
headers.ts              # every field as a teaching object, cited to a current spec
statuses.ts             # which run produces which status, so the map's clicks are honest
components/
  RequestBuilder.tsx    # the form: validated, badged `simulated`, with the route table shown
  WireView.tsx          # the literal bytes, the CRLF toggle, and every field focusable
  HeaderExplainer.tsx   # what the focused field does, who set it, and where it is defined
  StatusCodeMap.tsx     # the whole registry, with the reachable codes clickable
  CacheStatePanel.tsx   # both caches, never merged, with HIT / MISS / REVALIDATED per tier
  CookieJarPanel.tsx    # the attributes as the security model, and why a cookie was withheld
  VersionComparison.tsx # the same page load three ways, and the two head-of-line blockings
HttpExplorerModule.tsx  # the composition root, through SimulationView
meta.ts                 # the registry id, so nothing else spells it
```

The UI adds nothing to the protocol. `wire.ts`, `headers.ts`, `statuses.ts` and
`builder.ts` are pure and separately tested, the seven components render what those
return, and `HttpExplorerModule.tsx` holds five pieces of state and no logic. Delete every
file outside `sim/` and `scenarios/` and HTTP behaves identically.

### The one derivation the UI needed that `sim/` does not expose

`HttpExchange.response` is the response **as the client finally saw it**, and for a
revalidation that is not what crossed the network: the origin sent a 304 with no body, and
the cache merged its fields into the stored copy and handed the client a complete 200.
Both are true, and a wire view holding only the second could never show the first — which
would lose the most useful thing about conditional requests. `wire.ts` reconstructs the
304 by narrowing the merged message with the same `notModifiedResponse` the simulation
used, which is exact rather than approximate, and `wire.test.ts` asserts it is bodyless
and smaller than the body it replaced.

## The six files in `sim/`

| File           | The one idea it is arranged around                                          |
| -------------- | --------------------------------------------------------------------------- |
| `message.ts`   | Fields are an ordered **list**, not a map — order is on the wire and `Set-Cookie` repeats |
| `semantics.ts` | Safe, idempotent, and cacheable are three different promises, and POST sits between two of them |
| `caching.ts`   | `fresh ⟺ freshness_lifetime > current_age`, with both numbers exposed rather than hidden behind a boolean |
| `cookies.ts`   | The matching rules *are* the security model                                 |
| `versions.ts`  | Head-of-line blocking is **two** problems at two layers, and the versions score differently on each |
| `exchange.ts`  | A browser is a cookie jar, two caches, and a CORS policy wrapped around a socket |

## The version model

`versions.ts` is a discrete-event scheduler with a fluid, equal-share bandwidth model. It
exists to make one table true on a timeline rather than in prose:

|                       | HTTP/1.1    | HTTP/2         | HTTP/3 |
| --------------------- | ----------- | -------------- | ------ |
| Application-layer HOL | yes, badly  | **no**         | no     |
| Transport-layer HOL   | per-request | **yes, total** | **no** |
| Setup round trips     | 2           | 2              | **1**  |
| Repeated header bytes | every time  | **once**       | once   |

The second row is the one that gets left out. HTTP/2 put every stream inside one TCP byte
stream, so a single lost segment stalls all of them — which is _worse_ than HTTP/1.1,
where six connections mean one lost segment stalls one request. Only HTTP/3 fixes it, and
only because QUIC does loss recovery per stream (RFC 9000 §2.2).

Losses are drawn **per resource, not per version**, so the three runs meet one identical
network event rather than three different networks. That is what makes the comparison a
comparison.

## The scenario runner

`exchange.ts` is the one-way bridge from the five pure files to a `SimResult`. It models a
browser rather than a `curl`, because three of the seven scenarios are about policy the
protocol knows nothing about: the cookie jar, the two-tier cache, and CORS. It emits
`phase`, `transmit`, `pdu-created`, `annotate`, `drop` and `log` events, and has no idea
any of them will be drawn.

The order inside one exchange is the order a browser really works in, and the last step is
load-bearing: attach cookies → ask the private cache → cross the wire → store what came
back → **then** ask whether the page may see it. CORS running last is the CORS lesson.

## The seven scenarios

Each is the previous picture with one thing added.

| #   | Scenario              | The thing it adds, and the misconception it targets                          |
| --- | --------------------- | ---------------------------------------------------------------------------- |
| 1   | `simple-get`          | The blank line is framing, not formatting                                    |
| 2   | `post-form`           | A body, and a method that is neither safe nor idempotent                     |
| 3   | `redirect-chain`      | 301/302 rewrite POST to GET _in practice_, which is why 307/308 exist        |
| 4   | `conditional-request` | A 304 has no body; `no-cache` ≠ `no-store`; `max-age` ≠ `s-maxage`           |
| 5   | `cookie-session`      | One attribute (`SameSite`) stops CSRF — and the request is still sent        |
| 6   | `cors-preflight`      | **The request was sent and executed. Only the response was blocked.**        |
| 7   | `http2-multiplexing`  | Two kinds of head-of-line blocking, scored differently by three versions     |

Scenario 7's fixture is tuned so the gaps decompose exactly: h2 finishes ~560 ms behind
h3, which is one round trip of handshake plus one round trip of transport HOL, and h1 a
further ~472 ms behind that, which is the queue. If those numbers stop being round,
`scenarios.test.ts` fails — the prose and the arithmetic are checked against each other.

`serializeRequest` is byte-accurate: CRLF terminators, the lone CRLF that ends the header
section, and the body starting at the very next byte. `wireSegments` returns the same
message as addressable lines so `WireView` can focus one header without re-parsing
anything, and `showLineEndings` backs the CRLF toggle.

## The distinctions the tests exist to hold

- **`no-cache` is not `no-store`.** `no-cache` responses *are* stored — `isStorable`
  returns true — and are returned from `lookupCache` as `stale` even while they are
  fresh, because the directive constrains reuse and not storage. `no-store` is never
  written at all. `NO_CACHE_VS_NO_STORE` carries the wording the UI renders.
- **A 304 has no body.** `notModifiedResponse` keeps only the six fields RFC 9110 §15.4.5
  permits; `freshenEntry` then updates the stored headers and keeps the stored body,
  which is the whole saving.
- **Freshness precedence.** `s-maxage` (shared caches only) → `max-age` → `Expires` minus
  `Date` → a 10% heuristic capped at a day → nothing. The source is returned alongside the
  number, because which rule fired is the interesting part.
- **Fresh means strictly greater.** An age exactly equal to the lifetime is stale.
- **Browser and CDN are separate caches** with different rules — `private`, `s-maxage`,
  and the `Authorization` rule of RFC 9111 §3.5 all turn on the tier.
- **`evilexample.com` is not `example.com`.** Domain matching is dot-aligned; path
  matching is segment-aligned, so a cookie on `/docs` does not reach `/docsearch`.
- **`If-None-Match` beats `If-Modified-Since`.** A request sending both is decided on the
  entity tag alone.
- **Every safe method is idempotent**, and PUT and DELETE are the counterexamples to the
  converse. Asserted against the table, not written down twice.

## Time

Timestamps are **virtual milliseconds** on the simulation clock. Ages, lifetimes, and
`Max-Age` are **seconds**, as on the wire. `Expires`, `Date`, and `Last-Modified` are
absolute instants and are converted through `HttpClock` in `message.ts` — the one place
wall-clock time enters the module, and the reason `Date.now()` appears nowhere in it.
A scenario pins its clock origin and gets the same result on every run: `common.ts` fixes
it at 2026-03-01T12:00:00Z for all seven, so every `Date` and `Expires` in the module is a
literal in everything but syntax.

Determinism is asserted rather than assumed. Every scenario is run twice and then ten
times and compared whole — topology, events, phases, PDUs, caches and jar together — and
the `Date` fields are compared separately, because a stray `Date.now()` is the one failure
mode two fast runs in a row could hide.

## RFCs

Cited throughout, and only the current ones:

| RFC  | What                                          |
| ---- | --------------------------------------------- |
| 9110 | Semantics — methods, status codes, conditional requests |
| 9111 | Caching                                       |
| 9112 | HTTP/1.1 — the wire format                    |
| 9113 | HTTP/2                                        |
| 9114 | HTTP/3                                        |
| 6265 | Cookies (`bis` for `SameSite` and the name prefixes) |

The obsolete RFC 723x series and RFC 2616 are the source of most of what people still
believe about HTTP that stopped being true in 2014. Nothing here cites them, and
`semantics.test.ts` fails the build if a table row ever does.

## What must NEVER be imported here

- Another module (`src/modules/<b>/**`). Shared code goes through `@/core` or
  `@/components` — enforced by `eslint.config.mjs`.
- Anything in `sim/` may import `@/core` and nothing else. No React, no DOM, no
  `Math.random()`, no `Date.now()`: randomness comes from `@/core/sim/rng` seeded by the
  caller, and time is virtual milliseconds the caller advances explicitly.

## Safety

There is no network path in this folder. `sim/` builds and serialises message objects; it
has no `fetch`, no socket, and nothing that could acquire one. Every origin a scenario
talks to is an `OriginFixture` declared in `scenarios/`, answered by a pure function, and
addressed from `203.0.113.0/24` — one of the ranges RFC 5737 reserves for documentation,
so no address here could reach a real host even if something one day tried.
`scenarios.test.ts` asserts that for every node on every diagram.

The request builder is badged `simulated`, validated with `zod` in `builder.ts`, and
answered from a route table in that same file. It has **no host field**, which is the
property rather than an omission: the one origin it can address is `sandbox.example`, a
name in the TLD RFC 2606 reserves so that it can never be registered by anybody, at
another RFC 5737 documentation address. Typing `https://example.com/` into it is refused
with a message rather than quietly turned into a request, a path the table does not serve
comes back 404 from the simulated server, and the panel says in as many words that this is
a fact about a table in this repository and not about anything on the Internet.

`RequestBuilder.test.tsx` and `HttpExplorerModule.test.tsx` both stub `fetch` with a spy
that throws, then type an absolute URL into the field and click Send. The assertion that
nothing was called is the one in this module that must never be relaxed.
