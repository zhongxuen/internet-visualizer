# `src/core` — framework-free logic

Pure TypeScript. This layer models **how the Internet works**; it knows nothing about
how any of it is drawn.

## What belongs here

- `sim/` — the deterministic simulation kernel. Protocol simulations run on a virtual
  clock and emit an ordered list of typed `SimEvent`s.
- `net/` — address, port, and byte primitives (IPv4/IPv6/CIDR/MAC parsing and
  classification, the well-known port table, hex/binary rendering). The same validators
  guard real-network input in phase 12, which is why they are strict.
- `types/` — shared domain types (packets, nodes, links, events).
- `protocols/` — per-protocol logic (IPv4/TTL, DNS, TCP, TLS records) added from phase 03.

## What must NEVER be imported here

`react`, `react-dom`, `next`, `next/*`, `@xyflow/react`, `motion`, `@/components/**`,
`@/app/**`.

This is enforced mechanically by `eslint.config.mjs` and will fail `npm run lint`.
It is the mechanism behind the CLAUDE.md rule "visualization logic must stay separated
from networking logic".

## Why it matters

Because this layer is pure, protocol logic is unit-testable in a node environment with
no browser, and one timeline component can drive every module. Simulations must also be
**deterministic** — seeded RNG only, never `Math.random()` or wall-clock time.
