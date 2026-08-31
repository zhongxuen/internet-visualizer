# Internet Visualizer — Implementation Roadmap

This folder is the step-by-step build plan derived from the project spec
(`md-files/internet-visualizer.md`, local-only) and `CLAUDE.md`.

Each numbered file is **one self-contained phase**. Work them in order. Every file has
the same shape:

1. **Goal** — what exists at the end of the phase
2. **Prerequisites** — which phases must be done first
3. **Deliverables** — files created/changed
4. **Steps** — the actual work, in order
5. **Acceptance criteria** — how you know the phase is done
6. **Prompts to execute** — copy-paste prompts for Claude Code, one per chunk of work

---

## Phase index

| #   | Phase                                                                                  | Depends on |
| --- | -------------------------------------------------------------------------------------- | ---------- |
| 01  | [Project scaffolding & foundations](./01-project-scaffolding.md)                       | —          |
| 02  | [Design system & app shell](./02-design-system-and-shell.md)                           | 01         |
| 03  | [Simulation core (protocol engine)](./03-simulation-core.md)                           | 01         |
| 04  | [Visualization layer (reusable animation components)](./04-visualization-layer.md)     | 02, 03     |
| 05  | [Module: Network Map](./05-module-network-map.md)                                      | 04         |
| 06  | [Module: Packet Journey](./06-module-packet-journey.md)                                | 04         |
| 07  | [Module: DNS Explorer](./07-module-dns-explorer.md)                                    | 04         |
| 08  | [Module: HTTP Explorer](./08-module-http-explorer.md)                                  | 04         |
| 09  | [Module: HTTPS / TLS Explorer](./09-module-https-tls-explorer.md)                      | 08         |
| 10  | [Modules: API Visualizer & WebSocket Viewer](./10-modules-api-and-websocket.md)        | 08         |
| 11  | [Module: Internet Simulator (end-to-end composite)](./11-module-internet-simulator.md) | 06–10      |
| 12  | [Module: Network Diagnostics (real vs simulated)](./12-module-network-diagnostics.md)  | 02         |
| 13  | [Module: Learning Center](./13-module-learning-center.md)                              | 04         |
| 14  | [Quality, a11y, performance & deployment](./14-quality-and-deployment.md)              | all        |

Phases 05–13 are **independent of each other** by design. After phase 04 you can build
them in any order, or in parallel, without touching unrelated modules.

---

## Architectural decisions this plan commits to

These go beyond the raw spec. They exist to make "visualization logic separated from
networking logic" and "each protocol is an independent module" actually enforceable
instead of aspirational.

### 1. A deterministic simulation kernel (`src/core/sim/`)

Every protocol module is a **pure, framework-free simulation** that emits an ordered
list of typed `SimEvent`s on a virtual clock. No React, no DOM, no `react-flow` imports
allowed in `src/core/**`. The UI is a _renderer_ of that event stream.

Why: it makes protocol logic unit-testable without a browser, lets one timeline
component drive every module, and makes the separation rule mechanically checkable
(an ESLint boundary rule, added in phase 01).

### 2. Timeline playback as a shared primitive

Play / pause / step-forward / step-back / scrub / speed control is built **once** in
phase 04 and reused by every module. Modules never implement their own animation loop.

### 3. Scenarios as data

Every module ships typed scenario files (`scenarios/*.ts`) — a topology plus inputs.
Lessons in the Learning Center reference the _same_ scenarios, so content and
simulation never drift apart.

### 4. Module registry

`src/modules/registry.ts` is the single manifest of modules (id, title, route, icon,
status, topics). Navigation, the home page, and the Learning Center all read from it.
Adding a module = adding a folder + one registry entry.

### 5. Accuracy is a first-class requirement

Each simulation step carries an optional `reference` (RFC number + section). Wrong
networking taught confidently is worse than no product. Phase files call out the
specific RFCs to check against.

### 6. Accessibility is designed in, not retrofitted

An animation-first product fails hard for reduced-motion and keyboard users unless
planned. Every module must be operable by keyboard via the timeline, must respect
`prefers-reduced-motion` (animation collapses to discrete step transitions), and must
never encode meaning in color alone.

### 7. Hard safety boundary for real network access

**Everything is simulated by default.** Real network calls live behind a separate,
visually distinct "Live tools" surface, are server-side only, allowlisted, rate-limited,
and never touch a target the user did not explicitly supply. See phase 12 — it also
documents the serverless constraint that makes true ICMP `ping`/`traceroute`
impossible on Vercel, and what to do instead.

---

## How to use the prompts

Each phase ends with numbered prompts. Run them one at a time in Claude Code, from the
repo root, in order. Verify the acceptance criteria before moving to the next phase.

Prompts assume the agent has read `CLAUDE.md` and this overview file.
