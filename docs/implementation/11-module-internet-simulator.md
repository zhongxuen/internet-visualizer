# 11 — Module: Internet Simulator (end-to-end composite)

## Goal

The flagship experience: **type a URL, press enter, and watch everything happen** — from
the browser's URL parsing through DNS, TCP, TLS, HTTP, CDN, and rendering, on one
continuous timeline, with the ability to zoom into any stage and hand off to that
stage's dedicated module.

This is the module that ties the product together and is the demo you show people.

Simulated only.

## Prerequisites

Phases 06–10. This module **composes** their simulation logic; it must not duplicate it.

---

## Deliverables

```
src/modules/internet-simulator/
  meta.ts
  sim/
    pipeline.ts        # the ordered stage list and how stages compose
    stages/
      url-parse.ts     # scheme, host, port, path, query, fragment
      cache-check.ts   # browser cache, service worker, HSTS preload
      dns-stage.ts     # delegates to the DNS resolver logic
      tcp-stage.ts     # delegates to the TCP logic
      tls-stage.ts     # delegates to the TLS handshake logic
      http-stage.ts    # delegates to the HTTP exchange logic
      cdn-stage.ts     # edge hit/miss, origin fetch
      render-stage.ts  # HTML parse, subresource discovery, critical path
  scenarios/
    first-visit-https.ts       # cold everything
    repeat-visit-cached.ts     # warm DNS, TLS resumption, 304s
    cdn-hit.ts
    cdn-miss-origin-fetch.ts
    slow-network.ts            # 3G-ish latency, watch the cost of round trips
    failure-dns.ts             # NXDOMAIN -> browser error page
    failure-tls.ts             # bad certificate -> interstitial
    failure-timeout.ts
  components/
    UrlBar.tsx                 # the input, validated, badged `simulated`
    StageRail.tsx              # the pipeline as a horizontal rail with timings
    WaterfallChart.tsx         # devtools-style network waterfall
    StageZoom.tsx              # expand one stage into its detailed view
    NetworkProfileControls.tsx # latency/bandwidth/loss presets
    BrowserFrame.tsx           # mock browser chrome + progressive page render
  InternetSimulatorModule.tsx
src/app/(modules)/internet-simulator/page.tsx
```

---

## Design

### Composition, not duplication

`pipeline.ts` runs each stage's existing simulation logic and **offsets its events** onto
one shared timeline:

```ts
const stages = [
  urlParse,
  cacheCheck,
  dnsStage,
  tcpStage,
  tlsStage,
  httpStage,
  cdnStage,
  renderStage,
];
// each returns SimEvent[] in local virtual time; the pipeline shifts them by the
// accumulated offset and tags them with a stageId
```

If a stage needs logic that lives in another module's folder, the ESLint boundary rule
will block the import — that is correct. Promote the shared logic to `src/core/protocols/`
and have both the module and the simulator import from there. **Do not copy code.**

This refactor is expected and healthy; budget time for it in this phase.

### The stage rail

A horizontal rail of the eight stages showing each one's elapsed virtual time as a
proportional bar — the same "where did the time actually go" insight a devtools waterfall
gives, but explained. Clicking a stage:

1. Seeks the timeline to that stage
2. Expands `StageZoom` with the detailed view
3. Offers "Open in DNS Explorer" (etc.) — a deep link carrying the current input, so the
   user can go study that protocol in its own module and come back

That handoff is what turns a demo into a learning path.

### The waterfall

`WaterfallChart` mimics browser devtools: one row per request (document, then discovered
subresources), with the standard segments — queueing, DNS, connect, TLS, request sent,
waiting/TTFB, content download. Teaching a user to read a real waterfall is a genuinely
useful transferable skill, so match devtools' vocabulary exactly.

### Network profiles

Presets — `Fiber` (5 ms RTT), `Cable` (25 ms), `4G` (60 ms), `3G` (200 ms, low
bandwidth), `Satellite` (600 ms). Changing the profile re-runs the same scenario. The
lesson lands hard on the slow profiles: on a 600 ms RTT link the handshakes dominate
completely, which is exactly why TLS 1.3, 0-RTT, h3, and connection reuse exist.

### The browser frame

`BrowserFrame` shows a mock viewport painting progressively as the render stage
proceeds: blank → HTML received → CSS applied → images loaded. Mark **First Paint** and
**Largest Contentful Paint** on the timeline. Show a render-blocking stylesheet delaying
first paint, since that is the most common real-world performance lesson.

### Failure scenarios

Each failure ends in the realistic browser outcome — `DNS_PROBE_FINISHED_NXDOMAIN`, the
certificate interstitial, `ERR_CONNECTION_TIMED_OUT` — with an explanation of what
actually failed and where. Users have all seen these errors; connecting them to the
underlying stage is high-value.

---

## Acceptance criteria

- [ ] All eight stages run on one continuous timeline with correct cumulative timing
- [ ] No protocol logic is duplicated — shared logic lives in `src/core/protocols/`
- [ ] Stage rail proportions match actual virtual durations
- [ ] Deep links from a stage into its dedicated module carry the current input
- [ ] Waterfall uses devtools' standard segment names
- [ ] Switching network profile re-runs and visibly changes the timing balance
- [ ] Repeat-visit scenario is dramatically faster than first-visit, and the UI explains
      each thing that got skipped
- [ ] All three failure scenarios end in the realistic browser error with an explanation
- [ ] Registry entry `'ready'`

---

## Prompts to execute

### Prompt 11.1 — extract shared protocol logic

```
Read docs/implementation/11-module-internet-simulator.md.

Before building the simulator: identify every piece of protocol logic in
src/modules/{packet-journey,dns-explorer,http-explorer,https-explorer} that the
end-to-end pipeline needs, and promote it to src/core/protocols/ (dns/, tcp/, tls/,
http/). Update the owning modules to import from the new location.

Do not copy code — move it. Keep all existing tests passing and move them alongside.
Confirm `npm run lint` and `npm test` are green before continuing.
```

### Prompt 11.2 — pipeline and stages

```
Implement src/modules/internet-simulator/sim/ per the phase doc: pipeline.ts plus the
eight stages (url-parse, cache-check, dns-stage, tcp-stage, tls-stage, http-stage,
cdn-stage, render-stage).

Each stage returns SimEvents in local virtual time; the pipeline shifts them by the
accumulated offset and tags each with a stageId. Stages must delegate to
src/core/protocols/ — no reimplemented protocol logic.

Then implement the eight scenarios listed in the phase doc, including the three failure
cases. Test that stage offsets compose correctly and that the repeat-visit scenario is
measurably faster than first-visit.
```

### Prompt 11.3 — module UI

```
Implement the Internet Simulator UI per docs/implementation/11-module-internet-simulator.md:
UrlBar (zod-validated, badged `simulated`), StageRail with proportional timing bars and
click-to-zoom, StageZoom, WaterfallChart using devtools' standard segment names,
NetworkProfileControls with the five presets, and BrowserFrame with progressive painting
plus First Paint and LCP markers. Add the route.

Each stage must offer a deep link into its dedicated module carrying the current input.
Then flip the registry entry to 'ready' and make this the primary CTA on the home page.
```
