# 02 — Design system & app shell

## Goal

A dark, modern, animated shell: design tokens, a small primitive component set, the
global navigation driven by the module registry, and a home page that presents the ten
modules as an explorable grid. Every later module drops into this shell without
inventing its own chrome.

## Prerequisites

Phase 01.

---

## Deliverables

```
src/app/
  layout.tsx                 # shell: nav + main + motion provider
  page.tsx                   # home / module explorer
  (modules)/layout.tsx       # shared module chrome: title, topics, safety badge
src/styles/
  tokens.css                 # CSS custom properties (colors, layers, timing)
src/components/ui/
  Button.tsx  Card.tsx  Badge.tsx  Tooltip.tsx  Tabs.tsx
  Panel.tsx   CodeBlock.tsx  Kbd.tsx  EmptyState.tsx
src/components/shell/
  TopNav.tsx  ModuleGrid.tsx  ModuleCard.tsx  SafetyBadge.tsx
src/components/motion/
  MotionProvider.tsx         # reduced-motion context
  useReducedMotionSafe.ts
src/lib/
  theme.ts                   # typed token accessors
```

---

## Steps

### 1. Define the token layer

Put raw values in `src/styles/tokens.css` as CSS custom properties, then expose them to
Tailwind. Tokens, not ad-hoc hex codes, anywhere in components.

Required token groups:

- **Surface** — `--bg-base` (near black), `--bg-raised`, `--bg-overlay`, `--border`,
  `--border-strong`
- **Text** — `--text-primary`, `--text-secondary`, `--text-muted`
- **Accent** — one primary accent used for interactive affordances
- **Semantic protocol colors** — a fixed palette assigned per OSI layer, reused by every
  module so a "transport layer" thing is always the same color everywhere:
  `--layer-link`, `--layer-network`, `--layer-transport`, `--layer-session`,
  `--layer-application`
- **State** — `--state-ok`, `--state-warn`, `--state-error`, `--state-pending`
- **Motion** — `--dur-fast` (120ms), `--dur-base` (240ms), `--dur-slow` (600ms),
  `--ease-out`, `--ease-inout`

Two hard rules:

1. **Never encode meaning in color alone.** Every colored element also carries a shape,
   icon, or label. Layer colors get a matching short label (`L3`, `L4`, …).
2. Check contrast: body text ≥ 4.5:1, large text and UI borders ≥ 3:1 against the dark
   surface behind them.

### 2. Build the UI primitives

Small, unopinionated, no business logic. Each takes `className` and merges via `cn()`.

- `Button` — variants: `primary | secondary | ghost | danger`; sizes `sm | md`
- `Card` / `Panel` — the standard raised surface with border and optional header
- `Badge` — pill; used for topics, protocol layers, and status
- `Tooltip` — keyboard-accessible (focus opens it, `Esc` closes), not hover-only
- `Tabs` — roving-tabindex keyboard nav
- `CodeBlock` — monospace block with optional line highlighting; used constantly to show
  packet headers and request/response text
- `Kbd` — renders keyboard shortcut hints
- `EmptyState` — placeholder for modules still `planned`

Write one render test per primitive.

### 3. Motion provider and reduced-motion policy

`MotionProvider` reads `prefers-reduced-motion` and exposes a context with:

```ts
{
  reduced: boolean;
  scale: (ms: number) => number;
}
```

Policy, applied everywhere from here on:

- `reduced === false` → normal tweened animation
- `reduced === true` → transitions collapse to near-instant (`scale()` returns ~0);
  motion is replaced by state change plus a step label. **The simulation still runs and
  is still fully explorable** — only the tweening is removed.

Also allow a manual override in the UI (`Motion: full / reduced`) — some users want it
per-session without changing OS settings.

### 4. Top navigation

`TopNav` reads `MODULES` from the registry. Groups them: **Explore** (simulation
modules), **Tools** (diagnostics), **Learn** (learning center). Shows the module status
and, for anything with `usesRealNetwork: true`, a `SafetyBadge`.

`SafetyBadge` is the visual half of the security rule — two variants only:

- `simulated` — muted, calm, the default everywhere
- `live` — distinctly different color and icon, with a tooltip stating that this touches
  a real network

Any surface that can cause a real network request must render the `live` badge. This is
non-negotiable and is re-checked in phase 12.

### 5. Home page — module explorer

A grid of `ModuleCard`s from the registry. Each card: title, one-line summary, topic
badges, status, and a subtle idle animation hinting at what the module shows (e.g. a
looping dot along a path for Packet Journey). `planned` modules render disabled with an
`EmptyState` on their route.

Above the grid, one short hero line and a single primary CTA into the Internet Simulator
(phase 11) — the flagship "type a URL, watch everything happen" experience.

### 6. Shared module chrome

`src/app/(modules)/layout.tsx` gives every module the same frame: back link, title,
topic badges, safety badge, and a right-hand slot for the explanation panel. Modules
supply content, never chrome.

### 7. Keyboard and focus baseline

- Visible focus ring on every interactive element, tokenized
- Skip-to-content link in the shell
- `main` landmark, one `h1` per page
- No focus traps outside intentional modals

---

## Acceptance criteria

- [ ] All colors in components come from tokens; no raw hex outside `tokens.css`
- [ ] Home page lists all ten modules from the registry — adding a registry entry adds a
      card with no other edit
- [ ] Toggling OS reduced-motion visibly removes tweening but leaves the UI usable
- [ ] Full keyboard traversal of nav → card → module route works, focus always visible
- [ ] Primitives have render tests; `npm test` green
- [ ] Contrast checked on text and borders

---

## Prompts to execute

### Prompt 2.1 — tokens

```
Read docs/implementation/02-design-system-and-shell.md.

Implement step 1: create src/styles/tokens.css with the surface, text, accent, per-OSI-
layer, state, and motion token groups described there, wire them into the Tailwind
theme, and import them from globals.css.

Add src/lib/theme.ts exporting typed accessors for the layer tokens (a LayerKey union
plus label/color lookup) so modules never hardcode a layer color.

Verify the contrast ratios of text and border tokens against the dark surfaces and
report the numbers.
```

### Prompt 2.2 — UI primitives

```
Implement step 2 of docs/implementation/02-design-system-and-shell.md: build Button,
Card, Panel, Badge, Tooltip, Tabs, CodeBlock, Kbd, and EmptyState in
src/components/ui/.

Requirements: token-driven styling only, className merged via cn(), Tooltip openable by
keyboard focus and dismissible with Escape, Tabs with roving-tabindex keyboard nav.
Add one render test per primitive.
```

### Prompt 2.3 — motion provider

```
Implement step 3 of docs/implementation/02-design-system-and-shell.md: MotionProvider
and useReducedMotionSafe in src/components/motion/.

It must read prefers-reduced-motion, expose { reduced, scale }, support a manual
session override, and be mounted in the root layout. Add a test that asserts scale()
collapses durations when reduced is true.
```

### Prompt 2.4 — shell, nav, home page

```
Implement steps 4, 5, 6, and 7 of docs/implementation/02-design-system-and-shell.md.

Build TopNav (registry-driven, grouped Explore/Tools/Learn), SafetyBadge with its two
variants, ModuleCard and ModuleGrid, the home page, and the shared (modules) layout.
Add the skip link, focus-ring baseline, and landmarks.

Do not implement any module internals — planned modules route to an EmptyState.
```
