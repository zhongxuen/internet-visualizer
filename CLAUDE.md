# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Phases 01–13 are complete: the scaffolding, the design system and app shell, the
simulation core, the visualization layer, and all ten modules — **Network Map**
(phase 05), **Packet Journey** (phase 06), **DNS Explorer** (phase 07), **HTTP Explorer**
(phase 08), **HTTPS Explorer** (phase 09), **API Visualizer** (phase 10A), **WebSocket
Viewer** (phase 10B), **Internet Simulator** (phase 11), **Network Diagnostics**
(phase 12), and the **Learning Center** (phase 13). Every entry in
`src/modules/registry.ts` now has `status: 'ready'`.

Phase 14 is complete: the test suite (1), the accessibility pass (2), the performance
pass (3), the edge states (4), CI (5), the documentation set (6), deployment (7) and the
final review (8). Two things it did not fix and one it deliberately left alone: two
performance budgets are still missed (both described below, with what has been ruled
out); and `/demo` is still served, still excluded from the sitemap and disallowed in
`robots.txt`, and its own file still says to delete it once a real module renders a
`SimulationView` -- which happened in phase 05.

The Learning Center is the one module that teaches from the other nine rather than
simulating anything itself, and it is at `/learn` rather than `/learning-center` because
its routes are a small site: an index, a glossary, and thirty-three lessons across seven
tracks. Read `src/modules/learning-center/README.md` before touching it. Three
invariants matter most:

- **A lesson embeds a module's own run, never a copy of it.** `EmbeddedSim` resolves
  `module`/`scenario` through `src/modules/scenarios.ts` — the manifest that exists
  because the boundary rule below forbids one module importing another — so a lesson
  cannot drift out of sync with what it teaches. No animation code may be added to the
  Learning Center.
- **Coverage is asserted, not assumed.** `SPEC_LEARNING_TOPICS` in the registry is the
  committed copy of the spec's learning-topic list (the spec file is git-ignored), and
  `content/coverage.test.ts` asserts every one of those topics is taught by at least one
  lesson. `content/authoring.test.ts` asserts the shape of each lesson, including the
  spec's ~150-word prose budget between visual elements.
