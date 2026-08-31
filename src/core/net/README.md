# `src/core/net` — real-network safety primitives

The only place in the product that reasons about **real** network access.

- `guard.ts` — the SSRF guard. The single highest-risk file in the project; requires
  > = 95% test coverage. Validates input, blocks private/loopback/link-local/multicast/
  > reserved IPs and IPv4-mapped IPv6, restricts scheme to http(s) and ports to {80,443},
  > and re-checks every address **after DNS resolution** to defeat rebinding.
- `ratelimit.ts` — token bucket keyed by client IP.

Built in phase 12. These are pure functions: they decide whether a request is allowed,
they do not make it. The requests themselves live in `src/app/api/diagnostics/`.
