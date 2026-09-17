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

---

## UX-1.5 — GlossaryTerm and TermText

### `perf:bundles`, before and after

"Before" is the wave-1 gate build above (`7ee2e3c`'s tree). "After" is this commit. No module
route renders a glossary term yet (wave 3 adopts them), so a third build measured the cost to
a route that does: a probe `<TermText>` rendered on `/network-map`'s page, built, measured
and reverted before the commit.

| Route                                          |   Before |    After |  Change |
| ---------------------------------------------- | -------: | -------: | ------: |
| `/network-map` with the probe `TermText`       | 190.5 KB | 193.3 KB |    +2.8 |
| `/network-map` (this commit, no term on it)    | 190.5 KB | 190.7 KB |    +0.2 |
| `/packet-journey`                              | 250.1 KB | 250.3 KB |    +0.2 |
| other module routes, `/`, `/learn`, glossary   |        – |        – | +0.1–0.2 |
| every lesson route (33)                        | 198.4 KB | 188.2 KB | **−10.2** |
| `/_global-error`                               | 131.5 KB | 131.5 KB |       0 |

A route that renders a term pays **2.6 KB** for it (193.3 against 190.7, the same build
without the probe): `GlossaryTerm`, `TermText`, the matcher, the on-demand loader and the
`Popover`. That is under the 4 KB budget in uiux-spec.md §5.6.

The glossary itself is not in that figure. `@/core/glossary/inline` is built from the whole
glossary, definitions included, and loads as its own chunk the first time a term mounts:
11.2 KB gzipped today. Imported statically it would have cost a route about that much (the
popover half alone, spellings and `short`, is 3.8 KB gzipped), which is why
`useInlineGlossary` loads it on demand. It is also why every lesson route is 10.2 KB lighter:
`<Term>` used to put the whole glossary in each lesson's first load.

The 0.1–0.2 KB on routes that render no term is in the root layout chunk (12,266 → 12,408
bytes gzipped), which contains no glossary code; it looks like module-id churn from adding
modules to the build, not verified further. It moves `/packet-journey` from 0.1 to 0.3 KB
over the 250 KB budget.

### UX-1.5 gate (`ux-1.5`)

2026-09-17, main checkout, port 3100. The same load as the wave-1 gate (the game still
running; CPU at 76% before vitals).

**CI sequence**, first pass on `00247fb`: `npm ci`, `lint`, `build`, `typecheck`,
`format:check` green; `test:coverage` 4,773/4,774. The failure was UX-1.5's own:
`lesson-pipeline.test.tsx` waited the default 1 s for `<Term>`'s button, and under coverage
in a saturated pool the on-demand glossary chunk took longer. Fixed by preloading the index
in the tests that are about behaviour rather than loading (`lesson-pipeline`, `Term`,
`GlossaryTerm`, `TermText`), and adding `useInlineGlossary.test.tsx` for the state before
the index arrives (server render and first client render are plain text). Second pass:
`typecheck`, `format:check`, `lint` green; `test:coverage` 216 files, 4,776 tests, every
threshold met; `test:e2e` 214 passed (axe, CSP and smoke on every lesson route and the
glossary included).

**`uiux:screens -- ux-1.5`:** identical to `wave-1` in every module metric and position.

**`perf:bundles`:** identical to the "After" column above.

**`perf:vitals`**, UX-1.5 and then the wave-0 build (`1eb0adb`) under the same load:

| Route                  | LCP ms (1.5 / W0) | CLS (1.5 / W0)  | INP ms (1.5 / W0) | Playback fps (1.5 / W0) | LoAF count/ms (1.5 / W0) |
| ---------------------- | ----------------: | --------------: | ----------------: | ----------------------: | -----------------------: |
| `/`                    |        1000 / 884 |           0 / 0 |         840 / 464 |                       – |                        – |
| `/network-map`         |       2240 / 1148 |           0 / 0 |         648 / 688 |               16.0 / 18.0 |          6/404 · 5/361 |
| `/packet-journey`      |       5784 / 4660 | 0.002 / 0.0039  |       2720 / 2784 |                 1.0 / 1.2 |      4/3818 · 4/4183 |
| `/dns-explorer`        |       2380 / 2844 |      0.0003 / 0 |         760 / 888 |               37.7 / 37.9 |      7/1524 · 7/1352 |
| `/http-explorer`       |       2716 / 2636 |           0 / 0 |         648 / 696 |               57.7 / 57.5 |        3/554 · 3/577 |
| `/https-explorer`      |       1940 / 3040 |      0 / 0.0001 |       1176 / 1224 |               53.3 / 53.2 |        3/846 · 3/861 |
| `/api-visualizer`      |       2644 / 3448 | 0.0003 / 0.0002 |        1224 / 792 |                 4.4 / 5.1 |    17/3507 · 17/2924 |
| `/websocket-viewer`    |       2808 / 2956 |      0.0001 / 0 |        1032 / 880 |               33.4 / 33.5 |    11/2097 · 11/2122 |
| `/internet-simulator`  |       2988 / 2808 | 0.0001 / 0.0001 |         856 / 880 |               38.9 / 28.7 |      6/1843 · 6/2196 |
| `/network-diagnostics` |       1116 / 2408 |           0 / 0 |         824 / 856 |                7.4 / 12.7 |     20/3104 · 19/2626 |

UX-1.5 renders nothing new on these routes; the only runtime difference from wave 1 is the
0.1–0.2 KB above. Every pair sits inside the spread of repeated runs on this machine
(Network Diagnostics was 7.5 and 23.9 across two passes of identical wave-1 code), and LCP
misses the budget in both builds on the same routes. **Accepted as load; no regression
shown.** The quiet-machine pass owed since wave 1 is still owed.

## Wave 2

UX-2.1 (`4749ae3`) committed straight to `main` and left no perf note (it changes the shell
and adds no dependency; the gate numbers below cover it). UX-2.2 to UX-2.6 ran in worktrees
and were merged by UX-W2 in spec order. UX-2.6 adds lessons and glossary entries only and
left no note. The four notes below are folded in verbatim, with their headings moved down
two levels; each was measured on a machine running other worktrees at the same time, which
each note says where it matters.

### UX-2.2 — a home page that starts somewhere

Folded in from `perf/uiux/ux-2.2.md`.

- **Taken:** 2026-09-17, branch `uiux/2-2` (worktree `iv-ux/2-2`), on top of `219e54e`.
- **Build:** `npm ci && npm run build`, served by `npx next start --port 3122`, started
  after the build.
- **Load on the machine:** the full vitest run in this worktree was going at the same time
  as the vitals pass, and at least one other wave-2 session was active. Read INP and long
  tasks with that in mind; LCP, CLS and bundle sizes do not depend on it.

#### First-load JS — `npm run perf:bundles`

| Route         | Before (`219e54e`) | After    | Change  |
| ------------- | -----------------: | -------: | ------: |
| `/` (`index`) | 9 · 154.6 KB       | 10 · 158.1 KB | **+3.5 KB** |
| `/_not-found` | 9 · 154.6 KB       | 9 · 154.6 KB  | 0       |

"Before" is a build of `219e54e` in the main checkout, which matches the latest `/` figure in
`perf/uiux-baseline.md` (154.4 KB at the wave-1 gate, then +0.1–0.2 KB from UX-1.5). The
budget for this prompt is +5 KB, so the home page is inside it with 1.5 KB to spare. Against
the pre-restructure table at the top of the baseline (151.7 KB) it is +6.4 KB, of which
2.9 KB came from wave 1.

The added 3.5 KB is one chunk (3.7 KB gzip, 9.5 KB raw) holding the two client islands and
nothing else: `QuickStart` with `Field` and its shape check, and `StartPathProgress` with
`StartPath` and the progress store. `HeroJourney` is a server component and adds no JS. No
new dependency, and no zod: the address check is a hand-written `URL` parse. The progress hook
is imported from its own file, not from `@/modules/learning-center`, because that index pulls
in the lesson layout and the MDX loader. The 404 no longer renders the module grid, and its JS
did not change.

#### Core Web Vitals — `BASE=http://127.0.0.1:3122 ROUTES=/ npm run perf:vitals`

4x CPU throttle, median of three runs.

| Route | LCP ms | LCP element | CLS | INP ms | Long tasks | JS KB |
| ----- | -----: | ----------- | --: | -----: | ---------: | ----: |
| `/`   |    492 | `H1` (text) |   0 |    336 | 5 / 609 ms | 158.1 |

- **The LCP element is still text:** the `h1`, "How does the internet actually work?". The
  hero is inline SVG and HTML, and none of it is an LCP candidate.
- **CLS is 0.** A separate browser check with two First steps lessons marked complete in
  `localStorage` recorded no `layout-shift` entries: the tick boxes are always in the layout,
  and hydrating progress changes only their visibility.
- **INP fails the 200 ms budget, as it has on every route since the baseline** (`/` was
  216 / 232 there and 840 / 464 at the UX-1.5 gate). This pass ran under a saturated CPU and
  is not evidence either way.

#### Rebuilt after the SafetyBadge fix

The compact `SafetyBadge` change (a visually hidden label instead of `aria-label`) was built
and measured again: `/` 10 · 158.1 KB and `/_not-found` 9 · 154.6 KB, the same as above.

### UX-2.3 — the Stage

Folded in from `perf/uiux/ux-2.3.md`.

Measured in the `uiux/2-3` worktree, 2026-09-17. "Before" is `main` at `219e54e` (the
UX-1.5 gate), served from the main checkout's existing production build on port 3123;
"after" is this branch, built here and served on the same port, `next start` restarted
after every build. The machine was shared throughout: other wave-2 worktrees were
building, serving (3122, 3125) and running Playwright, and one Playwright run of this
branch was killed by the OS for low memory (rerun with `--workers=2`, green). Read every
timing below against that, and against the spreads recorded in `perf/uiux-baseline.md`.

#### `perf:bundles` — first-load JS, gzipped

| Route                        |   Before |    After |  Change |
| ---------------------------- | -------: | -------: | ------: |
| `/internet-simulator`        | 350.2 KB | 359.5 KB |    +9.3 |
| `/network-diagnostics`       | 323.0 KB | 332.3 KB |    +9.3 |
| `/api-visualizer`            | 322.1 KB | 331.4 KB |    +9.3 |
| `/http-explorer`             | 319.8 KB | 329.0 KB |    +9.2 |
| `/dns-explorer`              | 295.1 KB | 304.7 KB |    +9.6 |
| `/packet-journey`            | 250.3 KB | 259.9 KB |    +9.6 |
| `/https-explorer`            | 225.9 KB | 235.5 KB |    +9.6 |
| `/websocket-viewer`          | 220.1 KB | 229.6 KB |    +9.5 |
| `/network-map`               | 190.7 KB | 200.3 KB |    +9.6 |
| every lesson route (33)      | 188.2 KB | 195.9 KB |    +7.7 |
| `/demo`                      | 175.1 KB | 184.7 KB |    +9.6 |
| `/learn`, `/learn/glossary`  |        – |        – |       0 |
| `/`, `/_not-found`           | 154.6 KB | 154.6 KB |       0 |
| `/_global-error`             | 131.5 KB | 131.5 KB |       0 |

**No new runtime dependency.** Every route that renders a `SimulationView` gains about
9.5 KB, and a lesson (which embeds one, compact) 7.7 KB. What arrives is code that
already existed but had never been on these routes: the UX-1.2 primitives the Stage is
built from (`Popover` and its positioning, `Dialog`, `Switch`, `Tabs`, `Disclosure`,
`Select`, `StepDots`), UX-1.5's `TermText` / `GlossaryTerm` (2.6 KB by UX-1.5's own
measurement; the glossary itself still loads on demand), and the new Stage components.
The home page, `/learn`, the glossary and the error pages are unchanged, and none of them
gained React Flow.

