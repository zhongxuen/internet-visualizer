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

## Planned (phase 12)

- `guard.ts` — the SSRF guard. The highest-risk file in the project; requires ≥ 95% test
  coverage. Restricts scheme to http(s) and ports to {80, 443}, refuses every non-public
  scope `classifyIp` reports, and re-checks every address **after DNS resolution** to
  defeat rebinding.
- `ratelimit.ts` — token bucket keyed by client IP.

Both will be pure too: they decide whether a request is allowed, they do not make it.
The requests themselves live in `src/app/api/diagnostics/`.

## What must never be imported here

Anything from `react`, `next`, `@xyflow/react`, `motion`, `@/components/**`, `@/app/**`,
or `@/modules/**` — see `../README.md`. Enforced by `eslint.config.mjs`.
