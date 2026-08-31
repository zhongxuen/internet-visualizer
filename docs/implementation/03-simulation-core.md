# 03 — Simulation core (the protocol engine)

## Goal

A deterministic, framework-free simulation kernel in `src/core/` that every protocol
module compiles down to. This is the single most important phase in the project: it is
what makes "visualization logic separated from networking logic" real, makes protocol
behaviour unit-testable without a browser, and lets one timeline component drive every
module.

**Nothing in this phase renders anything.**

## Prerequisites

Phase 01 (specifically the ESLint boundary rules — they guard this layer).

---

## Deliverables

```
src/core/types/
  topology.ts      # nodes, links, addresses
  pdu.ts           # protocol data units, headers, layers
  events.ts        # SimEvent union
src/core/sim/
  clock.ts         # virtual time
  scenario.ts      # Scenario + ScenarioInput types
  simulation.ts    # Simulation class: run() -> SimEvent[]
  builder.ts       # ergonomic helpers for authoring protocol scripts
  rng.ts           # seeded PRNG (determinism)
  index.ts
src/core/net/
  address.ts       # IPv4/IPv6/MAC parse + validate + format
  ports.ts         # well-known port table
  bytes.ts         # hex/binary formatting, header field extraction
src/core/sim/__tests__/
```

---

## Design

### Topology model

```ts
export type NodeKind =
  | 'client'
  | 'router'
  | 'switch'
  | 'server'
  | 'dns-resolver'
  | 'dns-root'
  | 'dns-tld'
  | 'dns-authoritative'
  | 'cdn-edge'
  | 'load-balancer'
  | 'proxy'
  | 'firewall'
  | 'nat';

export interface SimNode {
  id: string;
  kind: NodeKind;
  label: string;
  ipv4?: string;
  ipv6?: string;
  mac?: string;
  /** free-form, rendered in the inspector */
  detail?: Record<string, string>;
}

export interface SimLink {
  id: string;
  from: string; // node id
  to: string;
  /** one-way propagation delay in virtual ms */
  latencyMs: number;
  bandwidthMbps?: number;
  medium?: 'ethernet' | 'wifi' | 'fiber' | 'cellular';
}

export interface Topology {
  nodes: SimNode[];
  links: SimLink[];
}
```

### PDU model — encapsulation is explicit

This is what makes the product _educational_ rather than decorative. A packet is a stack
of layers, each with real named header fields.

```ts
export type LayerKey = 'link' | 'network' | 'transport' | 'session' | 'application';

export interface HeaderField {
  name: string; // 'TTL'
  value: string; // '64'
  bits?: number; // 8
  note?: string; // short teaching note
}

export interface ProtocolLayer {
  layer: LayerKey;
  protocol: string; // 'Ethernet' | 'IPv4' | 'TCP' | 'TLS' | 'HTTP/1.1'
  fields: HeaderField[];
  payloadPreview?: string;
}

export interface PDU {
  id: string;
  layers: ProtocolLayer[]; // outermost first
  sizeBytes: number;
  summary: string; // 'TCP SYN 49152 -> 443'
}
```

Encapsulation and decapsulation are core operations (`encapsulate(pdu, layer)`,
`decapsulate(pdu)`) so Packet Journey can literally show headers being added and
stripped at each hop.

### Event model — the contract between logic and UI

```ts
export type SimEvent =
  | { kind: 'phase'; at: number; id: string; title: string; description: string }
  | {
      kind: 'transmit';
      at: number;
      pduId: string;
      from: string;
      to: string;
      durationMs: number;
      linkId: string;
    }
  | {
      kind: 'node-state';
      at: number;
      nodeId: string;
      state: 'idle' | 'processing' | 'active' | 'error';
      note?: string;
    }
  | { kind: 'pdu-created'; at: number; pdu: PDU; atNode: string }
  | {
      kind: 'pdu-transform';
      at: number;
      pduId: string;
      before: PDU;
      after: PDU;
      atNode: string;
      reason: string;
    } // NAT rewrite, TTL decrement, encap/decap
  | { kind: 'drop'; at: number; pduId: string; atNode: string; reason: string }
  | { kind: 'annotate'; at: number; targetId: string; text: string; reference?: RfcRef }
  | { kind: 'log'; at: number; level: 'info' | 'warn' | 'error'; text: string };

export interface RfcRef {
  rfc: number;
  section?: string;
  title: string;
}
```

`at` is **virtual milliseconds**, not wall-clock. The renderer maps virtual time to real
time through the playback speed control. This is why a TLS handshake can be watched at
0.1× and a DNS lookup at 4× with the same code.

### Simulation

```ts
export interface Scenario<I = unknown> {
  id: string;
  title: string;
  description: string;
  topology: Topology;
  input: I;
  /** the protocol script: pure, deterministic, no side effects */
  run(ctx: SimContext, input: I): void;
}

export interface SimResult {
  events: SimEvent[]; // sorted by `at`
  phases: PhaseSummary[]; // derived index for the stepper
  durationMs: number; // total virtual duration
  pdus: Record<string, PDU>;
}
```