**Needs a decision at the wave gate (§8.2).** `/packet-journey` goes from 0.3 KB over
the 250 KB budget to 9.9 KB over. Not tried here, and the obvious candidates if it has to
come back: load `StageHelp`'s dialog body and `RunRecap` on demand (neither is on screen
at load; both are interaction-only), and `StoryPicker`'s "More stories" popover. Measure
before and after, as CLAUDE.md asks; this note does not claim what they would save.

#### `perf:vitals` — the ten routes, 4x CPU, median of 3

`BASE=http://127.0.0.1:3123`, `ROUTES` from uiux-spec.md §8.2.

Three passes of this branch. **After (a)** is the first build. **After (b)** is after the
two layout-shift fixes below, measured under about the same load as "before".
**After (c)** is the committed build (caption height fixed too), measured while more of
the other sessions were running: `/`, which this prompt does not change, went from 324 ms
to 1,056 ms LCP between (b) and (c), so (c)'s LCP and fps say more about the machine than
about the code. Its CLS column still means something.

| Route                  | LCP ms: before / a / b / c | CLS: before / a / b / c        | fps: before / a / b / c  |
| ---------------------- | -------------------------: | -----------------------------: | -----------------------: |
| `/`                    |    484 / 328 / 324 / 1056  |               0 / 0 / 0 / 0    |                        – |
| `/network-map`         |  1824 / 1828 / 436 / 1460  |               0 / 0 / 0 / 0    |  27.2 / 49.2 / 18.1 / 13.6 |
| `/packet-journey`      |  2352 / 2484 / 1284 / 5988 | 0.0253 / 0.037 / 0.0256 / 0.0334 |   2.1 / 1.9 / 2.2 / 1.3 |
| `/dns-explorer`        |  1312 / 1348 / 656 / 4412  | 0.0003 / 0.0113 / 0.0092 / 0.0022 | 48.6 / 42.0 / 47.1 / 30.7 |
| `/http-explorer`       |  1436 / 1764 / 1760 / 6072 |               0 / 0 / 0 / 0    |  57.3 / 58.0 / 51.3 / 51.7 |
| `/https-explorer`      |   3160 / 852 / 1608 / 696  | 0 / 0.0006 / 0.0001 / 0        |  57.7 / 54.2 / 56.0 / 52.3 |
| `/api-visualizer`      |  1868 / 1504 / 1992 / 3732 | 0.0004 / 0.0011 / 0.0003 / 0.0003 |  7.5 / 8.4 / 8.5 / 4.1 |
| `/websocket-viewer`    |  2204 / 740 / 1024 / 3536  | 0 / 0.0035 / 0.002 / 0.0001    |  36.4 / 40.2 / 31.7 / 21.2 |
| `/internet-simulator`  |   1536 / 880 / 728 / 3504  | 0.0009 / 0.0007 / 0 / 0        |  46.5 / 36.1 / 49.6 / 38.2 |
| `/network-diagnostics` |   1516 / 564 / 760 / 2228  | 0.0006 / 0.0006 / 0 / 0        |  22.5 / 9.5 / 34.2 / 16.2 |

