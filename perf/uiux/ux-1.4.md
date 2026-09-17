# UX-1.4 — preferences store, pre-paint attributes, pause at steps

Measured in the `uiux/1-4` worktree, both builds from the same machine, `node
perf/bundles.mjs` against `.next` (no server needed). "Before" is `main` at `0fbb3a4`,
built in this worktree before any change; "after" is this branch.

## First-load JS, gzipped

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

## Vitals and playback

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
