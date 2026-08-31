# 12 — Module: Network Diagnostics (real vs simulated)

## Goal

The only module in the product that can touch a real network. It must therefore be the
most carefully built one. Two clearly separated surfaces:

- **Learn mode (default)** — simulated ping, traceroute, DNS lookup, and WHOIS with
  animated explanations of what each tool actually does
- **Live mode (explicit opt-in)** — a small set of genuinely safe, read-only lookups
  against a target the user typed, executed server-side, validated, allowlisted, and
  rate-limited

## Prerequisites

Phase 02 (the `SafetyBadge` and shell). Independent of phases 05–11.

---

## Read this before writing any code

### 1. The platform constraint that shapes the whole module

**ICMP ping and traceroute are not possible from Vercel serverless functions.** Raw
sockets require elevated privileges that serverless runtimes do not grant. Any tutorial
suggesting otherwise is either shelling out to a binary that is not present, or running
somewhere other than Vercel.

Consequences — decide these deliberately rather than discovering them at deploy time:

| Tool                        | Real implementation on Vercel                                                                                     | What to do                                                                                          |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `ping` (ICMP)               | ❌ impossible                                                                                                     | Simulate it, **or** offer a clearly-labeled _TCP connect timing_ check (not ICMP — say so)          |
| `traceroute` (ICMP/UDP TTL) | ❌ impossible                                                                                                     | Simulate only. Explain the TTL mechanism visually — this is more educational than raw output anyway |
| DNS lookup                  | ✅ via DNS-over-HTTPS to a public resolver                                                                        | Real, allowlisted resolver                                                                          |
| WHOIS                       | ⚠️ port 43 TCP is fragile/blocked; **use RDAP instead** — it is HTTP/JSON, structured, and the official successor | Real, via RDAP                                                                                      |
| Reachability / TTFB         | ✅ HTTP HEAD/GET with timing                                                                                      | Real, with strict SSRF guards                                                                       |

Be honest in the UI about each of these. "This is a TCP connect time, not an ICMP echo"
is a _teaching opportunity_, not a limitation to hide.

### 2. The security rules from `CLAUDE.md` are hard requirements here

> Never scan unknown/real systems. Clearly separate simulations from real network tools
> in both UI and code. Validate all user inputs.

Concretely, every one of these must hold:

- **Default is simulated.** Live mode requires an explicit toggle plus a one-time
  acknowledgement explaining what will happen.
- **One target, one request.** No ranges, no CIDR expansion, no port sweeps, no
  concurrent fan-out. This module must be structurally incapable of scanning.
- **Server-side only.** All live calls go through Route Handlers under
  `src/app/api/diagnostics/`. No live request originates in the browser.
- **SSRF guard, applied after DNS resolution** — see below.
- **Rate limited** per IP and globally.
- **Read-only.** `GET`/`HEAD` only for reachability. Never `POST` to a third-party target.
- **No credentials forwarded**, no cookies, no redirects followed to a different host
  without re-validation.

### 3. The SSRF guard (get this exactly right)

Validating the hostname string is not enough — an attacker controls DNS. The order must
be:

1. Parse and validate the input with `zod` + the phase-03 validators
2. Reject IP literals in private, loopback, link-local, multicast, reserved, and
   IPv4-mapped-IPv6 ranges
3. **Resolve the hostname to IPs server-side, then re-check every resolved address
   against the same block list** (this is what stops DNS rebinding)
4. Reject non-`http`/`https` schemes and any port outside `{80, 443}`
5. Set a short timeout (≤ 5 s) and a small response size cap
6. Do not follow redirects automatically; if following, re-run steps 2–4 on the new URL
7. Block internal metadata endpoints explicitly (`169.254.169.254` and equivalents) —
   covered by step 2, but assert it in a test by name

Write this as one module, `src/core/net/guard.ts`, with a **thorough test suite**. It is
the single highest-risk file in the project.

---

## Deliverables

```
src/core/net/
  guard.ts                    # SSRF guard (pure, heavily tested)
  ratelimit.ts                # token bucket keyed by IP
src/app/api/diagnostics/
  dns/route.ts                # DoH lookup
  rdap/route.ts               # domain/IP registration data
  reach/route.ts              # HTTP HEAD timing + TLS info
src/modules/network-diagnostics/
  meta.ts                     # usesRealNetwork: true
  sim/
    ping.ts                   # simulated ICMP echo, RTT distribution, loss
    traceroute.ts             # simulated TTL walk with ICMP Time Exceeded
    lookup.ts                 # simulated resolution (reuses core DNS logic)
    whois.ts                  # simulated registration record
  components/
    ModeSwitch.tsx            # Learn <-> Live, with the acknowledgement gate
    TargetInput.tsx           # single target, validated, no ranges accepted
    PingView.tsx              # RTT chart + packet stream animation
    TracerouteView.tsx        # hop list + TTL explanation on the map
    LookupView.tsx
    RdapView.tsx
    LiveDisclosure.tsx        # exactly what request will be made, before it is made
    RateLimitNotice.tsx
  NetworkDiagnosticsModule.tsx
src/app/(modules)/network-diagnostics/page.tsx
```

---

## Learn mode (build this first, and completely)

### Simulated ping

Animate ICMP Echo Request / Echo Reply across a topology. Show the RTT as a live chart,
introduce jitter and packet loss via the seeded RNG, and explain each field: type, code,
identifier, sequence number, TTL. Explain why a firewall dropping ICMP does **not** mean
the host is down.

