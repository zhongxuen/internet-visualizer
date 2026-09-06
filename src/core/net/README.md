# `src/core/net` — address, port, and byte primitives

Pure functions about the identifiers and encodings that appear on a network. No I/O:
nothing here opens a socket, resolves a name, or reads a clock. They describe and
validate; something else decides what to do about it.

Two audiences share these files, and the stricter one sets the rules:

1. **Scenario authors** (phase 03 onwards), writing trusted address literals.
2. **Network diagnostics** (phase 12), running the same validators over **untrusted
   user input** before anything is allowed near a real network.

So parsing is deliberately unforgiving — whitespace, leading zeros (`010.0.0.1`), IPv4
shorthand (`127.1`, `0x7f.0.0.1`), IPv6 zone identifiers, and bracketed literals are all
rejected rather than guessed at. Every validator returns a `ParseResult<T>` carrying the
reason it refused, because both a form field and a test need that reason.

## Built (phase 03)

- `result.ts` — `ParseResult<T>`, the `ok`/`fail`/`unwrap` helpers shared by the rest.
- `address.ts` — IPv4, IPv6, CIDR, and MAC: parse, validate, canonical formatting
  (RFC 5952 for IPv6), and `classifyIp` — private / loopback / link-local / multicast /
  documentation / reserved / public, including unwrapping IPv4-mapped IPv6.
- `ports.ts` — the well-known port table with service names and teaching notes, plus
  strict `parsePort` and the IANA range helpers.
- `bytes.ts` — hex and binary rendering at a header field's real width, hex dumps, byte
  sizes, and finding/rendering the header fields of a `PDU`.

## Built (phase 12, prompt 12.1)

- `guard.ts` — the SSRF guard, and the highest-risk file in the project. Validates the
  target with `zod`, restricts the scheme to http(s) and the port to {80, 443}, refuses
  every non-public scope `classifyIp` reports (including IPv4-mapped disguises and the
  cloud metadata endpoints by name), and re-checks **every** address a hostname resolves
  to, which is what defeats DNS rebinding. Also owns the outbound shape of a live
  request: a 5 s ceiling on the timeout, a response-size cap enforced while reading, an
  allow-list of forwardable headers, and redirects that are reported rather than
  followed. `npm run test:coverage` reports 100% of its statements and lines.
- `ratelimit.ts` — a token bucket keyed by client, with a global bucket behind it, an
  LRU bound on how many clients it will track, and the `Retry-After` / `X-RateLimit-*`
  headers a 429 needs.

Both are pure too: they decide whether a request is allowed, they do not make it. DNS
resolution is injected into `guardTarget` as a `HostResolver` and the clock is injected
into `createRateLimiter`, so both the rebinding case and the refill arithmetic are
testable with no network and no sleeping.

The requests themselves live in `src/app/api/diagnostics/` (prompt 12.3), which is the
only place in the product that opens a socket. Every live call there passes through the
single `guardedFetch` chokepoint in `_lib/outbound.ts`, which calls the functions above
in the order section 3 of the phase doc sets out; see that folder's `README.md` for the
invariants it enforces.

## Built (phase 12, prompt 12.4)

- `diagnostics.ts` — the contract the three Route Handlers and the Live-mode UI both
  read. The URL builders (`dohUrlFor`, `rdapUrlFor`, `normalizeReachTarget`), the
  resolver and bootstrap constants, the `REACH_NOT_ICMP` sentence, and every response
  type live here so that `LiveDisclosure` can show the exact URL a handler will request
  *before* it requests it. Two copies of that URL would drift, and the first time they
  did, the UI would be lying about a real network request.

  It performs no I/O either. A browser importing it gains the ability to *name* a live
  request and nothing else: every live call is still made by a route handler, under the
  guard, or it is not made at all.

## What must never be imported here

Anything from `react`, `next`, `@xyflow/react`, `motion`, `@/components/**`, `@/app/**`,
or `@/modules/**` — see `../README.md`. Enforced by `eslint.config.mjs`.
