# UI/UX restructure — the baseline

The "before" picture the restructure in `docs/implementation/uiux.md` is measured against.
Every wave gate appends its own numbers below under a heading for its step; compare them
with the tables here, not with memory.

- **Taken:** 2026-09-15, UX-0.2.
- **Commit:** `5621325` (the plan commit). Its product code is identical to `0fbb3a4`, the
  last commit before the restructure; only `docs/implementation/` differs.
- **Build:** `npm ci && npm run build` in a clean worktree (`uiux/0-2`), served by
  `npx next start --port 3102`, restarted after the build.
- **Screenshots:** `.uiux/baseline/` in the main checkout (git-ignored), 45 routes × two
  viewports. Regenerate with `npm run uiux:screens -- baseline` against a build of this
  commit. The three module numbers below come from the same run
  (`.uiux/baseline/metrics.json`).

**Read the fps figures with care.** Both vitals passes ran on a laptop that was also
running the wave-1 sessions (vitest, eslint and a `next start` in the other worktrees), so
the CPU was shared on top of the 4x throttle. The two passes are both given, so the spread
is visible. Every later gate should likewise say what else was running.

## First-load JS — `npm run perf:bundles`

Gzipped, per route, from the prerendered HTML (`perf/README.md` says how it counts).

| Route                  | Chunks | First-load JS (gzip) |
| ---------------------- | -----: | -------------------: |
| `/internet-simulator`  |     20 |             347.3 KB |
| `/network-diagnostics` |     17 |             320.0 KB |
| `/api-visualizer`      |     16 |             319.2 KB |
| `/http-explorer`       |     17 |             316.8 KB |
| `/dns-explorer`        |     16 |             292.1 KB |
| `/packet-journey`      |     16 |             247.3 KB |
| `/https-explorer`      |     16 |             223.0 KB |
| `/websocket-viewer`    |     15 |             217.2 KB |
| every lesson route (33, each identical) | 14 | 195.5 KB |
| `/network-map`         |     14 |             187.7 KB |
| `/demo`                |     11 |             172.1 KB |
| `/learn`               |     11 |             162.1 KB |
| `/learn/glossary`      |     10 |             153.3 KB |
| `/` (`/index`)         |      9 |             151.7 KB |
| `/_not-found`          |      9 |             151.7 KB |
| `/_global-error`       |      5 |             131.5 KB |

48 routes measured. Five module routes are over the 250 KB budget, as `CLAUDE.md` records
(the excess is zod).

## Core Web Vitals and playback — `npm run perf:vitals`

`BASE=http://127.0.0.1:3102`, the ten routes in `uiux-spec.md` §8.2, 4x CPU throttle,
median of three runs per pass, two passes. LoAF is long animation frames during four
seconds of playback: count / total ms.

| Route                  | LCP ms (1 / 2) | CLS (1 / 2)     | INP ms (1 / 2) | JS KB (browser) | Playback fps (1 / 2) | LoAF (1 / 2)            |
| ---------------------- | -------------: | --------------: | -------------: | --------------: | -------------------: | ----------------------: |
| `/`                    |      700 / 888 |           0 / 0 |      216 / 232 |           151.7 |                    – |                       – |
| `/network-map`         |      896 / 780 |           0 / 0 |     1568 / 312 |           187.7 |          35.7 / 35.0 |  19 / 1551 · 13 / 1027  |
| `/packet-journey`      |    1568 / 2108 | 0.0191 / 0.0354 |    1288 / 1136 |           247.3 |  **4.2 / 2.9** (±0.5 noise) |  13 / 3780 · 10 / 3146  |
| `/dns-explorer`        |    1608 / 1448 |           0 / 0 |      376 / 448 |           292.1 |          43.9 / 42.0 |  12 / 1297 · 10 / 1814  |
| `/http-explorer`       |    1584 / 1228 |      0.0383 / 0 |      232 / 408 |           316.8 |          55.0 / 54.3 |     4 / 312 · 3 / 243   |
| `/https-explorer`      |    1016 / 2204 |           0 / 0 |      504 / 312 |           223.0 |          54.6 / 48.9 |     3 / 289 · 4 / 576   |
| `/api-visualizer`      |    1652 / 1988 | 0.0002 / 0.0003 |     408 / 1408 |           319.2 |          11.4 / 10.2 |  24 / 2838 · 24 / 2792  |
| `/websocket-viewer`    |    1428 / 2132 | 0.0001 / 0.0076 |      360 / 520 |           217.2 |          42.9 / 38.9 |  11 / 1294 · 10 / 1181  |
| `/internet-simulator`  |     980 / 2068 |      0 / 0.0010 |      456 / 464 |           347.3 |          52.2 / 43.2 |    5 / 602 · 8 / 1007   |
| `/network-diagnostics` |    600 / 1224  |      0 / 0.0208 |     400 / 1392 |           320.1 |          32.4 / 25.9 |  18 / 1508 · 16 / 1538  |

