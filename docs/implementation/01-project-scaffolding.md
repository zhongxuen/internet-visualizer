# 01 — Project scaffolding & foundations

## Goal

A running Next.js + TypeScript + Tailwind app with the folder architecture, path
aliases, lint/format/test tooling, and the **architectural boundary rules** the rest of
the project depends on. No product features yet.

## Prerequisites

None — this is the first phase. Node 22+ and npm 10+ required.

---

## Deliverables

```
package.json
tsconfig.json
next.config.ts
eslint.config.mjs
.prettierrc
vitest.config.ts
.env.example
.gitignore                      (extended)
src/
  app/
    layout.tsx
    page.tsx
    globals.css
  core/                         # framework-free logic. NO react/next/react-flow imports.
    sim/
    net/
    types/
  components/                   # reusable UI (viz + generic)
  modules/                      # one folder per protocol module
    registry.ts
  lib/                          # small shared utils (cn, format, ids)
tests/
  setup.ts
```

---

## Steps

### 1. Scaffold the app

Use `create-next-app` with the App Router, TypeScript, Tailwind, ESLint, a `src/`
directory, and the `@/*` import alias. Verify both the dev script and the build script
work after scaffolding.

Pin nothing manually; take the current stable versions `create-next-app` installs, then
record the resulting Next / React / Tailwind major versions in `CLAUDE.md`.

### 2. Install the additional dependencies

Runtime:

- `@xyflow/react` — React Flow (current package name; `react-flow-renderer` is dead)
- `motion` — animation primitives (the Framer Motion successor package)
- `zustand` — small client store for playback / UI state
- `clsx` + `tailwind-merge` — the `cn()` helper
- `zod` — input validation (required by the security rules, used heavily in phase 12)
- `lucide-react` — icons

Dev:

- `vitest`, `@vitest/coverage-v8`
- `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`
- `prettier`, `prettier-plugin-tailwindcss`
- `eslint-plugin-boundaries` (or `eslint-plugin-import` with `no-restricted-paths`)

### 3. Configure path aliases

In `tsconfig.json`:

```json
"paths": {
  "@/*": ["./src/*"],
  "@/core/*": ["./src/core/*"],
  "@/components/*": ["./src/components/*"],
  "@/modules/*": ["./src/modules/*"],
  "@/lib/*": ["./src/lib/*"]
}
```

### 4. Enforce the architecture boundary in ESLint — the important part

Add rules that **fail lint** on violations:

1. Files under `src/core/**` may not import `react`, `react-dom`, `next`, `next/*`,
   `@xyflow/react`, `motion`, or anything under `@/components/**` or `@/app/**`.
2. Files under `src/modules/<a>/**` may not import from `src/modules/<b>/**` — modules
   are independent; shared code goes through `src/core` or `src/components`.
3. `src/components/**` may not import from `src/modules/**`.

This is the mechanical enforcement of the two rules in `CLAUDE.md` ("visualization logic
must stay separated from networking logic", "don't touch unrelated modules"). Without
it, both rules erode within a few phases.

### 5. Set up Vitest

`vitest.config.ts` with two projects:

- **node** environment for `src/core/**` — fast, no DOM
- **jsdom** environment for `src/components/**` and `src/modules/**`

Scripts: `test`, `test:watch`, `test:coverage`.

### 6. Set up Prettier

`.prettierrc` with `prettier-plugin-tailwindcss` so class order is deterministic.
Scripts: `format`, `format:check`.

### 7. Extend `.gitignore`

Keep the existing `md-files/` entry. Add `node_modules/`, `.next/`, `out/`, `.env*.local`,
`coverage/`, `.vercel/`.

### 8. Dark theme baseline

The product is dark-mode-first. Set `<html class="dark">` and a near-black background in
`globals.css` now, so nothing built later assumes a light canvas. Full tokens land in
phase 02.

### 9. Module registry stub

`src/modules/registry.ts`:

```ts
export type ModuleStatus = 'planned' | 'in-progress' | 'ready';

export interface ModuleMeta {
  id: string;
  title: string;
  route: string;
  summary: string;
  status: ModuleStatus;
  topics: string[]; // e.g. ['DNS', 'UDP']
  /** true only for modules that can touch a real network */
  usesRealNetwork: boolean;
}

export const MODULES: ModuleMeta[] = [/* all ten spec modules, status: 'planned' */];
```

Seed all ten modules from the spec as `'planned'`. Each later phase flips its own entry
to `'ready'`.

### 10. Update `CLAUDE.md`

Replace the "pre-implementation" section with the real commands: `npm run dev`, `build`,
`lint`, `format`, `test`, and **how to run a single test**
(`npx vitest run path/to/file.test.ts -t "test name"`).

---

## Acceptance criteria

- [ ] `npm run dev` serves a dark page at `localhost:3000` with no console errors
- [ ] `npm run build` succeeds
- [ ] `npm run lint` passes
- [ ] `npm test` runs and exits 0
- [ ] A deliberate `import { useState } from 'react'` inside `src/core/` **fails lint**
- [ ] A deliberate cross-module import **fails lint**
- [ ] `CLAUDE.md` lists the real commands

---

## Prompts to execute

### Prompt 1.1 — scaffold

```
Read CLAUDE.md, docs/implementation/00-overview.md, and
docs/implementation/01-project-scaffolding.md.

Scaffold the Next.js app in the repo root using create-next-app: App Router, TypeScript,
TailwindCSS, ESLint, src/ directory, @/* import alias. Use current stable versions.
Do not build any product features.

Then verify `npm run dev` and `npm run build` both work, and report the installed
Next.js, React, and Tailwind major versions.
```

### Prompt 1.2 — dependencies and tooling

```
Follow steps 2, 3, 5, 6, and 7 of docs/implementation/01-project-scaffolding.md.

Install the runtime deps (@xyflow/react, motion, zustand, clsx, tailwind-merge, zod,
lucide-react) and the dev deps (vitest, @vitest/coverage-v8, @testing-library/react,
@testing-library/jest-dom, jsdom, prettier, prettier-plugin-tailwindcss).

Configure the tsconfig path aliases, Vitest with separate node and jsdom environments,
Prettier with the Tailwind plugin, and extend .gitignore. Add npm scripts: dev, build,
start, lint, format, format:check, test, test:watch, test:coverage.

Add one trivial passing test under tests/ to prove the runner works.
```

### Prompt 1.3 — architecture boundary rules

```
Follow step 4 of docs/implementation/01-project-scaffolding.md. Add ESLint rules that
enforce:

1. src/core/** must not import react, react-dom, next, next/*, @xyflow/react, motion,
   @/components/**, or @/app/**
2. src/modules/<a>/** must not import from src/modules/<b>/**
3. src/components/** must not import from src/modules/**

Prove each rule fires by temporarily adding a violating import and showing the lint
error, then remove the violations. Do not leave them in the tree.
```

### Prompt 1.4 — skeleton, dark baseline, registry, docs

```
Follow steps 8, 9, and 10 of docs/implementation/01-project-scaffolding.md.

Create the folder skeleton (src/core/{sim,net,types}, src/components, src/modules,
src/lib), each with a short README.md stating what belongs there and what must never be
imported. Add src/lib/cn.ts (clsx + tailwind-merge).

Set the dark-mode baseline in globals.css and layout.tsx. Create src/modules/registry.ts
with the ModuleMeta type and all ten spec modules seeded as status 'planned'.

Finally, update CLAUDE.md: replace the pre-implementation section with the real build,
lint, format, and test commands, including how to run a single test.
```
