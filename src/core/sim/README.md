# `src/core/sim` — the simulation kernel

The virtual clock, event types, and the runner that turns a scenario into an ordered
`SimEvent[]`. Built in phase 03.

Rules:

- Deterministic: identical scenario in, identical event list out. Seeded RNG only.
- No wall-clock time and no `Math.random()`.
- No React, no DOM. See `../README.md` for the full import ban list.

## What is here now

- `result.ts` — `SimResult` and `summarizePhases`: the contract the kernel will produce
  and the renderer already consumes.
- `project.ts` — `projectAt(result, t)` turns a `SimResult` into the `VisualState` on
  screen at virtual time `t`. A pure function of `t` with no accumulated animation state,
  which is what makes scrubbing backwards exact. Components render its output; they never
  compute it.
- `playback.ts` — the playback state machine: status, virtual time, speed, and the
  transitions behind every playback control. Plain functions over a plain value, with no
  clock of its own — something outside calls `tick(state, timeline, deltaMs)`. Zustand
  wraps it in `src/components/viz/hooks/usePlayback.ts`; the rules are tested here.
- `toyRun.ts` — a hand-authored two-hop ping run. It stands in for
  `Simulation.run(scenario)` until the kernel lands, so the visualization layer could be
  built and demonstrated against the real shape of the data. Replacing it changes nothing
  downstream: nothing in the renderer knows where a `SimResult` came from.

Still to come with the rest of phase 03: `clock.ts`, `rng.ts`, `scenario.ts`,
`simulation.ts`, `builder.ts`, `index.ts`.
