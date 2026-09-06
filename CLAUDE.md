# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Phases 01–12 are complete: the scaffolding, the design system and app shell, the
simulation core, the visualization layer, and nine finished modules — **Network Map**
(phase 05), **Packet Journey** (phase 06), **DNS Explorer** (phase 07), **HTTP Explorer**
(phase 08), **HTTPS Explorer** (phase 09), **API Visualizer** (phase 10A), **WebSocket
Viewer** (phase 10B), **Internet Simulator** (phase 11), and **Network Diagnostics**
(phase 12), the only nine entries in `src/modules/registry.ts` with `status: 'ready'`.
The Learning Center (phase 13) is still `'planned'`.

**Network Diagnostics is the only module with `usesRealNetwork: true`, and no other
module may ever set it.** `tests/registry.test.ts` asserts that; tighten that test, never
relax it. The flag means the module *can* reach a network, not that it is:

- **Learn mode is the default** and mounts nothing that can make a request. Everything
  under `src/modules/network-diagnostics/sim/` is a pure function of a bundled fixture.
- **Live mode requires the acknowledgement gate** in `components/ModeSwitch.tsx`, is held
  in component state, and is never persisted — a reload returns to Learn mode.
- The `live` `SafetyBadge` is shown by the mode switch whenever Live mode is active, and
  again on the live console itself. The chrome badge (from the registry) states
  capability; those two state what is happening now.

Three live operations exist and there is no fourth: a DoH lookup, an RDAP lookup, and one
`HEAD` with timing — labelled *Reachability (TCP + HTTP timing)*, never "ping", because a
serverless runtime cannot send ICMP. There is no live traceroute for the same reason, and
the console says so where one would be.

The pieces, in the order they were built:

- prompt 12.1 — `src/core/net/{guard,ratelimit}.ts`, the SSRF guard and token bucket.
- prompt 12.2 — Learn mode: simulated `ping`, `traceroute`, DNS lookup, and WHOIS/RDAP,
  all four composed through `SimulationView`.
- prompt 12.3 — the three `GET`-only Route Handlers under `src/app/api/diagnostics/`.
  Read that folder's `README.md` before touching it: every live call goes through the
  single `guardedFetch` chokepoint in `_lib/outbound.ts`, and the invariants listed there
  are asserted in `src/app/api/diagnostics/__tests__/` (the `routes` vitest project).
- prompt 12.4 — Live mode's UI: `ModeSwitch`, `TargetInput`, `LiveDisclosure`,
  `RateLimitNotice`, and the `LiveConsole` that drives them. `live/client.ts` is the
  module's only I/O — one same-origin `GET` per press of Run, never retried.

`src/core/net/diagnostics.ts` is the contract both sides read: the URL builders, the
resolver and bootstrap constants, the `REACH_NOT_ICMP` sentence, and every payload type.
`LiveDisclosure` shows the exact URL a handler will request before it requests it, which
is only honest because the panel and the handler call the same function — so do not
rebuild a diagnostics URL anywhere else.

Shared protocol logic lives in `src/core/protocols/{ipv4,udp,tcp,dns,tls,http}` — `dns`,
`tcp`, `tls`, and `http` promoted in phase 11 for the Internet Simulator, and `ipv4` and
`udp` in phase 12 so Network Diagnostics builds traceroute out of the same `forwardIpv4`
TTL decrement Packet Journey animates. Nothing under `src/modules/*/sim/` may reimplement a
protocol.

The step-by-step build plan lives in `docs/implementation/` (start at `00-overview.md`),
which is committed and is the source of truth for _how_ to build. The full project spec
lives at `md-files/internet-visualizer.md` (git-ignored, local-only — see `.gitignore`). Read it before starting significant work; the summary below is derived from it.

## Commands

```bash
npm run dev            # dev server (Turbopack) on localhost:3000
npm run build          # production build
npm start              # serve the production build
npm run lint           # ESLint, including the architecture boundary rules below
npm run typecheck      # tsc --noEmit
npm run format         # Prettier write
npm run format:check   # Prettier check (CI)
npm test               # Vitest, single run
npm run test:watch     # Vitest, watch mode
npm run test:coverage  # Vitest with v8 coverage
```

Run a **single test file**, or a single test by name:

```bash
npx vitest run tests/registry.test.ts
npx vitest run tests/registry.test.ts -t "seeds all ten spec modules"
npx vitest run --project core     # only the node-environment (src/core) tests
npx vitest run --project routes   # only the diagnostics Route Handler tests
```

