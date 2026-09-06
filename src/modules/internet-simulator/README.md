# `src/modules/internet-simulator` — the whole thing, once

Every other module takes one protocol apart. This one takes none of them apart: it puts a URL
bar in front of you, runs the eight stages of a real page load on one continuous timeline, and
shows where the time actually went. DNS is not explained here — the DNS Explorer explains DNS.
What is explained here is the **arrangement**: that a name lookup, a connection, a handshake,
and a request happen in that order, that each one costs round trips, and that on a slow link
the ordering matters far more than any of the bytes.

This is the flagship, and the primary call to action on the home page.

Simulated only. There is no `fetch` in this module, no socket, no host outside the names
RFC 2606 reserves or the addresses RFC 5737 reserves, and no code path from the address bar to
a real name server. `input.ts` is the boundary and says so at length.

## What is here

```
meta.ts                      # the registry id, and a typed accessor for the entry
input.ts                     # the address bar's zod boundary + the deep links out
waterfall.ts                 # the run, re-cut into devtools' named timing segments
stageDetail.ts               # the handful of facts each stage established
sim/                         # pure composition -- see "Composition, not duplication"
  stage.ts                   # the stage contract, the profiles, what a scenario declares
  pipeline.ts                # runs the eight stages, shifts them onto one timeline
  page.ts, topology.ts       # the page model and the machines a run touches
  stages/                    # url-parse, cache-check, dns, tcp, tls, http, cdn, render
scenarios/                   # eight authored page loads, including three failures
components/
  UrlBar.tsx                 # the address bar: validated, badged, and honest about coverage
  StageRail.tsx              # the eight stages as one bar, sized by real duration
  StageZoom.tsx              # one stage opened up, then handed off to its own module
  WaterfallChart.tsx         # the run as Chrome's Network panel would draw it
  NetworkProfileControls.tsx # five links, and the same scenario timed on each
  BrowserFrame.tsx           # the viewport: blank, then painted, with FP and LCP marked
InternetSimulatorModule.tsx  # composition root
```

## Composition, not duplication

Nothing in `sim/stages/` implements a protocol. Each stage delegates to
`@/core/protocols/{dns,tcp,tls,http}` — the same code the DNS Explorer, the Packet Journey,
the HTTPS Explorer, and the HTTP Explorer run — and contributes only the composition: it is
handed the state earlier stages produced, emits its events in its own local virtual time, and
lets `pipeline.ts` shift them by the accumulated offset.

That is why a stage may not read a clock and may not know its own offset. Everything it says
about time it says relative to its own start, so the pipeline can compose, skip, or truncate
stages without any stage being written to expect it. The property that falls out is the one the
rail depends on: its proportions **are** the stages' real virtual durations, because there is
nowhere else for a duration to come from.

If a stage ever needs logic that lives in another module's folder, the ESLint boundary rule
will block the import, and that is correct. Promote the logic to `@/core/protocols/` and have
both modules import it from there. Do not copy it.

## The handoff

Every stage with a module of its own offers a link into it carrying the URL currently in the
address bar — `/dns-explorer?name=…&type=A&from=internet-simulator`, and so on. The parameter
names are the vocabulary each target already uses for the thing it takes apart, and they are
built in one table in `input.ts`.

These are links, not imports: one module may not import another, so a target adopts a parameter
by reading its own search params. **No target reads them yet.** Until one does, the link still
lands on the right module and loses only the pre-fill. Adding that is a one-file change inside
the receiving module, and belongs to that module's own phase rather than to this one.

Two stages have no handoff on purpose. Parsing a URL and painting a page are browser behaviour
rather than protocols, and there is nowhere honest to send someone for them.

## Why the waterfall uses Chrome's words

Reading a real waterfall is a transferable skill, so `waterfall.ts` uses Chrome's segment names
verbatim — `Initial connection`, not "TCP connect"; `SSL`, not "TLS", even though this codebase
says TLS everywhere else. A learner who reads `Waiting (TTFB)` here should find the identical
words in a real Network panel and be looking at the identical thing. Renaming any of them is a
regression, whatever it does for internal consistency.

Subresource rows deliberately carry no `DNS Lookup`, `Initial connection` or `SSL` segment: the
document paid for all three once, and the subresources reuse its connection. A chart that
charged every row for them would teach the opposite of connection reuse.

## Rules for this folder

- No `fetch`, no `WebSocket`, no socket, no timer that stands in for one. Runs are pure
  functions of a scenario and a profile, and replay identically.
- No host outside `example.com` / `example.net` / `example.org` and no address outside the
  RFC 5737 documentation ranges.
- No protocol logic. If you are about to implement one, it belongs in `@/core/protocols/`.
- The `Simulated` badge on the address bar is not optional and does not get quieter. A field
  that looks exactly like a browser's without saying it is not one would be the single most
  misleading component in this product.