**LCP.** Passes the 2.5 s budget on every route in (a) and (b), which ran under about
the same load as "before" (`/https-explorer` failed it before, at 3,160 ms). The LCP
element is the same element before and after on every route: the module's own summary
paragraph, rendered by its `controlPanel`, which the Stage leaves where it was. Eight of
the nine module routes had at least one pass faster than before. The exception is
`/http-explorer`, at 1,764 and 1,760 ms against 1,436 ms before, still inside the budget
and inside the spread earlier gates recorded for it (1,224–2,716 ms). The Stage's
overlays are server rendered with the page (the start overlay is absolutely positioned
inside the canvas box), so nothing new arrives late enough to become the LCP.

**CLS.** Every route passes 0.1 in every pass. Pass (a) found two shifts the Stage itself
caused during playback, both attributed with `LayoutShift.sources` and both fixed:

1. **The Play button changed width** between "Play", "Pause" and "Play again", moving
   Next step and the timeline mid-run. It now has one width (`lg:w-40`; below `lg` it
   takes the space Back and Next step leave). Measured: its box and the slider's box are
   identical across idle, playing and ended at 1366 and 390.
2. **The step caption changed height** with each step's sentence, and at `lg` it is
   anchored to the canvas's bottom edge, so its top moved (198 → 94 px on DNS Explorer's
   last step: 0.009 on its own). It is now a fixed height (`h-30`, `lg:h-36`) that scrolls
   a long sentence, with a tab stop for that scroll box.

