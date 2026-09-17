# `src/components/glossary` — glossary words inside any sentence

- `GlossaryTerm` — one word: a dotted-underline button opening a `Popover` with the term,
  its `short` definition and a link to `/learn/glossary#<id>`.
- `TermText` — a plain string with the first occurrence of each glossary word linked, up to
  `max`. For step captions, the Steps list, Details summaries and scenario questions; never
  for log rows (uiux-spec.md §5.6). `matchTerms` holds the matching rules.
- `useInlineGlossary` — loads `@/core/glossary/inline` on demand, once for the page.

Rules:

- **Import only `@/core/glossary/inline`, and only through `useInlineGlossary`.** A static
  import puts the whole glossary (definitions included) in a route's first load, which
  breaks the under-4 KB budget. Until the index arrives, words render as plain text.
- The Learning Center's `<Term>` is a thin wrapper over `GlossaryTerm`; change behaviour
  here, not there.
- Nothing here may import from `@/modules/**`.
