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

---

## Wave 0 gate (`wave-0`)

UX-W0, 2026-09-15, merge commit `1eb0adb` (UX-0.1 and UX-0.2 on top of the plan). Wave 0
changed no product code: `git diff 5621325 1eb0adb` touches only `CLAUDE.md`,
`docs/CONTENT-STYLE.md`, `.gitignore`, `package.json` (one script), this file and
`scripts/uiux-screens.mjs`. So this gate is a second measurement of the baseline build,
and every difference below is noise.

Run in a clean detached worktree of `main` rather than the main checkout, because the
main checkout was carrying uncommitted wave-1 work (UX-1.1 and UX-1.2) and serving it on
:3111; a build there would have measured that instead. The worktree was re-checked-out
with LF line endings first (see the note under the CI sequence). The wave-1 sessions were
still running throughout.

**CI sequence:** `npm ci`, `lint`, `build`, `typecheck`, `format:check`, `test:coverage`
(190 files, 4406 tests, every threshold met; all files 96.2% statements, 87.4% branches),
`test:e2e` (214 passed) — all green.

The system-wide `core.autocrlf=true` makes a fresh worktree check every file out with
CRLF, and `format:check` then fails on 614 files; the repository content is LF, as CI and
the main checkout see it. The gate re-checked the tree out with `core.autocrlf=false`,
then rebuilt.

**`uiux:screens -- wave-0`:** every module metric identical to the baseline, at both
viewports (Play in first viewport, controls above canvas, node label px and canvas top).

**`perf:bundles`:** identical to the baseline on all 48 routes.

**`perf:vitals`** (`BASE=http://127.0.0.1:3100`, the ten routes, 4x, median of 3):

| Route                  | LCP ms | CLS    | INP ms | JS KB (browser) | Playback fps | LoAF count / ms |
| ---------------------- | -----: | -----: | -----: | --------------: | -----------: | --------------: |
| `/`                    |    532 |      0 |    272 |           151.7 |            – |               – |
| `/network-map`         |   1340 |      0 |    304 |           187.7 |         33.4 |           0 / 0 |
| `/packet-journey`      |   2672 | 0.0172 |    968 |           247.3 |          2.4 |        9 / 3878 |
| `/dns-explorer`        |    552 |      0 |    336 |           292.1 |         55.0 |         3 / 237 |
| `/http-explorer`       |   1224 |      0 |    416 |           316.8 |         58.5 |         3 / 437 |
| `/https-explorer`      |   1848 |      0 |    576 |           223.0 |         58.5 |         2 / 219 |
| `/api-visualizer`      |   1028 | 0.0002 |    600 |           319.2 |         10.2 |       22 / 2591 |
| `/websocket-viewer`    |   1224 |      0 |    480 |           217.2 |         45.5 |         7 / 794 |
| `/internet-simulator`  |   1080 |      0 |    712 |           347.3 |         51.9 |         5 / 719 |
| `/network-diagnostics` |   1056 |      0 |    760 |           320.1 |         16.4 |       17 / 2075 |

LCP and CLS pass everywhere. Against the baseline's two passes, `/packet-journey` is 2.4
fps (baseline 4.2 / 2.9) and `/network-diagnostics` 16.4 (32.4 / 25.9). §8.2 asks for any
regression to be explained: the build is byte-for-byte the same product, so these are
the spread of the measurement on a shared machine, not a change — and they show the
spread is wider than CLAUDE.md's ±0.5 fps. `/api-visualizer` repeats at 10.2 fps, so a
third run agrees it is the page. **Accepted; the gate passes.**

What this means for later gates: on this machine with other sessions running, a
per-route fps change smaller than the spread across these three runs (Packet Journey
2.4–4.2, Network Diagnostics 16.4–32.4) is not evidence of anything. Measure on a quiet
machine, or run each side twice, before claiming a change.

---

## Wave 1

UX-1.1 (`57db703`) and UX-1.2 (`1904b10`) ran in the main checkout and committed straight to
`main`; UX-1.3 and UX-1.4 ran in worktrees and were merged by UX-W1. Only UX-1.4 left a perf
note. UX-1.1 added no dependency and did not run `perf:bundles`; UX-1.2 could not build in
the shared checkout and left its measurement to the gate. Both are covered by the gate
numbers below.

### UX-1.4 — preferences store, pre-paint attributes, pause at steps

Folded in from `perf/uiux/ux-1.4.md`.

Measured in the `uiux/1-4` worktree, both builds from the same machine, `node
perf/bundles.mjs` against `.next` (no server needed). "Before" is `main` at `0fbb3a4`,
built in this worktree before any change; "after" is this branch.

#### First-load JS, gzipped

Every route gains about 1 KB of chunk code: `PreferencesProvider`, the store and the
preference hooks, in the root layout's client chunk. No new runtime dependency.