What is left on `/dns-explorer` (0.0022 in (c)) is its own "Question / Answer" panel
reflowing near the bottom of the window, which the module owns, plus sub-0.002 text moves
inside the fixed caption box. `/packet-journey`'s 0.03 is the baseline's 0.025 within
spread; its sources are the module's own ledger chips ("466 B" / "54 B").

**Playback fps.** Every per-route difference is inside the spread this machine has shown
on identical code (`perf/uiux-baseline.md`: Network Diagnostics 7.5–23.9 across two
passes of the same wave-1 build). `/packet-journey` stays at about 2 fps, as it was. What
the Stage adds to a frame is deliberately little: the new overlays, caption and picker
are memoized and read only `stageMoment` (which changes three times in a run) and the
current step index, never the playhead; the recap, the help dialog's body, "Go deeper"'s
inactive tabs, "What you'll learn" and "Experiment" are not in the document until they
are shown.

#### `?scenario=` does not change LCP

`useScenarioParam` reads the URL through `useSyncExternalStore` with a server snapshot of
"no parameter", instead of `useSearchParams`, which would have made the whole Stage
client-rendered on these statically prerendered routes (Next's docs,
`use-search-params.md`, "Prerendering"). The build still reports every module route as
`○ (Static)`.

No module calls the hook until wave 3, so it was measured with a probe, the way UX-1.5
measured `TermText`: Packet Journey's `useState` for the scenario id replaced with
`useScenarioParam(ids, DEFAULT_JOURNEY_ID)` and its scenarios passed as `stories`,
built, measured, and reverted before the commit. The control is the committed build,
measured just before on the same port. Both 4x CPU, median of **5**.

