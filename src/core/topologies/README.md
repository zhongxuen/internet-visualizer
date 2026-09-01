# `src/core/topologies` — the shared scenario networks

Four networks, from a single house to a datacenter, each a `Topology` plus the teaching
that goes with it: a two-or-three sentence note per machine and a citation into the
document that defines the behaviour.

| File              | Scenario       | Teaches                                             |
| ----------------- | -------------- | --------------------------------------------------- |
| `homeLan.ts`      | `home-lan`     | Private addressing, gateways, DHCP, NAPT            |
| `smallOffice.ts`  | `small-office` | Subnetting, VLANs, where a firewall belongs         |
| `ispPath.ts`      | `isp-path`     | Autonomous systems, peering vs transit, distance    |
| `datacenter.ts`   | `datacenter`   | CDN caching, load balancing, tiers, TLS termination |

## Why these live in `core` and not in a module

`src/modules/<a>` may not import from `src/modules/<b>` (`eslint.config.mjs`), and these
topologies are drawn by the Network Map, animated by Packet Journey, and reused by the
Learning Center. A topology shared by three modules has exactly one place it can live
without being duplicated, and this is it — the plan anticipates this in
`docs/implementation/06-module-packet-journey.md`.

It is also the right layer on its own terms. None of this is a picture: it is addresses,
latencies, and prose about protocols. Coordinates are the visualization layer's problem
(`src/components/viz/layout.ts`), and nothing here has any.

## What must NEVER be imported here

The same ban list as the rest of `src/core` — see `../README.md`. These files import
`../types/topology` and nothing else.

## Address rules every scenario follows

Nothing here may be mistaken for, or accidentally point at, a real host. Every literal
comes from a range reserved for exactly this purpose:

- **Private IPv4** — `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` (RFC 1918), used
  only where a real network would use a private address.
- **Public IPv4** — `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24` (RFC 5737).
- **IPv6** — `2001:db8::/32` (RFC 3849).
- **MAC** — `00:00:5e:00:53:00`–`00:00:5e:00:53:ff` (RFC 7042 §2.1.2).
- **AS numbers** — `64496`–`64511` (RFC 5398), so no real operator is implicated in an
  invented peering arrangement.

## Accuracy rules every scenario follows

- A **switch** forwards frames by MAC and never routes; a **router** routes and never
  claims to switch frames. An access point and an IXP fabric are both switches.
- The home router performs **NAPT** — port-based translation — not one-to-one NAT.
- Latency is one-way propagation delay in virtual milliseconds, and stays plausible:
  LAN under 1 ms, ISP access 5–20 ms, intercontinental 80–160 ms. `../../..` renders a
  round trip as twice these numbers, so they have to survive being doubled.

`__tests__/topologies.test.ts` enforces the mechanical half of all of the above.