### Simulated traceroute

The best visual in the whole module. Send probes with TTL = 1, 2, 3…; each router
decrements TTL to zero, drops the packet, and returns **ICMP Time Exceeded**, revealing
itself. Show the TTL counter on the packet as it travels and the hop list filling in.

Also show the honest caveats: `* * *` hops from routers that do not reply, asymmetric
return paths, and load-balanced paths giving inconsistent hops.

Reuse the phase-06 IPv4/TTL logic from `src/core/protocols/`.

### Simulated DNS lookup and WHOIS

Compact versions of the phase-07 walk plus a fixture registration record, with every
field explained (registrar, nameservers, creation/expiry dates, status codes like
`clientTransferProhibited`).

---

## Live mode

- Entering live mode shows `LiveDisclosure`: the exact URL that will be requested, the
  method, and where the request originates (the server, not the browser)
- The `live` `SafetyBadge` is visible the entire time
- Results are shown next to the simulated explanation of the same tool, so the user
  learns what they are looking at
- Every live response includes the resolver/registry source and a timestamp
- Failures are shown plainly — blocked target, rate limited, timeout — never silently
  retried

Supported live operations, and nothing else:

1. **DNS lookup** via DoH (`A`, `AAAA`, `MX`, `NS`, `TXT`, `CNAME`) against one
   allowlisted public resolver
2. **RDAP lookup** for a domain or IP against the official RDAP bootstrap service
3. **Reachability**: one `HEAD` request, reporting status, TTFB, final URL, and
   certificate summary if HTTPS — labeled as _not_ an ICMP ping

---

## Acceptance criteria

- [ ] `guard.ts` blocks: private/loopback/link-local/multicast/reserved IPs, IPv4-mapped
      IPv6, `169.254.169.254` by name, non-http(s) schemes, ports outside {80,443}, and
      hostnames that _resolve_ to blocked addresses (rebinding case tested explicitly)
- [ ] `guard.ts` has ≥ 95% test coverage
- [ ] No route handler accepts a CIDR, range, port list, or multiple targets
- [ ] Rate limiting returns 429 with `Retry-After` and the UI handles it gracefully
- [ ] Live mode is off by default and requires acknowledgement
- [ ] The `live` badge is present on every surface capable of a real request
- [ ] Simulated traceroute correctly shows TTL expiry generating ICMP Time Exceeded
- [ ] The UI states plainly that live "ping" is TCP connect timing, not ICMP
- [ ] Registry entry `'ready'`, `usesRealNetwork: true`

---

## Prompts to execute

### Prompt 12.1 — the SSRF guard (do this first, on its own)

```
Read docs/implementation/12-module-network-diagnostics.md, especially section 3.

Implement src/core/net/guard.ts and src/core/net/ratelimit.ts exactly as specified: zod
input validation, IP-literal block list (private, loopback, link-local, multicast,
reserved, IPv4-mapped IPv6), scheme and port restriction to http/https and ports 80/443,
post-resolution re-checking of every resolved address to defeat DNS rebinding, timeouts,
and response size caps.

Write an exhaustive test suite — target 95%+ coverage — including an explicit test that
169.254.169.254 is blocked by name and a test for the rebinding case where a hostname
resolves to a private address. Report the coverage number.
```

### Prompt 12.2 — Learn mode

```
Implement Learn mode per docs/implementation/12-module-network-diagnostics.md:
src/modules/network-diagnostics/sim/{ping,traceroute,lookup,whois}.ts and the views
PingView, TracerouteView, LookupView, and RdapView, composed through SimulationView.

Traceroute must reuse the IPv4/TTL logic from src/core/protocols/ and show TTL expiry
producing ICMP Time Exceeded at each hop, including the '* * *' non-responding-hop and
asymmetric-path caveats. Ping must explain why dropped ICMP does not mean a host is down.

Everything simulated — no route handlers yet, no network access at all.
```

### Prompt 12.3 — live route handlers

```
Implement the three Route Handlers under src/app/api/diagnostics/ per the phase doc:
dns/route.ts (DoH against one allowlisted public resolver), rdap/route.ts (RDAP
bootstrap), and reach/route.ts (a single HEAD request with timing).

Every handler must: validate input with zod, pass it through src/core/net/guard.ts,
enforce the rate limiter, accept exactly one target (never a range, CIDR, port list, or
array), forward no credentials or cookies, use a <=5s timeout, and not follow redirects
without re-validating.

Add integration tests asserting that blocked targets, multi-target payloads, and
rate-limit-exceeded requests are all rejected correctly.
```

### Prompt 12.4 — Live mode UI and the safety boundary

```
Implement ModeSwitch, TargetInput, LiveDisclosure, and RateLimitNotice per the phase
doc, and wire them into NetworkDiagnosticsModule with the route.

Requirements: Learn mode is the default; entering Live mode requires an explicit
acknowledgement that states what will happen; the `live` SafetyBadge is visible whenever
Live mode is active; LiveDisclosure shows the exact URL and method before the request is
made; live "ping" is labeled as TCP connect timing, not ICMP; failures are shown plainly
and never auto-retried.

Then flip the registry entry to status 'ready' with usesRealNetwork: true, and verify
that this is the only module in the registry with that flag set.
```