| Build and URL                                          | LCP ms | FCP ms |    CLS | JS KB | `/` LCP ms (load check) |
| ------------------------------------------------------ | -----: | -----: | -----: | ----: | ----------------------: |
| control: committed build, `/packet-journey`            |   1304 |    324 |  0.034 | 259.9 |                     636 |
| probe, `/packet-journey`                               |   1004 |    376 | 0.0342 | 260.2 |                     288 |
| probe, `/packet-journey?scenario=udp-dns-query`        |   1284 |    400 | 0.0005 | 260.2 |                     288 |

- **LCP is unchanged**: no slower than the control on either URL (the probe pass ran
  under lighter load, as `/` shows, so read "no slower", not "faster").
- **The route stays static** in the probe build (`○ /packet-journey`), and its server
  HTML already holds the story picker and "Watch it happen": nothing suspends, and nothing
  that was server rendered became client rendered.
- **A link with `?scenario=`** renders the default story on the server and switches after
  hydration. That switch cost CLS 0.0005 here, and LCP stayed within the same range.
- The hook plus `StoryPicker` in use cost **0.3 KB** on top of this commit.

#### `uiux:screens -- ux-2.3`

`PLAYWRIGHT_PORT=3123`, the committed build. **Play is inside the first viewport on every
module at both sizes** (baseline: on none).

| Module                 | Play in first viewport (1366 / 390) | Controls above canvas (1366 / 390), baseline | Node label px (1366 / 390) |
| ---------------------- | :---------------------------------: | -------------------------------------------: | -------------------------: |
| `/network-map`         |              yes / yes              |                                  12 / 15, 12 |                5.06 / 3.50 |
| `/packet-journey`      |              yes / yes              |                                  10 / 16, 10 |                3.50 / 3.50 |
| `/dns-explorer`        |              yes / yes              |                                  39 / 29, 23 |               10.79 / 4.44 |
| `/http-explorer`       |              yes / yes              |                                  42 / 39, 33 |               16.80 / 7.14 |
| `/https-explorer`      |              yes / yes              |                                  10 / 16, 10 |               10.79 / 4.44 |
| `/api-visualizer`      |              yes / yes              |                                   8 / 14, 8 |               10.79 / 4.44 |
| `/websocket-viewer`    |              yes / yes              |                                   8 / 14, 8 |               10.79 / 4.44 |
| `/internet-simulator`  |              yes / yes              |                                  16 / 22, 16 |               10.79 / 4.44 |
| `/network-diagnostics` |              yes / yes              |                                  13 / 19, 13 |                5.06 / 3.50 |

Play is in view because the transport is sticky to the bottom of the window while the
stage is on screen, not because the canvas moved up: every module still passes its old
`controlPanel`, which is still above the canvas until its wave-3 pass. That is also why
"controls above canvas" rose where the canvas starts below the fold (DNS Explorer, HTTP
Explorer, and every module at 390): the metric counts anything whose bottom edge is above
the canvas's top, and the sticky bar and the "?" button now sit there. Where the canvas
top is inside the first window (1366 on the other seven), the count is unchanged. Node
label sizes are UX-2.5's, and unchanged here.

### UX-2.4: steps, details and a log that stays out of the way

Folded in from `perf/uiux/ux-2.4.md`.

Route measured: `/packet-journey`, the page where CLAUDE.md's fps table found that removing
the event log took playback from 1.7 to 21.7 fps. This prompt closes the log by default and
mounts its rows only while it is open, and does the same for "The map as a list" and the
Details panel's technical half.

