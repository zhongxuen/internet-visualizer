# 05 — Module: Network Map

## Goal

An explorable map of how a network is built up, from a single home LAN to the wider
Internet. This is the module that gives users the mental _geography_ every other module
then animates traffic across.

It is a **simulated** module. It never scans anything.

## Prerequisites

Phase 04.

---

## Deliverables

```
src/modules/network-map/
  meta.ts                   # registry entry
  scenarios/
    home-lan.ts
    small-office.ts
    isp-path.ts             # home -> ISP -> IXP -> hosting provider
    datacenter.ts           # LB, app tier, DB tier, CDN edge
  components/
    ScenarioPicker.tsx
    LayerFilter.tsx         # show/hide by OSI layer or by device role
    TopologyLegend.tsx
    NodeDetailTab.tsx       # module-specific inspector tab
  NetworkMapModule.tsx
src/app/(modules)/network-map/page.tsx
```

---

## Scope

### Scenarios (build in this order)

1. **Home LAN** — devices, Wi-Fi AP, switch, router doing NAT, modem, ISP uplink.
   Teaches: private vs public addressing, the default gateway, NAT, DHCP, subnet masks.
2. **Small office** — adds a managed switch with VLANs, a firewall, a local DNS server,
   and a printer/NAS. Teaches: segmentation, why a firewall sits where it does.
3. **ISP path** — home router → ISP access → regional POP → IXP → transit → hosting AS.
   Teaches: AS numbers, peering vs transit, why latency grows with distance, BGP at a
   conceptual level.
4. **Datacenter** — CDN edge, load balancer, reverse proxy, app servers, database,
   cache. Teaches: horizontal scaling, health checks, where TLS terminates.

Each scenario is a `Topology` plus static annotations — no packets yet. Traffic across
these topologies is phase 06's job, and it **reuses these exact topology files**.

### Interactions

- Click a node → `Inspector` shows kind, addresses, role, and 2–3 sentence explanation
  with an RFC or standards reference where one applies
- Click a link → latency, medium, bandwidth, and what physically carries it
- **Layer filter** — dim everything above/below a chosen layer, so a user can look at
  "just L2" or "just L3"
- **Address reveal toggle** — show/hide IPs and MACs to reduce first-time overload
- **Guided tour** — an ordered walk-through of the topology using the phase-04
  `PhaseStepper`; each step pans/zooms to a node and explains it. This reuses the phase
  mechanism with zero packets, which is a good test that the abstraction holds.

### Accuracy notes to verify

- RFC 1918 private ranges are correct (`10/8`, `172.16/12`, `192.168/16`)
- The home router is doing **NAPT** (port-based NAT) — label it correctly
- Do not draw a "switch" doing routing, or a "router" doing frame switching
- Latency values should be plausible: LAN < 1 ms, ISP access 5–20 ms, cross-continent
  80–160 ms

---

## Acceptance criteria

- [ ] Four scenarios render, switchable without a page reload
- [ ] Topology files are exported for reuse by phase 06 (no duplication later)
- [ ] Node/link inspection works by mouse and keyboard
- [ ] Layer filter and address toggle work
- [ ] Guided tour steps through the phase stepper and works under reduced motion
- [ ] Registry entry flipped to `status: 'ready'`, `usesRealNetwork: false`
- [ ] No imports from any other `src/modules/*` folder

---

## Prompts to execute

### Prompt 5.1 — topologies

```
Read docs/implementation/05-module-network-map.md and the phase-03 topology types.

Create src/modules/network-map/scenarios/ with home-lan.ts, small-office.ts,
isp-path.ts, and datacenter.ts as typed Topology objects with realistic addressing and
plausible latencies (LAN <1ms, ISP access 5-20ms, cross-continent 80-160ms).

Use RFC 1918 ranges correctly, label the home router as doing NAPT, and give each node a
short teaching explanation plus a standards reference where one applies. Export the
topologies so other modules can import them.
```

### Prompt 5.2 — module UI

```
Implement the Network Map module UI per docs/implementation/05-module-network-map.md:
ScenarioPicker, LayerFilter, TopologyLegend, NodeDetailTab, and NetworkMapModule,
composed through the phase-04 SimulationView, plus the route at
src/app/(modules)/network-map/page.tsx.

Include the address-reveal toggle and the guided tour built on PhaseStepper. Then flip
the network-map entry in src/modules/registry.ts to status 'ready'.

Do not modify any other module.
```
