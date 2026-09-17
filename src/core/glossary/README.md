# `src/core/glossary` — one term list for the whole product

Plain data: every term the product defines, with a one-sentence `short` for popovers and
a longer `definition` for `/learn/glossary`. It lives in `src/core` so that module screens
and shared components can define a word too; no module may import another, and every one
may import core.

```
terms.ts              # the base entries (the sixty-two the lessons were written against)
extra/<module-id>.ts  # one file per registry module, each adding that module's own terms
index.ts              # GLOSSARY: terms + every extra, merged in registry order
lookup.ts             # lookupTerm (id, spelling or alias, any case) and sortedGlossary
inline.ts             # spelling -> { slug, term, short }: the only file a popover imports
```

Rules:

- **A module adds terms only to its own `extra/<module-id>.ts`.** That is what lets
  module passes run in parallel without touching the same file.
- **No spelling answers to two entries**, across the base and every extra.
  `__tests__/glossary.test.ts` asserts it, and names the two files that collide.
- **The writing rules are in `terms.ts`**: `short` is one sentence that stands alone,
  `definition` is two or three.
- Nothing here imports anything outside `src/core`.