Rules:

- `Simulation.run(scenario)` is **pure and deterministic**: same scenario + same seed →
  byte-identical `SimResult`. Any jitter comes from `rng.ts`, seeded from the scenario.
- No `Date.now()`, no `Math.random()`, no timers, no `fetch` anywhere in `src/core/sim`.
- The clock only advances through `ctx.advance(ms)` or `ctx.send(...)`, which returns the
  arrival time.

### Builder helpers

Authoring a protocol script should read like a protocol description:

```ts
run(ctx, input) {
  ctx.phase('resolve', 'DNS resolution', 'Turn the hostname into an IP address');
  const query = ctx.pdu.udp({ from: client, to: resolver, dport: 53 })
                   .app('DNS', dnsQueryFields(input.hostname));
  ctx.send(query, client, resolver);
  ctx.note(resolver, 'Recursive resolver checks its cache first',
           { rfc: 1034, section: '4.3.2', title: 'Domain Names — Concepts' });
}
```

The builder API is the ergonomics layer. Get it right here and every module phase gets
cheaper.

### Playback store (client side, but still no rendering)

`src/core/sim/playback.ts` — a plain state machine (no React) that a Zustand store wraps
in phase 04:

```ts
{ status: 'idle'|'playing'|'paused'|'ended', virtualTime: number, speed: number,
  seek(t), play(), pause(), stepForward(), stepBack(), setSpeed(x) }
```

`stepForward` / `stepBack` jump between **phase boundaries**, not raw events — that is
what makes a module explorable by keyboard and usable under reduced motion.

---

## Testing (this phase is the one with real test coverage)

- Determinism: run a scenario twice, assert deep equality
- Event ordering: `at` is non-decreasing; every `transmit` references an existing PDU and
  a real link
- Encapsulation: `decapsulate(encapsulate(p, l))` round-trips
- Address parsing: valid/invalid IPv4, IPv6, CIDR, MAC — including the malformed cases
  (this validator is reused for real user input in phase 12, so it must be strict)
- Clock: `advance` monotonicity; `send` arrival = start + link latency + serialization

Target ≥ 90% coverage for `src/core/**`. It is pure logic — there is no excuse for less.

---

## Acceptance criteria

- [ ] `src/core` imports nothing from React, Next, React Flow, or `src/components`
      (lint proves it)
- [ ] A toy two-node scenario produces a sorted, deterministic `SimResult`
- [ ] The same scenario run twice is deep-equal
- [ ] Encapsulate/decapsulate round-trips
- [ ] Address validators reject malformed input
- [ ] `src/core` coverage ≥ 90%

---

## Prompts to execute

### Prompt 3.1 — types

```
Read docs/implementation/03-simulation-core.md.

Implement the type layer only: src/core/types/topology.ts, pdu.ts, and events.ts exactly
as specified there (Topology, SimNode, SimLink, LayerKey, HeaderField, ProtocolLayer,
PDU, SimEvent, RfcRef).

Framework-free — no React, Next, or React Flow imports. Add TSDoc comments explaining
each field in networking terms, since these types are the shared vocabulary for every
module.
```

### Prompt 3.2 — net utilities

```
Implement src/core/net/ per docs/implementation/03-simulation-core.md:

- address.ts: parse, validate, and format IPv4, IPv6, CIDR, and MAC addresses; classify
  an IP as private/loopback/link-local/public
- ports.ts: well-known port table with service names
- bytes.ts: hex and binary formatting helpers, byte-size formatting, header field
  rendering

Strict validation — these validators are reused for real user input in phase 12. Write
thorough unit tests including malformed inputs.
```

### Prompt 3.3 — simulation kernel

```
Implement src/core/sim/ per docs/implementation/03-simulation-core.md: rng.ts (seeded
PRNG), clock.ts, scenario.ts, simulation.ts, builder.ts, and index.ts.

Hard requirements:
- Simulation.run(scenario) is pure and deterministic; same scenario + seed produces a
  deep-equal SimResult
- No Date.now(), Math.random(), timers, or fetch anywhere under src/core/sim
- Events are emitted sorted by virtual time `at`
- The builder API reads like a protocol description (see the example in the phase doc)

Include a toy two-node ping-style scenario used only by tests.
```

### Prompt 3.4 — playback state machine + test suite

```
Implement src/core/sim/playback.ts as a plain, framework-free state machine with
status, virtualTime, speed, seek, play, pause, stepForward, stepBack, and setSpeed.
stepForward/stepBack must move between phase boundaries, not raw events.

Then write the full test suite described in docs/implementation/03-simulation-core.md
(determinism, event ordering, encapsulation round-trip, address parsing, clock
arithmetic, playback transitions) and get src/core/** to at least 90% coverage.
Report the coverage numbers.
```
