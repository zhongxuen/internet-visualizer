# `src/modules` — one folder per protocol module

Each module is **independent**. A module folder owns its simulation inputs, its
scenarios, and its module-specific views.

## Rules

- `src/modules/<a>/**` must **NEVER** import from `src/modules/<b>/**`. Shared code goes
  through `@/core` or `@/components`. Enforced by `eslint.config.mjs`.
- Networking logic goes in `sim/`, is pure, and is testable without a DOM.
- Protocol logic that a second module could need does **not** live in `sim/`. It is
  promoted to `@/core/protocols/<protocol>/` and imported from there by everyone — the
  answer to rule 1 is always to move shared logic out, never to copy it in.
- Rendering goes in `components/`, and is built out of `@/components` primitives.
- `registry.ts` is the single manifest of modules. Adding a module = adding a folder
  plus one registry entry.
- `scenarios.ts` is the single manifest of **embeddable runs** — which modules the
  Learning Center may drop a simulation from, and how to turn one of their scenarios
  into the `{ topology, result }` pair `SimulationView` draws. Both files are direct
  children of this folder rather than folders inside it, which is what exempts them from
  rule 1: a manifest has to name every module, and nothing else may.
- A module that ships a scenario catalogue re-exports it from its `index.ts` and adds
  one loader to `scenarios.ts`. Never a list of scenario **ids** — a loader names a
  module and reads whatever that module currently offers, so a scenario cannot exist in
  one place and be missing in the other.

## Conventional shape

```
<module-id>/
  meta.ts          # the registry entry for this module
  sim/             # pure simulation -- no React; this module's own composition only
  scenarios/       # typed scenario data
  components/      # module-specific views
  <Name>Module.tsx # composition root
```
