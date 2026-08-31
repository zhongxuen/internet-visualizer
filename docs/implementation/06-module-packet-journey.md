# 06 — Module: Packet Journey

## Goal

Follow a single packet from an application on one machine all the way to an application
on another, showing **encapsulation, hop-by-hop forwarding, TTL decrement, NAT
translation, fragmentation, and decapsulation**. This is the module that makes TCP/IP
concrete.

Simulated only.

## Prerequisites

Phase 04 (uses phase 05's topologies, but does not import module code — import the
scenario data, or move the shared topologies to `src/core/topologies/` if lint flags a
cross-module import).

> **Note:** if the ESLint boundary rule blocks importing `src/modules/network-map/scenarios`,
> that is the rule working as intended. Promote the shared topologies to
> `src/core/topologies/` and have both modules import from there.

---

## Deliverables

```
src/core/topologies/           # promoted shared topologies (if needed)
src/modules/packet-journey/
  meta.ts
  sim/
    ethernet.ts     # frame construction, MAC rewrite per hop
    ipv4.ts         # header, TTL, checksum, fragmentation
    tcp.ts          # 3-way handshake, seq/ack, data, FIN teardown
    udp.ts
    nat.ts          # NAPT table, translation both directions
    journey.ts      # the scenario `run()` composing the above
  scenarios/
    tcp-web-request.ts
    udp-dns-query.ts
    fragmented-packet.ts
    lossy-link.ts               # drop + retransmission
  components/
    JourneyControls.tsx         # protocol, payload size, MTU, loss toggle
    EncapsulationPanel.tsx      # live layer stack at the current hop
    HopTable.tsx                # per-hop: TTL, src/dst MAC, src/dst IP+port
  PacketJourneyModule.tsx
src/app/(modules)/packet-journey/page.tsx
```

---

## What must be modelled correctly

This module is where inaccuracy is most likely and most damaging. Verify each of these:

**Encapsulation order** — Application data → TCP/UDP segment → IPv4 packet → Ethernet
frame. Show the header _prepended_, and show sizes adding up.

**Per-hop rewriting** — the one thing most tutorials get wrong:

- **Source/destination MAC change at every hop.** Show the ARP-resolved next-hop MAC.
- **Source/destination IP do not change** — except at the NAT device.
- **TTL decrements by 1 at each router**; at 0 the packet is dropped and an ICMP Time
  Exceeded is generated (this is exactly what phase 12's traceroute explainer needs).
- **IPv4 header checksum is recomputed** at each hop because TTL changed.

**NAT (NAPT)** — the home router rewrites source IP _and_ source port, records the
mapping in a translation table, and reverses it on the way back. Render the table live;
it is the clearest possible explanation of why inbound connections need port forwarding.

**TCP handshake** — SYN → SYN-ACK → ACK with real initial sequence numbers, then data
with correct seq/ack arithmetic, then FIN/ACK teardown. Show the state machine label on
each endpoint (`CLOSED → SYN_SENT → ESTABLISHED → …`).

**Fragmentation** — when payload + headers exceed the link MTU (1500 typical), split
with correct More Fragments flag and fragment offsets, and reassemble at the
destination only. Also show the Don't Fragment case producing ICMP Fragmentation Needed
(path MTU discovery).

**Loss and retransmission** — the lossy-link scenario drops a segment; show the sender's
retransmission timeout and resend. Keep it deterministic via the seeded RNG.

---

## Interactions

- Choose protocol (TCP / UDP), payload size, MTU, and whether the link is lossy
- The `EncapsulationPanel` follows the current hop, wrapping/unwrapping layers live
- `HopTable` is a running ledger — the "what changed at this hop" answer at a glance
- Clicking any hop row seeks the timeline to that moment

---

## Acceptance criteria

- [ ] MACs change per hop, IPs do not (except at NAT), TTL decrements, checksum updates
- [ ] NAT table renders and reverses correctly on the return path
- [ ] TCP handshake, data transfer, and teardown have arithmetically correct seq/ack
- [ ] Fragmentation produces correct offsets and MF flags; reassembly only at the
      destination
- [ ] Lossy scenario is deterministic across runs
- [ ] Unit tests for `ipv4.ts`, `tcp.ts`, and `nat.ts` (pure logic — test it directly)
- [ ] Registry entry `'ready'`

---

## Prompts to execute

### Prompt 6.1 — protocol logic (no UI)

```
Read docs/implementation/06-module-packet-journey.md.

Implement the pure protocol logic under src/modules/packet-journey/sim/: ethernet.ts,
ipv4.ts, tcp.ts, udp.ts, and nat.ts. No React, no rendering — these build and transform
PDUs using the phase-03 types.

Correctness requirements from the phase doc: per-hop MAC rewrite, unchanged IPs except
at NAT, TTL decrement with checksum recomputation, NAPT translation table with reverse
mapping, TCP seq/ack arithmetic across handshake/data/teardown, and IPv4 fragmentation
with correct MF flags and offsets.

Write unit tests for ipv4.ts, tcp.ts, and nat.ts covering those rules.
```

### Prompt 6.2 — scenarios

```
Implement src/modules/packet-journey/sim/journey.ts and the four scenarios
(tcp-web-request, udp-dns-query, fragmented-packet, lossy-link) per
docs/implementation/06-module-packet-journey.md.

Use the shared topologies from phase 05 — if the ESLint boundary rule blocks importing
from src/modules/network-map, promote the shared topologies to src/core/topologies/ and
update both modules to import from there.

The lossy-link scenario must be deterministic via the seeded RNG. Add a test asserting
two runs of each scenario are deep-equal.
```

### Prompt 6.3 — module UI

```
Implement the Packet Journey UI per docs/implementation/06-module-packet-journey.md:
JourneyControls, EncapsulationPanel, HopTable, PacketJourneyModule, and the route.

EncapsulationPanel must follow the current hop and animate layers being added and
stripped. HopTable rows must be clickable to seek the timeline. Reuse SimulationView and
the phase-04 playback — do not write a new animation loop.

Then flip the packet-journey registry entry to 'ready'. Do not modify other modules.
```