**Summary.** The document halves: 6,046 elements become 2,756. At 1x, the time spent in long
animation frames falls to between a quarter and a half. At 4x, **no fps change can be
claimed in either direction**: the same build measured anywhere from 1.7 to 31.4 fps. The
machine was shared with four other wave-2 worktrees building and testing, at 27--99% CPU
before the throttle was applied. Every module route gains 5.4--5.5 KB gzipped, from
`TermText`. A quiet-machine pass is still owed before any fps claim is made from this change.

#### How it was measured

- Port 3124, production builds, `next start` restarted for every build.
- "Before" is `219e54e` (the branch point) and "after" is this commit's source. Both were built
  in this worktree, then both `.next` folders were kept and swapped in turn, so rounds 1--4
  alternate builds on one machine state instead of comparing a morning against an afternoon.
- `perf/vitals.mjs 4 3` (4x throttle, median of 3) and `perf/vitals.mjs 1 3`. "Load" is the
  Windows CPU load percentage just before the pass, from other processes.
- Elements were counted with Playwright after `networkidle` plus 3 s:
  `document.querySelectorAll('*').length`, plus log-row buttons inside a `<details>`.

#### Document size

| Build  | Elements | Event-log rows mounted |
| ------ | -------: | ---------------------: |
| before |    6,046 |          601 (log open) |
| after  |    2,756 |      0 (log closed) |

#### Playback at 4x (`perf/vitals.mjs 4 3`)

| Pass                       | Build  | Load % |     fps | LoAF total ms |    CLS | INP ms |
| -------------------------- | ------ | -----: | ------: | ------------: | -----: | -----: |
| sequential 1               | before |      – |     2.1 |          3970 | 0.0252 |   1136 |
| sequential 2               | before |      – |     2.4 |          3624 | 0.0214 |   1792 |
| sequential 3               | after  |     99 |     1.1 |          4667 | 0.0261 |   1952 |
| sequential 4               | after  |     99 |     1.6 |          4617 | 0.0258 |   1904 |
| sequential 5 (rebuilt)     | before |     91 |     3.3 |          3731 | 0.0129 |   1152 |
| sequential 6               | before |     60 |     2.0 |          3973 | 0.0216 |   1744 |
| sequential 7 (rebuilt)     | after  |     68 |     2.1 |          3168 | 0.0299 |   1544 |
| sequential 8               | after  |     82 |     2.4 |          3655 | 0.0492 |   1480 |
| interleaved round 1        | before |     41 |     2.2 |          3561 | 0.0288 |   1416 |
| interleaved round 1        | after  |     27 |     1.9 |          3738 | 0.0445 |   1752 |
| interleaved round 2        | before |     80 |    16.2 |          2984 | 0.0374 |   1152 |
| interleaved round 2        | after  |     63 |    36.7 |          1752 | 0.0128 |    576 |
| interleaved round 3        | after  |     79 |    20.7 |          2516 | 0.0139 |    624 |
| interleaved round 3        | before |     66 |     1.7 |          3466 | 0.0214 |   1672 |
| interleaved round 4        | after  |     62 |    12.7 |          3103 | 0.0110 |   1104 |
| interleaved round 4        | before |     65 |    31.4 |          2213 | 0.0364 |    912 |

Both builds switch between two modes: about 2 fps in some passes, and 12--37 fps in
others. The mode doesn't follow the build or the measured load. Medians: before 2.3 fps
(8 passes), after 2.25 fps (8 passes). Neither is a result. Two things could explain the
split, and neither was checked. First, `vitals.mjs` takes the median over only the runs that
entered `playing`. Second, a run that reaches its end inside the 4 s window paints a
stationary page.

CLS stays under 0.1 in every pass for both builds (after: 0.011--0.049; before:
0.013--0.037). The two highest after-values (0.0445, 0.0492) are single passes. UX-4.4's CLS
check should look at the Details panel if they repeat.

#### Playback at 1x (`perf/vitals.mjs 1 3`)

| Round | Build  | Load % |  fps | LoAF total ms | INP ms |
| ----- | ------ | -----: | ---: | ------------: | -----: |
| 1     | before |     41 | 41.5 |          1153 |    312 |
| 1     | after  |     27 | 49.1 |           321 |    256 |
| 2     | before |     80 | 49.7 |           636 |    176 |
| 2     | after  |     63 | 49.7 |           271 |    144 |

