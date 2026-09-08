# `perf/` — the performance measurements

Phase 14 section 3 sets budgets and says "measure, do not guess". These are the two
scripts that measure, kept in the repo so the numbers in that section can be reproduced
rather than believed.

```bash
npm run build
npx next start --port 3100          # in another shell

node perf/bundles.mjs               # per-route first-load JS, gzipped
node perf/vitals.mjs 4 3            # CWV + playback: 4x CPU throttle, median of 3
ROUTES=/,/packet-journey node perf/vitals.mjs 4 3
```

Both read a **production build**. `next start` reads the build manifest once, at boot, so
restart it after every `next build` — measuring a rebuilt app against a server that is
still serving the previous manifest is the easiest way to record a number that means
nothing.

## The budgets

| Budget                            | From                                     |
| --------------------------------- | ---------------------------------------- |
| LCP < 2.5 s, CLS < 0.1, INP < 200 ms | home page and a representative module |
| Initial JS for a module route < 250 KB gzipped | every module route           |
| 60 fps playback with ~50 nodes and ~20 packets | every module route           |

## How to read the numbers

**`bundles.mjs`** sums the gzipped size of every `static/chunks/*.js` the prerendered HTML
references, deduped, per route. It skips the legacy polyfill bundle, which Next ships with
`noModule` — no browser that can run the app downloads it, and counting it inflates every
route by the same ~39 KB while hiding the ones that move.

**`vitals.mjs`** drives Chromium through Playwright with `Emulation.setCPUThrottlingRate`
and reports the median of N runs. Two caveats worth stating whenever these numbers are
quoted:

- **The network is not throttled.** The server is local, so TTFB is ~0 and LCP is
  optimistic. LCP passing here is weaker evidence than LCP failing would be.
- **The CPU multiplier is a stand-in, not a device.** 4x is roughly a mid-range laptop
  against the machine that ran it. Use it to compare a change against its own baseline,
  which is what it is for; do not read an absolute figure off it.

`playback` is measured over four seconds of a run actually playing — the script asserts
the Play control flipped to Pause first, because a stationary page reports a perfect
frame rate. Alongside the frame count it reports **long animation frames**: every frame
the renderer took more than ~50 ms, with the scripting time inside it. A run holding
60 fps produces none of those, which makes them the more honest of the two figures.
