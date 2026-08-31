# `src/modules` — one folder per protocol module

Each module is **independent**. A module folder owns its simulation inputs, its
scenarios, and its module-specific views.

## Rules

- `src/modules/<a>/**` must **NEVER** import from `src/modules/<b>/**`. Shared code goes
  through `@/core` or `@/components`. Enforced by `eslint.config.mjs`.
- Networking logic goes in `sim/`, is pure, and is testable without a DOM.
- Rendering goes in `components/`, and is built out of `@/components` primitives.
- `registry.ts` is the single manifest of modules. Adding a module = adding a folder
  plus one registry entry.

## Conventional shape

```
<module-id>/
  meta.ts          # the registry entry for this module
  sim/             # pure simulation -- no React
  scenarios/       # typed scenario data
  components/      # module-specific views
  <Name>Module.tsx # composition root
```