Not in these figures: the pre-paint script, which is inlined into each HTML document's
`<head>` (about 750 bytes minified) and so is page weight rather than a chunk --
`bundles.mjs` counts only `static/chunks/*.js`.

| Route | Before | After | Change |
| --- | --- | --- | --- |
| `/` (index) | 151.7 KB | 152.6 KB | +0.9 |
| `/learn` | 162.1 KB | 163.0 KB | +0.9 |
| `/learn/glossary` | 153.3 KB | 154.2 KB | +0.9 |
| every lesson | 195.5 KB | 196.5 KB | +1.0 |
| `/network-map` | 187.7 KB | 188.7 KB | +1.0 |
| `/websocket-viewer` | 217.2 KB | 218.2 KB | +1.0 |
| `/https-explorer` | 223.0 KB | 224.1 KB | +1.1 |
| `/packet-journey` | 247.3 KB | 248.4 KB | +1.1 |
| `/dns-explorer` | 292.1 KB | 293.1 KB | +1.0 |
| `/http-explorer` | 316.8 KB | 317.9 KB | +1.1 |
| `/api-visualizer` | 319.2 KB | 320.2 KB | +1.0 |
| `/network-diagnostics` | 320.0 KB | 321.1 KB | +1.1 |
| `/internet-simulator` | 347.3 KB | 348.3 KB | +1.0 |

`/packet-journey` is now 1.6 KB under the 250 KB budget. The five routes already over it
stay over by the same zod chunk CLAUDE.md describes.

Every route is still statically prerendered (`○` in `next build`): the script reads
storage in the browser, so the root layout did not become dynamic.

#### Vitals and playback

Not measured on this branch. The machine was shared with other sessions for the whole
run, and CLAUDE.md's ±0.5 fps noise floor on Packet Journey needs a quiet machine and a
same-machine baseline to mean anything. The wave gate measures it.

What changed on the per-frame path, for whoever reads that number: `tick` does one extra
scan of `phaseStarts` (a handful of entries) when pause-at-steps is on, and the store
reads one boolean. Nothing new renders per frame.

One change to the measurement itself: `perf/vitals.mjs` now seeds
`iv:preferences` with `pauseAtSteps: false` before each page load. A fresh browser is
in Simple, which pauses after each step; a pause inside the four-second playback window
would leave the page stationary and report a perfect frame rate, which is not
comparable with any earlier figure.

### Wave 1 gate (`wave-1`)

UX-W1, 2026-09-17, on the merge of `uiux/1-3` and `uiux/1-4` into `main` plus the W1 fixes,
in the main checkout (LF working tree), port 3100.

**What else was running.** A game (VALORANT), VS Code, Opera, Chrome, Discord, another
project's dev server and several MCP servers: CPU at 57% before the vitals passes. The
vitals figures below are therefore an A/B under the same load, not absolute numbers.

**CI sequence:** `npm ci`, `lint`, `build`, `typecheck` green. `format:check` failed on
three files the W1 token swap had just changed (class order; fixed with Prettier).
`test:coverage`: 212 files, 4,748 tests, one failure — `tests/single-raf-loop.test.ts`
counted `ui/position.ts` (UX-1.2) as a second rAF loop, because its scroll coalescer
cancelled its pending frame on cleanup. Fixed there (a disposed flag instead of
`cancelAnimationFrame`); the test is unchanged and it and the 21 `src/components/ui` test
files pass. Every coverage threshold was met (all files 96.3% statements, 87.6% branches).
`test:e2e`: 214 passed.

**`uiux:screens -- wave-1`:** the three module metrics (Play in first viewport, controls
above canvas, node label px) are identical to the baseline at both viewports. The canvas and
Play sit lower on four modules, because UX-1.1's 44px buttons and 12px floor made the
controls above them taller: `/http-explorer` +80px at 1366×768 and +99px at 390×844,
`/https-explorer` +52px at 390, `/dns-explorer` +9 / +20px, `/packet-journey` +3 / +10px.
Every other change is 1–2px.

**`perf:bundles`** (rebuilt after the fixes):

| Route                  | Baseline | Wave 1   | Change |
| ---------------------- | -------: | -------: | -----: |
| `/internet-simulator`  | 347.3 KB | 350.1 KB |   +2.8 |
| `/network-diagnostics` | 320.0 KB | 322.8 KB |   +2.8 |
| `/api-visualizer`      | 319.2 KB | 322.0 KB |   +2.8 |
| `/http-explorer`       | 316.8 KB | 319.6 KB |   +2.8 |
| `/dns-explorer`        | 292.1 KB | 294.9 KB |   +2.8 |
| `/packet-journey`      | 247.3 KB | **250.1 KB** | +2.8 |
| `/https-explorer`      | 223.0 KB | 225.8 KB |   +2.8 |
| `/websocket-viewer`    | 217.2 KB | 220.0 KB |   +2.8 |
| every lesson route     | 195.5 KB | 198.4 KB |   +2.9 |
| `/network-map`         | 187.7 KB | 190.5 KB |   +2.8 |
| `/demo`                | 172.1 KB | 175.0 KB |   +2.9 |
| `/learn`               | 162.1 KB | 164.8 KB |   +2.7 |
| `/learn/glossary`      | 153.3 KB | 156.0 KB |   +2.7 |
| `/` and `/_not-found`  | 151.7 KB | 154.4 KB |   +2.7 |
| `/_global-error`       | 131.5 KB | 131.5 KB |      0 |

