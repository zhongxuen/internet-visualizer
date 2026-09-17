# UX-2.4: steps, details and a log that stays out of the way

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

## How it was measured

- Port 3124, production builds, `next start` restarted for every build.
- "Before" is `219e54e` (the branch point) and "after" is this commit's source. Both were built
  in this worktree, then both `.next` folders were kept and swapped in turn, so rounds 1--4
  alternate builds on one machine state instead of comparing a morning against an afternoon.
- `perf/vitals.mjs 4 3` (4x throttle, median of 3) and `perf/vitals.mjs 1 3`. "Load" is the
  Windows CPU load percentage just before the pass, from other processes.
- Elements were counted with Playwright after `networkidle` plus 3 s:
  `document.querySelectorAll('*').length`, plus log-row buttons inside a `<details>`.

## Document size

| Build  | Elements | Event-log rows mounted |
| ------ | -------: | ---------------------: |
| before |    6,046 |          601 (log open) |
| after  |    2,756 |      0 (log closed) |

## Playback at 4x (`perf/vitals.mjs 4 3`)

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

## Playback at 1x (`perf/vitals.mjs 1 3`)

| Round | Build  | Load % |  fps | LoAF total ms | INP ms |
| ----- | ------ | -----: | ---: | ------------: | -----: |
| 1     | before |     41 | 41.5 |          1153 |    312 |
| 1     | after  |     27 | 49.1 |           321 |    256 |
| 2     | before |     80 | 49.7 |           636 |    176 |
| 2     | after  |     63 | 49.7 |           271 |    144 |

fps sits at the machine's ~50 ceiling either way. The long-animation-frame total is lower
in the after build in both rounds: 1153 → 321 ms and 636 → 271 ms. That fits a smaller
document, but two rounds are not a result either.

## First-load JS (`npm run perf:bundles`)

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
