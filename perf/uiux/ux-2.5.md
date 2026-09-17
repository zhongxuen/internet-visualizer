# UX-2.5 — places, envelopes and a camera that follows

Branch `uiux/2-5`, base `219e54e`. Every figure below is a production build served by
`npx next start --port 3125`, restarted after each build. 4x CPU throttle, median of 3 runs
per figure unless stated.

**Read the fps figures with care: the machine was saturated throughout.** CPU sat at 100%, with other wave-2 worktrees building and serving on 3122 and 3123.
One build of this branch measured `/network-map` at 45.4 fps and, minutes later, at 13.7.
LCP on unchanged server-rendered text moved between 336 ms and 3.8 s. As `perf/uiux-baseline.md`
already says, a single pass here says nothing about a small change. So the comparison that
counts is the **alternated A/B** below: the base commit and this branch, built side by side
and served in turn on the same port under the same load.

## First-load JS — `npm run perf:bundles`

Gzipped. Before is `219e54e`; after is this branch.

| Route                        | Before   | After    | Change  |
| ---------------------------- | -------: | -------: | ------: |
| `/internet-simulator`        | 350.2 KB | 351.0 KB | +0.8 KB |
| `/network-diagnostics`       | 323.0 KB | 323.8 KB | +0.8 KB |
| `/api-visualizer`            | 322.1 KB | 323.0 KB | +0.9 KB |
| `/http-explorer`             | 319.8 KB | 320.6 KB | +0.8 KB |
| `/dns-explorer`              | 295.1 KB | 295.9 KB | +0.8 KB |
| `/packet-journey`            | 250.3 KB | 251.6 KB | +1.3 KB |
| `/https-explorer`            | 225.9 KB | 226.8 KB | +0.9 KB |
| `/websocket-viewer`          | 220.1 KB | 221.0 KB | +0.9 KB |
| `/network-map`               | 190.7 KB | 192.3 KB | +1.6 KB |
| every lesson route (33)      | 188.2 KB | 189.1 KB | +0.9 KB |
| `/demo`                      | 175.1 KB | 175.9 KB | +0.8 KB |
| `/`, `/_not-found`, `/learn`, `/learn/glossary`, `/_global-error` | unchanged | unchanged | 0 |

No new dependency. Every icon is from `lucide-react`, which was already installed. The
growth is data that ships with the shared tables: the zones and plain roles in
`src/core/topologies/*`, `plainRole` on `nodes/kinds.ts` (which now imports
`src/core/text/kinds.ts`), and the state words. The canvas itself (React Flow, the camera,
zone backdrops, the Key) is still in the lazy chunk. The home route and lesson routes carry
no React Flow: lessons grew by 0.9 KB, not 80. Every module route is well inside the §10
allowance of +10 KB.

## Playback — alternated A/B (the comparison that counts)

A throwaway script (not committed): the base build, from a detached worktree of `219e54e`, and the branch build, each served on 3125 in turn,
`ROUTES=/network-map,/packet-journey,/api-visualizer`, two rounds (base, branch, base,
branch).

| Route             | Base (round 1 / 2) | Branch (round 1 / 2) | Read as |
| ----------------- | -----------------: | -------------------: | ------- |
| `/packet-journey` |        1.6 / 1.4 fps |          1.6 / 1.6 fps | **Not worse.** |
| `/api-visualizer` |        5.7 / 8.4 fps |          6.9 / 5.4 fps | Same range: noise. |
| `/network-map`    |       31.0 / 22.4 fps |         17.2 / 18.1 fps | Lower in both rounds; see below. |

### `/network-map`: what was tried

A lower figure in both rounds had to be explained before being accepted, so one diagnostic
build carried temporary query-string switches (since removed). Each one turned off one new
thing, measured back to back on the same server, two rounds:

| Variant                            | Round 1 | Round 2 |
| ---------------------------------- | ------: | ------: |
| branch, unchanged                  | 26.7    | 19.8    |
| zone backdrops not rendered        | 13.7    | 16.0    |
| no glow on working machines        | 15.7    | 14.7    |
| camera never moves (`setViewport` skipped) | 13.7 | 18.6 |

None of the three changes that are new on Network Map buys anything back. The
unchanged branch measured best in both rounds, and a one-run check of the zone-less variant
on a quieter moment gave 45.4 fps. The spread on this page under this load (13.7–45.4 fps on
one build) is wider than the gap being investigated. **Nothing new on the page is shown to
cost frames, and the A/B gap is not shown to be real.** The UX-W2 gate should measure
`/network-map` both sides on a quiet machine. If the gap survives that, the zone backdrops
(large translucent layers that repaint while the tour pans the camera) are the first thing
to try without, then the glow.

Guided-tour playback on Network Map re-aims the camera on every step. It did before this
prompt too (`focusNodeIds` then went through `fitView`), so camera motion itself is not new
on that page.