Every addition is in the root layout's client chunk, which every route loads: UX-1.4's
preferences store (+1.0–1.1 KB, its own measurement above) and UX-1.2's Tooltip, which now
imports `position.ts` and `topLayer.ts` for top-layer rendering, touch and collision
handling (SafetyBadge renders a Tooltip on every module route). UX-1.1's `extendTailwindMerge`
config is the small remainder. No dependency was added. **`/packet-journey` crosses the 250 KB
budget by 0.1 KB**; it was the one module route still under it. Explained here, not fixed:
accepting it or trimming the layout chunk is a decision for the person running the plan.

**`perf:vitals`** (`BASE=http://127.0.0.1:3100`, the ten routes, 4x, median of 3). Wave 1
twice, and the wave-0 build (`~/iv-ux/w0-gate`, `1eb0adb`) once in between on the same
port and under the same load:

| Route                  | LCP ms (W1 / W0 / W1) | CLS (W1 / W0 / W1)       | Playback fps (W1 / W0 / W1) | LoAF count/ms (W1 / W0 / W1)   |
| ---------------------- | --------------------: | -----------------------: | --------------------------: | -----------------------------: |
| `/`                    |    356 / 604 / 1140   |              0 / 0 / 0   |                           – |                              – |
| `/network-map`         |  1716 / 1260 / 2144   |              0 / 0 / 0   |          19.4 / 17.2 / 16.9 |     5/318 · 9/494 · 14/886     |
| `/packet-journey`      |  1924 / 4056 / 5432   | 0.0214 / 0.0026 / 0.0161 |             1.3 / 1.1 / 1.0 |  6/4300 · 4/4773 · 3/4421      |
| `/dns-explorer`        |  2140 / 2708 / 2064   | 0.0006 / 0.0001 / 0.0004 |          43.0 / 18.2 / 42.3 |  7/1233 · 5/1863 · 7/1537      |
| `/http-explorer`       |   1304 / 796 / 936    |         0 / 0.0055 / 0   |          57.8 / 53.9 / 57.6 |     3/349 · 3/587 · 3/617      |
| `/https-explorer`      |  1964 / 1252 / 1852   |              0 / 0 / 0   |          56.3 / 58.7 / 56.7 |     3/799 · 3/226 · 3/1189     |
| `/api-visualizer`      |  1476 / 2656 / 1572   | 0.0003 / 0.0001 / 0.0003 |             5.6 / 5.1 / 4.1 | 20/2849 · 19/3422 · 13/3188    |
| `/websocket-viewer`    |  2928 / 2872 / 2424   |    0.0001 / 0 / 0        |          33.2 / 35.9 / 33.9 | 11/2208 · 11/1944 · 11/1981    |
| `/internet-simulator`  |   968 / 3112 / 2452   |    0.0001 / 0.001 / 0.0001 |        46.2 / 38.2 / 46.1 |  6/1520 · 5/1917 · 6/1684      |
| `/network-diagnostics` |  1288 / 3260 / 2428   |              0 / 0 / 0   |           7.5 / 8.7 / 23.9  | 19/3227 · 21/2987 · 16/1530    |

INP (W1 / W0 / W1): `/` 416 / 272 / 848, `/network-map` 600 / 752 / 936, `/packet-journey`
2768 / 2592 / 3152, `/dns-explorer` 1072 / 1456 / 888, `/http-explorer` 440 / 792 / 936,
`/https-explorer` 1064 / 416 / 1488, `/api-visualizer` 944 / 1456 / 912,
`/websocket-viewer` 1016 / 728 / 1320, `/internet-simulator` 808 / 848 / 608,
`/network-diagnostics` 968 / 1088 / 552.

Every figure is far below the baseline table, and the wave-0 build — the baseline's own
product — is as slow as wave 1 under the same load, so the drop is the machine. Between the
two builds, wave 1 is within the spread or ahead on every route; LCP fails on some routes
in both builds (`/packet-journey`, `/websocket-viewer`, `/internet-simulator`,
`/network-diagnostics`, `/dns-explorer`, `/api-visualizer` in one pass or another), which is
the load as well. CLS passes everywhere. **Accepted as noise; no wave-1 regression shown.**
A quiet-machine pass is still owed before any fps claim is made.
