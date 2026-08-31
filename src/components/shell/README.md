# `src/components/shell` — the app chrome

Everything that frames a module but is not part of one: the top navigation, the module
explorer grid on the home page, the shared module header, the skip link, the motion
toggle, and the safety badge.

## Rules

- **Registry-driven, never hardcoded.** `TopNav`, `ModuleGrid`, and `ModuleChrome` read
  `@/modules/registry` (the one file `src/components` may import from `src/modules`).
  Adding a module is a registry edit and nothing else — no component in here may hold a
  list of module ids. Group membership lives on the entry as `group`, not in the nav.
- **Modules supply content, never chrome.** Back link, title, topic badges, safety
  badge, and the explanation-panel slot all belong to `ModuleChrome`. A module route
  that draws its own header, or a second `h1`, is doing the layout's job.
- **`SafetyBadge` has exactly two variants.** `simulated` and `live`. Any surface that
  can cause a real network request renders `live`. Re-checked in phase 12; do not add a
  third state in between.
- Decoration stays decorative: `ModuleGlyph` is `aria-hidden`, uses only the accent and
  muted tokens (the OSI layer palette means something specific and is not spent on
  ornament), and animates only through the shared `animate-idle-*` utilities in
  `src/styles/motion.css`.