## Core Web Vitals, all ten routes

Before: base `219e54e`, one pass at the start of the session. After: the final build of this
branch, one pass at the end. Both on the shared machine, so read the fps against the A/B above.

| Route                  | LCP ms (before / after) | CLS (before / after) | INP ms (before / after) | Playback fps (before / after) |
| ---------------------- | ----------------------: | -------------------: | ----------------------: | ----------------------------: |
| `/`                    |               448 / 448 |                0 / 0 |               208 / 568 |                         – / – |
| `/network-map`         |              1268 / 604 |                0 / 0 |               296 / 656 |                     32 / 15   |
| `/packet-journey`      |             2480 / 3180 |     0.0216 / 0.0019 |             2000 / 2840 |                    1.8 / 1.2  |
| `/dns-explorer`        |             1864 / 2436 |     0.0003 / 0.0003 |               712 / 912 |                   43.6 / 38   |
| `/http-explorer`       |             1228 / 1916 |                0 / 0 |               488 / 600 |                   56.5 / 55.6 |
| `/https-explorer`      |             1512 / 2748 |                0 / 0 |               832 / 904 |                   56.8 / 56.7 |
| `/api-visualizer`      |             1212 / 2548 |     0.0002 / 0     |               880 / 848 |                     11 / 5.1  |
| `/websocket-viewer`    |             2108 / 2376 |          0 / 0.0002 |               480 / 648 |                   37.7 / 33.7 |
| `/internet-simulator`  |             2324 / 1120 |     0.0001 / 0.0001 |               824 / 448 |                   51.2 / 47.7 |
| `/network-diagnostics` |              684 / 1436 |                0 / 0 |               448 / 304 |                     26 / 26.7 |

- **CLS passes everywhere, and no worse.** The camera decides the first framing itself, with a
  zero-duration jump once the nodes are measured. `fitView` is gone, so the diagram never
  opens at one zoom and then jumps to another.
- **LCP: `/packet-journey` measured 3,180 ms in the final pass, over the 2,500 budget.** It
  is flagged here, not waved away. It is judged contention for three reasons. The same page
  gave 1,332 / 896 ms (base) and 1,804 / 1,184 ms (branch) in the A/B. Its LCP element is
  the server-rendered summary paragraph, which is outside the lazy canvas chunk this prompt
  changed. And in that pass LCP rose on six of the nine module routes at once, on server-rendered text none of them had changed. UX-W2 should
  confirm it on a quiet machine.
- **INP** is scripted clicks under the throttle and moves with load in the same way.

## Node labels — `PLAYWRIGHT_PORT=3125 npm run uiux:screens -- ux-2.5`

The first node's name as rendered: font size times React Flow's zoom, at scroll 0 before any
interaction. Target: 12px or more on every module (uiux-spec.md §10).

| Module                 | Baseline (1366×768 / 390×844) | UX-2.5 (1366×768 / 390×844) |
| ---------------------- | ----------------------------: | --------------------------: |
| `/network-map`         |                   5.06 / 3.50 |                 16 / 16     |
| `/packet-journey`      |                   3.50 / 3.50 |                 16 / 16     |
| `/dns-explorer`        |                  10.79 / 4.44 |              13.61 / 12.06  |
| `/http-explorer`       |                  16.80 / 7.14 |               19.2 / 16     |
| `/https-explorer`      |                  10.79 / 4.44 |              13.61 / 12.06  |
| `/api-visualizer`      |                  10.79 / 4.44 |              13.61 / 12.06  |
| `/websocket-viewer`    |                  10.79 / 4.44 |              13.61 / 12.06  |
| `/internet-simulator`  |                  10.79 / 4.44 |              13.61 / 16     |
| `/network-diagnostics` |                   5.06 / 3.50 |                 16 / 12.06  |

**Every module is at 12px or more at both sizes.** The name is now 16px in Simple, and the
camera's readable zoom is 12px ÷ the label size, plus 0.5% so rounding never lands a label
at 11.99. 12.06 is that floor. "Play in first viewport" and "controls above canvas" are
unchanged from the baseline: they belong to UX-2.3.

## Nothing new changes per frame through React

- Zone backdrops subscribe to React Flow's store through a selector that returns one string
  of rounded rectangles. The store changes every frame of a pan, but the string changes only
  when a card is measured differently.
- The camera's inputs are `actionKeyOf(topology, nodeStates, inFlight)` and the joined
  `focusNodeIds`, both compared as strings. `nodeStates` holds its identity between events
  (`projectionKey`), and `inFlight` holds it while the same packets travel
  (`useSteadyPackets`). While the framed machines are already comfortably on screen, the
  camera does not move at all. Under reduced motion every move is a jump.
- The link pill's hover and focus state is one `useState` per link, flipped by pointer and
  focus events, never by playback. `PacketSprite` still moves itself from the `FrameClock`.