What this says, and what it does not:

- **LCP and CLS pass on every route** in both passes (budgets 2500 ms and 0.1). The LCP
  element is text everywhere: the home page's `h1`, a module's summary paragraph, and on
  `/network-map` the summary's muted span.
- **`/packet-journey` is the slow page, at 4.2 and 2.9 fps.** `CLAUDE.md` states the
  run-to-run noise on this page as about ±0.5 fps, and quotes 1.7 fps from phase 14; the
  gap between these two passes (1.3 fps) is wider than that, which is the shared CPU. A
  later wave must beat 2.9–4.2 by more than the noise to claim an improvement.
- **`/api-visualizer` holds only about 11 fps, in both passes.** `CLAUDE.md` says "every
  other module is 40–50". Two passes agreeing suggests this is the page rather than the
  load. It is recorded here and not investigated: it predates the restructure, and the
  plan measures its effect on performance rather than fixing what it found (§12).
- **INP fails the 200 ms budget everywhere.** `perf/vitals.mjs` takes the worst event over
  a frame during a scripted sequence of clicks and key presses under the 4x throttle, so
  read it against its own baseline, not the budget.

## The module layout — `npm run uiux:screens`

The three numbers UX-0.2 defines, per module route, at scroll 0 before any interaction.
`scripts/uiux-screens.mjs` states each definition precisely. In short:

- **Play in first viewport:** the button named "Play" is entirely inside the window.
- **Controls above canvas:** visible links, buttons, form controls and ARIA widgets inside
  `<main>` that sit entirely above the canvas; the site nav adds six more on every
  route. The spec's target for Simple mode is 6 or fewer (§9).
- **Node label px:** the first node's name, as rendered: its font size (14px on every
  module today) times React Flow's fitted zoom. The target is 12px or more (§10).

| Module                 | Play in first viewport (1366×768 / 390×844) | Play button's top edge (px) | Controls above canvas | Node label px (1366×768 / 390×844) |
| ---------------------- | :-----------------------------------------: | --------------------------: | --------------------: | ---------------------------------: |
| `/network-map`         |                   no / no                   |                1118 / 3245  |                    12 |                        5.06 / 3.50 |
| `/packet-journey`      |                   no / no                   |                1192 / 2315  |                    10 |                        3.50 / 3.50 |
| `/dns-explorer`        |                   no / no                   |                1433 / 3627  |                    23 |                       10.79 / 4.44 |
| `/http-explorer`       |                   no / no                   |                1554 / 2843  |                    33 |                       16.80 / 7.14 |
| `/https-explorer`      |                   no / no                   |                1170 / 2435  |                    10 |                       10.79 / 4.44 |
| `/api-visualizer`      |                   no / no                   |                1167 / 2762  |                     8 |                       10.79 / 4.44 |
| `/websocket-viewer`    |                   no / no                   |                1144 / 2486  |                     8 |                       10.79 / 4.44 |
| `/internet-simulator`  |                   no / no                   |                1236 / 2797  |                    16 |                       10.79 / 4.44 |
| `/network-diagnostics` |                   no / no                   |                1207 / 2694  |                    13 |                        5.06 / 3.50 |
| `/learn`               |          – (no canvas; not a simulation)    |                           – |                     – |                                  – |

The controls count is the same at both widths on every module: the controls wrap rather
than collapse. The Play button is a 36×36 icon-only button on every module. Its top edge
is 350–800px below the bottom of a 768px window, and about 1,500–2,800px below the bottom of an
844px phone screen.

The audit in `uiux-spec.md` §3 predicted all of it: Play below the fold everywhere, about
30 controls before HTTP Explorer's diagram (33 here), and Packet Journey's labels at about
3.5px (3.50 here, at React Flow's 0.25 minimum zoom).
