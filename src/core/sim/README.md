# `src/core/sim` — the simulation kernel

The virtual clock, event types, and the runner that turns a scenario into an ordered
`SimEvent[]`. Built in phase 03.

Rules:

- Deterministic: identical scenario in, identical event list out. Seeded RNG only.
- No wall-clock time and no `Math.random()`.
- No React, no DOM. See `../README.md` for the full import ban list.
