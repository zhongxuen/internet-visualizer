# Network Diagnostics

Four tools people already know, taken apart: **ping**, **traceroute**, **DNS lookup**, and
**WHOIS/RDAP**. It is the only module in the product allowed to touch a real network,
which is why it is the most carefully bounded one.

## Two modes, and the line between them

**Learn mode is the default and cannot reach a network.** Everything under `sim/` is a
pure function of a fixture bundled in this folder; no function there takes a host name
from a caller and does anything with it but print it, and in Learn mode the live console
is not mounted at all. There is no code path from a Learn-mode control to a request.

**Live mode is opt-in, and it is one file of I/O.** `live/client.ts` makes a single
same-origin `GET` to this app's own Route Handlers when the user presses Run, and never
retries. Getting there requires passing `ModeSwitch`'s acknowledgement gate, which states
what a live run does before it can be turned on; the mode is held in component state and
is never persisted, so a reload lands back in Learn mode.

The registry entry is `status: 'ready'`, `usesRealNetwork: true` — a statement about what
this module *can* do. What it is doing *right now* is the badge inside the mode switch,
which reads `simulated` in Learn mode and `live` in Live mode, and the second `live` badge
on the console itself. `tests/registry.test.ts` asserts no other module sets the flag.

## The three live operations, and the fourth that does not exist

| Live operation                       | What the server does                                        | Reaches the target? |
| ------------------------------------ | ----------------------------------------------------------- | ------------------- |
| DNS lookup                           | one DoH `GET` to Cloudflare; the target is a query parameter | no                  |
| RDAP lookup                          | IANA bootstrap, then the registry that file names            | no                  |
| Reachability (TCP + HTTP timing)     | one `HEAD` to the host you typed                             | **yes**             |

There is no live traceroute. A TTL-limited probe needs a raw socket, which a serverless
runtime does not grant, so the console says that in the place a fourth operation would be
rather than quietly substituting a simulation. For the same reason the reachability check
is never labelled "ping": `REACH_NOT_ICMP` is one sentence, defined once in
`@/core/net/diagnostics`, and shown by both the API payload and the UI.

## Layout

```
@/core/net/guard.ts        # the SSRF guard -- also run in the browser, on every
                           # keystroke, so a refusal arrives before a request does
@/core/net/diagnostics.ts  # the request/response contract the routes and this module
                           # share, so LiveDisclosure and the handler build one URL
@/core/protocols/ipv4      # forwardIpv4 and icmpTimeExceededLayer -- the TTL arithmetic
                           # traceroute is built out of, shared with Packet Journey
@/core/protocols/udp       # the eight bytes a classic traceroute probe travels in
@/core/protocols/dns/*     # the recursive walk the simulated lookup calls into
sim/            # pure logic -- no React, no DOM, no clock, no socket
  path.ts       # what a probe path is: hops, ICMP policy, return skew, load balancing
  paths.ts      # the six networks, one per lesson (see the table in the file)
  ping.ts       # ICMP echo, RTT statistics, and the verdict panel's argument
  traceroute.ts # the TTL walk, the '* * *' rows, and the caveats
  lookup.ts     # the DNS walk in a tool's clothing, plus the warm-cache contrast
  whois.ts      # the registration record, printed as both WHOIS text and RDAP JSON
live/           # Live mode's logic. operations.ts is pure; client.ts is the only I/O.
  operations.ts # the three operations, and planLiveRequest: exactly what will be sent
  client.ts     # one fetch, same origin, no retry, every ending a value
components/
  ModeSwitch.tsx      # Learn <-> Live, and the acknowledgement gate in front of Live
  TargetInput.tsx     # one target, validated by the server's own guard functions
  LiveDisclosure.tsx  # the URLs, methods, and who makes them -- before Run is pressed
  RateLimitNotice.tsx # the 429, with the countdown in the open and no retry
  LiveConsole.tsx     # the live state machine, and the live SafetyBadge
  LiveResultView.tsx  # the three payloads, each with its source, timestamp, and caveat
  PingView.tsx        # RTT chart, TCP contrast, and what the result does not prove
  TracerouteView.tsx  # hop table, the TTL walk behind the selected row, the caveats
  LookupView.tsx      # answer, ladder, warm run, transcript
  RdapView.tsx        # status codes, dates, and the two protocols side by side
NetworkDiagnosticsModule.tsx  # composition root: mode switch, tool switch, both halves
meta.ts / index.ts / README.md
```

## The thing each tool exists to correct

Every tool here has one widely-believed wrong inference attached to it, and the panels are
laid out so that the correction cannot be scrolled past.

| Tool       | The wrong inference                                | Where it is corrected                                     |
| ---------- | -------------------------------------------------- | --------------------------------------------------------- |
| ping       | "No reply, so the host is down."                   | The TCP check sits beside the chart, same size, always on. |
| traceroute | "This is the path my packets take."                | `* * *`, asymmetric returns, and two addresses on one row. |
| lookup     | "dig says X, so my app will get X."                | The caveats panel, and the warm run beside the cold one.   |
| WHOIS      | "The DNS is broken."                               | `clientHold` on `example.org`, which explains the outage.  |

The tool switch drives both halves at once, so a live answer always appears directly above
the simulation that explains what it is.

## Traceroute reuses the real TTL arithmetic

`sim/traceroute.ts` does not look up a list of hops. For each TTL it builds an IPv4 header
and calls `forwardIpv4` once per router until the function reports `expired` — the same
function Packet Journey animates. `TracerouteHop.walk` is that arithmetic, TTL and header
checksum in and out at every step, and `TracerouteView` renders it. A hop appears in the
output because the decrement reached zero somewhere, not because a fixture said so.

Three probes are computed per TTL and all three appear in the table and the printed output.
Only the first is animated on the canvas, with a `pdu-transform` at each router; animating
twenty-four near-identical flights would bury the one worth watching.

## What must NEVER be added here

- Another module's code (`eslint.config.mjs` enforces it). Shared protocol logic belongs
  in `@/core/protocols`, shared UI in `@/components`.
- A second file that performs I/O. `live/client.ts` is the only one, and it calls this
  app's own origin; a `fetch` to anywhere else — or one not started by a user pressing Run
  — is the change that would make this module something other than a diagnostics tool.
- A retry, a poll, a debounced auto-run, or a queue. One press, one request.
- A control that reaches the live console without passing the acknowledgement gate.
