# `src/modules/packet-journey` — following one packet the whole way

Application data on one machine becomes a segment, becomes a packet, becomes a frame,
crosses seven routers and three transparent boxes, and is taken apart again at the other
end. This module exists to make **encapsulation, per-hop rewriting, NAT, fragmentation,
and loss** concrete rather than described.

Simulated only. No address here is ever contacted; see the address rules below.

## Layout

```
sim/            # pure protocol logic -- no React, no DOM, no clock of its own
  ethernet.ts   # framing, and the MAC rewrite every hop performs
  ipv4.ts       # header, TTL, real RFC 1071 checksum, fragmentation, reassembly
  tcp.ts        # state machine and seq/ack arithmetic, send and deliver kept separate
  udp.ts        # eight bytes and no state, which is the lesson
  nat.ts        # the NAPT translation table, in both directions
  journey.ts    # the engine: walks a packet across a path and emits SimEvents
scenarios/      # typed scenario data -- what to send, over which network
  topology.ts   # the composed network (see below)
  *.ts          # the four runs
ledger.ts       # pure: the event stream read back as hop rows and as "the packet now"
options.ts      # pure: the four controls, translated into JourneyOverrides
components/     # the module's own UI
  JourneyControls.tsx    # scenario, transport, payload, MTU, loss
  EncapsulationPanel.tsx # the live stack, animating headers on and off
  HopTable.tsx           # the ledger; every row seeks the timeline
  NatTable.tsx           # the translation table, filled in as the run writes it
PacketJourneyModule.tsx  # composition root: one SimulationView and three live panels
```

## How the UI is put together

The diagram, the playback loop, the keyboard map, the phase stepper, the inspector, and
the event log are all `SimulationView`'s (phase 04) -- this module writes **no animation
code and owns no timer**. What it adds is three panels that follow the playhead, and they
follow it by deriving from it rather than by being told:

| Panel                | Derived by                    | From                          |
| -------------------- | ----------------------------- | ----------------------------- |
| `EncapsulationPanel` | `focusAt(result, t)`          | the last packet event at `t`  |
| `HopTable`           | `buildLedger(result, topo)`   | every `transmit` and `drop`   |
| `NatTable`           | `binding.createdAt <= t`      | the run's final NAT table     |

`ledger.ts` holds the first two and has no React in it, which is why the accuracy claims
the hop table makes are tested as functions (`ledger.test.ts`) rather than as markup. The
panels live in `SimulationView`'s `footer` slot and reach the playhead through
`PlaybackContext`, which is also how a row click seeks.

`options.ts` is the other pure half: it turns the four controls into a `JourneyOverrides`.
Two of them are not the assignments they look like -- the MTU control also caps a
scenario's per-link overrides, and switching loss *off* is a zero rate rather than the
absence of a loss spec, because overrides cannot remove a key. Both are tested in
`options.test.ts` against the resulting run.

## The four scenarios

| Scenario            | Shows                                                          |
| ------------------- | -------------------------------------------------------------- |
| `tcp-web-request`   | Handshake, request, response, teardown, and a NAPT round trip   |
| `udp-dns-query`     | The same journey with no connection, no ACK, and no teardown    |
| `fragmented-packet` | Path MTU discovery, fragment offsets, re-fragmentation, reassembly |
| `lossy-link`        | A silent drop, the retransmission timer, and the resend         |

Run one with `runJourney(scenario)`, or `runJourneyDetailed(scenario)` when the NAT
table and the resolved path are wanted too. `JourneyOverrides` is the second argument:
transport, MTU, TTL, loss, seed, and the writes themselves — which is what the module's
controls turn.

## The network they run on

`scenarios/topology.ts` composes `HOME_LAN` and `ISP_PATH` from `@/core/topologies` into
one end-to-end network. Neither is enough alone: the home LAN has the client and the NAT
but nothing to send to, and the ISP path has the route but starts at the home router.
They join at the two machines they already share. Read the file header for exactly what
is added and why.

## The rules the tests enforce

`sim/journey.test.ts` asserts the things that would be wrong lessons rather than crashes:

- **A hop is between two layer-3 machines.** Switches, access points, and a bridged
  fibre terminal forward frames and change nothing — no TTL decrement, no MAC rewrite,
  nothing in a traceroute.
- **Both MAC addresses change at every router. Neither IP address does** — except at the
  NAT, which is the only machine on the path allowed to touch one.
- **The TTL comes down by one per router, and the checksum is recomputed**, because it
  covers the header and the header just changed.
- **Fragment offsets count 8-byte units**, More Fragments is set on all but the last, and
  reassembly happens at the destination and nowhere else.
- **Loss is silent.** No ICMP, no error, only an acknowledgement that never arrives.

`scenarios/scenarios.test.ts` runs every scenario ten times and compares the results
whole. Determinism is the property the rest depends on.

`ledger.test.ts` asserts the same rules a second time, one layer up: that the hop table
*reads them back correctly*. Those are separate failures worth telling apart — the engine
decrementing a TTL twice and the table printing the wrong column are different bugs, and
neither test can hide the other.

## What must NEVER be imported here

- Another module (`src/modules/<b>/**`). Shared code goes through `@/core` or
  `@/components` — this is enforced by `eslint.config.mjs`, and it is why the shared
  topologies live in `src/core/topologies`.
- Anything from `sim/` may import `@/core` and nothing else. No React, no DOM, no
  `Math.random()`, no `Date.now()`: randomness comes from `@/core/sim/rng` seeded by the
  scenario, and time is virtual milliseconds that the engine advances explicitly.

## Address rules

Every address comes from a range reserved for documentation or private use, so nothing
here can be mistaken for a real host: RFC 1918 (`192.168.0.0/16`), RFC 5737
(`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`), and RFC 7042 §2.1.2 for MACs
(`00:00:5e:00:53:00`–`ff`). `scenarios.test.ts` checks this with the same classifier the
phase-12 diagnostics guard will use.
