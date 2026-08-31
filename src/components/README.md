# `src/components` — reusable UI

Generic UI plus the **reusable visualization primitives** (timeline playback controls,
packet animation, node/link renderers, inspector panels). Built in phases 02 and 04.

## Rules

- May import from `@/core/**` and `@/lib/**`.
- Must **NEVER** import from `@/modules/**`. Components are shared building blocks;
  if a component needs module-specific knowledge, it is not a shared component.
  Enforced by `eslint.config.mjs`.
- Animation belongs here once and is reused. Modules never write their own animation
  loop.