- **Progress is `localStorage` only and never reaches a server render.** No account, no
  backend, no PII.

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
npm run test:coverage  # Vitest with v8 coverage, thresholds enforced
npm run test:e2e       # Playwright (builds, then serves on :3100)
npm run test:e2e:ui    # Playwright UI runner
```

`test:coverage` is the gate, not a report: `vitest.config.mts` fails the run below
`src/core` 90% (95% for `net/guard.ts`) and below each module `sim/` folder's own budget.
If a run dies on a *timeout* rather than a threshold, read the `testTimeout` note in that
file before touching anything: v8 instrumentation roughly doubles every jsdom mount, and
`PacketJourneyModule.test.tsx` alone goes from 65 s to 134 s under it. The backstop is
120 s per test for that reason, and it is a backstop, not a budget.
Playwright runs against a **production build**, never the dev server -- `e2e/README.md`
says why, and how to reuse a server you already have running.

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

`.github/workflows/ci.yml` runs those same commands on every push and pull request, in
one job, with no `continue-on-error` anywhere -- `npm ci`, lint, **build**, `tsc --noEmit`,
`format:check`, `test:coverage`, then Playwright. The build is not one of the phase doc's
six steps and is not optional either: it is what generates the route types the typecheck
needs, and Playwright's own `webServer` reuses the `.next/cache` it leaves behind.

Versions installed: **Next 16.3**, **React 19.2**, **Tailwind 4**, **Vitest 4**, Node 22+.

Next 16 differs substantially from older Next.js; `AGENTS.md` (regenerated by `next dev`)
points at the version-accurate docs in `node_modules/next/dist/docs/`. Read those rather
than relying on memory of earlier Next versions.

## Accessibility — checked, not assumed

Phase 14 section 2 is done and is guarded by two Playwright specs (`e2e/README.md`
explains the split). Three rules follow from it and apply to anything added anywhere:

1. **Recession is a colour, not an alpha.** `opacity-45` on a row of text blends it toward
   the surface -- `text-fg-muted` at 45% measures 2.25:1 -- which was the source of every
   colour-contrast violation in the first axe pass. Use `.state-dim` (`src/app/globals.css`),
   which applies `--text-dim`: the dimmest value clearing 4.5:1 on all three surfaces.
   Never put it on a row that also draws a selection tint, and `[data-no-dim]` opts a
   tinted subtree (any `Badge`) out.
2. **A scrollable box needs a tab stop.** `Panel` sets `tabIndex={0}` whenever `scroll` is
   on; a scroll container holding only text is unreachable without a pointer otherwise.
3. **The canvas is never the only route in.** `SimulationView` renders `TopologyList` (the
   topology as tab-through buttons, writing to the same selection) and `PhaseAnnouncer`
   (the current phase in the one `aria-live` region a view is allowed).

`tests/tokens-contrast.test.ts` asserts every text token clears 4.5:1 and every border
3:1 on every surface; `tests/non-colour-signals.test.ts` asserts no two node states, node
kinds or link media are indistinguishable in greyscale.

## Performance — measured, not guessed

Phase 14 section 3 has been done once. `perf/README.md` says how to reproduce the numbers;
`npm run perf:bundles` and `npm run perf:vitals` are the two commands. **Do not change
anything in this section on reasoning alone** -- three of the four things tried during that
pass looked obviously right and measured nothing, and the one that mattered was found by
bisection, not by reading the code.

Where the budgets stand: LCP and CLS pass everywhere with room to spare; four module routes
are inside the 250 KB gzipped budget and five are over it by between 38 and 93 KB, all of
it zod; and playback holds ~50 fps on a small module but 2 fps on Packet Journey. The last
one is not solved -- see the note at the end.

What follows is the shape of the code as it stands, and the three things that will quietly
undo it.

1. **A frame costs no render.** Playback moves `virtualTime` sixty times a second, and
   almost nothing on screen changes that often -- node highlights, the current phase, the
   pinned notes and how much of the log has been reached all change only when the playhead
   crosses an event. `projectionKey` (`src/core/sim/project.ts`) collapses "which events
   have happened and which phase is in force" into one number; `useVisibleState` memoizes
   the projection on it, so every identity downstream holds still between events. Only
   `inFlight` is recomputed per frame. `project.test.ts` asserts the invariant this rests
   on: equal cursors give deep-equal `nodeStates`, `log`, `activeAnnotations` and
   `currentPhase`.
2. **Packet position never goes through React.** `PacketSprite` subscribes to the
   `FrameClock` (`src/components/viz/frameClock.ts`) and writes its own `transform`; the
   canvas holds the `inFlight` array still for as long as the same packets are travelling.
   `Timeline` does the same for the playhead, with `transform: scaleX()` and an
   uncontrolled slider, because `width: %`, a controlled `value` and a changing
   `aria-valuetext` each invalidate layout or the accessibility tree. Adding a prop that
   changes every frame puts all of that back into the render path.
3. **The bundle is split at the barrel.** `package.json` declares `"sideEffects": ["*.css"]`,
   without which nothing in `src/components/viz/index.ts` can be tree-shaken and React Flow
   (~80 KB gzipped) sits in the first load of every module *and* every lesson route. The
   canvas itself loads through `next/dynamic` (`viz/LazyCanvas.tsx`) with a placeholder of
   the same height, so the split costs no layout shift. Nothing in `src/` may start
   depending on an import for its side effect.

Fonts are wired through `--font-sans` / `--font-mono` in `src/styles/tokens.css`. Those two
lines are the whole connection between `next/font` in `app/layout.tsx` and everything that
draws text; without them the two Geist files are still fetched on every route and never
used, which is exactly the state phase 14 found them in.

### The two budgets still missed, and what is actually known about them

- **Five module routes are over 250 KB gzipped, and the excess is zod.** One 83.5 KB
  gzipped chunk, on exactly the five routes that import it -- `core/net/guard.ts` plus the
  four modules that validate typed input. Nothing else is close. It is a deliberate
  client-side dependency (the SSRF guard validates a target before the request is built,
  which is what lets `LiveDisclosure` show the real URL), so it is not a leak to remove; it
  is a migration to `zod/mini` or to hand-written validators, and it touches the one file
  with a 95% coverage floor. Do that on purpose, not in passing.
- **Playback on `/packet-journey` is ~2 fps under a 4x CPU throttle; every other module is
  40--50.** The cause is not any of the obvious ones, and the list of things ruled out is
  worth more than another guess. Each line is a separate production build, measured with
  `perf/vitals.mjs`:

  | Change | fps |
  | --- | --- |
  | unchanged | 1.7 |
  | the module's three live panels removed | 2.6 |
  | the event log's scroll-into-view effect disabled | 1.9 |
  | the log's rows individually memoized, then chunked | 1.8 / 2.4 |
  | the `Timeline` taken off layout-invalidating writes | 2.2 |
  | packet sprites not rendered at all | 2.3 |
  | `SimulationCanvas` memoized so React Flow never re-renders | 1.7 |
  | **the log cut to 40 rows** | **8.2** |
  | **the log removed entirely** | **21.7** |
  | **the canvas removed, log kept** | **17.5** |

  The three that move it are the three that change how much is *in the document*. Neither
  the canvas nor the log is slow on its own -- remove either and the page is fine -- and no
  amount of not re-rendering either one helps. So something forces a document-wide style or
  layout pass every frame, and Packet Journey is simply the page big enough (6,014 elements
  against ~1,700 for the next module) for that pass to cost 500 ms.

  What has *not* been established is what triggers the pass. React Flow's `ResizeObserver`
  showed 129--210 ms callbacks in the long-animation-frame attribution and is the leading
  suspect; `EncapsulationPanel`'s `motion` `layout` projection is the other, though removing
  the panels entirely only bought 0.9 fps. The next step is a `MutationObserver` over a
  playing run to find what writes to the DOM each frame -- attempted once and abandoned
  because the observer itself could not keep up on a page already at 2 fps under throttling;
  try it unthrottled, or with `Animation`/`LayoutShift` instrumentation instead.

  Two process notes, both learned the hard way. `next start` reads the build manifest once,
  at boot, so **restart it after every build** or you will measure the previous one. And the
  run-to-run spread on this page is roughly +/-0.5 fps, so nothing under about 1 fps of
  difference means anything.

## Edge states — where the product ends up when something is wrong

Phase 14 section 4. Six route files, and one rule behind all of them: **losing a part
should cost that part, not the page.**

- `app/error.tsx`, `app/(modules)/error.tsx` and `app/learn/error.tsx` all render
  `RouteError` (`src/components/shell/`), which offers `reset()` first and shows the
  runtime's own message and `digest` rather than a euphemism. The `(modules)` one renders
  *inside* `ModuleChrome`, which has already drawn the page's `h1`, so it passes
  `level={2}` -- one `h1` per page is an acceptance criterion, and `e2e/a11y.spec.ts`
  checks it.
- `app/global-error.tsx` is the root layout's own boundary and is deliberately built out
  of nothing: reaching it means the layout did not render, so reaching for a shared
  component would be reaching for something that may be the thing that broke.
- `app/(modules)/loading.tsx` draws `ModuleSkeleton`, whose canvas box copies
  `SimulationView`'s `h-[26rem] lg:h-[32rem]`. If those heights change there, change them
  here -- that is the one thing in it that can go stale.
- **There is one 404 and it is `app/not-found.tsx`.** A `not-found.tsx` under `app/learn/`
  would never render: every lesson is pre-rendered and `dynamicParams = false`, so a wrong
  track or slug does not match the route at all and no boundary inside it is consulted.
  Do not add one back.

Two things below the route level do the same job:

- `SimulationCanvasSlot` (`viz/LazyCanvas.tsx`) wraps the lazy canvas in an error
  boundary. React Flow arrives as a chunk and a chunk can fail; without the boundary that
  rejection reaches the route's `error.tsx` and takes the whole module with it. The canvas
  is the one redundant part of a `SimulationView` -- `TopologyList` and the log carry the
  same run as text -- so it is the one part that may be lost alone. Note that
  `tests/setup.ts` replaces this whole module in jsdom and must name the same export the
  view renders; renaming one without the other fails a hundred module tests at once with
  a mocker error pointing at `SimulationView`, not at the rename.
- `EmbeddedSim` distinguishes *missing* from *failed*. A module or scenario that does not
  exist is an authoring fact and gets the message an author needs; a catalogue whose chunk
  did not arrive is transient and gets a retry button. `loadEmbeddableScenarios` evicts a
  rejected promise from its cache so that retry can actually succeed -- a rejection left in
  the map disables every embed of that module for the life of the page.

The module-level edge states the phase doc lists were already in place before this section
and are worth knowing about rather than rebuilding: every module that takes typed input
has a `coverageFor()` that says whether the fixtures cover it (DNS Explorer, HTTP Explorer,
API Visualizer, the Internet Simulator's URL bar), and Live mode already renders
`blocked-target`, `rate-limited`, `timeout` and `upstream-failed` distinctly -- see
`LiveResultView`. A refusal is never phrased as a failure.

## Documentation

Four files, and each is checked by something rather than trusted:

- `README.md` -- what the product is, the module list, run instructions, the architecture
  summary, and the screenshots in `docs/media/` (regenerate them against a production
  build; they are viewport shots at 1440x1120, 2x).
- `docs/ACCURACY.md` -- every protocol claim mapped to its RFC, and every deliberate
  simplification. `tests/rfc-references.test.ts` runs every scenario in the codebase,
  collects the `RfcRef` on each `annotate` event, and fails if one is malformed or names an
  RFC that file does not list. **Adding a citation to a scenario means adding a row there.**
- `docs/CONTENT-STYLE.md` -- how to write an annotation, a log line, a phase description
  and a lesson. The four slots have different jobs and different lengths; that file is the
  place to look before writing product prose.
- `CLAUDE.md` -- this file.

One claim they share and that must stay true: **"everything is simulated" is false on its
own.** Network Diagnostics' Live mode exists, so the footer, the home page and the README
all name it as the exception rather than glossing it. A global reassurance with an
unmentioned exception is worse than no claim at all.

## Deployment — headers, and what the browser enforces for us

Phase 14 section 7. The deployment is Vercel, production from `main`, previews on PRs;
`.vercel/project.json` links the repository to the project. Four pieces, and the first
is doing more work than it looks like.

1. **The security headers are in `src/lib/securityHeaders.ts`, not in `next.config.ts`.**
   The config imports `securityHeaders()` and returns it verbatim under `source:
   '/:path*'`, so every response carries them -- pages, the diagnostics handlers, the OG
   image, static assets. Splitting the policy out is what lets
   `tests/security-headers.test.ts` assert what it says and `e2e/security.spec.ts`
   assert that it arrives.

   **`connect-src 'self'` is the load-bearing directive.** It is the browser-level form
   of "every module is a deterministic client-side simulation": a `fetch`,
   `XMLHttpRequest`, `EventSource` or `WebSocket` to any other origin is refused by the
   browser whatever the code asks for. Live mode is unaffected, because its three
   lookups are same-origin `GET`s to `/api/diagnostics/*` and the outbound half happens
   on the server behind `guardedFetch`. Do not add a host to it. If a module ever needs
   one, the module is on the wrong side of the boundary.

   `script-src 'unsafe-inline'` is the policy's one real weakness and is deliberate: the
   App Router streams its payload through per-page inline scripts, and the only
   alternative is a per-request nonce, which forces every route -- all thirty-three
   pre-rendered lessons included -- to render dynamically. The file states the trade and
   what bounds it.

2. **CSP has two modes and a rollout, not a switch to flip on a hunch.** `CSP_MODE=report-only`
   renames the header; `.env.example` writes down the three steps. The evidence that the
   policy is clean comes from `e2e/security.spec.ts`, which collects
   `securitypolicyviolation` DOM events rather than console text -- so it says the same
   thing in both modes, and a policy can be proven safe before it is allowed to break
   anything. Both passes were run before this shipped: report-only clean across every
   route shape and a full playback, then enforcing with all 210 e2e tests green.

3. **`sitemap.ts` and `robots.ts` are derived, like `e2e/routes.ts`.** `readyModules()`
   and `allLessonParams()` -- the same function `generateStaticParams` uses -- so a
   module or lesson cannot ship without a crawlable URL. `lastModified` is omitted
   everywhere on purpose; the honest value is unknown and the easy one is a build
   timestamp that claims all forty pages changed together.

4. **Per-route metadata goes through `pageMetadata()` in `src/lib/metadata.ts`.** The
   trap it exists for: Next merges metadata *shallowly*, so a segment that defines
   `openGraph` at all replaces the root's -- including the image Next injected from
   `app/opengraph-image.tsx`. Every route here defines `openGraph`, so the card is named
   explicitly in `OG_IMAGE`. Leave it out of a new route's metadata and that route
   unfurls blank, silently.

`src/lib/site.ts` resolves the origin everything absolute is built from, and the
fallback chain matters: `NEXT_PUBLIC_SITE_URL`, then `VERCEL_PROJECT_PRODUCTION_URL`
(set on previews too, which is why a preview canonicalises to production), then
`VERCEL_URL`, then localhost. A preview also emits `noindex` and a `Disallow: /`, in
both places, because `robots.txt` governs crawling and the meta tag governs indexing and
they are not the same instruction.

`src/lib/ogPalette.ts` is the **only** file outside `tokens.css` allowed to name a hex
value. Satori has no custom properties, so `var(--accent)` reaching it is an unparseable
string; `tests/og-palette.test.ts` asserts every copied value still equals its
declaration, which is what keeps rule 1 in `tokens.css` true rather than merely stated.

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
  app/          # Next.js App Router routes, the three diagnostics Route Handlers,
                #   and the error / not-found / loading boundaries
  core/         # framework-free simulation + networking logic (sim/, net/, protocols/, types/)
  components/   # reusable UI and visualization primitives
  modules/      # one folder per protocol module + registry.ts + scenarios.ts
  lib/          # small shared utils (cn)
tests/          # cross-cutting tests + jsdom setup
e2e/            # Playwright: smoke, per-module, axe, manual-a11y
perf/           # the two measurement scripts behind the performance section
docs/           # ACCURACY.md, CONTENT-STYLE.md, media/, and implementation/
.github/        # the CI workflow
```

Each folder under `src/` has a `README.md` stating what belongs there and what must never
be imported into it. Vitest runs three projects: `core` and `routes` in **node** (no DOM)
and `ui` in **jsdom**.

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