fps sits at the machine's ~50 ceiling either way. The long-animation-frame total is lower
in the after build in both rounds: 1153 → 321 ms and 636 → 271 ms. That fits a smaller
document, but two rounds are not a result either.

#### First-load JS (`npm run perf:bundles`)

| Route             | Before (gzipped) | After (gzipped) | Change |
| ----------------- | ---------------: | --------------: | -----: |
| `/network-map`    |         190.7 KB |        196.1 KB |   +5.4 |
| `/packet-journey` |         250.3 KB |        255.8 KB |   +5.5 |
| `/dns-explorer`   |         295.1 KB |        300.5 KB |   +5.4 |

No dependency was added. This branch is the first to put `TermText` on module routes. The
spec requires it in the Steps list and the Details panel (uiux-spec.md §5.6), and it brings
`GlossaryTerm`, `Popover` with its positioning code, `next/link` and `matchTerms` with it. The
glossary data itself still loads on demand through `useInlineGlossary`. `/packet-journey` was
already 0.3 KB over the 250 KB budget, and is now 5.8 KB over.

### UX-2.5 — places, envelopes and a camera that follows

Folded in from `perf/uiux/ux-2.5.md`.

Branch `uiux/2-5`, base `219e54e`. Every figure below is a production build served by
`npx next start --port 3125`, restarted after each build. 4x CPU throttle, median of 3 runs
per figure unless stated.

**Read the fps figures with care: the machine was saturated throughout.** CPU sat at 100%, with other wave-2 worktrees building and serving on 3122 and 3123.
One build of this branch measured `/network-map` at 45.4 fps and, minutes later, at 13.7.
LCP on unchanged server-rendered text moved between 336 ms and 3.8 s. As `perf/uiux-baseline.md`
already says, a single pass here says nothing about a small change. So the comparison that
counts is the **alternated A/B** below: the base commit and this branch, built side by side
and served in turn on the same port under the same load.

#### First-load JS — `npm run perf:bundles`

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

#### Playback — alternated A/B (the comparison that counts)

A throwaway script (not committed): the base build, from a detached worktree of `219e54e`, and the branch build, each served on 3125 in turn,
`ROUTES=/network-map,/packet-journey,/api-visualizer`, two rounds (base, branch, base,
branch).

| Route             | Base (round 1 / 2) | Branch (round 1 / 2) | Read as |
| ----------------- | -----------------: | -------------------: | ------- |
| `/packet-journey` |        1.6 / 1.4 fps |          1.6 / 1.6 fps | **Not worse.** |
| `/api-visualizer` |        5.7 / 8.4 fps |          6.9 / 5.4 fps | Same range: noise. |
| `/network-map`    |       31.0 / 22.4 fps |         17.2 / 18.1 fps | Lower in both rounds; see below. |

##### `/network-map`: what was tried

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

#### Core Web Vitals, all ten routes

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

#### Node labels — `PLAYWRIGHT_PORT=3125 npm run uiux:screens -- ux-2.5`

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

#### Nothing new changes per frame through React

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

### Wave 2 gate (`wave-2`)

UX-W2, 2026-09-17, on the merge of `uiux/2-2` … `uiux/2-6` into `main` (UX-2.1 was already
there) plus the W2 follow-ups, in the main checkout, port 3100. No worktree servers were
running; the rest of the machine's load was not controlled.

**CI sequence:** `npm ci`, `lint`, `build`, `typecheck` green. `format:check` failed once, on
a test W2 itself had just added (`content.test.ts`, line length; fixed with Prettier).
`test:coverage`: 224 files, 5,005 tests, every threshold met (all files 96.3% statements,
87.6% branches). `test:e2e`: 311 passed. The server logs `NoFallbackError` twice during the
run: the unknown-lesson 404 routes, which `dynamicParams = false` answers that way; both
tests pass.

**`uiux:screens -- wave-2`:** Play is inside the first viewport on all nine simulating
modules at 1366x768 and 390x844, and every node label is at least 12px (12.06–19.2px;
baseline 3.5–16.8).

**`perf:bundles`**, first-load JS gzipped, against the UX-1.5 build:

| Route                  |   UX-1.5 |   Wave 2 |  Change |
| ---------------------- | -------: | -------: | ------: |
| `/internet-simulator`  | 350.2 KB | 365.5 KB |   +15.3 |
| `/network-diagnostics` | 323.0 KB | 338.4 KB |   +15.4 |
| `/api-visualizer`      | 322.1 KB | 337.6 KB |   +15.5 |
| `/http-explorer`       | 319.8 KB | 335.1 KB |   +15.3 |
| `/dns-explorer`        | 295.1 KB | 310.7 KB |   +15.6 |
| `/packet-journey`      | 250.3 KB | **266.5 KB** | +16.2 |
| `/https-explorer`      | 225.9 KB | 241.7 KB |   +15.8 |
| `/websocket-viewer`    | 220.1 KB | 235.9 KB |   +15.8 |
| `/network-map`         | 190.7 KB | 207.1 KB |   +16.4 |
| every lesson route     | 188.2 KB | 202.2 KB |   +14.0 |
| `/demo`                | 175.1 KB | 190.8 KB |   +15.7 |
| `/learn`               | 165.0 KB | 170.0 KB |    +5.0 |
| `/`                    | 154.6 KB | 162.9 KB |    +8.3 |
| `/learn/glossary`      | 156.2 KB | 160.9 KB |    +4.7 |
| `/_not-found`, `/start`| 154.6 KB | 159.6 KB |    +5.0 |
| `/_global-error`       | 131.5 KB | 131.5 KB |       0 |

(UX-1.5 column: the "before" figures in the UX-2.3 and UX-2.5 notes, which measured the
UX-1.5 tree; `/` is UX-2.2's own "before"; `/learn`, the glossary and 404 are the wave-1
table plus UX-1.5's +0.2.)

Where it comes from, from the branch notes above and the shape of the table: about **5 KB
on every route** is UX-2.1's shell (TopNav's Explore menu, MobileNav's Drawer and
SettingsMenu's Popover in the root layout); `/` adds UX-2.2's **+3.5**; every route that
renders a `SimulationView` or an embed adds UX-2.3's Stage (**~9.5**, UX-1.2's primitives
and `TermText` reaching module routes for the first time) and UX-2.5's canvas work (**+0.8–1.3**,
in the lazy canvas chunk on most routes). UX-2.4's own +5.5 is mostly the same `TermText`
2.3 already pulled in, so the two do not add. No dependency was added.
**`/packet-journey` is now 16.5 KB over the 250 KB budget** (was 0.3), and
`/https-explorer` and `/websocket-viewer` are still under it. **Explained, not fixed; the
gate needs this accepted or trimmed** (untried candidates, from UX-2.3's note: lazy
`RunRecap` and the `StageHelp` dialog body, and the Drawer and Popover behind first open).
Measure first.

**`perf:vitals`** (`BASE=http://127.0.0.1:3100`, the ten routes, 4x, median of 3), one pass:

| Route                  | LCP ms | CLS    | INP ms | Playback fps | LoAF count/ms |
| ---------------------- | -----: | -----: | -----: | -----------: | ------------: |
| `/`                    |    348 |      0 |     96 |            – |             – |
| `/network-map`         |    608 |      0 |    280 |         33.5 |          1/51 |
| `/packet-journey`      |   1540 |  0.035 |    376 |          3.2 |       10/3429 |
| `/dns-explorer`        |   1384 | 0.0011 |    176 |         49.8 |        3/752 |
| `/http-explorer`       |   1080 |      0 |     80 |         56.5 |        3/349 |
| `/https-explorer`      |   1036 |      0 |     56 |         57.4 |        3/294 |
| `/api-visualizer`      |   1396 | 0.0199 |     72 |         26.7 |      18/1480 |
| `/websocket-viewer`    |    824 | 0.0196 |     80 |         51.0 |        8/597 |
| `/internet-simulator`  |   1492 | 0.0001 |    128 |         46.8 |       6/1054 |
| `/network-diagnostics` |    352 | 0.0021 |     64 |         41.3 |        9/655 |

LCP passes on every route and the LCP element is text everywhere (the `h1` on `/`). CLS
passes everywhere; `/packet-journey`'s 0.035 is the largest (0.0161–0.0214 at wave 1).
Playback is at or above every wave-1 figure: `/packet-journey` 3.2 against 1.0–1.3 (UX-2.4's
closed, lazily mounted log took it from ~6,000 to ~2,750 elements), `/network-map` 33.5
against 16.9–19.4, `/api-visualizer` 26.7 against 4.1–5.6. The machine's load was not the
same as at wave 1, so these gains are not claims; what the pass shows is **no vitals
regression**. A quiet-machine pass is still owed.
