# UX-2.3 — the Stage

Measured in the `uiux/2-3` worktree, 2026-09-17. "Before" is `main` at `219e54e` (the
UX-1.5 gate), served from the main checkout's existing production build on port 3123;
"after" is this branch, built here and served on the same port, `next start` restarted
after every build. The machine was shared throughout: other wave-2 worktrees were
building, serving (3122, 3125) and running Playwright, and one Playwright run of this
branch was killed by the OS for low memory (rerun with `--workers=2`, green). Read every
timing below against that, and against the spreads recorded in `perf/uiux-baseline.md`.

## `perf:bundles` — first-load JS, gzipped

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

## `perf:vitals` — the ten routes, 4x CPU, median of 3

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

## `?scenario=` does not change LCP

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

## `uiux:screens -- ux-2.3`

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