`npm run typecheck` needs `npm run build` (or `npm run dev`) to have run at least once:
Next 16 generates the global route types (`LayoutProps`, `PageProps`) into `.next/types`,
and `tsc` cannot resolve them before then. In CI, build before typechecking.

Versions installed: **Next 16.3**, **React 19.2**, **Tailwind 4**, **Vitest 4**, Node 22+.

Next 16 differs substantially from older Next.js; `AGENTS.md` (regenerated by `next dev`)
points at the version-accurate docs in `node_modules/next/dist/docs/`. Read those rather
than relying on memory of earlier Next versions.

## Architecture boundaries — enforced by lint, not convention

`eslint.config.mjs` fails the build on all three of these. They are the mechanical
enforcement of the philosophy below; do not weaken them. If a rule blocks you, the code
is on the wrong side of a boundary.

1. `src/core/**` may not import `react`, `react-dom`, `next`, `next/*`, `@xyflow/react`,
   `motion`, `zustand`, or anything under `app/`, `components/`, or `modules/`
   (`no-restricted-imports` for packages, `boundaries/dependencies` for local paths).
2. `src/modules/<a>/**` may not import from `src/modules/<b>/**`.
3. `src/components/**` may not import from `src/modules/**`.

`src/modules/registry.ts` is deliberately exempt from rule 3 — it is the shared manifest
that navigation and the home page read.

## Layout

```
src/
  app/          # Next.js App Router routes
  core/         # framework-free simulation + networking logic (sim/, net/, types/)
  components/   # reusable UI and visualization primitives
  modules/      # one folder per protocol module + registry.ts
  lib/          # small shared utils (cn)
tests/          # cross-cutting tests + jsdom setup
```

Each folder has a `README.md` stating what belongs there and what must never be imported
into it. Vitest runs two projects: `core` in **node** (no DOM) and `ui` in **jsdom**.

## Project vision

**Internet Visualizer** is an interactive platform that visually explains how the Internet works in real time — animations, graphs, and live simulations instead of text, aimed at students, developers, and networking/cybersecurity learners.

## Tech stack

Installed: Next.js 16.3 (App Router, Turbopack), React 19.2, TypeScript 5, Tailwind 4,
`@xyflow/react` (React Flow), `motion`, `zustand`, `zod`, `clsx` + `tailwind-merge`,
`lucide-react`. Tooling: ESLint 9 (flat config) + `eslint-plugin-boundaries`, Prettier
with `prettier-plugin-tailwindcss`, Vitest 4 + Testing Library + jsdom.

- Deployment: Vercel (production deploys from `main`, preview deploys on PRs)
- Planned later: D3.js, Playwright (phase 14), Electron, Docker
- **No database.** Every module is a deterministic client-side simulation and scenarios
  are typed files in the repo. The only candidate for external storage is the phase-12
  diagnostics rate limiter, which is in-memory by default; if it needs to survive across
  serverless instances, add Upstash Redis via the Vercel Marketplace at that point.

## Architecture philosophy

- Each protocol/concept (DNS, HTTP, HTTPS/TLS, TCP/IP, WebSockets, etc.) should be built as an **independent module** — implement and modify one module at a time; don't touch unrelated modules in the same change.
- Animations should be **reusable** components, not one-off per module.
- **Visualization logic must stay separated from networking logic** — e.g. a module that simulates/explains a protocol should not be entangled with the code that renders/animates it.

Planned core modules (each an independent module per the philosophy above): Network Map, Packet Journey, DNS Explorer, HTTP Explorer, HTTPS Explorer, API Visualizer, WebSocket Viewer, Internet Simulator, Network Diagnostics (ping/traceroute/DNS lookup/WHOIS), Learning Center.

## Security constraints

- Never scan unknown/real systems — diagnostics tools (ping, traceroute, WHOIS, etc.) must operate only against simulated or explicitly user-owned targets.
- Clearly separate simulations from real network tools in both UI and code — a user should never be unsure whether an action touches a real network.
- Validate all user inputs (this becomes especially important once diagnostics/API modules exist).

## UI philosophy

Highly interactive, animated, dark mode, modern, easy to explore — prefer visual explanations over long blocks of text throughout the product (this applies to in-app content, not to code comments or commit messages).
